import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("scanner builds a code evidence graph from a linked repo", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "whereami-static-"));
  const repoPath = path.join(tempRoot, "fixture-platform");
  const outputPath = path.join(tempRoot, "snapshot.json");
  const configPath = path.join(tempRoot, "whereami.config.json");

  await mkdir(path.join(repoPath, "backend", "cmd", "server"), {
    recursive: true,
  });
  await mkdir(path.join(repoPath, "frontend", "src", "api"), {
    recursive: true,
  });
  await mkdir(path.join(repoPath, "services", "engine", "api", "routes"), {
    recursive: true,
  });

  await writeFile(
    path.join(repoPath, "backend", "cmd", "server", "routes.go"),
    `package server

func registerRoutes(r Router) {
  r.Post("/api/models", createModel)
}

func createModel() {
  persistModel()
  trainModel()
}

func persistModel() {
  db.Query("select 1")
}

func trainModel() {
  http.Post("https://engine.example/train", "application/json", nil)
}
`,
  );
  await writeFile(
    path.join(repoPath, "frontend", "src", "api", "models.ts"),
    `export async function createModel() {
  return fetch("/api/models", { method: "POST" });
}
`,
  );
  await writeFile(
    path.join(repoPath, "services", "engine", "api", "routes", "training.py"),
    `@app.post("/train")
async def train_model():
    build_feature_matrix()
    fit_model()
    raise EngineError("SNT-401")
`,
  );
  await writeFile(
    configPath,
    JSON.stringify(
      {
        repos: [
          {
            name: "fixture-platform",
            path: repoPath,
            type: "platform",
            baseBranch: "main",
          },
        ],
        autoFetch: false,
        output: outputPath,
        scanLimits: {
          filesPerRepo: 200,
          apiFilesPerRepo: 200,
          apiNodesPerScenario: 80,
          changedFiles: 20,
          nodesPerScenario: 80,
          codeFactsPerRepo: 200,
          codeEdgesPerRepo: 200,
        },
      },
      null,
      2,
    ),
  );

  run("git", ["init", "-b", "main"], repoPath);
  run("git", ["config", "user.email", "whereami@example.test"], repoPath);
  run("git", ["config", "user.name", "Where am I Test"], repoPath);
  run("git", ["add", "."], repoPath);
  run("git", ["commit", "-m", "init"], repoPath);

  const scan = spawnSync(
    process.execPath,
    ["scripts/scan-repos.mjs", "--quiet", "--no-fetch"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        WHEREAMI_CONFIG_PATH: configPath,
      },
    },
  );
  assert.equal(scan.status, 0, scan.stderr);

  const snapshot = JSON.parse(await readFile(outputPath, "utf8"));
  const currentWork = snapshot.scenarios.find(
    (scenario) => scenario.id === "current-work",
  );
  assert.ok(currentWork);

  const nodes = currentWork.allNodes ?? currentWork.nodes;
  const edges = currentWork.allEdges ?? currentWork.edges;
  const nodeKinds = new Set(nodes.map((node) => node.data.kind));
  const edgeLabels = new Set(edges.map((edge) => edge.label));
  const evidenceLines = edges.flatMap(
    (edge) => edge.data?.evidenceItems?.map((item) => item.text) ?? [],
  );

  assert.ok(nodeKinds.has("handler"));
  assert.ok(nodeKinds.has("db"));
  assert.ok(nodeKinds.has("external"));
  assert.ok(nodeKinds.has("error"));
  assert.ok(edgeLabels.has("handled by"));
  assert.ok(edgeLabels.has("reads/writes"));
  assert.ok(edgeLabels.has("requests"));
  assert.ok(edgeLabels.has("raises"));
  assert.ok(evidenceLines.some((line) => line.includes("r.Post")));
  assert.ok(evidenceLines.some((line) => line.includes("SNT-401")));
  assert.ok(snapshot.repos[0].codeFactCount > 0);
});

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")}\n${result.stderr}`,
  );
}
