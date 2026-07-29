import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync, watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(rootDir, "whereami.config.json");
const defaultConfig = {
  repoRoots: [],
  include: [],
  scanServerPort: 3010,
  watchIntervalMs: 60 * 60 * 1000,
  liveWatch: true,
  watchDebounceMs: 1800,
};
const config = readConfig();
const port = Number(process.env.WHEREAMI_SCAN_PORT ?? config.scanServerPort ?? 3010);
const intervalMs = Number(config.watchIntervalMs ?? 60 * 60 * 1000);
const liveWatch = config.liveWatch !== false;
const watchDebounceMs = Number(config.watchDebounceMs ?? 1800);
const ignoredWatchParts = new Set([
  ".git",
  ".next",
  ".turbo",
  ".wrangler",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

let activeScan = null;
let lastResult = null;
let watchTimer = null;
const eventClients = new Set();
const repoWatchers = liveWatch ? startRepoWatchers() : [];

runScan("startup").catch(() => {});

const timer = setInterval(() => {
  runScan("interval").catch(() => {});
}, intervalMs);

const server = createServer(async (request, response) => {
  setCors(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.url === "/health") {
    sendJson(response, 200, {
      ok: true,
      scanning: Boolean(activeScan),
      intervalMs,
      liveWatch,
      watchDebounceMs,
      watchedRepos: repoWatchers.length,
      lastResult,
    });
    return;
  }

  if (request.url === "/events" && request.method === "GET") {
    openEventStream(request, response);
    return;
  }

  if (request.url === "/scan" && request.method === "POST") {
    try {
      const result = await runScan("manual");
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "scan failed",
      });
    }
    return;
  }

  sendJson(response, 404, { ok: false, error: "not found" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[whereami] scan server http://127.0.0.1:${port}`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function readConfig() {
  if (!existsSync(configPath)) return defaultConfig;
  return {
    ...defaultConfig,
    ...JSON.parse(readFileSync(configPath, "utf8")),
  };
}

function runScan(reason) {
  if (activeScan) return activeScan;

  broadcastEvent("scan-start", {
    reason,
    scannedAt: new Date().toISOString(),
  });

  activeScan = new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, ["scripts/scan-repos.mjs", "--quiet"], {
      cwd: rootDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("close", (code) => {
      const result = {
        ok: code === 0,
        reason,
        durationMs: Date.now() - startedAt,
        scannedAt: new Date().toISOString(),
      };
      lastResult = result;
      activeScan = null;

      if (code === 0) {
        broadcastEvent("scan-complete", result);
        resolve(result);
      } else {
        const error = new Error(stderr.trim() || `scan exited with ${code}`);
        broadcastEvent("scan-error", {
          ...result,
          error: error.message,
        });
        reject(error);
      }
    });
  });

  return activeScan;
}

function startRepoWatchers() {
  return discoverRepos()
    .map((repo) => {
      try {
        const repoWatcher = watch(
          repo.path,
          { recursive: true },
          (_eventType, filename) => {
            if (shouldIgnoreWatchFile(filename)) return;
            scheduleWatchScan(repo.name);
          },
        );
        repoWatcher.on("error", () => {});
        return repoWatcher;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function discoverRepos() {
  const explicitRepos = (config.repos ?? []).map((repo) => ({
    name: repo.name ?? path.basename(repo.path),
    path: repo.path,
  }));
  const discovered = [];

  for (const root of config.repoRoots ?? []) {
    if (!existsSync(root)) continue;

    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!(config.include ?? []).some((token) => entry.name.includes(token))) {
        continue;
      }

      const repoPath = path.join(root, entry.name);
      if (!existsSync(path.join(repoPath, ".git"))) continue;
      discovered.push({ name: entry.name, path: repoPath });
    }
  }

  const byPath = new Map();
  [...explicitRepos, ...discovered].forEach((repo) => {
    byPath.set(path.resolve(repo.path), {
      ...repo,
      path: path.resolve(repo.path),
    });
  });

  return [...byPath.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function shouldIgnoreWatchFile(filename) {
  if (!filename) return false;
  const normalized = String(filename);
  const parts = normalized.split(/[\\/]/);
  const basename = parts.at(-1) ?? "";

  return (
    parts.some((part) => ignoredWatchParts.has(part)) ||
    basename === ".DS_Store" ||
    basename.endsWith(".swp") ||
    basename.endsWith("~")
  );
}

function scheduleWatchScan(repoName) {
  if (watchTimer) clearTimeout(watchTimer);

  watchTimer = setTimeout(() => {
    watchTimer = null;
    runScan(`watch:${repoName}`).catch(() => {});
  }, watchDebounceMs);
}

function openEventStream(request, response) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  response.write(": connected\n\n");
  eventClients.add(response);

  const heartbeat = setInterval(() => {
    response.write(": ping\n\n");
  }, 25000);

  request.on("close", () => {
    clearInterval(heartbeat);
    eventClients.delete(response);
  });
}

function broadcastEvent(type, payload) {
  const data = `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;

  for (const client of eventClients) {
    client.write(data);
  }
}

function setCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function shutdown() {
  clearInterval(timer);
  if (watchTimer) clearTimeout(watchTimer);
  repoWatchers.forEach((repoWatcher) => repoWatcher.close());
  eventClients.forEach((client) => client.end());
  server.close(() => process.exit(0));
}
