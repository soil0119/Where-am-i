import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = process.env.WHEREAMI_CONFIG_PATH
  ? path.resolve(process.env.WHEREAMI_CONFIG_PATH)
  : path.join(rootDir, "whereami.config.json");
const args = new Set(process.argv.slice(2));
const quiet = args.has("--quiet");
const watch = args.has("--watch");
const noFetch = args.has("--no-fetch");

const defaultConfig = {
  repoRoots: [],
  include: [],
  baseBranch: "develop",
  autoFetch: true,
  output: "public/whereami-snapshot.json",
  watchIntervalMs: 60 * 60 * 1000,
  scanLimits: {
    filesPerRepo: 900,
    apiFilesPerRepo: 2400,
    apiNodesPerScenario: 800,
    changedFiles: 80,
    historyEvents: 24,
    nodesPerScenario: 26,
    codeFactsPerRepo: 420,
    codeEdgesPerRepo: 620,
  },
};

const config = readConfig();
const fetchedRepos = new Set();
const ignoredCallSymbols = new Set([
  "if",
  "for",
  "while",
  "switch",
  "return",
  "throw",
  "catch",
  "new",
  "await",
  "typeof",
  "sizeof",
  "make",
  "append",
  "len",
  "cap",
  "print",
  "println",
  "String",
  "Number",
  "Boolean",
  "JSON",
  "Error",
]);

await runOnce();

if (watch) {
  setInterval(() => {
    runOnce().catch((error) => {
      if (!quiet) console.error(`[whereami] scan failed: ${error.message}`);
    });
  }, config.watchIntervalMs);
}

function readConfig() {
  if (!existsSync(configPath)) return defaultConfig;

  const userConfig = JSON.parse(readFileSync(configPath, "utf8"));
  return {
    ...defaultConfig,
    ...userConfig,
    scanLimits: {
      ...defaultConfig.scanLimits,
      ...(userConfig.scanLimits ?? {}),
    },
  };
}

async function runOnce() {
  const repos = discoverRepos(config);
  const scannedRepos = repos.map((repo) => scanRepo(repo));
  const outputPath = path.resolve(rootDir, config.output);
  const previousSnapshot = readJson(outputPath);
  const snapshot = buildSnapshot(scannedRepos, previousSnapshot);

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);

  if (!quiet) {
    console.log(
      `[whereami] ${snapshot.repos.length} repos, ${snapshot.scenarios[0].nodes.length} nodes -> ${path.relative(rootDir, outputPath)}`,
    );
  }
}

function readJson(file) {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function discoverRepos(config) {
  const explicitRepos = (config.repos ?? []).map((repo) => ({
    name: repo.name ?? path.basename(repo.path),
    path: repo.path,
    type: repo.type ?? classifyRepoType(repo.path),
    baseBranch: repo.baseBranch ?? config.baseBranch,
  }));

  const discovered = [];
  for (const root of config.repoRoots ?? []) {
    if (!existsSync(root)) continue;

    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!config.include.some((token) => entry.name.includes(token))) continue;

      const repoPath = path.join(root, entry.name);
      if (!existsSync(path.join(repoPath, ".git"))) continue;

      discovered.push({
        name: entry.name,
        path: repoPath,
        type: classifyRepoType(repoPath),
        baseBranch: config.baseBranch,
      });
    }
  }

  const byPath = new Map();
  [...explicitRepos, ...discovered].forEach((repo) => {
    byPath.set(path.resolve(repo.path), {
      ...repo,
      path: path.resolve(repo.path),
    });
  });

  return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function classifyRepoType(repoPath) {
  const name = path.basename(repoPath).toLowerCase();
  if (name.includes("platform")) return "platform";
  if (name.includes("engine")) return "engine";
  if (name.includes("gateway")) return "gateway";
  if (name.includes("chat")) return "chat";
  if (name.includes("kubernetes")) return "kubernetes";
  return "repo";
}

function scanRepo(repo) {
  const warnings = [];

  if (!existsSync(path.join(repo.path, ".git"))) {
    return {
      ...repo,
      branch: "missing",
      baseRef: repo.baseBranch,
      head: "",
      dirty: 0,
      changedFiles: [],
      teamChangedFiles: [],
      teamUpdates: [],
      fileStatuses: {},
      changeDetails: { current: {}, team: {} },
      entities: emptyEntities(),
      warnings: ["git repo가 아님"],
    };
  }

  if (
    config.autoFetch &&
    !noFetch &&
    !fetchedRepos.has(repo.path) &&
    hasRemote(repo.path, "origin")
  ) {
    const fetched = git(repo.path, ["fetch", "origin", "--prune"], {
      optional: true,
      timeout: 15000,
    });
    if (!fetched.ok) warnings.push("origin fetch 실패");
    fetchedRepos.add(repo.path);
  }

  const branch = currentBranch(repo.path);
  const baseRef = selectBaseRef(repo.path, repo.baseBranch);
  const head = gitText(repo.path, ["rev-parse", "--short", "HEAD"], "unknown");
  const latestCommit = parseLatestCommit(
    gitText(repo.path, ["log", "-1", "--format=%h%x09%ct%x09%s"], ""),
    head,
  );
  const statusLines = gitText(repo.path, ["status", "--short"], "")
    .split("\n")
    .filter(Boolean);
  const fileStatuses = parseStatus(statusLines);
  const localChanged = [
    ...Object.keys(fileStatuses),
    ...gitLines(repo.path, ["diff", "--name-only"]),
    ...gitLines(repo.path, ["diff", "--name-only", "--cached"]),
  ];
  const branchChanged = baseRef
    ? gitLines(repo.path, ["diff", "--name-only", `${baseRef}...HEAD`])
    : [];
  const teamChangedFiles = baseRef
    ? gitLines(repo.path, ["diff", "--name-only", `HEAD..${baseRef}`])
    : [];
  const teamUpdates = baseRef ? buildTeamUpdates(repo, baseRef) : [];
  const changedFiles = unique([...localChanged, ...branchChanged]).slice(
    0,
    config.scanLimits.changedFiles,
  );
  const currentChangeDetails = buildChangeDetails(
    repo.path,
    [
      ...(baseRef ? [{ diffArgs: [`${baseRef}...HEAD`], label: `${baseRef}...HEAD` }] : []),
      { diffArgs: [], label: "working tree" },
      { diffArgs: ["--cached"], label: "staged" },
    ],
    fileStatuses,
  );
  const teamChangeDetails = baseRef
    ? buildChangeDetails(
        repo.path,
        [{ diffArgs: [`HEAD..${baseRef}`], label: `HEAD..${baseRef}` }],
        {},
      )
    : {};
  const changeDetails = { current: currentChangeDetails, team: teamChangeDetails };
  const trackedFiles = gitLines(repo.path, ["ls-files"]).filter(isScannable);
  const apiCatalogFiles = trackedFiles
    .filter(isApiCatalogFile)
    .slice(0, config.scanLimits.apiFilesPerRepo);
  const sampledTrackedFiles = trackedFiles.slice(0, config.scanLimits.filesPerRepo);
  const priorityFiles = unique([
    ...changedFiles,
    ...teamChangedFiles,
    ...apiCatalogFiles,
    ...sampledTrackedFiles.filter(isPriorityFile),
  ]).filter(isScannable);
  const entities = extractEntities(repo, priorityFiles, fileStatuses, teamChangedFiles, changeDetails);

  if (!baseRef) warnings.push(`${repo.baseBranch} 기준 브랜치 없음`);

  return {
    ...repo,
    branch,
    baseRef: baseRef ?? repo.baseBranch,
    head,
    latestCommit,
    dirty: statusLines.length,
    changedFiles,
    teamChangedFiles: teamChangedFiles.slice(0, config.scanLimits.changedFiles),
    teamUpdates,
    fileStatuses,
    changeDetails,
    entities,
    warnings,
  };
}

function emptyEntities() {
  return {
    routes: [],
    wrappers: [],
    uiFiles: [],
    engineEndpoints: [],
    engineFlows: [],
    codeFacts: [],
    codeEdges: [],
    docs: [],
    tests: [],
    dbFiles: [],
  };
}

function git(cwd, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    timeout: options.timeout ?? 8000,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function gitText(cwd, args, fallback) {
  const result = git(cwd, args, { optional: true });
  return result.ok ? result.stdout.trim() : fallback;
}

function gitLines(cwd, args) {
  const result = git(cwd, args, { optional: true });
  if (!result.ok) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildTeamUpdates(repo, baseRef) {
  return gitLines(repo.path, [
    "log",
    "--max-count=12",
    "--format=%h%x09%ct%x09%s",
    `HEAD..${baseRef}`,
  ])
    .map((line) => parseTeamUpdate(repo, line))
    .filter(Boolean);
}

function parseTeamUpdate(repo, line) {
  const [hash = "", rawTimestamp = "0", ...subjectParts] = line.split("\t");
  if (!hash) return null;

  const subject = subjectParts.join("\t").trim() || "커밋 메시지 없음";
  const unixSeconds = Number.parseInt(rawTimestamp, 10);
  const prNumber = extractPrNumber(subject);
  const files = changedFilesForCommit(repo.path, hash);
  const statuses = fileStatusesForCommit(repo.path, hash);
  const changeDetails = buildCommitChangeDetails(repo.path, hash, files, statuses);
  const featureChanges = buildPrFeatureChanges(repo, files, statuses, changeDetails);
  const stats = changeStatsForCommit(repo.path, hash);
  const codePreview = buildCommitCodePreview(files, changeDetails);

  return {
    hash,
    subject,
    prNumber,
    files,
    additions: stats.additions,
    deletions: stats.deletions,
    summary: summarizeTeamUpdate(subject, featureChanges, files, stats),
    featureChanges,
    codePreview,
    at: Number.isFinite(unixSeconds) && unixSeconds > 0
      ? new Date(unixSeconds * 1000).toISOString()
      : "",
  };
}

function changedFilesForCommit(cwd, hash) {
  const firstParent = `${hash}^1`;
  const files = gitLines(cwd, ["diff", "--name-only", firstParent, hash]);
  const fallback = files.length > 0
    ? files
    : gitLines(cwd, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-m", hash]);

  return unique(fallback)
    .filter(isScannable)
    .slice(0, config.scanLimits.changedFiles);
}

function changeStatsForCommit(cwd, hash) {
  const stats = gitLines(cwd, ["diff", "--numstat", `${hash}^1`, hash]);

  return stats.reduce(
    (result, line) => {
      const [rawAdditions, rawDeletions, ...fileParts] = line.split("\t");
      const file = fileParts.join("\t");
      if (!isScannable(file)) return result;

      result.additions += parseNumstat(rawAdditions);
      result.deletions += parseNumstat(rawDeletions);
      return result;
    },
    { additions: 0, deletions: 0 },
  );
}

function fileStatusesForCommit(cwd, hash) {
  const statuses = {};

  for (const line of gitLines(cwd, ["diff", "--name-status", `${hash}^1`, hash])) {
    const [rawStatus = "", ...fileParts] = line.split("\t");
    const file = fileParts.at(-1) ?? "";
    if (!isScannable(file)) continue;

    if (rawStatus.startsWith("A")) statuses[file] = "added";
    else if (rawStatus.startsWith("D")) statuses[file] = "risk";
    else statuses[file] = "changed";
  }

  return statuses;
}

function buildCommitChangeDetails(cwd, hash, files, statuses) {
  const numstats = new Map();

  for (const line of gitLines(cwd, ["diff", "--numstat", `${hash}^1`, hash])) {
    const [rawAdditions, rawDeletions, ...fileParts] = line.split("\t");
    const file = fileParts.join("\t");
    if (!isScannable(file)) continue;
    numstats.set(file, {
      additions: parseNumstat(rawAdditions),
      deletions: parseNumstat(rawDeletions),
    });
  }

  return Object.fromEntries(
    files.map((file) => {
      const stats = numstats.get(file) ?? { additions: 0, deletions: 0 };
      const status = statuses[file] ?? "changed";

      return [
        file,
        {
          file,
          compare: `${hash}^1..${hash}`,
          additions: stats.additions,
          deletions: stats.deletions,
          summary: summarizeChange(stats.additions, stats.deletions, status),
          lines: diffPreview(cwd, [`${hash}^1`, hash], file),
          signals: diffSignals(cwd, [`${hash}^1`, hash], file),
        },
      ];
    }),
  );
}

function buildPrFeatureChanges(repo, files, statuses, changeDetails) {
  const groups = new Map();

  for (const file of files) {
    addFeatureRecord(groups, {
      repo: repo.name,
      repoType: repo.type,
      file,
      kind: classifyFileKind(file, repo.type),
      status: statuses[file] ?? "changed",
      change: changeDetails[file],
      title: titleFromFile(file),
    });
  }

  return [...groups.values()]
    .map((group) => finishFeatureGroup(group))
    .sort((a, b) => featureSortScore(b) - featureSortScore(a))
    .slice(0, 5);
}

function buildCommitCodePreview(files, changeDetails) {
  const file = [...files]
    .sort((left, right) => codePreviewScore(right) - codePreviewScore(left))
    .find((candidate) => changeDetails[candidate]?.lines?.length > 0);

  return file ? changeDetails[file] : undefined;
}

function codePreviewScore(file) {
  if (/swagger|docs\.go|package-lock|package\.json/.test(file)) return -20;
  if (/frontend\/src\/pages|frontend\/src\/components/.test(file)) return 45;
  if (/backend\/internal|backend\/cmd|src\/.*\.(ts|tsx|go|py)$/.test(file)) return 42;
  if (/tests?|spec/.test(file)) return 12;
  if (/docs?/.test(file)) return 4;
  return priorityScore(file);
}

function summarizeTeamUpdate(subject, featureChanges, files, stats) {
  const readableSubject = humanizePrSubject(subject);
  const featureText = featureChanges
    .slice(0, 2)
    .map((feature) => `${feature.title} ${feature.summary}`)
    .join(" / ");

  if (featureText) {
    return `${readableSubject} · ${featureText}`;
  }

  return `${readableSubject} · ${files.length} files, +${stats.additions} / -${stats.deletions}`;
}

function humanizePrSubject(subject) {
  const merge = subject.match(/Merge pull request #\d+ from [^/]+\/(.+)$/i);
  if (merge) return humanizeBranchName(merge[1]);

  return subject
    .replace(/\s*\(#\d+\)\s*$/, "")
    .replace(/^(feat|fix|refactor|docs|test|chore|ci|perf|style|hotfix):\s*/i, "")
    .trim();
}

function humanizeBranchName(branch) {
  return branch
    .replace(/^(feat|fix|refactor|docs|test|chore|ci|perf|style|hotfix)\//i, "")
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((part) => humanizeToken(part))
    .join(" ");
}

function extractPrNumber(subject) {
  const match =
    subject.match(/pull request\s+#(\d+)/i) ??
    subject.match(/\(#(\d+)\)/) ??
    subject.match(/\bPR\s*#(\d+)/i) ??
    subject.match(/#(\d+)/);

  return match ? match[1] : "";
}

function buildChangeDetails(cwd, specs, fileStatuses) {
  const details = {};

  for (const spec of specs) {
    const stats = gitLines(cwd, ["diff", "--numstat", ...spec.diffArgs]);

    for (const line of stats) {
      const [rawAdditions, rawDeletions, ...fileParts] = line.split("\t");
      const file = fileParts.join("\t");
      if (!file || !isScannable(file)) continue;

      const additions = parseNumstat(rawAdditions);
      const deletions = parseNumstat(rawDeletions);
      const preview = diffPreview(cwd, spec.diffArgs, file);
      const signals = diffSignals(cwd, spec.diffArgs, file);
      details[file] = mergeChangeDetail(details[file], {
        compare: spec.label,
        additions,
        deletions,
        summary: summarizeChange(additions, deletions, fileStatuses[file]),
        lines: preview,
        signals,
      });
    }
  }

  for (const [file, status] of Object.entries(fileStatuses)) {
    if (!isScannable(file) || details[file]) continue;
    details[file] = {
      compare: "working tree",
      additions: status === "added" ? countFileLines(path.join(cwd, file)) : 0,
      deletions: status === "risk" ? 1 : 0,
      summary: status === "added" ? "새 파일" : status === "risk" ? "삭제된 파일" : "작업 트리 변경",
      lines: [],
      signals: [
        {
          action: status === "risk" ? "deleted" : "added",
          kind: "file",
          label: titleFromFile(file),
        },
      ],
    };
  }

  return details;
}

function parseNumstat(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeChangeDetail(previous, next) {
  if (!previous) return next;

  return {
    compare: `${previous.compare}, ${next.compare}`,
    additions: previous.additions + next.additions,
    deletions: previous.deletions + next.deletions,
    summary: summarizeChange(
      previous.additions + next.additions,
      previous.deletions + next.deletions,
    ),
    lines: [...previous.lines, ...next.lines].slice(0, 18),
    signals: uniqueBy(
      [...(previous.signals ?? []), ...(next.signals ?? [])],
      (item) => `${item.action}:${item.kind}:${item.label}`,
    ).slice(0, 8),
  };
}

function summarizeChange(additions, deletions, status) {
  if (status === "added") return `새 파일, +${additions}`;
  if (status === "risk") return `삭제 또는 이동, -${deletions}`;
  if (additions > 0 && deletions > 0) return `수정: +${additions} / -${deletions}`;
  if (additions > 0) return `추가 중심: +${additions}`;
  if (deletions > 0) return `삭제 중심: -${deletions}`;
  return "내용 변경";
}

function diffPreview(cwd, diffArgs, file) {
  const result = git(cwd, ["diff", "--unified=2", ...diffArgs, "--", file], {
    optional: true,
    timeout: 8000,
  });
  if (!result.ok) return [];

  return result.stdout
    .split("\n")
    .filter((line) => {
      if (line.startsWith("diff --git")) return false;
      if (line.startsWith("index ")) return false;
      if (line.startsWith("--- ") || line.startsWith("+++ ")) return false;
      return line.startsWith("@@") || line.startsWith("+") || line.startsWith("-");
    })
    .map((line) => trimDiffLine(line))
    .slice(0, 18);
}

function diffSignals(cwd, diffArgs, file) {
  const result = git(cwd, ["diff", "--unified=0", ...diffArgs, "--", file], {
    optional: true,
    timeout: 8000,
  });
  if (!result.ok) return [];

  const signals = [];
  for (const line of result.stdout.split("\n")) {
    if (!/^[+-]/.test(line) || line.startsWith("+++") || line.startsWith("---")) continue;

    const action = line.startsWith("+") ? "added" : "deleted";
    const body = line.slice(1).trim();
    const signal = extractChangeSignal(body, action, file);
    if (signal) signals.push(signal);
  }

  return uniqueBy(signals, (item) => `${item.action}:${item.kind}:${item.label}`).slice(0, 8);
}

function extractChangeSignal(line, action, file) {
  const goRoute = line.match(/\.(Get|Post|Put|Patch|Delete|Head|Options)\(\s*["`]([^"`]+)["`]/);
  if (goRoute) {
    if (!isRouteLiteral(goRoute[2])) return null;
    return {
      action,
      kind: "api",
      label: `${goRoute[1].toUpperCase()} ${normalizeRoutePath(goRoute[2])}`,
    };
  }

  const pyRoute = line.match(/@\w+\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/i);
  if (pyRoute) {
    if (!isRouteLiteral(pyRoute[2])) return null;
    return {
      action,
      kind: "api",
      label: `${pyRoute[1].toUpperCase()} ${normalizeRoutePath(pyRoute[2])}`,
    };
  }

  const apiPath = line.match(/[`'"]([^`'"]*\/api\/[^`'"]*)[`'"]/);
  if (apiPath) {
    return {
      action,
      kind: "api",
      label: normalizeRoutePath(apiPath[1]),
    };
  }

  const namedCode = line.match(
    /(?:export\s+)?(?:async\s+)?(?:function|class|interface|type)\s+([A-Za-z0-9_]+)/,
  ) ?? line.match(/(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=/);
  if (namedCode) {
    return {
      action,
      kind: isUiFile(file) ? "ui" : "code",
      label: namedCode[1],
    };
  }

  return null;
}

function trimDiffLine(line) {
  if (line.length <= 140) return line;
  return `${line.slice(0, 137)}...`;
}

function countFileLines(file) {
  const text = readText(file);
  return text ? text.split("\n").length : 0;
}

function hasRemote(cwd, name) {
  return gitLines(cwd, ["remote"]).includes(name);
}

function currentBranch(cwd) {
  const branch = gitText(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], "");
  if (branch && branch !== "HEAD") return branch;
  return `detached:${gitText(cwd, ["rev-parse", "--short", "HEAD"], "unknown")}`;
}

function selectBaseRef(cwd, baseBranch) {
  const candidates = [
    `origin/${baseBranch}`,
    baseBranch,
    "origin/develop",
    "develop",
    "origin/main",
    "main",
    "origin/master",
    "master",
  ];

  return candidates.find((candidate) =>
    git(cwd, ["rev-parse", "--verify", "--quiet", candidate]).ok,
  );
}

function parseStatus(lines) {
  const statuses = {};

  for (const line of lines) {
    const code = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    const filePath = rawPath.includes(" -> ")
      ? rawPath.split(" -> ").at(-1)
      : rawPath;

    if (!filePath) continue;
    if (code.includes("?") || code.includes("A")) statuses[filePath] = "added";
    else if (code.includes("D")) statuses[filePath] = "risk";
    else statuses[filePath] = "changed";
  }

  return statuses;
}

function isScannable(file) {
  if (!file || file.length > 240) return false;
  if (
    /(^|\/)(node_modules|dist|build|coverage|vendor|__pycache__|\.pytest_cache|\.ruff_cache|\.venv|artifacts|storage|work|outputs)(\/|$)/.test(
      file,
    )
  ) {
    return false;
  }

  return /\.(go|py|ts|tsx|js|jsx|json|ya?ml|md|sql)$/.test(file) ||
    /(^|\/)docker-compose.*\.ya?ml$/.test(file);
}

function isPriorityFile(file) {
  return (
    /(^|\/)(frontend\/src\/api|frontend\/src\/pages|backend\/cmd\/server|backend\/internal|backend\/docs|services\/engine\/api\/routes|tests|docs|db)(\/|$)/.test(
      file,
    ) || /docker-compose.*\.ya?ml$/.test(file)
  );
}

function isApiCatalogFile(file) {
  if (isDocsFile(file) || isTestFile(file) || isFrontendApiFile(file)) {
    return true;
  }

  return (
    /(^|\/)(backend|cmd|internal|routes|server|gateway)(\/|$).*\.(go|ts|js)$/.test(
      file,
    ) ||
    /(^|\/)(services\/engine\/api|src\/.*\/api|api\/routes|routes)(\/|$).*\.py$/.test(
      file,
    )
  );
}

function extractEntities(repo, files, fileStatuses, teamChangedFiles, changeDetails) {
  const entities = emptyEntities();
  const teamSet = new Set(teamChangedFiles);
  const docTexts = [];
  const testTexts = [];
  const codeFiles = [];

  for (const file of files) {
    const absolute = path.join(repo.path, file);
    const text = readText(absolute);
    if (!text) continue;

    const status = fileStatuses[file] ?? (teamSet.has(file) ? "changed" : "stable");
    const base = {
      repo: repo.name,
      repoType: repo.type,
      file,
      status,
      changes: {
        current: changeDetails.current[file],
        team: changeDetails.team[file],
      },
    };
    codeFiles.push({ file, text, base });

    if (isUiFile(file)) {
      entities.uiFiles.push({
        ...base,
        kind: "ui",
        title: titleFromFile(file),
        summary: "화면/상태/사용자 액션 진입점",
        evidence: "frontend page/component scan",
      });
    }

    if (isDbFile(file)) {
      entities.dbFiles.push({
        ...base,
        kind: "db",
        title: titleFromFile(file),
        summary: "저장소 또는 schema 변경 지점",
        evidence: "db/schema file scan",
      });
    }

    if (isDocsFile(file)) {
      entities.docs.push({
        ...base,
        kind: "docs",
        title: titleFromFile(file),
        summary: file.includes("swagger") || file.includes("openapi")
          ? "Swagger/OpenAPI 계약 문서"
          : "기능/리뷰 문서",
        evidence: "docs file scan",
      });
      docTexts.push({ file, text });
      entities.routes.push(...extractOpenApiRoutes(text, base));
    }

    if (isTestFile(file)) {
      entities.tests.push({
        ...base,
        kind: "test",
        title: titleFromFile(file),
        summary: "회귀 또는 E2E 검증 지점",
        evidence: "test file scan",
      });
      testTexts.push({ file, text });
    }

    entities.routes.push(...extractGoRoutes(text, base));
    entities.engineEndpoints.push(...extractPythonRoutes(text, base));
    if (isFrontendApiFile(file)) {
      entities.wrappers.push(...extractFrontendApiCalls(text, base));
    }
  }

  const codeTopology = extractCodeTopology(repo, codeFiles, [
    ...entities.routes,
    ...entities.engineEndpoints,
  ]);
  entities.codeFacts.push(...codeTopology.facts);
  entities.codeEdges.push(...codeTopology.edges);

  if (repo.type === "engine" || entities.engineEndpoints.length > 0) {
    entities.engineFlows.push(
      ...buildEngineFlowEntities(repo, entities.codeFacts, entities.engineEndpoints),
    );
  }

  for (const route of [...entities.routes, ...entities.engineEndpoints]) {
    route.hasDocs = docTexts.some((doc) => mentionsPathOrTokens(doc.text, route.path));
    route.hasTests = testTexts.some((testFile) => mentionsPathOrTokens(testFile.text, route.path));
  }

  entities.routes = dedupeApiRoutes(entities.routes).slice(0, config.scanLimits.apiNodesPerScenario);
  entities.engineEndpoints = dedupeApiRoutes(entities.engineEndpoints).slice(0, config.scanLimits.apiNodesPerScenario);
  entities.engineFlows = uniqueBy(entities.engineFlows, (item) => item.id).slice(0, 40);
  entities.codeFacts = uniqueBy(entities.codeFacts, (item) => item.id).slice(0, config.scanLimits.codeFactsPerRepo);
  entities.codeEdges = uniqueBy(entities.codeEdges, (item) => item.id).slice(0, config.scanLimits.codeEdgesPerRepo);
  entities.wrappers = uniqueBy(entities.wrappers, (item) => `${item.method} ${item.path} ${item.file}`).slice(0, 120);
  entities.uiFiles = uniqueBy(entities.uiFiles, (item) => item.file).slice(0, 80);
  entities.docs = uniqueBy(entities.docs, (item) => item.file).slice(0, 80);
  entities.tests = uniqueBy(entities.tests, (item) => item.file).slice(0, 80);

  return entities;
}

function readText(file) {
  try {
    if (!existsSync(file) || statSync(file).size > 1_400_000) return "";
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function isUiFile(file) {
  return /frontend\/src\/(pages|components)\/.*\.(tsx|ts)$/.test(file);
}

function isFrontendApiFile(file) {
  return /(^|\/)(frontend\/src|mcp\/.*\/src)\/.*\.(tsx?|jsx?)$/.test(file);
}

function isDbFile(file) {
  return /(^|\/)(db|migrations|schema|postgres)(\/|$)/.test(file) || /\.sql$/.test(file);
}

function isDocsFile(file) {
  return /(^|\/)(docs|backend\/docs)(\/|$)/.test(file) || /swagger|openapi/i.test(file);
}

function isTestFile(file) {
  return (
    /(^|\/)(tests?|e2e)(\/|$)/.test(file) ||
    /_test\.go$/.test(file) ||
    /\.(test|spec)\.(ts|tsx|js|go|py)$/.test(file)
  );
}

function titleFromFile(file) {
  return path.basename(file).replace(/\.(tsx?|jsx?|go|py|ya?ml|json|md|sql)$/, "");
}

function extractGoRoutes(text, base) {
  if (!/\.((Get|Post|Put|Patch|Delete|Head|Options))\(/.test(text)) return [];

  const routes = [];
  const hasOrganizationsPrefix = text.includes('r.Route("/api/organizations"');
  const lines = text.split("\n");

  lines.forEach((line, index) => {
    const regex = /\.(Get|Post|Put|Patch|Delete|Head|Options)\(\s*["`]([^"`]+)["`]\s*(?:,\s*([A-Za-z0-9_.$]+))?/g;
    for (const match of line.matchAll(regex)) {
      if (!isRouteLiteral(match[2])) continue;
      let routePath = normalizeRoutePath(match[2]);
      if (hasOrganizationsPrefix && routePath.startsWith("/{orgId}")) {
        routePath = `/api/organizations${routePath}`;
      }
      const handlerName = cleanSymbol(match[3] ?? "");
      routes.push({
        ...base,
        kind: "api",
        source: "code",
        method: match[1].toUpperCase(),
        path: routePath,
        handlerName,
        line: index + 1,
        title: `${match[1].toUpperCase()} ${routePath}`,
        summary: handlerName
          ? `backend route -> ${handlerName}`
          : "backend public/internal route",
        evidence: `${base.file}:${index + 1}`,
        evidenceItems: [
          evidenceItem(base.file, index + 1, line.trim(), "static", 0.86),
        ],
      });
    }
  });

  return routes;
}

function extractPythonRoutes(text, base) {
  if (!/@\w+\.(get|post|put|patch|delete)\(/i.test(text)) return [];

  const routes = [];
  let pending = null;

  text.split("\n").forEach((line, index) => {
    const inline = line.match(/@\w+\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/i);
    if (inline) {
      if (!isRouteLiteral(inline[2])) return;
      pending = {
        method: inline[1].toUpperCase(),
        path: normalizeRoutePath(inline[2]),
        line: index + 1,
        source: line.trim(),
      };
      return;
    }

    const start = line.match(/@\w+\.(get|post|put|patch|delete)\(\s*$/i);
    if (start) {
      pending = {
        method: start[1].toUpperCase(),
        path: "",
        line: index + 1,
        source: line.trim(),
      };
      return;
    }

    if (pending) {
      const pathMatch = line.match(/["']([^"']+)["']/);
      if (pathMatch) {
        if (!isRouteLiteral(pathMatch[1])) {
          pending = null;
          return;
        }
        pending.path = normalizeRoutePath(pathMatch[1]);
        pending.source = `${pending.source} ${line.trim()}`.trim();
      }
      if (!/^\s*\)/.test(line) && !/^\s*(?:async\s+)?def\s+/.test(line)) return;
    }

    const functionMatch = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (!pending || !pending.path || !functionMatch) return;

    const handlerName = cleanSymbol(functionMatch[1]);
    routes.push({
      ...base,
      kind: "engine",
      source: "code",
      method: pending.method,
      path: pending.path,
      handlerName,
      line: pending.line,
      handlerLine: index + 1,
      title: `${pending.method} ${pending.path}`,
      summary: `FastAPI endpoint -> ${handlerName}`,
      evidence: `${base.file}:${pending.line}`,
      evidenceItems: [
        evidenceItem(base.file, pending.line, pending.source, "static", 0.9),
        evidenceItem(base.file, index + 1, line.trim(), "static", 0.84),
      ],
    });
    pending = null;
  });

  return routes;
}

function extractOpenApiRoutes(text, base) {
  if (!/swagger|openapi|paths:/i.test(text) && !/"paths"\s*:/.test(text)) {
    return [];
  }

  const routes = [];
  const lines = text.split("\n");
  let currentPath = "";

  lines.forEach((line, index) => {
    const pathMatch =
      line.match(/^\s{0,8}["']?(\/[^"'{}][^"':]*)["']?\s*:\s*(?:\{|$)/) ??
      line.match(/^\s{0,8}["']?(\/[^"']+)["']?\s*:\s*$/);
    if (pathMatch && isRouteLiteral(pathMatch[1])) {
      currentPath = normalizeRoutePath(pathMatch[1]);
      return;
    }

    const methodMatch = line.match(
      /^\s{2,14}["']?(get|post|put|patch|delete|head|options)["']?\s*:/i,
    );
    if (!currentPath || !methodMatch) return;

    const method = methodMatch[1].toUpperCase();
    routes.push({
      ...base,
      kind: "api",
      source: "openapi",
      method,
      path: currentPath,
      line: index + 1,
      title: `${method} ${currentPath}`,
      summary: "Swagger/OpenAPI documented route",
      evidence: `${base.file}:${index + 1}`,
      evidenceItems: [
        evidenceItem(base.file, index + 1, line.trim(), "static", 0.78),
      ],
      hasDocs: true,
    });
  });

  return routes;
}

function buildEngineFlowEntities(repo, codeFacts, endpoints) {
  const endpointFacts = endpoints.map((endpoint) => ({
    ...endpoint,
    id: `engine-flow:endpoint:${hash(`${endpoint.file}:${endpoint.method}:${endpoint.path}`)}`,
    kind: "engine",
    symbol: endpoint.handlerName || endpoint.path,
    confidence: 0.86,
  }));
  const candidates = uniqueBy(
    [...endpointFacts, ...codeFacts.filter(isEngineFlowCandidate)],
    (item) => item.id,
  )
    .map((item) => ({
      ...item,
      flowGroup: engineFlowGroup(item),
      flowScore: engineFlowScore(item),
    }))
    .filter((item) => item.flowGroup);

  const grouped = new Map();
  for (const item of candidates) {
    const group = grouped.get(item.flowGroup) ?? [];
    group.push(item);
    grouped.set(item.flowGroup, group);
  }

  return [...grouped.entries()].flatMap(([group, items]) =>
    items
      .sort((left, right) => right.flowScore - left.flowScore || lineNumber(left) - lineNumber(right))
      .slice(0, group === "error-code" ? 10 : 8)
      .map((item, index) => ({
        ...item,
        id: `engine-flow:${group}:${index + 1}-${hash(item.id).slice(0, 6)}`,
        kind: item.kind === "error" ? "error" : "engine",
        title: `${index + 1}. ${item.title}`,
        summary: item.summary,
        evidence: item.evidence,
        flowGroup: group,
        flowStep: index + 1,
        transition: engineTransition(item, group),
        status: item.kind === "error" ? "risk" : item.status,
        confidence: item.confidence ?? 0.68,
      })),
  );
}

function extractFrontendApiCalls(text, base) {
  if (!/\/api\//.test(text)) return [];

  const wrappers = [];
  const lines = text.split("\n");
  let currentFunction = "";

  lines.forEach((line, index) => {
    currentFunction = detectJsFunctionName(line) || currentFunction;
    const pathRegex = /[`'"]([^`'"]*\/api\/[^`'"]*)[`'"]/g;
    for (const match of line.matchAll(pathRegex)) {
      const apiPath = normalizeRoutePath(match[1]);
      const method =
        line.match(/axios\.(get|post|put|patch|delete)/i)?.[1]?.toUpperCase() ??
        line.match(/method:\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]/i)?.[1]?.toUpperCase() ??
        "CALL";

      wrappers.push({
        ...base,
        kind: "wrapper",
        method,
        path: apiPath,
        callerName: currentFunction,
        line: index + 1,
        title: currentFunction ? `${currentFunction} -> ${apiPath}` : `${method} ${apiPath}`,
        summary: currentFunction
          ? `frontend callsite in ${currentFunction}`
          : "frontend API wrapper/callsite",
        evidence: `${base.file}:${index + 1}`,
        evidenceItems: [
          evidenceItem(base.file, index + 1, line.trim(), "static", 0.82),
        ],
      });
    }
  });

  return wrappers;
}

function extractCodeTopology(repo, files, routeEntities) {
  const facts = new Map();
  const callRefs = [];
  const edges = [];

  for (const fileItem of files) {
    const extracted = extractFileCodeFacts(fileItem);
    extracted.facts.forEach((fact) => addFact(facts, fact));
    callRefs.push(...extracted.callRefs);
  }

  const symbolIndex = buildSymbolIndex([...facts.values()]);

  for (const route of routeEntities) {
    const handlerName = cleanSymbol(route.handlerName ?? "");
    if (!handlerName) continue;

    const handlerFact =
      findFactBySymbol(symbolIndex, handlerName, route.file) ??
      addFact(facts, syntheticHandlerFact(repo, route, handlerName));

    handlerFact.kind = "handler";
    handlerFact.summary = `API handler for ${route.method} ${route.path}`;
    handlerFact.confidence = Math.max(handlerFact.confidence ?? 0, 0.88);

    edges.push(
      codeEdge(
        entityId(route),
        handlerFact.id,
        "handled by",
        route.status,
        route.evidenceItems ?? [
          evidenceItem(route.file, route.line, route.evidence, "static", 0.84),
        ],
        0.88,
        "handles",
      ),
    );
  }

  for (const ref of callRefs) {
    const source = findFactBySymbol(symbolIndex, ref.callerSymbol, ref.file);
    const target = ref.targetId
      ? facts.get(ref.targetId)
      : findFactBySymbol(symbolIndex, ref.targetSymbol, ref.file);
    if (!source || !target || source.id === target.id) continue;

    edges.push(
      codeEdge(
        source.id,
        target.id,
        ref.label,
        strongestStatus(source.status, target.status),
        ref.evidenceItems,
        ref.confidence,
        ref.kind,
      ),
    );
  }

  return {
    facts: [...facts.values()],
    edges: uniqueBy(edges, (item) => item.id),
  };
}

function extractFileCodeFacts({ file, text, base }) {
  if (!/\.(go|py|tsx?|jsx?)$/.test(file)) {
    return { facts: [], callRefs: [] };
  }

  const facts = [];
  const callRefs = [];
  let currentFunction = "";

  text.split("\n").forEach((line, index) => {
    const lineNo = index + 1;
    const functionName = detectFunctionName(line, file);
    if (functionName) {
      currentFunction = cleanSymbol(functionName);
      facts.push(
        codeFact(base, {
          kind: codeFunctionKind(file, base.repoType),
          title: currentFunction,
          symbol: currentFunction,
          line: lineNo,
          path: `${file}#${currentFunction}`,
          summary: "코드 실행 지점",
          evidenceText: line.trim(),
          confidence: 0.74,
        }),
      );
    }

    const errorCodes = extractErrorCodes(line);
    for (const errorCode of errorCodes) {
      const fact = codeFact(base, {
        kind: "error",
        title: errorCode,
        symbol: errorCode,
        line: lineNo,
        path: `${file}#${errorCode}`,
        summary: "코드에서 선언 또는 사용된 에러 코드",
        evidenceText: line.trim(),
        confidence: 0.82,
        status: base.status === "stable" ? "risk" : base.status,
      });
      facts.push(fact);
      if (currentFunction) {
        callRefs.push(
          codeRef(currentFunction, fact.id, file, lineNo, "raises", "error", line.trim(), 0.76),
        );
      }
    }

    for (const target of extractExternalTargets(line)) {
      const fact = codeFact(base, {
        kind: "external",
        title: target,
        symbol: target,
        line: lineNo,
        path: target,
        summary: "외부 HTTP/API 호출 지점",
        evidenceText: line.trim(),
        confidence: 0.72,
      });
      facts.push(fact);
      if (currentFunction) {
        callRefs.push(
          codeRef(currentFunction, fact.id, file, lineNo, "requests", "external", line.trim(), 0.72),
        );
      }
    }

    if (isDbUsage(line, file)) {
      const fact = codeFact(base, {
        kind: "db",
        title: "DB access",
        symbol: `db:${file}`,
        line: lineNo,
        path: `${file}#db`,
        summary: "DB query/read/write 호출 지점",
        evidenceText: line.trim(),
        confidence: 0.7,
      });
      facts.push(fact);
      if (currentFunction) {
        callRefs.push(
          codeRef(currentFunction, fact.id, file, lineNo, "reads/writes", "db", line.trim(), 0.7),
        );
      }
    }

    if (!currentFunction) return;

    for (const targetSymbol of extractCallSymbols(line, file)) {
      const cleanTarget = cleanSymbol(targetSymbol);
      if (!cleanTarget || cleanTarget === currentFunction) continue;
      callRefs.push(
        codeRef(currentFunction, cleanTarget, file, lineNo, "calls", "calls", line.trim(), 0.58),
      );
    }
  });

  return { facts, callRefs };
}

function codeFact(base, options) {
  const line = Number(options.line ?? 0);
  const id = `code:${base.repo}:${hash(`${base.file}:${options.kind}:${options.symbol}:${line}`)}`;

  return {
    id,
    repo: base.repo,
    repoType: base.repoType,
    file: base.file,
    kind: options.kind,
    status: options.status ?? base.status,
    symbol: options.symbol,
    path: options.path ?? `${base.file}:${line}`,
    line,
    title: options.title,
    summary: options.summary,
    evidence: `${base.file}:${line}`,
    evidenceItems: [
      evidenceItem(base.file, line, options.evidenceText, "static", options.confidence),
    ],
    confidence: options.confidence,
    changes: base.changes,
  };
}

function syntheticHandlerFact(repo, route, handlerName) {
  return {
    id: `code:${repo.name}:${hash(`${route.file}:handler:${handlerName}:${route.line}`)}`,
    repo: repo.name,
    repoType: repo.type,
    file: route.file,
    kind: "handler",
    status: route.status,
    symbol: handlerName,
    path: `${route.file}#${handlerName}`,
    line: route.handlerLine ?? route.line,
    title: handlerName,
    summary: `API handler for ${route.method} ${route.path}`,
    evidence: `${route.file}:${route.handlerLine ?? route.line}`,
    evidenceItems: route.evidenceItems ?? [
      evidenceItem(route.file, route.line, route.evidence, "static", 0.74),
    ],
    confidence: 0.68,
    changes: route.changes,
  };
}

function codeRef(callerSymbol, target, file, line, label, kind, text, confidence) {
  const targetId = String(target).startsWith("code:") ? target : "";
  const targetSymbol = targetId ? "" : target;

  return {
    callerSymbol,
    targetId,
    targetSymbol,
    file,
    label,
    kind,
    evidenceItems: [evidenceItem(file, line, text, "static", confidence)],
    confidence,
  };
}

function codeEdge(source, target, label, status, evidenceItems, confidence, kind) {
  const evidence = evidenceItems?.[0];
  return {
    id: `code-edge:${source}->${target}:${label}:${hash(`${evidence?.file ?? ""}:${evidence?.line ?? ""}:${label}`)}`,
    source,
    target,
    label,
    status,
    kind,
    confidence,
    evidence: evidence ? `${evidence.file}:${evidence.line}` : "",
    evidenceItems: evidenceItems ?? [],
  };
}

function addFact(facts, fact) {
  const existing = facts.get(fact.id);
  if (!existing) {
    facts.set(fact.id, fact);
    return fact;
  }

  existing.status = strongestStatus(existing.status, fact.status);
  existing.confidence = Math.max(existing.confidence ?? 0, fact.confidence ?? 0);
  existing.evidenceItems = uniqueBy(
    [...(existing.evidenceItems ?? []), ...(fact.evidenceItems ?? [])],
    (item) => `${item.file}:${item.line}:${item.text}`,
  ).slice(0, 6);
  return existing;
}

function buildSymbolIndex(facts) {
  const index = new Map();

  for (const fact of facts) {
    if (!fact.symbol) continue;
    const key = cleanSymbol(fact.symbol).toLowerCase();
    const values = index.get(key) ?? [];
    values.push(fact);
    index.set(key, values);
  }

  return index;
}

function findFactBySymbol(index, symbol, preferredFile) {
  const values = index.get(cleanSymbol(symbol).toLowerCase()) ?? [];
  return values.find((item) => item.file === preferredFile) ?? values[0] ?? null;
}

function detectFunctionName(line, file) {
  if (/\.py$/.test(file)) {
    return line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/)?.[1] ?? "";
  }

  if (/\.go$/.test(file)) {
    return (
      line.match(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/)?.[1] ??
      ""
    );
  }

  return detectJsFunctionName(line);
}

function detectJsFunctionName(line) {
  return (
    line.match(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/)?.[1] ??
    line.match(/(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(?/)?.[1] ??
    line.match(/^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*[:=]\s*(?:async\s*)?\([^)]*\)\s*=>/)?.[1] ??
    line.match(/^\s*class\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/)?.[1] ??
    ""
  );
}

function extractCallSymbols(line, file) {
  const calls = [];
  const regex = /\.?\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  for (const match of line.matchAll(regex)) {
    const symbol = cleanSymbol(match[1]);
    if (!symbol || ignoredCallSymbols.has(symbol)) continue;
    if (/\.py$/.test(file) && symbol === "def") continue;
    if (/\.go$/.test(file) && symbol === "func") continue;
    calls.push(symbol);
  }
  return unique(calls).slice(0, 12);
}

function extractExternalTargets(line) {
  const urls = [];
  const regex = /["'`](https?:\/\/[^"'`\s)]+)["'`]/g;
  for (const match of line.matchAll(regex)) {
    urls.push(match[1].replace(/\?.*$/, ""));
  }
  return unique(urls).slice(0, 4);
}

function extractErrorCodes(line) {
  const codes = [];
  const regex = /\b(?:ERR[-_]\d{2,5}|SNT[A-Z0-9_-]{2,}|[A-Z]{2,8}[-_]\d{2,5})\b/g;
  for (const match of line.matchAll(regex)) {
    codes.push(match[0].replace("_", "-"));
  }
  return unique(codes).slice(0, 8);
}

function isDbUsage(line, file) {
  if (isDbFile(file)) return true;
  return /\b(db|database|sql|postgres|mysql|sqlite|mongo|redis|prisma|drizzle|gorm|typeorm|sequelize)\b/i.test(line) ||
    /\.(Query|QueryRow|Exec|Find|FindOne|Insert|Update|Delete|Create|Save)(Context)?\s*\(/.test(line);
}

function codeFunctionKind(file, repoType) {
  if (isUiFile(file)) return "ui";
  if (repoType === "engine" || /\.py$/.test(file)) return "engine";
  if (/api|route|handler|server|controller/i.test(file)) return "handler";
  return "function";
}

function evidenceItem(file, line, text, source, confidence) {
  return {
    file,
    line: Number(line) || 0,
    text: trimEvidenceText(text ?? ""),
    source,
    confidence: Number(confidence.toFixed(2)),
  };
}

function trimEvidenceText(text) {
  const normalized = String(text).replace(/\s+/g, " ").trim();
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177)}...`;
}

function cleanSymbol(value) {
  return String(value ?? "")
    .trim()
    .replace(/^[*.]+/, "")
    .split(".")
    .at(-1)
    ?.replace(/[^A-Za-z0-9_$-]/g, "") ?? "";
}

function strongestStatus(left, right) {
  const score = { risk: 4, active: 3, added: 2, changed: 2, stable: 1 };
  return (score[left] ?? 0) >= (score[right] ?? 0) ? left : right;
}

function lineNumber(item) {
  return Number(item.line ?? item.flowStep ?? 0);
}

function isEngineFlowCandidate(item) {
  if (item.kind === "error") return true;
  if (item.kind === "external" || item.kind === "db") return false;
  return /engine|analysis|analy[sz]e|score|overlay|callback|train|retrain|fit|model|artifact|feature|dataset|collect|predict|detect/i.test(
    `${item.repoType} ${item.file} ${item.title} ${item.symbol ?? ""} ${item.path ?? ""}`,
  );
}

function engineFlowGroup(item) {
  const target = `${item.file} ${item.title} ${item.symbol ?? ""} ${item.path ?? ""}`.toLowerCase();
  if (item.kind === "error" || /err[-_]\d|snt|error|failure|exception/.test(target)) {
    return "error-code";
  }
  if (/train|retrain|fit|model|artifact|feature|dataset|collect|label/.test(target)) {
    return "training";
  }
  if (/analysis|analyze|analyse|score|overlay|callback|predict|detect|incident|anomaly/.test(target)) {
    return "analysis";
  }
  return "";
}

function engineFlowScore(item) {
  const target = `${item.file} ${item.title} ${item.symbol ?? ""} ${item.path ?? ""}`.toLowerCase();
  const order = [
    [/\/|route|endpoint|start|request|create|bootstrap/, 120],
    [/plan|validate|admission|config/, 104],
    [/collect|fetch|load|query|dataset|source/, 92],
    [/feature|transform|matrix|prepare/, 80],
    [/score|predict|detect|fit|train/, 68],
    [/overlay|artifact|publish|save|store|callback|result/, 56],
    [/error|failure|exception|err[-_]\d|snt/, 44],
  ];
  const matched = order.find(([pattern]) => pattern.test(target))?.[1] ?? 20;
  const statusBoost = item.status === "stable" ? 0 : 12;
  return matched + statusBoost + Math.round((item.confidence ?? 0.5) * 10);
}

function engineTransition(item, group) {
  const target = `${item.title} ${item.symbol ?? ""} ${item.path ?? ""}`.toLowerCase();
  if (group === "error-code") return "error branch";
  if (/route|endpoint|request|start|create|bootstrap/.test(target)) return "request";
  if (/plan|validate|admission|config/.test(target)) return "validate";
  if (/collect|fetch|load|query|dataset|source/.test(target)) return "collect";
  if (/feature|transform|matrix|prepare/.test(target)) return "feature";
  if (/score|predict|detect|fit|train/.test(target)) return group === "training" ? "fit" : "score";
  if (/overlay|artifact|publish|save|store|callback|result/.test(target)) return "publish/result";
  return group === "training" ? "training flow" : "analysis flow";
}

function normalizeRoutePath(value) {
  return value
    .replace(/\$\{\s*encodeURIComponent\(([^)]+)\)\s*\}/g, "{$1}")
    .replace(/\$\{\s*([^}]+)\s*\}/g, "{$1}")
    .replace(/\{([^}]+)\}/g, (_, key) => `{${String(key).split(".").at(-1)}}`)
    .replace(/\?.*$/, "")
    .replace(/\/+/g, "/")
    .trim();
}

function isRouteLiteral(value) {
  return value.startsWith("/") || value.startsWith("{");
}

function mentionsPathOrTokens(text, routePath) {
  if (text.includes(routePath)) return true;
  const tokens = pathTokens(routePath);
  if (tokens.length === 0) return false;
  const lower = text.toLowerCase();
  return tokens.filter((token) => lower.includes(token)).length >= Math.min(3, tokens.length);
}

function dedupeApiRoutes(routes) {
  const byKey = new Map();

  for (const route of routes) {
    const key = `${route.repo}:${route.method}:${route.path}`;
    const existing = byKey.get(key);

    if (
      !existing ||
      (existing.source === "openapi" && route.source !== "openapi") ||
      route.status !== "stable"
    ) {
      byKey.set(key, route);
    }
  }

  return [...byKey.values()];
}

function pathTokens(value) {
  return unique(
    value
      .toLowerCase()
      .replace(/\{[^}]+\}/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3)
      .filter((token) => !["api", "org", "orgs", "organizations"].includes(token)),
  );
}

function buildSnapshot(repos, previousSnapshot) {
  const snapshot = {
    generatedAt: new Date().toISOString(),
    source: "local-scan",
    repos: repos.map((repo) => ({
      name: repo.name,
      path: repo.path,
      type: repo.type,
      branch: repo.branch,
      baseBranch: repo.baseRef,
      head: repo.head,
      latestCommit: repo.latestCommit,
      dirty: repo.dirty,
      changedCount: repo.changedFiles.length,
      teamChangedCount: repo.teamChangedFiles.length,
      teamUpdates: repo.teamUpdates,
      routeCount: repo.entities.routes.length,
      wrapperCount: repo.entities.wrappers.length,
      engineEndpointCount: repo.entities.engineEndpoints.length,
      codeFactCount: repo.entities.codeFacts.length,
      warnings: repo.warnings,
    })),
    warnings: repos.flatMap((repo) =>
      repo.warnings.map((warning) => `${repo.name}: ${warning}`),
    ),
    scenarios: [
      buildScenario("current-work", "내 작업", "실제 git diff 기준", repos),
      buildScenario("team-briefing", "팀 변경", "origin/develop 반영 후 차이", repos),
      buildScenario("contract-check", "API 계약", "route, wrapper, 문서, 테스트 자동 비교", repos),
      buildScenario("engine-flow", "분석엔진", "분석 오버레이와 학습 모델 생성 흐름", repos),
    ],
  };
  snapshot.scanDelta = buildScanDelta(previousSnapshot, snapshot);
  snapshot.history = buildHistory(previousSnapshot, snapshot.scanDelta);

  return snapshot;
}

function buildScanDelta(previousSnapshot, snapshot) {
  const hasPreviousHistory =
    Array.isArray(previousSnapshot?.history) || Boolean(previousSnapshot?.scanDelta);
  const events = previousSnapshot && hasPreviousHistory
    ? buildDeltaEvents(previousSnapshot, snapshot)
    : [
        {
          id: `baseline:${snapshot.generatedAt}`,
          at: snapshot.generatedAt,
          type: "baseline",
          scenarioId: "all",
          scenarioLabel: "전체",
          title: "히스토리 기준점 생성",
          detail: `${snapshot.repos.length}개 repo와 ${snapshot.scenarios.reduce((sum, scenario) => sum + (scenario.featureChanges?.length ?? 0), 0)}개 기능 변화를 기준으로 저장함`,
          items: snapshot.repos.map((repo) => `${repo.name} ${repo.branch}`).slice(0, 5),
        },
      ];
  events.push(...teamPrEvents(snapshot));

  if (events.length === 0) {
    events.push({
      id: `none:${snapshot.generatedAt}`,
      at: snapshot.generatedAt,
      type: "none",
      scenarioId: "all",
      scenarioLabel: "전체",
      title: "이번 스캔 변화 없음",
      detail: "이전 스냅샷과 기능/파일 변화가 같습니다.",
      items: [],
    });
  }

  return {
    from: previousSnapshot?.generatedAt ?? null,
    to: snapshot.generatedAt,
    hasChanges: events.some((event) => event.type !== "none"),
    summary: summarizeScanDelta(events),
    events: uniqueBy(events, (event) => event.id)
      .sort((a, b) => historyEventScore(b) - historyEventScore(a))
      .slice(0, 12),
  };
}

function teamPrEvents(snapshot) {
  return snapshot.repos.flatMap((repo) =>
    (repo.teamUpdates ?? [])
      .filter((update) => update.prNumber)
      .slice(0, 3)
      .map((update) => ({
        id: `team-pr:${repo.name}:${update.prNumber}`,
        at: update.at || snapshot.generatedAt,
        type: "changed",
        scenarioId: "team-briefing",
        scenarioLabel: "팀 변경",
        title: `${repo.name} PR #${update.prNumber} 미반영`,
        detail: update.subject,
        items: [
          `${update.files.length || repo.teamChangedCount} files`,
          `commit ${update.hash}`,
          `PR #${update.prNumber}`,
        ],
      })),
  );
}

function buildHistory(previousSnapshot, scanDelta) {
  const previousHistory = Array.isArray(previousSnapshot?.history)
    ? previousSnapshot.history
    : [];
  const nextEvents = scanDelta.events.filter((event) => event.type !== "none");

  return uniqueBy(
    [...nextEvents, ...previousHistory],
    (event) => event.id,
  ).slice(0, config.scanLimits.historyEvents);
}

function buildDeltaEvents(previousSnapshot, snapshot) {
  const events = [];
  const previousScenarios = new Map(
    (previousSnapshot.scenarios ?? []).map((scenario) => [scenario.id, scenario]),
  );

  for (const scenario of snapshot.scenarios) {
    const previousScenario = previousScenarios.get(scenario.id);
    if (!previousScenario) {
      events.push(historyEvent("added", snapshot.generatedAt, scenario, "관점 추가", scenario.description, []));
      continue;
    }

    events.push(
      ...featureDeltaEvents(previousScenario, scenario, snapshot.generatedAt),
      ...fileDeltaEvents(previousScenario, scenario, snapshot.generatedAt),
    );
  }

  return events
    .sort((a, b) => historyEventScore(b) - historyEventScore(a))
    .slice(0, 12);
}

function featureDeltaEvents(previousScenario, scenario, at) {
  const events = [];
  const previousFeatures = new Map(
    (previousScenario.featureChanges ?? []).map((feature) => [feature.id, feature]),
  );
  const currentFeatures = new Map(
    (scenario.featureChanges ?? []).map((feature) => [feature.id, feature]),
  );

  for (const [id, feature] of currentFeatures.entries()) {
    const previous = previousFeatures.get(id);
    if (!previous) {
      events.push(
        historyEvent(
          "added",
          at,
          scenario,
          `${feature.title} 기능 새로 감지`,
          feature.summary,
          featureItems(feature),
        ),
      );
      continue;
    }

    if (featureFingerprint(previous) !== featureFingerprint(feature)) {
      events.push(
        historyEvent(
          "changed",
          at,
          scenario,
          `${feature.title} 기능 변화량 변경`,
          `${previous.summary} -> ${feature.summary}`,
          featureItems(feature),
        ),
      );
    }
  }

  for (const [id, feature] of previousFeatures.entries()) {
    if (currentFeatures.has(id)) continue;
    events.push(
      historyEvent(
        "deleted",
        at,
        scenario,
        `${feature.title} 기능 변화 사라짐`,
        feature.summary,
        featureItems(feature),
      ),
    );
  }

  return events;
}

function fileDeltaEvents(previousScenario, scenario, at) {
  const previousFiles = new Set(previousScenario.files ?? []);
  const currentFiles = new Set(scenario.files ?? []);
  const added = difference([...currentFiles], previousFiles);
  const deleted = difference([...previousFiles], currentFiles);
  const events = [];

  if (added.length > 0) {
    events.push(
      historyEvent(
        "added",
        at,
        scenario,
        `${added.length}개 변경 파일 새로 감지`,
        "직전 스캔에는 없던 변경 파일입니다.",
        added.slice(0, 5),
      ),
    );
  }

  if (deleted.length > 0) {
    events.push(
      historyEvent(
        "deleted",
        at,
        scenario,
        `${deleted.length}개 변경 파일 해소`,
        "직전 스캔에는 있었지만 이번 스캔에서 사라졌습니다.",
        deleted.slice(0, 5),
      ),
    );
  }

  return events;
}

function historyEvent(type, at, scenario, title, detail, items) {
  return {
    id: `${at}:${scenario.id}:${type}:${slugify(title)}`,
    at,
    type,
    scenarioId: scenario.id,
    scenarioLabel: scenario.label,
    title,
    detail,
    items,
  };
}

function summarizeScanDelta(events) {
  const counts = events.reduce(
    (result, event) => {
      result[event.type] = (result[event.type] ?? 0) + 1;
      return result;
    },
    {},
  );

  if (counts.none) return "새 변화 없음";
  if (counts.baseline) return "기준점 생성";
  return `추가 ${counts.added ?? 0} / 삭제 ${counts.deleted ?? 0} / 변경 ${counts.changed ?? 0}`;
}

function featureFingerprint(feature) {
  return JSON.stringify({
    action: feature.action,
    summary: feature.summary,
    detail: feature.detail,
    signals: feature.signals ?? [],
    items: feature.items ?? [],
    files: feature.files ?? [],
  });
}

function featureItems(feature) {
  return unique([
    ...(feature.signals ?? []),
    ...(feature.items ?? []),
    ...(feature.files ?? []),
  ]).slice(0, 5);
}

function historyEventScore(event) {
  const typeScore = {
    deleted: 300,
    added: 240,
    changed: 180,
    baseline: 80,
    none: 0,
  }[event.type] ?? 0;
  return typeScore + (event.items?.length ?? 0);
}

function buildScenario(id, label, description, repos) {
  const mode = id === "team-briefing"
    ? "team"
    : id === "contract-check"
      ? "contract"
      : id === "engine-flow"
        ? "engine"
        : "current";
  const isEngineFlow = mode === "engine";
  const nodes = [];
  const edges = [];
  const files = [];
  const briefing = [];
  const graphRepos = isEngineFlow
    ? repos.filter((repo) => repo.type === "engine" || repo.entities.engineEndpoints.length > 0)
    : repos;

  graphRepos.forEach((repo, index) => {
    const status = repo.dirty > 0 || repo.changedFiles.length > 0 ? "active" : repo.teamChangedFiles.length > 0 ? "changed" : "stable";
    nodes.push(node(`repo:${repo.name}`, repo.name, repo.name, repo.path, "repo", status, 0, index, `${repo.branch} / ${repo.head}`, `${repo.changedFiles.length} local, ${repo.teamChangedFiles.length} team changes`, "git status + branch scan", [repo.type, repo.branch], [
      { label: "routes", value: String(repo.entities.routes.length) },
      { label: "dirty", value: String(repo.dirty) },
    ]));
  });

  const selectedFiles = isEngineFlow ? [] : selectFilesForMode(repos, mode);
  files.push(...selectedFiles.map((item) => `${item.repo.name}/${item.file}`));

  for (const item of selectedFiles.slice(0, 16)) {
    const kind = classifyFileKind(item.file, item.repo.type);
    const status = item.status;
    const nodeId = `file:${item.repo.name}:${item.file}`;
      nodes.push(node(
        nodeId,
        titleFromFile(item.file),
      item.repo.name,
      item.file,
      kind,
      status,
      kindColumn(kind),
      nodes.length,
      status === "risk" ? "삭제 또는 검증 필요 파일" : "git diff에 걸린 실제 파일",
      `${item.repo.branch}에서 변경 감지`,
        "git status/diff",
        [status, kind],
        undefined,
        item.change,
      ));
    edges.push(edge(`repo:${item.repo.name}`, nodeId, "changed file", status));
  }

  const contextTokens = selectedFiles.flatMap((item) => pathTokens(item.file));
  const apiEntityLimit = mode === "contract" ? config.scanLimits.apiNodesPerScenario : null;
  const routes = selectEntities(
    repos.flatMap((repo) => repo.entities.routes),
    contextTokens,
    mode,
    isEngineFlow ? 0 : apiEntityLimit ?? 16,
  );
  const wrappers = selectEntities(
    repos.flatMap((repo) => repo.entities.wrappers),
    contextTokens,
    mode,
    isEngineFlow ? 0 : apiEntityLimit ?? 14,
  );
  const endpoints = selectEntities(
    repos.flatMap((repo) => repo.entities.engineEndpoints),
    contextTokens,
    mode,
    isEngineFlow ? config.scanLimits.apiNodesPerScenario : apiEntityLimit ?? 12,
  );
  const engineFlows = isEngineFlow
    ? repos.flatMap((repo) => repo.entities.engineFlows)
    : [];
  const docs = selectEntities(
    repos.flatMap((repo) => repo.entities.docs),
    contextTokens,
    mode,
    isEngineFlow ? 0 : 8,
  );
  const tests = selectEntities(
    repos.flatMap((repo) => repo.entities.tests),
    contextTokens,
    mode,
    isEngineFlow ? 0 : 8,
  );
  const dbFiles = selectEntities(
    repos.flatMap((repo) => repo.entities.dbFiles),
    contextTokens,
    mode,
    isEngineFlow ? 0 : 5,
  );
  const codeFacts = selectEntities(
    repos.flatMap((repo) => repo.entities.codeFacts),
    contextTokens,
    mode,
    isEngineFlow ? 0 : 18,
  );
  const codeEdges = repos.flatMap((repo) => repo.entities.codeEdges);

  const selectedEntities = isEngineFlow
    ? [...engineFlows, ...endpoints]
    : [...wrappers, ...routes, ...endpoints, ...codeFacts, ...docs, ...tests, ...dbFiles];
  const featureChanges = buildFeatureChanges(selectedFiles, selectedEntities, mode);

  for (const item of selectedEntities) {
    const itemId = entityId(item);
    if (nodes.some((existing) => existing.id === itemId)) continue;
    const status = mode === "contract" && item.kind === "api" && (!item.hasDocs || !item.hasTests)
      ? "risk"
      : item.status;
    nodes.push(node(
      itemId,
      item.title,
      item.repo,
      item.file,
      item.kind,
      status,
      kindColumn(item.kind),
      nodes.length,
      item.summary,
      item.path ? `${item.method} ${item.path}` : item.summary,
      item.evidence,
      badgesForEntity(item, status),
      undefined,
      changeForMode(item, mode),
      item.evidenceItems,
      item.confidence,
    ));
    if (status !== "stable") {
      edges.push(edge(`repo:${item.repo}`, itemId, "owns", status));
    }
  }

  connectByFile(nodes, edges);
  connectApiFlow(wrappers, routes, endpoints, edges);
  connectStaticCodeEdges(selectedEntities, codeEdges, edges);
  connectEngineFlows(engineFlows, edges);
  connectContracts(routes, docs, tests, edges);
  connectData(routes, dbFiles, edges);

  if (isEngineFlow) {
    briefing.push(
      {
        type: "정상",
        title: "분석 흐름 표시",
        detail: "/analyze부터 query fetch, scoring, overlay callback까지",
      },
      {
        type: "정상",
        title: "학습 흐름 표시",
        detail: "/train부터 수집, 품질검증, 모델 생성, artifact publish까지",
      },
      {
        type: "주의",
        title: "에러 코드 표시",
        detail: "query/source/feature/artifact/callback 실패가 error-code 노드로 연결됨",
      },
    );
  } else if (featureChanges.length > 0) {
    const featureCounts = countFeatureActions(featureChanges);
    briefing.push({
      type: featureCounts.deleted > 0 ? "주의" : featureCounts.added > 0 ? "추가" : "변경",
      title: `${featureChanges.length}개 기능 변화 감지`,
      detail: `추가 ${featureCounts.added}, 삭제 ${featureCounts.deleted}, 변경 ${featureCounts.changed}`,
    });
  }

  if (isEngineFlow) {
    const changedFlowCount = engineFlows.filter((item) => item.status !== "stable").length;
    if (changedFlowCount > 0) {
      briefing.push({
        type: "변경",
        title: `엔진 흐름 구성 파일 ${changedFlowCount}개 변경`,
        detail: "해당 노드가 active/changed 상태로 표시됨",
      });
    }
  } else if (selectedFiles.length === 0 && mode === "current") {
    briefing.push({
      type: "정상",
      title: "현재 로컬 diff가 없음",
      detail: "repo 연결과 route/wrapper 스캔은 완료됨",
    });
  } else {
    const apiChanged = selectedFiles.filter((item) => classifyFileKind(item.file, item.repo.type) === "api").length;
    const uiChanged = selectedFiles.filter((item) => classifyFileKind(item.file, item.repo.type) === "ui").length;
    briefing.push({
      type: mode === "team" ? "변경" : "추가",
      title: `${selectedFiles.length}개 파일에서 영향 범위 감지`,
      detail: `UI ${uiChanged}개, API/engine ${apiChanged}개 중심으로 연결선을 생성함`,
    });
  }

  const riskyRoutes = routes.filter((route) => !route.hasDocs || !route.hasTests);
  if (riskyRoutes.length > 0) {
    briefing.push({
      type: "주의",
      title: `${riskyRoutes.length}개 API가 문서 또는 테스트 확인 필요`,
      detail: "Swagger/OpenAPI와 test/e2e 파일에서 matching signal이 약함",
    });
  }

  if (mode === "team") {
    const teamCount = repos.reduce((sum, repo) => sum + repo.teamChangedFiles.length, 0);
    const teamPrLabel = teamUpdateLabel(repos);
    if (teamPrLabel) {
      briefing.push({
        type: "변경",
        title: `팀원 최근 변경 ${teamPrLabel.count}개 감지`,
        detail: teamPrLabel.text,
      });
    }
    briefing.push({
      type: teamCount > 0 ? "변경" : "정상",
      title: teamCount > 0 ? `origin/develop에 ${teamCount}개 미반영 파일 있음` : "origin/develop과 큰 차이 없음",
      detail: "fetch가 성공한 repo 기준으로 HEAD..base diff를 계산함",
    });
  }

  const prioritizedNodes = prioritizeGraphNodes(nodes);
  const allPositioned = assignPositions(prioritizedNodes);
  const allEdges = edgesForVisibleNodes(allPositioned, edges);
  const positioned = assignPositions(
    isEngineFlow
      ? nodes
      : selectVisibleGraphNodes(nodes, config.scanLimits.nodesPerScenario),
  );
  const visibleEdges = edgesForVisibleNodes(positioned, edges);

  return {
    id,
    label,
    description,
    branch: recentCommitLabel(repos),
    compare: mode === "team"
      ? "원격 최신 커밋과 비교"
      : mode === "contract"
        ? "extractor graph"
        : mode === "engine"
          ? "engine runtime/training flow"
          : "최근 커밋 + local diff",
    focusNodeId: isEngineFlow
      ? "engine-flow:analysis:1-start"
      : positioned.find((item) => item.data.status === "active")?.id ?? positioned[0]?.id ?? "",
    files: files.slice(0, config.scanLimits.changedFiles),
    featureChanges,
    briefing,
    nodes: positioned,
    edges: visibleEdges,
    allNodes: allPositioned,
    allEdges,
    hiddenCount: Math.max(0, allPositioned.length - positioned.length),
    visibleLimit: config.scanLimits.nodesPerScenario,
  };
}

function buildFeatureChanges(selectedFiles, selectedEntities, mode) {
  const groups = new Map();

  for (const item of selectedFiles) {
    addFeatureRecord(groups, {
      repo: item.repo.name,
      repoType: item.repo.type,
      file: item.file,
      kind: classifyFileKind(item.file, item.repo.type),
      status: item.status,
      change: item.change,
      title: titleFromFile(item.file),
    });
  }

  for (const item of selectedEntities) {
    const change = changeForMode(item, mode);
    if (!change && item.status === "stable") continue;

    addFeatureRecord(groups, {
      repo: item.repo,
      repoType: item.repoType,
      file: item.file,
      kind: item.kind,
      status: item.status,
      change,
      title: item.title,
      path: item.path,
      method: item.method,
    });
  }

  return [...groups.values()]
    .map((group) => finishFeatureGroup(group))
    .sort((a, b) => featureSortScore(b) - featureSortScore(a))
    .slice(0, 8);
}

function addFeatureRecord(groups, item) {
  if (!item.change && item.status === "stable") return;

  const feature = inferFeature(item.file, item.path, item.title);
  if (!groups.has(feature.id)) {
    groups.set(feature.id, {
      id: feature.id,
      title: feature.title,
      counts: { added: 0, deleted: 0, changed: 0 },
      additions: 0,
      deletions: 0,
      repos: new Set(),
      files: new Set(),
      kinds: new Set(),
      signals: [],
      items: new Set(),
    });
  }

  const group = groups.get(feature.id);
  const action = classifyFeatureAction(item.status, item.change);
  group.counts[action] += 1;
  group.additions += item.change?.additions ?? 0;
  group.deletions += item.change?.deletions ?? 0;
  group.repos.add(item.repo);
  group.files.add(`${item.repo}/${item.file}`);
  group.kinds.add(item.kind);

  const itemLabel = item.path
    ? `${item.method ?? "CALL"} ${item.path}`
    : `${kindLabel(item.kind)} ${titleFromFile(item.file)}`;
  group.items.add(itemLabel);

  for (const signal of item.change?.signals ?? []) {
    const signalAction = signal.action === "deleted" ? "삭제" : "추가";
    group.signals.push(`${signalAction} ${kindLabel(signal.kind)} ${signal.label}`);
    if (signal.action === "added" || signal.action === "deleted") {
      group.counts[signal.action] += 1;
    }
  }
}

function finishFeatureGroup(group) {
  const counts = group.counts;
  const action = dominantFeatureAction(counts);
  const kindSummary = [...group.kinds].map(kindLabel).join(", ");

  return {
    id: group.id,
    title: group.title,
    action,
    summary: `추가 ${counts.added} / 삭제 ${counts.deleted} / 변경 ${counts.changed}`,
    detail: `${kindSummary || "코드"} · +${group.additions} / -${group.deletions}`,
    repos: [...group.repos].sort(),
    files: [...group.files].slice(0, 6),
    signals: unique(group.signals).slice(0, 6),
    items: [...group.items].slice(0, 5),
    counts,
  };
}

function countFeatureActions(features) {
  return features.reduce(
    (counts, feature) => {
      counts.added += feature.counts?.added ?? (feature.action === "added" ? 1 : 0);
      counts.deleted += feature.counts?.deleted ?? (feature.action === "deleted" ? 1 : 0);
      counts.changed += feature.counts?.changed ?? (feature.action === "changed" ? 1 : 0);
      return counts;
    },
    { added: 0, deleted: 0, changed: 0 },
  );
}

function classifyFeatureAction(status, change) {
  if (status === "added") return "added";
  if (status === "risk" && (!change || change.summary.includes("삭제"))) return "deleted";

  const signals = change?.signals ?? [];
  const addedSignals = signals.filter((signal) => signal.action === "added").length;
  const deletedSignals = signals.filter((signal) => signal.action === "deleted").length;
  if (addedSignals > 0 && deletedSignals === 0) return "added";
  if (deletedSignals > 0 && addedSignals === 0) return "deleted";

  if (change && change.additions > 0 && change.deletions === 0) return "added";
  if (change && change.deletions > 0 && change.additions === 0) return "deleted";
  return "changed";
}

function dominantFeatureAction(counts) {
  if (counts.added > 0 && counts.deleted > 0) return "changed";
  if (counts.deleted > 0 && counts.deleted >= counts.added && counts.deleted >= counts.changed) {
    return "deleted";
  }
  if (counts.added > 0 && counts.added >= counts.changed) return "added";
  return "changed";
}

function featureSortScore(feature) {
  return (
    feature.counts.deleted * 1200 +
    feature.counts.added * 900 +
    feature.counts.changed * 500 +
    feature.files.length * 30 +
    feature.signals.length * 20
  );
}

function inferFeature(file, routePath, title) {
  const target = `${file} ${routePath ?? ""} ${title ?? ""}`.toLowerCase();
  const patterns = [
    [/model|train|retrain|anomaly|incident|detector|scoring/, "model-flow", "모델/분석 흐름"],
    [/connect|connection|integration|github|repository/, "repo-connection", "Repo 연결"],
    [/chat|conversation|message/, "chat", "Chat"],
    [/auth|login|token|session|oauth/, "auth", "인증"],
    [/dashboard|overview|metric|monitor/, "dashboard", "Dashboard"],
    [/setting|config|preference/, "settings", "Settings"],
    [/alert|notification|alarm/, "alert", "알림"],
    [/billing|payment|plan|subscription/, "billing", "Billing"],
    [/kubernetes|helm|manifest|deployment|service/, "kubernetes", "Kubernetes 배포"],
    [/swagger|openapi|docs?/, "api-docs", "API 문서"],
    [/test|spec|e2e/, "tests", "검증 테스트"],
    [/db|migration|schema|postgres/, "database", "DB schema"],
  ];

  for (const [pattern, id, featureTitle] of patterns) {
    if (pattern.test(target)) return { id, title: featureTitle };
  }

  const tokens = pathTokens(`${routePath ?? ""} ${file}`).filter(
    (token) =>
      ![
        "frontend",
        "backend",
        "internal",
        "server",
        "routes",
        "route",
        "pages",
        "components",
        "src",
        "cmd",
        "pkg",
      ].includes(token),
  );
  const selected = tokens.slice(0, 2);
  const fallback = selected.length > 0 ? selected.map(humanizeToken).join(" / ") : titleFromFile(file);

  return {
    id: selected.join("-") || fallback.toLowerCase(),
    title: fallback,
  };
}

function kindLabel(kind) {
  return {
    repo: "repo",
    ui: "화면",
    wrapper: "프론트 API",
    api: "백엔드 API",
    engine: "엔진 API",
    handler: "처리 함수",
    function: "함수",
    external: "외부 API",
    error: "에러 코드",
    db: "DB",
    docs: "문서",
    test: "테스트",
    file: "파일",
    code: "코드",
  }[kind] ?? String(kind);
}

function humanizeToken(token) {
  if (token.length <= 3) return token.toUpperCase();
  return token
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function selectFilesForMode(repos, mode) {
  const items = [];

  for (const repo of repos) {
    const files = mode === "team"
      ? repo.teamChangedFiles
      : mode === "contract"
        ? []
        : repo.changedFiles;

    for (const file of files) {
      items.push({
        repo,
        file,
        status: repo.fileStatuses[file] ?? "changed",
        change:
          mode === "team"
            ? repo.changeDetails.team[file]
            : repo.changeDetails.current[file] ?? repo.changeDetails.team[file],
      });
    }
  }

  return items
    .filter((item) => isScannable(item.file))
    .sort((a, b) => priorityScore(b.file) - priorityScore(a.file));
}

function changeForMode(item, mode) {
  if (!item.changes) return undefined;
  return mode === "team"
    ? item.changes.team ?? item.changes.current
    : item.changes.current ?? item.changes.team;
}

function selectEntities(entities, contextTokens, mode, limit) {
  return entities
    .map((item) => ({
      item,
      score: entityScore(item, contextTokens, mode),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item)
    .slice(0, limit);
}

function entityScore(item, contextTokens, mode) {
  let score = priorityScore(item.file);
  if (item.status !== "stable") score += 20;
  if (mode === "contract" && item.path) score += 14;
  if (/model|train|retrain|anomaly|incident|detector|scoring/i.test(`${item.file} ${item.path ?? ""}`)) score += 16;
  if (contextTokens.length > 0) {
    const targetTokens = pathTokens(`${item.file} ${item.path ?? ""}`);
    score += contextTokens.filter((token) => targetTokens.includes(token)).length * 8;
  }
  return score;
}

function priorityScore(file) {
  if (/model|train|retrain|anomaly|incident|detector|scoring/i.test(file)) return 40;
  if (/frontend\/src\/api|backend\/cmd\/server|api\/routes/.test(file)) return 30;
  if (/swagger|openapi|tests?/.test(file)) return 22;
  if (/frontend\/src\/pages/.test(file)) return 18;
  return 5;
}

function classifyFileKind(file, repoType) {
  if (isTestFile(file)) return "test";
  if (isDocsFile(file)) return "docs";
  if (isDbFile(file)) return "db";
  if (/frontend\/src\/api/.test(file)) return "wrapper";
  if (isUiFile(file)) return "ui";
  if (repoType === "engine" || /\.py$/.test(file)) return "engine";
  if (/backend|gateway|api|server/.test(file)) return "api";
  return "repo";
}

function node(id, title, repo, filePath, kind, status, column, order, impact, summary, evidence, badges, metrics, change, evidenceItems, confidence) {
  return {
    id,
    type: "entity",
    position: { x: column * 340 + 40, y: 80 + order * 180 },
    data: {
      title,
      repo,
      path: filePath,
      kind,
      status,
      impact,
      summary,
      evidence,
      badges,
      metrics,
      change,
      evidenceItems,
      confidence,
    },
  };
}

function edge(source, target, label, status, metadata = {}) {
  return {
    id: `${source}->${target}:${label}`,
    source,
    target,
    label,
    data: { ...metadata, status },
  };
}

function assignPositions(nodes) {
  const maxRows = 3;
  const nodeStepX = 560;
  const nodeStepY = 360;
  const stageGap = 260;
  const startX = 90;
  const startY = 90;
  const stageOrder = [
    "repo",
    "file",
    ...Array.from({ length: 12 }, (_, index) => `flow-${index + 1}`),
    "surface",
    "api",
    "downstream",
  ];
  const groups = new Map(stageOrder.map((stage) => [stage, []]));

  for (const item of nodes) {
    const stage = nodeStage(item);
    groups.get(stage)?.push(item);
  }

  let nextX = startX;
  const positioned = [];

  for (const stage of stageOrder) {
    const group = groups.get(stage) ?? [];
    if (group.length === 0) continue;

    const lanes = Math.max(1, Math.ceil(group.length / maxRows));
    const orderedGroup = group
      .map((item, index) => ({ item, index }))
      .sort((a, b) => nodeLaneOrder(a.item) - nodeLaneOrder(b.item) || a.index - b.index)
      .map(({ item }) => item);

    orderedGroup.forEach((item, index) => {
      const lane = Math.floor(index / maxRows);
      const row = index % maxRows;
      positioned.push({
        ...item,
        position: {
          x: nextX + lane * nodeStepX,
          y: startY + row * nodeStepY,
        },
      });
    });
    nextX += lanes * nodeStepX + stageGap;
  }

  return positioned;
}

function edgesForVisibleNodes(nodes, edges) {
  const visibleIds = new Set(nodes.map((item) => item.id));
  const visibleEdges = uniqueBy(edges, (item) => item.id).filter(
    (item) => visibleIds.has(item.source) && visibleIds.has(item.target),
  );
  const connectedIds = new Set(
    visibleEdges.flatMap((item) => [item.source, item.target]),
  );

  for (const item of nodes) {
    const repoId = `repo:${item.data.repo}`;
    if (
      item.id.startsWith("repo:") ||
      connectedIds.has(item.id) ||
      !visibleIds.has(repoId)
    ) {
      continue;
    }
    visibleEdges.push(edge(repoId, item.id, "owns", item.data.status));
  }

  return visibleEdges;
}

function nodeStage(item) {
  if (item.id.startsWith("repo:")) return "repo";
  if (item.id.startsWith("file:")) return "file";
  const flowStage = item.id.match(/^engine-flow:[^:]+:(\d+)-/);
  if (flowStage) return `flow-${flowStage[1]}`;
  if (item.data.kind === "ui" || item.data.kind === "wrapper") return "surface";
  if (item.data.kind === "api") return "api";
  if (item.data.kind === "handler" || item.data.kind === "function") return "downstream";
  return "downstream";
}

function nodeLaneOrder(item) {
  if (item.id.startsWith("engine-flow:analysis:")) return 0;
  if (item.id.startsWith("engine-flow:training:")) return 1;
  if (item.id.startsWith("engine-flow:snt:")) return 2;
  return 0;
}

function kindColumn(kind) {
  return {
    repo: 0,
    ui: 1,
    wrapper: 1,
    api: 2,
    handler: 3,
    function: 3,
    docs: 2,
    engine: 3,
    external: 4,
    error: 4,
    db: 3,
    test: 3,
  }[kind] ?? 1;
}

function prioritizeGraphNodes(nodes) {
  return nodes
    .map((item, index) => ({
      item,
      index,
      score: graphNodeScore(item),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item);
}

function selectVisibleGraphNodes(nodes, limit) {
  const required = nodes.filter((item) => item.id.startsWith("repo:"));
  const requiredIds = new Set(required.map((item) => item.id));
  const rest = prioritizeGraphNodes(nodes).filter((item) => !requiredIds.has(item.id));

  return [...required, ...rest.slice(0, limit)];
}

function graphNodeScore(item) {
  const statusScore = {
    active: 120,
    risk: 105,
    added: 98,
    changed: 88,
    stable: 24,
  }[item.data.status] ?? 0;
  const kindScore = {
    api: 20,
    handler: 19,
    function: 15,
    wrapper: 18,
    engine: 18,
    external: 13,
    error: 24,
    ui: 16,
    test: 12,
    docs: 10,
    db: 10,
    repo: item.data.status === "stable" ? -8 : 12,
  }[item.data.kind] ?? 0;
  const text = `${item.data.title} ${item.data.path}`.toLowerCase();
  const domainScore = /model|train|retrain|anomaly|incident|detector|scoring/.test(text) ? 26 : 0;
  const fileScore = item.id.startsWith("file:") ? 24 : 0;

  return statusScore + kindScore + domainScore + fileScore;
}
function entityId(item) {
  if (item.id) return item.id;
  return `${item.kind}:${item.repo}:${hash(`${item.file}:${item.method ?? ""}:${item.path ?? ""}`)}`;
}

function badgesForEntity(item, status) {
  const badges = [status, item.kind];
  if (item.flowGroup === "analysis") badges.push("분석흐름");
  if (item.flowGroup === "training") badges.push("학습흐름");
  if (item.flowGroup === "error-code") badges.push("error-code");
  if (item.flowStep) badges.push(`${item.flowStep}단계`);
  if (item.method) badges.push(item.method);
  if (item.hasDocs === false) badges.push("docs?");
  if (item.hasTests === false) badges.push("test?");
  if (typeof item.confidence === "number") badges.push(`conf ${Math.round(item.confidence * 100)}%`);
  return badges;
}

function connectByFile(nodes, edges) {
  const fileNodes = nodes.filter((node) => node.id.startsWith("file:"));
  const entityNodes = nodes.filter((node) => !node.id.startsWith("file:") && !node.id.startsWith("repo:"));

  for (const fileNode of fileNodes) {
    for (const entityNode of entityNodes) {
      if (
        fileNode.data.repo === entityNode.data.repo &&
        fileNode.data.path === entityNode.data.path
      ) {
        edges.push(edge(fileNode.id, entityNode.id, "extracts", entityNode.data.status));
      }
    }
  }
}

function connectApiFlow(wrappers, routes, endpoints, edges) {
  for (const wrapper of wrappers) {
    const wrapperId = entityId(wrapper);
    const matches = routes
      .filter((route) => routeMatches(wrapper.path, route.path))
      .slice(0, 3);

    for (const route of matches) {
      edges.push(edge(wrapperId, entityId(route), wrapper.method === "CALL" ? "calls" : wrapper.method, route.status));
    }
  }

  for (const route of routes) {
    if (!/model|train|retrain|artifact|anomaly|analysis/i.test(`${route.path} ${route.file}`)) continue;
    const matches = endpoints
      .filter((endpoint) => tokenOverlap(route.path, endpoint.path) > 0)
      .slice(0, 3);
    for (const endpoint of matches) {
      edges.push(edge(entityId(route), entityId(endpoint), endpoint.path, endpoint.status));
    }
  }
}

function connectStaticCodeEdges(selectedEntities, codeEdges, edges) {
  const selectedIds = new Set(selectedEntities.map(entityId));

  for (const codeEdgeItem of codeEdges) {
    if (!selectedIds.has(codeEdgeItem.source) || !selectedIds.has(codeEdgeItem.target)) {
      continue;
    }

    edges.push(
      edge(
        codeEdgeItem.source,
        codeEdgeItem.target,
        codeEdgeItem.label,
        codeEdgeItem.status,
        {
          kind: codeEdgeItem.kind,
          confidence: codeEdgeItem.confidence,
          evidence: codeEdgeItem.evidence,
          evidenceItems: codeEdgeItem.evidenceItems,
        },
      ),
    );
  }
}

function connectEngineFlows(engineFlows, edges) {
  const byGroup = new Map();

  for (const item of engineFlows) {
    const group = byGroup.get(item.flowGroup) ?? [];
    group.push(item);
    byGroup.set(item.flowGroup, group);
  }

  for (const [groupName, groupItems] of byGroup.entries()) {
    if (groupName === "error-code") continue;
    const orderedItems = groupItems.sort(
      (a, b) => Number(a.flowStep ?? 0) - Number(b.flowStep ?? 0),
    );

    for (let index = 1; index < orderedItems.length; index += 1) {
      const previous = orderedItems[index - 1];
      const current = orderedItems[index];
      edges.push(
        edge(
          entityId(previous),
          entityId(current),
          current.transition ?? (groupName === "training" ? "학습" : "분석"),
          current.status,
        ),
      );
    }
  }
}

function connectContracts(routes, docs, tests, edges) {
  for (const route of routes) {
    const routeId = entityId(route);
    for (const doc of docs.filter((item) => tokenOverlap(route.path, item.file) > 0).slice(0, 2)) {
      edges.push(edge(routeId, entityId(doc), "documents", route.hasDocs ? "stable" : "risk"));
    }
    for (const test of tests.filter((item) => tokenOverlap(route.path, item.file) > 0).slice(0, 2)) {
      edges.push(edge(routeId, entityId(test), "covered by", route.hasTests ? "stable" : "risk"));
    }
  }
}

function connectData(routes, dbFiles, edges) {
  for (const route of routes) {
    for (const db of dbFiles.filter((item) => tokenOverlap(route.path, item.file) > 0).slice(0, 2)) {
      edges.push(edge(entityId(route), entityId(db), "reads/writes", db.status));
    }
  }
}

function routeMatches(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftTokens = pathTokens(left);
  const rightTokens = pathTokens(right);
  return leftTokens.filter((token) => rightTokens.includes(token)).length >= Math.min(3, leftTokens.length, rightTokens.length);
}

function tokenOverlap(left, right) {
  const a = pathTokens(left);
  const b = pathTokens(right);
  return a.filter((token) => b.includes(token)).length;
}

function parseLatestCommit(value, fallbackHash) {
  const [hash = fallbackHash, timestamp = "0", ...subjectParts] = value.split("\t");
  const unixSeconds = Number.parseInt(timestamp, 10);

  return {
    hash: hash || fallbackHash,
    subject: subjectParts.join("\t").trim() || "커밋 메시지 없음",
    at: Number.isFinite(unixSeconds) && unixSeconds > 0
      ? new Date(unixSeconds * 1000).toISOString()
      : "",
  };
}

function recentCommitLabel(repos) {
  const candidates = repos
    .filter((repo) => repo.latestCommit?.hash)
    .sort((left, right) =>
      String(right.latestCommit?.at ?? "").localeCompare(String(left.latestCommit?.at ?? "")),
    );

  if (candidates.length === 0) return "최근 업데이트 커밋 없음";

  const items = candidates.map((repo) => {
    const name = compactRepoName(repo.name);
    return `${name} ${repo.latestCommit.hash}`;
  });

  return `최근 반영 커밋 ${items.join(" / ")}`;
}

function compactRepoName(name) {
  return name.split("/").at(-1) ?? name;
}

function teamUpdateLabel(repos) {
  const updates = repos.flatMap((repo) =>
    (repo.teamUpdates ?? []).map((update) => ({
      repo,
      update,
    })),
  );

  if (updates.length === 0) return null;

  const withPr = updates.filter((item) => item.update.prNumber);
  const visible = (withPr.length > 0 ? withPr : updates).slice(0, 5);
  const text = visible
    .map(({ repo, update }) => {
      const ref = update.prNumber ? `PR #${update.prNumber}` : update.hash;
      return `${compactRepoName(repo.name)} ${ref}`;
    })
    .join(" / ");

  return {
    count: withPr.length || updates.length,
    text,
  };
}

function unique(values) {
  return [...new Set(values)];
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function difference(values, excluded) {
  return values.filter((value) => !excluded.has(value));
}

function slugify(value) {
  return hash(value).slice(0, 10);
}

function hash(value) {
  let hashed = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hashed = (hashed * 33) ^ value.charCodeAt(index);
  }
  return (hashed >>> 0).toString(36);
}
