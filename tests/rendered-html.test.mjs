import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Where am I app shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Where am I<\/title>/i);
  assert.match(html, /Where am I/);
  assert.match(html, /See where your change leads/);
  assert.match(html, /lang="en"/);
  assert.doesNotMatch(html, /Codex/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
  assert.doesNotMatch(html, /codex-preview/);
});

test("removes starter preview and keeps app-specific source", async () => {
  const [page, layout, client, i18n, styles, packageJson, scanServer, scanRepos, gitignore] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/WhereAmIClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/i18n.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../scripts/scan-server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/scan-repos.mjs", import.meta.url), "utf8"),
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
  ]);
  const uiSource = `${client}\n${i18n}`;

  assert.match(page, /export const metadata:\s*Metadata/);
  assert.match(page, /<WhereAmIClient \/>/);
  assert.match(layout, /title:\s*"Where am I"/);
  assert.match(client, /ReactFlow/);
  assert.match(client, /FLOW_COLUMN_GAP = 76/);
  assert.match(client, /fitViewOptions=\{\{ padding: 0\.08, maxZoom: 1 \}\}/);
  assert.match(client, /LANGUAGE_STORAGE_KEY/);
  assert.match(client, /document\.documentElement\.lang = nextLocale/);
  assert.match(client, /className="language-toggle"/);
  assert.match(client, /팀 변경/);
  assert.match(client, /whereami-snapshot\.json/);
  assert.match(client, /localhost:3010\/scan/);
  assert.match(client, /localhost:3010\/events/);
  assert.match(client, /EventSource/);
  assert.match(uiSource, /작업 자동 반영/);
  assert.match(client, /hiddenCount/);
  assert.match(client, /scanDelta/);
  assert.match(uiSource, /스캔 변화/);
  assert.match(client, /GraphMode/);
  assert.match(uiSource, /전체 API/);
  assert.match(client, /graph-filter-bar/);
  assert.match(client, /selectedRepoNames/);
  assert.match(client, /selectRepoForMap/);
  assert.match(client, /selectScanEvent/);
  assert.match(client, /onSelectEvent/);
  assert.match(client, /role=\{canSelect \? "button" : undefined\}/);
  assert.match(client, /aria-pressed=\{isSelected\}/);
  assert.match(client, /engine-flow/);
  assert.match(client, /teamUpdates/);
  assert.match(uiSource, /팀원 변경 PR/);
  assert.match(uiSource, /최근 PR/);
  assert.match(client, /selectedTeamUpdateKey/);
  assert.match(uiSource, /PR 변경/);
  assert.match(client, /compactTeamGraphNodes/);
  assert.match(client, /buildTeamUpdateEvents/);
  assert.match(client, /EvidenceList/);
  assert.match(client, /EdgeSummary/);
  assert.match(client, /StructureOverview/);
  assert.match(client, /FLOW_STAGE_ROWS/);
  assert.match(client, /selectedStructureRepoCount/);
  assert.match(client, /selectionFocusActive/);
  assert.match(client, /is-focus-node/);
  assert.match(client, /selectedRepoNodeIds/);
  assert.match(client, /scanRepoName/);
  assert.match(client, /scanPrQuery/);
  assert.match(client, /scan-repo-toggle/);
  assert.match(uiSource, /PR 번호/);
  assert.match(uiSource, /API와 워크플로우 조회/);
  assert.match(client, /setSelectedRepoNames\(\[\]\);/);
  assert.doesNotMatch(client, /<h2>변경 파일<\/h2>/);
  assert.doesNotMatch(client, /repo-main/);
  assert.doesNotMatch(client, /team-pr-chip/);
  assert.match(i18n, /whereami-language/);
  assert.match(i18n, /tagline: "See where your change leads"/);
  assert.match(i18n, /tagline: "내 변경이 어디로 이어지는지 한눈에"/);
  assert.match(i18n, /export function localizeText/);
  assert.match(styles, /\.language-toggle/);
  assert.match(styles, /\.briefing-item--warning/);
  assert.match(styles, /grid-template-rows: auto 720px auto/);
  assert.match(styles, /minmax\(320px, 620px\)/);
  assert.match(styles, /\.side-panel--left > \.panel-section:first-child/);
  assert.match(styles, /\.mode-list button:hover/);
  assert.match(packageJson, /"name": "where-am-i"/);
  assert.doesNotMatch(packageJson, /"prebuild"/);
  assert.match(packageJson, /"scan": "node scripts\/scan-repos\.mjs"/);
  assert.match(packageJson, /"scan:server": "node scripts\/scan-server\.mjs"/);
  assert.match(scanServer, /text\/event-stream/);
  assert.match(scanServer, /watchDebounceMs/);
  assert.match(scanServer, /watch\(/);
  assert.match(scanRepos, /extractOpenApiRoutes/);
  assert.match(scanRepos, /extractCodeTopology/);
  assert.match(scanRepos, /codeFacts/);
  assert.match(scanRepos, /evidenceItems/);
  assert.match(scanRepos, /apiNodesPerScenario/);
  assert.match(scanRepos, /isApiCatalogFile/);
  assert.match(scanRepos, /repoRoots:\s*\[\]/);
  assert.match(gitignore, /public\/whereami-snapshot\.json/);
  assert.match(gitignore, /whereami\.config\.json/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(layout, /codex-preview|_sites-preview|themeColor|\bViewport\b/);

  await assert.rejects(access(new URL("app/_sites-preview", templateRoot)));
});

test("production build excludes the local repository snapshot", async () => {
  await assert.rejects(
    access(new URL("../dist/client/whereami-snapshot.json", import.meta.url)),
    { code: "ENOENT" },
  );
});
