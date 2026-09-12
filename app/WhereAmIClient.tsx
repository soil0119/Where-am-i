"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useContext,
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  Boxes,
  CheckCircle2,
  Code2,
  Database,
  FileDiff,
  Filter,
  GitCommitHorizontal,
  GripHorizontal,
  GripVertical,
  LayoutDashboard,
  Route,
  Search,
  ServerCog,
  TestTubeDiagonal,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  LANGUAGE_STORAGE_KEY,
  localizeText,
  resolveLocale,
  translate,
  type Locale,
  type MessageKey,
} from "./i18n";

type NodeStatus = "stable" | "active" | "added" | "changed" | "risk";
type EntityKind =
  | "repo"
  | "ui"
  | "wrapper"
  | "api"
  | "engine"
  | "handler"
  | "function"
  | "external"
  | "error"
  | "db"
  | "docs"
  | "test";
type ScenarioId =
  | "current-work"
  | "team-briefing"
  | "contract-check"
  | "engine-flow";
type GraphMode = "focus" | "all" | "api" | "verify";

type Metric = {
  label: string;
  value: string;
};

type ChangeDetail = {
  file?: string;
  compare: string;
  additions: number;
  deletions: number;
  summary: string;
  lines: string[];
  signals?: ChangeSignal[];
};

type ChangeSignal = {
  action: "added" | "deleted";
  kind: string;
  label: string;
};

type EvidenceItem = {
  file: string;
  line: number;
  text: string;
  source: "static" | "git" | "runtime" | "inferred";
  confidence: number;
};

type FeatureChangeAction = "added" | "deleted" | "changed";

type FeatureChange = {
  id: string;
  title: string;
  action: FeatureChangeAction;
  summary: string;
  detail: string;
  repos: string[];
  files: string[];
  signals: string[];
  items: string[];
  counts: Record<FeatureChangeAction, number>;
};

type ScanHistoryEventType = FeatureChangeAction | "baseline" | "none";

type ScanHistoryEvent = {
  id: string;
  at: string;
  type: ScanHistoryEventType;
  scenarioId: string;
  scenarioLabel: string;
  title: string;
  detail: string;
  items: string[];
  repoName?: string;
  updateKey?: string;
};

type ScanDelta = {
  from: string | null;
  to: string;
  hasChanges: boolean;
  summary: string;
  events: ScanHistoryEvent[];
};

type EntityNodeData = Record<string, unknown> & {
  title: string;
  repo: string;
  path: string;
  kind: EntityKind;
  status: NodeStatus;
  impact: string;
  summary: string;
  evidence: string;
  evidenceItems?: EvidenceItem[];
  confidence?: number;
  badges: string[];
  metrics?: Metric[];
  change?: ChangeDetail;
};

type EntityNode = Node<EntityNodeData, "entity">;

type BriefingItem = {
  type: "추가" | "변경" | "주의" | "정상" | "added" | "changed" | "warning" | "stable";
  title: string;
  detail: string;
};

type Scenario = {
  id: ScenarioId;
  label: string;
  description: string;
  branch: string;
  compare: string;
  focusNodeId: string;
  nodes: EntityNode[];
  edges: Edge[];
  allNodes?: EntityNode[];
  allEdges?: Edge[];
  hiddenCount?: number;
  visibleLimit?: number;
  files: string[];
  featureChanges?: FeatureChange[];
  briefing: BriefingItem[];
};

type RepoSummary = {
  name: string;
  path: string;
  type: string;
  branch: string;
  baseBranch: string;
  head: string;
  latestCommit?: {
    hash: string;
    subject: string;
    at: string;
  };
  teamUpdates?: TeamUpdate[];
  dirty: number;
  changedCount: number;
  teamChangedCount: number;
  routeCount: number;
  wrapperCount: number;
  engineEndpointCount: number;
  codeFactCount?: number;
  warnings?: string[];
};

type TeamUpdate = {
  hash: string;
  subject: string;
  prNumber?: string;
  files: string[];
  additions: number;
  deletions: number;
  summary?: string;
  featureChanges?: FeatureChange[];
  codePreview?: ChangeDetail;
  at: string;
};

type SelectedTeamUpdate = {
  repo: RepoSummary;
  update: TeamUpdate;
};

type WhereAmISnapshot = {
  generatedAt: string;
  source: "local-scan";
  repos: RepoSummary[];
  scenarios: Scenario[];
  scanDelta?: ScanDelta;
  history?: ScanHistoryEvent[];
  warnings?: string[];
};

type SnapshotState = "loading" | "live" | "sample";
const SNAPSHOT_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const LOCAL_SCAN_URL = "http://localhost:3010/scan";
const LOCAL_SCAN_EVENTS_URL = "http://localhost:3010/events";
const LEFT_PANEL_MIN_WIDTH = 220;
const LEFT_PANEL_MAX_WIDTH = 460;
const DETAIL_PANEL_MIN_HEIGHT = 260;
const DETAIL_PANEL_MAX_HEIGHT = 780;
const RESIZE_OBSERVER_LOOP_MESSAGES = new Set([
  "ResizeObserver loop completed with undelivered notifications.",
  "ResizeObserver loop limit exceeded",
]);

const statusMeta: Record<
  NodeStatus,
  { color: string; edge: string; soft: string }
> = {
  stable: {
    color: "#475569",
    edge: "#94a3b8",
    soft: "rgba(148, 163, 184, 0.14)",
  },
  active: {
    color: "#0f766e",
    edge: "#0f766e",
    soft: "rgba(15, 118, 110, 0.13)",
  },
  added: {
    color: "#2563eb",
    edge: "#2563eb",
    soft: "rgba(37, 99, 235, 0.13)",
  },
  changed: {
    color: "#b45309",
    edge: "#d97706",
    soft: "rgba(217, 119, 6, 0.14)",
  },
  risk: {
    color: "#dc2626",
    edge: "#dc2626",
    soft: "rgba(220, 38, 38, 0.12)",
  },
};

type I18nContextValue = {
  locale: Locale;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  text: (value: string) => string;
};

const I18nContext = createContext<I18nContextValue>({
  locale: "en",
  t: (key, values) => translate("en", key, values),
  text: (value) => localizeText("en", value),
});

function useI18n() {
  return useContext(I18nContext);
}

function statusLabel(locale: Locale, status: NodeStatus) {
  const key: Record<NodeStatus, MessageKey> = {
    stable: "stable",
    active: "active",
    added: "added",
    changed: "changed",
    risk: "attention",
  };
  return translate(locale, key[status]);
}

function briefingTone(type: BriefingItem["type"]) {
  if (type === "추가" || type === "added") return "added";
  if (type === "변경" || type === "changed") return "changed";
  if (type === "주의" || type === "warning") return "warning";
  return "stable";
}

function briefingLabel(locale: Locale, type: BriefingItem["type"]) {
  const tone = briefingTone(type);
  return translate(
    locale,
    tone === "warning" ? "warning" : tone === "stable" ? "normal" : tone,
  );
}

const kindIcon: Record<EntityKind, LucideIcon> = {
  repo: Boxes,
  ui: LayoutDashboard,
  wrapper: Code2,
  api: Route,
  engine: ServerCog,
  handler: Code2,
  function: Code2,
  external: ServerCog,
  error: AlertTriangle,
  db: Database,
  docs: BookOpenCheck,
  test: TestTubeDiagonal,
};

const scenarios: Scenario[] = [
  {
    id: "current-work",
    label: "내 작업",
    description: "현재 브랜치 diff 기준",
    branch: "최근 업데이트 커밋 sample-api a1b2c3d",
    compare: "최근 커밋 + local diff",
    focusNodeId: "ui-dashboard",
    files: [
      "apps/web/src/pages/ModelPage.tsx",
      "apps/web/src/api/models.ts",
      "services/api/src/routes/models.go",
      "services/engine/api/routes/training.py",
    ],
    briefing: [
      {
        type: "추가",
        title: "모델 생성 화면에서 새 API 호출 감지",
        detail: "프론트 wrapper에서 backend route로 연결선이 생성됨",
      },
      {
        type: "변경",
        title: "backend route가 engine 학습 endpoint로 이어짐",
        detail: "서비스 경계와 내부 engine 호출 지점이 같이 표시됨",
      },
    ],
    nodes: [
      entity(
        "repo-web",
        "sample-web",
        "sample-web",
        "/workspace/sample-web",
        "repo",
        "active",
        40,
        120,
        "화면과 API wrapper 소유 repo",
        "현재 작업이 시작되는 UI surface",
        "sample fallback",
        ["repo", "web"],
      ),
      entity(
        "repo-api",
        "sample-api",
        "sample-api",
        "/workspace/sample-api",
        "repo",
        "changed",
        40,
        420,
        "backend route 소유 repo",
        "공개 API와 내부 서비스 호출 지점",
        "sample fallback",
        ["repo", "api"],
      ),
      entity(
        "ui-dashboard",
        "Model dashboard",
        "sample-web",
        "apps/web/src/pages/ModelPage.tsx",
        "ui",
        "active",
        340,
        120,
        "사용자가 보는 첫 영향 지점",
        "모델 생성 버튼과 결과 상태를 표시",
        "sample fallback",
        ["ui", "active"],
      ),
      entity(
        "api-wrapper",
        "modelApi.create",
        "sample-web",
        "apps/web/src/api/models.ts",
        "wrapper",
        "added",
        340,
        420,
        "UI와 backend 사이 호출 wrapper",
        "POST /api/models 호출을 캡슐화",
        "sample fallback",
        ["wrapper", "POST"],
      ),
      entity(
        "backend-model-create",
        "POST /api/models",
        "sample-api",
        "services/api/src/routes/models.go",
        "api",
        "changed",
        700,
        240,
        "모델 생성 요청 진입점",
        "요청 검증 후 engine 학습 endpoint로 전달",
        "sample fallback",
        ["api", "POST"],
      ),
      entity(
        "engine-train",
        "POST /train",
        "sample-engine",
        "services/engine/api/routes/training.py",
        "engine",
        "changed",
        1060,
        240,
        "학습 실행 지점",
        "feature build, fit, artifact publish 단계 실행",
        "sample fallback",
        ["engine", "training"],
      ),
    ],
    edges: [
      relation("repo-web", "ui-dashboard", "owns", "active"),
      relation("ui-dashboard", "api-wrapper", "calls", "added"),
      relation("api-wrapper", "backend-model-create", "POST /api/models", "changed"),
      relation("backend-model-create", "engine-train", "POST /train", "changed"),
    ],
  },
  {
    id: "team-briefing",
    label: "팀 변경",
    description: "원격 최신 반영 후 차이",
    branch: "최근 반영 커밋 sample-api d4e5f6a",
    compare: "원격 최신 커밋과 비교",
    focusNodeId: "team-route",
    files: ["services/api/src/routes/billing.go", "apps/web/src/api/billing.ts"],
    briefing: [
      {
        type: "변경",
        title: "팀원 PR에서 billing API 변경 감지",
        detail: "스캔 변화 카드 선택 시 PR 요약과 코드 지점이 표시됨",
      },
    ],
    nodes: [
      entity("team-repo-api", "sample-api", "sample-api", "/workspace/sample-api", "repo", "changed", 40, 120, "팀 변경 repo", "원격 커밋과 차이 있음", "sample fallback", ["repo", "team"]),
      entity("team-wrapper", "billingApi", "sample-web", "apps/web/src/api/billing.ts", "wrapper", "changed", 340, 120, "프론트 호출 변경", "billing API 호출 wrapper", "sample fallback", ["wrapper"]),
      entity("team-route", "PATCH /api/billing/{id}", "sample-api", "services/api/src/routes/billing.go", "api", "changed", 700, 120, "팀원이 변경한 route", "요청 필드와 응답 상태 변경", "sample fallback", ["api", "PATCH"]),
    ],
    edges: [
      relation("team-repo-api", "team-route", "owns", "changed"),
      relation("team-wrapper", "team-route", "PATCH", "changed"),
    ],
  },
  {
    id: "contract-check",
    label: "API 계약",
    description: "route, wrapper, 문서, 테스트 자동 비교",
    branch: "최근 반영 커밋 sample-api d4e5f6a",
    compare: "extractor graph",
    focusNodeId: "contract-route",
    files: ["services/api/openapi.yaml", "services/api/src/routes/models.go", "tests/models.spec.ts"],
    briefing: [
      {
        type: "주의",
        title: "API 문서 또는 테스트 확인 필요",
        detail: "route, wrapper, OpenAPI, test 연결 상태를 한 화면에서 확인",
      },
    ],
    nodes: [
      entity("contract-repo", "sample-api", "sample-api", "/workspace/sample-api", "repo", "stable", 40, 120, "API repo", "전체 API catalog 대상", "sample fallback", ["repo", "api"]),
      entity("contract-route", "GET /api/models/{id}", "sample-api", "services/api/src/routes/models.go", "api", "risk", 340, 120, "public API", "문서와 테스트 matching signal 확인 필요", "sample fallback", ["api", "GET", "docs?", "test?"]),
      entity("contract-doc", "openapi.yaml", "sample-api", "services/api/openapi.yaml", "docs", "stable", 700, 120, "API 문서", "OpenAPI path catalog", "sample fallback", ["docs"]),
      entity("contract-test", "models.spec", "sample-api", "tests/models.spec.ts", "test", "changed", 1060, 120, "회귀 테스트", "API 동작 검증", "sample fallback", ["test"]),
    ],
    edges: [
      relation("contract-repo", "contract-route", "owns", "stable"),
      relation("contract-route", "contract-doc", "documents", "risk"),
      relation("contract-route", "contract-test", "covered by", "changed"),
    ],
  },
  {
    id: "engine-flow",
    label: "분석엔진",
    description: "분석 오버레이와 학습 모델 생성 흐름",
    branch: "최근 반영 커밋 sample-engine f7g8h9i",
    compare: "engine runtime/training flow",
    focusNodeId: "engine-flow-analysis-start",
    files: ["services/engine/api/routes/analysis.py", "services/engine/training/pipeline.py"],
    briefing: [
      {
        type: "정상",
        title: "분석 시작부터 결과 오버레이까지 표시",
        detail: "request, feature build, scoring, callback 흐름을 선으로 표현",
      },
      {
        type: "변경",
        title: "학습 시작부터 모델 생성까지 표시",
        detail: "dataset load, fit, artifact publish 단계가 분리됨",
      },
    ],
    nodes: [
      entity("engine-repo", "sample-engine", "sample-engine", "/workspace/sample-engine", "repo", "stable", 40, 220, "engine repo", "분석/학습 흐름 소유", "sample fallback", ["repo", "engine"]),
      entity("engine-flow-analysis-start", "1. 분석 시작", "sample-engine", "services/engine/api/routes/analysis.py", "engine", "stable", 340, 120, "분석 요청 진입", "POST /analyze", "sample fallback", ["분석흐름", "1단계"]),
      entity("engine-flow-analysis-overlay", "2. 결과 오버레이", "sample-engine", "services/engine/callbacks/overlay.py", "engine", "stable", 700, 120, "결과 전송", "분석 결과를 product UI callback으로 전달", "sample fallback", ["분석흐름", "2단계"]),
      entity("engine-flow-training-start", "1. 학습 시작", "sample-engine", "services/engine/api/routes/training.py", "engine", "changed", 340, 420, "학습 요청 진입", "POST /train", "sample fallback", ["학습흐름", "1단계"]),
      entity("engine-flow-model", "2. 모델 생성", "sample-engine", "services/engine/training/pipeline.py", "engine", "changed", 700, 420, "모델 artifact 생성", "fit 후 artifact publish", "sample fallback", ["학습흐름", "2단계"]),
    ],
    edges: [
      relation("engine-repo", "engine-flow-analysis-start", "owns", "stable"),
      relation("engine-flow-analysis-start", "engine-flow-analysis-overlay", "score -> overlay", "stable"),
      relation("engine-repo", "engine-flow-training-start", "owns", "changed"),
      relation("engine-flow-training-start", "engine-flow-model", "fit -> artifact", "changed"),
    ],
  },
];
function entity(
  id: string,
  title: string,
  repo: string,
  path: string,
  kind: EntityKind,
  status: NodeStatus,
  x: number,
  y: number,
  impact: string,
  summary: string,
  evidence: string,
  badges: string[],
  metrics?: Metric[],
): EntityNode {
  return {
    id,
    type: "entity",
    position: { x, y },
    data: {
      title,
      repo,
      path,
      kind,
      status,
      impact,
      summary,
      evidence,
      badges,
      metrics,
    },
  };
}

function relation(
  source: string,
  target: string,
  label: string,
  status: NodeStatus,
): Edge {
  const color = statusMeta[status].edge;
  const showLabel = label !== "owns" && label !== "extracts";

  return {
    id: `${source}-${target}-${label}`,
    source,
    target,
    type: "smoothstep",
    label: showLabel ? label : undefined,
    animated: false,
    style: {
      stroke: color,
      strokeOpacity: status === "stable" ? 0.42 : 0.78,
      strokeWidth: status === "stable" ? 2 : 3.5,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color,
    },
    labelStyle: {
      fill: "#111827",
      fontSize: 12,
      fontWeight: 700,
    },
    labelBgStyle: {
      fill: "#ffffff",
      fillOpacity: 0.9,
    },
    data: { status },
  };
}

function normalizeScenario(rawScenario: Scenario): Scenario {
  const nodes = rawScenario.nodes.map(normalizeNode);
  const edges = rawScenario.edges.map(normalizeEdge);
  const allNodes = (rawScenario.allNodes ?? rawScenario.nodes).map(normalizeNode);
  const allEdges = (rawScenario.allEdges ?? rawScenario.edges).map(normalizeEdge);

  return {
    ...rawScenario,
    nodes,
    edges,
    allNodes,
    allEdges,
    featureChanges: normalizeFeatureChanges(rawScenario.featureChanges),
    hiddenCount: rawScenario.hiddenCount ?? Math.max(0, allNodes.length - nodes.length),
  };
}

function normalizeNode(node: EntityNode): EntityNode {
  return {
    ...node,
    type: "entity",
    data: {
      ...node.data,
      kind: normalizeKind(node.data.kind),
      status: normalizeStatus(node.data.status),
      badges: Array.isArray(node.data.badges) ? node.data.badges : [],
      change: normalizeChange(node.data.change),
      evidenceItems: normalizeEvidenceItems(node.data.evidenceItems),
      confidence:
        typeof node.data.confidence === "number"
          ? clamp(node.data.confidence, 0, 1)
          : undefined,
    },
  };
}

function normalizeEvidenceItems(value: unknown): EvidenceItem[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      const evidence = item as Partial<EvidenceItem>;
      const source =
        evidence.source === "git" ||
        evidence.source === "runtime" ||
        evidence.source === "inferred"
          ? evidence.source
          : "static";

      return {
        file: String(evidence.file ?? ""),
        line: Number(evidence.line ?? 0),
        text: String(evidence.text ?? ""),
        source,
        confidence: clamp(Number(evidence.confidence ?? 0), 0, 1),
      };
    })
    .filter((item): item is EvidenceItem => Boolean(item?.file || item?.text))
    .slice(0, 8);
}

function normalizeChange(value: unknown): ChangeDetail | undefined {
  if (!value || typeof value !== "object") return undefined;
  const change = value as Partial<ChangeDetail>;

  return {
    file: typeof change.file === "string" ? change.file : undefined,
    compare: String(change.compare ?? ""),
    additions: Number(change.additions ?? 0),
    deletions: Number(change.deletions ?? 0),
    summary: String(change.summary ?? "변경 감지"),
    lines: Array.isArray(change.lines)
      ? change.lines.map((line) => String(line)).slice(0, 18)
      : [],
    signals: Array.isArray(change.signals)
      ? change.signals
          .map((signal) => normalizeChangeSignal(signal))
          .filter((signal): signal is ChangeSignal => Boolean(signal))
      : [],
  };
}

function normalizeChangeSignal(value: unknown): ChangeSignal | undefined {
  if (!value || typeof value !== "object") return undefined;
  const signal = value as Partial<ChangeSignal>;
  const action = signal.action === "deleted" ? "deleted" : "added";

  return {
    action,
    kind: String(signal.kind ?? "code"),
    label: String(signal.label ?? ""),
  };
}

function normalizeFeatureChanges(value: unknown): FeatureChange[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      const feature = item as Partial<FeatureChange>;
      const action = normalizeFeatureAction(feature.action);

      return {
        id: String(feature.id ?? feature.title ?? action),
        title: String(feature.title ?? "기능 변화"),
        action,
        summary: String(feature.summary ?? "변경 감지"),
        detail: String(feature.detail ?? ""),
        repos: Array.isArray(feature.repos) ? feature.repos.map(String) : [],
        files: Array.isArray(feature.files) ? feature.files.map(String) : [],
        signals: Array.isArray(feature.signals) ? feature.signals.map(String) : [],
        items: Array.isArray(feature.items) ? feature.items.map(String) : [],
        counts: {
          added: Number(feature.counts?.added ?? 0),
          deleted: Number(feature.counts?.deleted ?? 0),
          changed: Number(feature.counts?.changed ?? 0),
        },
      };
    })
    .filter((item): item is FeatureChange => Boolean(item));
}

function normalizeFeatureAction(value: unknown): FeatureChangeAction {
  return value === "added" || value === "deleted" || value === "changed"
    ? value
    : "changed";
}

function normalizeScanDelta(value: unknown): ScanDelta | undefined {
  if (!value || typeof value !== "object") return undefined;
  const delta = value as Partial<ScanDelta>;
  const events = normalizeHistoryEvents(delta.events);

  return {
    from: typeof delta.from === "string" ? delta.from : null,
    to: String(delta.to ?? ""),
    hasChanges: Boolean(delta.hasChanges),
    summary: String(delta.summary ?? "새 변화 없음"),
    events,
  };
}

function normalizeHistoryEvents(value: unknown): ScanHistoryEvent[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      const event = item as Partial<ScanHistoryEvent>;

      return {
        id: String(event.id ?? `${event.at}-${event.title}`),
        at: String(event.at ?? ""),
        type: normalizeHistoryEventType(event.type),
        scenarioId: String(event.scenarioId ?? ""),
        scenarioLabel: String(event.scenarioLabel ?? "전체"),
        title: String(event.title ?? "스캔 변화"),
        detail: String(event.detail ?? ""),
        items: Array.isArray(event.items) ? event.items.map(String) : [],
        repoName: typeof event.repoName === "string" ? event.repoName : undefined,
        updateKey: typeof event.updateKey === "string" ? event.updateKey : undefined,
      };
    })
    .filter((event): event is ScanHistoryEvent => Boolean(event));
}

function normalizeHistoryEventType(value: unknown): ScanHistoryEventType {
  return value === "added" ||
    value === "deleted" ||
    value === "changed" ||
    value === "baseline" ||
    value === "none"
    ? value
    : "changed";
}

function normalizeEdge(edge: Edge): Edge {
  const status = normalizeStatus(edge.data?.status);
  const decorated = relation(edge.source, edge.target, String(edge.label ?? "uses"), status);
  const confidence =
    typeof edge.data?.confidence === "number"
      ? clamp(edge.data.confidence, 0, 1)
      : undefined;

  return {
    ...decorated,
    id: edge.id,
    data: {
      ...edge.data,
      status,
      confidence,
      evidenceItems: normalizeEvidenceItems(edge.data?.evidenceItems),
    },
  };
}

function normalizeStatus(value: unknown): NodeStatus {
  return value === "active" ||
    value === "added" ||
    value === "changed" ||
    value === "risk" ||
    value === "stable"
    ? value
    : "stable";
}

function normalizeKind(value: unknown): EntityKind {
  return value === "repo" ||
    value === "ui" ||
    value === "wrapper" ||
    value === "api" ||
    value === "engine" ||
    value === "handler" ||
    value === "function" ||
    value === "external" ||
    value === "error" ||
    value === "db" ||
    value === "docs" ||
    value === "test"
    ? value
    : "repo";
}

function compactRepoName(name: string) {
  return name.split("/").at(-1) ?? name;
}

function repoCommitTime(repo: RepoSummary) {
  return repo.latestCommit?.at ? Date.parse(repo.latestCommit.at) : 0;
}

function repoCommitHash(repo: RepoSummary) {
  return repo.latestCommit?.hash || repo.head || "unknown";
}

function buildCommitScope(
  repos: RepoSummary[],
  selectedRepoNames: string[],
  fallback: string,
) {
  const selectedSet = new Set(selectedRepoNames);
  const scopedRepos = repos
    .filter((repo) => selectedSet.size === 0 || selectedSet.has(repo.name))
    .filter((repo) => repoCommitHash(repo) !== "unknown")
    .sort((left, right) => repoCommitTime(right) - repoCommitTime(left));

  if (scopedRepos.length === 0) {
    return {
      label: fallback,
      title: fallback,
    };
  }

  const label =
    selectedSet.size === 1 && scopedRepos[0]
      ? `최근 반영 ${compactRepoName(scopedRepos[0].name)} ${repoCommitHash(scopedRepos[0])}`
      : selectedSet.size > 1
        ? `최근 반영 커밋 선택 ${scopedRepos.length}개`
        : `최근 반영 커밋 전체 ${scopedRepos.length}개`;
  const title = scopedRepos
    .map((repo) => {
      const subject = repo.latestCommit?.subject
        ? ` ${repo.latestCommit.subject}`
        : "";
      return `${repo.name} ${repoCommitHash(repo)}${subject}`;
    })
    .join("\n");

  return { label, title };
}

function repoTeamUpdateLabel(repo: RepoSummary) {
  const updates = repo.teamUpdates ?? [];
  const prNumbers = Array.from(
    new Set(
      updates
        .map((update) => update.prNumber)
        .filter((number): number is string => Boolean(number)),
    ),
  );

  if (prNumbers.length > 0) {
    return `PR ${prNumbers.slice(0, 3).map((number) => `#${number}`).join(", ")}`;
  }

  if (updates.length > 0) {
    return `commit ${updates.slice(0, 2).map((update) => update.hash).join(", ")}`;
  }

  return "";
}

function buildTeamAlertScope(repos: RepoSummary[], selectedRepoNames: string[]) {
  const selectedSet = new Set(selectedRepoNames);
  const updates = repos
    .filter((repo) => selectedSet.size === 0 || selectedSet.has(repo.name))
    .flatMap((repo) =>
      (repo.teamUpdates ?? [])
        .filter((update) => update.prNumber)
        .map((update) => ({
          repo,
          update,
        })),
    );
  const uniqueUpdates = Array.from(
    new Map(
      updates.map((item) => [
        `${item.repo.name}:${item.update.prNumber}`,
        item,
      ]),
    ).values(),
  ).sort((left, right) => repoUpdateTime(right.update) - repoUpdateTime(left.update));

  if (uniqueUpdates.length === 0) return null;

  const visible = uniqueUpdates.slice(0, 3);
  const label =
    selectedSet.size === 1
      ? `팀 PR ${visible
          .map(({ update }) => `#${update.prNumber}`)
          .join(", ")}${uniqueUpdates.length > 3 ? ` 외 ${uniqueUpdates.length - 3}` : ""}`
      : `팀원 변경 PR ${uniqueUpdates.length}개`;
  const title = uniqueUpdates
    .map(({ repo, update }) => `${repo.name} PR #${update.prNumber} ${update.subject}`)
    .join("\n");

  return { label, title };
}

function repoUpdateTime(update: TeamUpdate) {
  return update.at ? Date.parse(update.at) : 0;
}

function teamUpdateKey(repoName: string, update: TeamUpdate) {
  return `${repoName}:${update.prNumber || update.hash}`;
}

function findTeamUpdate(
  repos: RepoSummary[],
  key: string | null,
): SelectedTeamUpdate | null {
  if (!key) return null;

  for (const repo of repos) {
    for (const update of repo.teamUpdates ?? []) {
      if (teamUpdateKey(repo.name, update) === key) {
        return { repo, update };
      }
    }
  }

  return null;
}

function teamUpdateFileKey(repoName: string, file: string) {
  return `${repoName}/${file}`;
}

function normalizeCodeFilePath(filePath: string) {
  return filePath
    .split("#")[0]
    .replace(/:\d+(?::\d+)?$/, "")
    .trim();
}

function matchesTeamUpdateFile(node: EntityNode, fileSet: Set<string>) {
  if (fileSet.size === 0) return false;

  const candidatePaths = [
    node.data.path,
    ...(node.data.evidenceItems ?? []).map((item) => item.file),
  ];

  return candidatePaths.some((filePath) => {
    const normalized = normalizeCodeFilePath(filePath);
    return (
      normalized.length > 0 &&
      fileSet.has(teamUpdateFileKey(node.data.repo, normalized))
    );
  });
}

function buildTeamUpdateEvents(
  repos: RepoSummary[],
  fallback?: ScanDelta,
  selectedRepoName?: string | null,
  prQuery = "",
): ScanDelta | undefined {
  const normalizedPrQuery = prQuery.replace(/^#/, "").trim();
  const latestPrEvents = repos
    .filter((repo) => !selectedRepoName || repo.name === selectedRepoName)
    .flatMap((repo) =>
      (repo.teamUpdates ?? [])
        .filter((update) => Boolean(update.prNumber))
        .map((update) => teamUpdateEvent(repo, update)),
    )
    .filter(
      (event) =>
        normalizedPrQuery.length === 0 ||
        String(event.title).includes(`#${normalizedPrQuery}`) ||
        event.updateKey?.endsWith(`:${normalizedPrQuery}`),
    )
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, 5);

  if (
    latestPrEvents.length === 0 &&
    !selectedRepoName &&
    normalizedPrQuery.length === 0
  ) {
    return fallback;
  }

  const summary = normalizedPrQuery
    ? `PR #${normalizedPrQuery} ${latestPrEvents.length}`
    : selectedRepoName
      ? `${compactRepoName(selectedRepoName)} PR ${latestPrEvents.length}`
      : `최근 PR ${latestPrEvents.length}`;

  return {
    from: fallback?.from ?? null,
    to: fallback?.to ?? new Date().toISOString(),
    hasChanges: latestPrEvents.length > 0,
    summary,
    events: latestPrEvents,
  };
}

function teamUpdateEvent(repo: RepoSummary, update: TeamUpdate): ScanHistoryEvent {
  const prLabel = update.prNumber ? `PR #${update.prNumber}` : `commit ${update.hash}`;

  return {
    id: `team-pr:${repo.name}:${update.prNumber || update.hash}`,
    at: update.at,
    type: "changed",
    scenarioId: "team-briefing",
    scenarioLabel: "팀 변경",
    title: `${compactRepoName(repo.name)} ${prLabel}`,
    detail: update.summary || update.subject,
    items: [
      `${update.files?.length ?? 0} files`,
      `+${update.additions ?? 0} / -${update.deletions ?? 0}`,
      update.hash,
    ],
    repoName: repo.name,
    updateKey: teamUpdateKey(repo.name, update),
  };
}

function compactTeamGraphNodes(nodes: EntityNode[]) {
  const repoNodes = nodes.filter((node) => node.data.kind === "repo");
  const restNodes = nodes.filter((node) => node.data.kind !== "repo");
  const orderedNodes = [...repoNodes, ...restNodes];

  return orderedNodes.map((node, index) => {
    if (node.data.kind === "repo") {
      return {
        ...node,
        position: { x: 80, y: 120 },
      };
    }

    const itemIndex = Math.max(0, index - repoNodes.length);
    return {
      ...node,
      position: {
        x: 470 + (itemIndex % 3) * 390,
        y: 70 + Math.floor(itemIndex / 3) * 250,
      },
    };
  });
}

const FLOW_COLUMN_GAP = 126;
const FLOW_LANE_STEP_X = 356;
const FLOW_NODE_STEP_Y = 188;
const FLOW_STAGE_ROWS = 4;
const FLOW_START_X = 70;
const FLOW_START_Y = 64;

function flowColumn(node: EntityNode) {
  const engineFlowStep = node.id.match(/^engine-flow:[^:]+:(\d+)-/);
  if (engineFlowStep) return Math.max(0, Number(engineFlowStep[1]) - 1);
  if (node.id.startsWith("engine-error:")) return 5;

  return {
    ui: 0,
    wrapper: 1,
    api: 2,
    engine: 3,
    handler: 3,
    function: 3,
    external: 4,
    error: 4,
    db: 4,
    docs: 4,
    test: 4,
    repo: 0,
  }[node.data.kind];
}

function flowNodeOrder(node: EntityNode) {
  if (node.id.startsWith("engine-flow:analysis:")) return 0;
  if (node.id.startsWith("engine-flow:training:")) return 1;
  if (node.id.startsWith("engine-error:")) return 2;

  return node.data.title.localeCompare(node.data.title);
}

function layoutApiFlowGraph(nodes: EntityNode[], edges: Edge[]) {
  const contentNodes = nodes.filter((node) => node.data.kind !== "repo");
  const visibleIds = new Set(contentNodes.map((node) => node.id));
  const flowEdges = edges.filter(
    (edge) =>
      visibleIds.has(edge.source) &&
      visibleIds.has(edge.target) &&
      edge.label !== "owns" &&
      edge.label !== "changed file",
  );

  if (contentNodes.length === 0) {
    return { nodes: contentNodes, edges: flowEdges };
  }

  const maxColumn = Math.max(4, ...contentNodes.map(flowColumn));
  const byColumn = new Map<number, EntityNode[]>();
  const positionedNodes: EntityNode[] = [];
  let columnX = FLOW_START_X;

  contentNodes.forEach((node) => {
    const column = flowColumn(node);
    const columnNodes = byColumn.get(column) ?? [];
    columnNodes.push(node);
    byColumn.set(column, columnNodes);
  });

  Array.from({ length: maxColumn + 1 }, (_, column) => column).forEach((column) => {
    const columnNodes = byColumn.get(column) ?? [];
    if (columnNodes.length === 0) {
      columnX += FLOW_LANE_STEP_X + FLOW_COLUMN_GAP;
      return;
    }

    const lanes = Math.max(1, Math.ceil(columnNodes.length / FLOW_STAGE_ROWS));
    columnNodes
      .sort(
        (left, right) =>
          flowNodeOrder(left) - flowNodeOrder(right) ||
          left.data.repo.localeCompare(right.data.repo),
      )
      .forEach((node, index) => {
        const lane = Math.floor(index / FLOW_STAGE_ROWS);
        const row = index % FLOW_STAGE_ROWS;
        positionedNodes.push({
          ...node,
          position: {
            x: columnX + lane * FLOW_LANE_STEP_X,
            y: FLOW_START_Y + row * FLOW_NODE_STEP_Y,
          },
          zIndex: 2,
        });
      });

    columnX += lanes * FLOW_LANE_STEP_X + FLOW_COLUMN_GAP;
  });

  return {
    nodes: positionedNodes,
    edges: flowEdges,
  };
}

async function readSnapshot(): Promise<WhereAmISnapshot> {
  const response = await fetch(`/whereami-snapshot.json?t=${Date.now()}`, {
    cache: "no-store",
  });

  if (!response.ok) throw new Error("snapshot not found");

  const snapshot = (await response.json()) as WhereAmISnapshot;
  if (!Array.isArray(snapshot.scenarios)) throw new Error("invalid snapshot");

  return snapshot;
}

function scanRefreshNote(event: MessageEvent) {
  try {
    const payload = JSON.parse(event.data) as { reason?: string };
    if (payload.reason?.startsWith("watch:")) return "작업 자동 반영";
    if (payload.reason === "manual") return "방금 재스캔";
    if (payload.reason === "startup") return "초기 스캔 반영";
  } catch {
    return "자동 재스캔";
  }

  return "자동 재스캔";
}

function EntityNodeCard({ data, selected }: NodeProps<EntityNode>) {
  const { locale, text } = useI18n();
  const Icon = kindIcon[data.kind];
  const meta = statusMeta[data.status];

  return (
    <section
      className={`entity-node entity-node--${data.status} ${
        selected ? "is-selected" : ""
      }`}
      style={
        {
          "--node-accent": meta.color,
          "--node-soft": meta.soft,
        } as CSSProperties
      }
    >
      <Handle type="target" position={Position.Left} className="node-handle" />
      <div className="node-header">
        <div className="node-icon" aria-hidden="true">
          <Icon size={20} strokeWidth={2.4} />
        </div>
        <div className="node-title-wrap">
          <h2>{text(data.title)}</h2>
          <p>{data.repo}</p>
        </div>
        <span className="node-status">{statusLabel(locale, data.status)}</span>
      </div>
      <p className="node-summary">{text(data.impact)}</p>
      <div className="node-path">{data.path}</div>
      <div className="node-badges">
        {data.badges.map((badge) => (
          <span key={badge}>{text(badge)}</span>
        ))}
      </div>
      {data.metrics ? (
        <div className="node-metrics">
          {data.metrics.map((metric) => (
            <span key={metric.label}>
              <strong>{metric.value}</strong>
              {text(metric.label)}
            </span>
          ))}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} className="node-handle" />
    </section>
  );
}

const nodeTypes: NodeTypes = {
  entity: EntityNodeCard,
};

function ChangeSummary({ change }: { change?: ChangeDetail }) {
  const { t, text } = useI18n();
  if (!change) {
    return (
      <section className="change-card change-card--empty">
        <h4>{t("changeDetails")}</h4>
        <p>{t("noDiffPreview")}</p>
      </section>
    );
  }

  return (
    <section className="change-card">
      <div className="change-card-header">
        <h4>{t("changeDetails")}</h4>
        <span>{change.compare}</span>
      </div>
      <div className="change-stats">
        <strong>{text(change.summary)}</strong>
        <span>+{change.additions}</span>
        <span>-{change.deletions}</span>
      </div>
      {change.signals && change.signals.length > 0 ? (
        <div className="signal-list">
          {change.signals.map((signal) => (
            <span
              className={`signal-pill signal-pill--${signal.action}`}
              key={`${signal.action}-${signal.kind}-${signal.label}`}
            >
              {t(signal.action === "deleted" ? "deleted" : "added")} {text(signal.label)}
            </span>
          ))}
        </div>
      ) : null}
      {change.lines.length > 0 ? (
        <pre className="diff-preview">
          {change.lines.map((line, index) => (
            <code
              className={
                line.startsWith("+")
                  ? "diff-line diff-line--add"
                  : line.startsWith("-")
                    ? "diff-line diff-line--delete"
                    : line.startsWith("@@")
                      ? "diff-line diff-line--hunk"
                      : "diff-line"
              }
              key={`${line}-${index}`}
            >
              {line}
            </code>
          ))}
        </pre>
      ) : (
        <p>{t("noLinePreview")}</p>
      )}
    </section>
  );
}

function EvidenceList({
  items,
  fallback,
}: {
  items?: EvidenceItem[];
  fallback?: string;
}) {
  const { t, text } = useI18n();
  const visibleItems = (items ?? []).filter(
    (item) => item.file || item.text,
  );

  if (visibleItems.length === 0 && !fallback) return null;

  return (
    <section className="evidence-card">
      <div className="change-card-header">
        <h4>{t("evidence")}</h4>
        <span>{visibleItems.length > 0 ? "static scan" : "summary"}</span>
      </div>
      {visibleItems.length > 0 ? (
        <ul className="evidence-list">
          {visibleItems.map((item, index) => (
            <li key={`${item.file}-${item.line}-${index}`}>
              <div>
                <strong>
                  {item.file}
                  {item.line > 0 ? `:${item.line}` : ""}
                </strong>
                <span>{item.source} · {Math.round(item.confidence * 100)}%</span>
              </div>
              {item.text ? <code>{item.text}</code> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>{text(fallback ?? "")}</p>
      )}
    </section>
  );
}

function EdgeSummary({ edge }: { edge: Edge }) {
  const { t, text } = useI18n();
  const evidenceItems = normalizeEvidenceItems(edge.data?.evidenceItems);
  const confidence =
    typeof edge.data?.confidence === "number"
      ? Math.round(edge.data.confidence * 100)
      : null;

  return (
    <>
      <div className="section-title-row">
        <h2>{t("selectedConnection")}</h2>
        <span className="detail-status detail-status--changed">
          {confidence !== null ? `${confidence}%` : t("connection")}
        </span>
      </div>
      <h3>{text(String(edge.label ?? t("connection")))}</h3>
      <p>{text(String(edge.data?.kind ?? "static relation"))}</p>
      <dl className="detail-list">
        <div>
          <dt>source</dt>
          <dd>{edge.source}</dd>
        </div>
        <div>
          <dt>target</dt>
          <dd>{edge.target}</dd>
        </div>
        <div>
          <dt>{t("evidence")}</dt>
          <dd>{text(String(edge.data?.evidence ?? t("connectionRule")))}</dd>
        </div>
      </dl>
      <EvidenceList
        fallback={String(edge.data?.evidence ?? t("generatedByRule"))}
        items={evidenceItems}
      />
    </>
  );
}

function StructureOverview({
  scenarioLabel,
  repoCount,
  selectedRepoCount,
  featureCount,
  changedCount,
  riskCount,
  edgeCount,
  focusLabel,
  evidenceCount,
}: {
  scenarioLabel: string;
  repoCount: number;
  selectedRepoCount: number;
  featureCount: number;
  changedCount: number;
  riskCount: number;
  edgeCount: number;
  focusLabel: string;
  evidenceCount: number;
}) {
  const { t, text } = useI18n();
  const steps = [
    {
      label: t("scope"),
      value:
        selectedRepoCount > 0 && selectedRepoCount !== repoCount
          ? `${selectedRepoCount}/${repoCount} repo`
          : `${repoCount} repo`,
      detail: text(scenarioLabel),
      icon: Boxes,
    },
    {
      label: t("changes"),
      value: `${featureCount} ${t("features")}`,
      detail: `${t("impact")} ${changedCount} · ${t("attention")} ${riskCount}`,
      icon: FileDiff,
    },
    {
      label: t("entryPoint"),
      value: "API / UI",
      detail: "route · wrapper",
      icon: Route,
    },
    {
      label: t("processing"),
      value: `${edgeCount} ${t("connections")}`,
      detail: "handler · function",
      icon: ServerCog,
    },
    {
      label: t("evidence"),
      value: evidenceCount > 0 ? `${evidenceCount} lines` : "summary",
      detail: text(focusLabel),
      icon: Code2,
    },
  ];

  return (
    <section className="structure-overview" aria-label={t("systemOverview")}>
      {steps.map((step, index) => {
        const Icon = step.icon;

        return (
          <div className="structure-step" key={step.label}>
            <div className="structure-step-head">
              <span>{index + 1}</span>
              <Icon size={16} aria-hidden="true" />
              <strong>{step.label}</strong>
              {index < steps.length - 1 ? (
                <ArrowRight size={14} aria-hidden="true" />
              ) : null}
            </div>
            <p>{step.value}</p>
            <small>{step.detail}</small>
          </div>
        );
      })}
    </section>
  );
}

function FeatureChangeList({ features }: { features: FeatureChange[] }) {
  const { t, text } = useI18n();
  const actionLabel: Record<FeatureChangeAction, string> = {
    added: t("added"),
    deleted: t("deleted"),
    changed: t("changed"),
  };

  if (features.length === 0) {
    return (
      <section className="panel-section feature-change-section">
        <div className="section-title-row">
          <h2>{t("featureChanges")}</h2>
          <span className="muted-count">0</span>
        </div>
        <p className="empty-note">{t("noFeatureChanges")}</p>
      </section>
    );
  }

  return (
    <section className="panel-section feature-change-section">
      <div className="section-title-row">
        <h2>{t("featureChanges")}</h2>
        <span className="muted-count">{features.length}</span>
      </div>
      <div className="feature-change-list">
        {features.map((feature) => (
          <article
            className={`feature-change feature-change--${feature.action}`}
            key={feature.id}
          >
            <div className="feature-change-head">
              <span>{actionLabel[feature.action]}</span>
              <strong>{text(feature.title)}</strong>
            </div>
            <p>{text(feature.summary)}</p>
            <small>{text(feature.detail)}</small>
            {(feature.signals.length > 0 ? feature.signals : feature.items).length > 0 ? (
              <ul>
                {(feature.signals.length > 0 ? feature.signals : feature.items)
                  .slice(0, 3)
                  .map((item) => (
                    <li key={item}>{text(item)}</li>
                  ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function TeamUpdateDetail({
  selection,
  onClear,
}: {
  selection: SelectedTeamUpdate;
  onClear: () => void;
}) {
  const { t, text } = useI18n();
  const files = selection.update.files ?? [];
  const features = selection.update.featureChanges ?? [];
  const prLabel = selection.update.prNumber
    ? `PR #${selection.update.prNumber}`
    : `commit ${selection.update.hash}`;

  return (
    <section className="panel-section feature-change-section pr-detail-section">
      <div className="section-title-row">
        <h2>{t("prChanges")}</h2>
        <button className="clear-filter-button" onClick={onClear} type="button">
          {t("clear")}
        </button>
      </div>
      <article className="pr-detail-card">
        <div className="feature-change-head">
          <span>{prLabel}</span>
          <strong>{compactRepoName(selection.repo.name)}</strong>
        </div>
        <p>{text(selection.update.summary || selection.update.subject)}</p>
        <div className="pr-stat-row">
          <span>{files.length} files</span>
          <span>+{selection.update.additions ?? 0}</span>
          <span>-{selection.update.deletions ?? 0}</span>
        </div>
        {features.length > 0 ? (
          <div className="pr-feature-list">
            {features.slice(0, 4).map((feature) => (
              <div
                className={`pr-feature pr-feature--${feature.action}`}
                key={feature.id}
              >
                <strong>{text(feature.title)}</strong>
                <span>{text(feature.summary)}</span>
                <small>{text(feature.detail)}</small>
              </div>
            ))}
          </div>
        ) : null}
        {files.length > 0 ? (
          <ul className="pr-file-list">
            {files.slice(0, 10).map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        ) : (
          <p className="empty-note">{t("noPrFiles")}</p>
        )}
      </article>
    </section>
  );
}

function ScanHistoryPanel({
  delta,
  history,
  repos,
  selectedRepoName,
  prQuery,
  onChangePrQuery,
  onSelectRepo,
  onSelectEvent,
}: {
  delta?: ScanDelta;
  history: ScanHistoryEvent[];
  repos: RepoSummary[];
  selectedRepoName: string | null;
  prQuery: string;
  onChangePrQuery: (value: string) => void;
  onSelectRepo: (repoName: string | null) => void;
  onSelectEvent?: (event: ScanHistoryEvent) => void;
}) {
  const { t, text } = useI18n();
  const currentEvents = delta?.events ?? [];
  const currentIds = new Set(currentEvents.map((event) => event.id));
  const hasPrFilter = Boolean(selectedRepoName || prQuery.trim());
  const previousEvents = history
    .filter((event) => !currentIds.has(event.id))
    .slice(0, 4);

  return (
    <section className="panel-section scan-history-section">
      <div className="section-title-row">
        <h2>{t("scanChanges")}</h2>
        <span className="muted-count">{delta?.summary ? text(delta.summary) : t("waiting")}</span>
      </div>
      {repos.length > 0 ? (
        <div className="scan-filter-row" aria-label={t("prFilters")}>
          <div className="scan-repo-toggle" aria-label={t("recentPrByRepo")}>
            <button
              className={!selectedRepoName ? "is-active" : ""}
              onClick={() => onSelectRepo(null)}
              type="button"
            >
              {t("all")}
            </button>
            {repos.map((repo) => (
              <button
                className={selectedRepoName === repo.name ? "is-active" : ""}
                key={repo.path}
                onClick={() =>
                  onSelectRepo(selectedRepoName === repo.name ? null : repo.name)
                }
                title={repo.name}
                type="button"
              >
                {compactRepoName(repo.name)}
              </button>
            ))}
          </div>
          <label className="scan-pr-search">
            <Search size={14} />
            <input
              inputMode="numeric"
              onChange={(event) => onChangePrQuery(event.target.value)}
              placeholder={t("prNumber")}
              value={prQuery}
            />
          </label>
        </div>
      ) : null}
      <div className="history-list">
        {(currentEvents.length > 0
          ? currentEvents
          : [
              {
                id: "history-empty",
                at: "",
                type: "none" as const,
                scenarioId: "all",
                scenarioLabel: t("all"),
                title: hasPrFilter ? t("noPrResults") : t("noScanHistory"),
                detail: hasPrFilter
                  ? t("changePrFilter")
                  : t("refreshToCompare"),
                items: [],
              },
            ]
        ).map((event) => (
          <HistoryEventCard
            event={event}
            key={event.id}
            onSelect={onSelectEvent}
          />
        ))}
        {previousEvents.length > 0 ? (
          <>
            <div className="history-subtitle">{t("previousChanges")}</div>
            {previousEvents.map((event) => (
            <HistoryEventCard
                event={event}
                key={event.id}
                onSelect={onSelectEvent}
              />
            ))}
          </>
        ) : null}
      </div>
    </section>
  );
}

function HistoryEventCard({
  event,
  onSelect,
}: {
  event: ScanHistoryEvent;
  onSelect?: (event: ScanHistoryEvent) => void;
}) {
  const { locale, t, text } = useI18n();
  const label: Record<ScanHistoryEventType, string> = {
    added: t("newLabel"),
    deleted: t("removedLabel"),
    changed: t("changedLabel"),
    baseline: t("baselineLabel"),
    none: t("noneLabel"),
  };

  const canSelect = Boolean(event.updateKey && onSelect);

  return (
    <article
      className={`history-event history-event--${event.type} ${
        canSelect ? "is-clickable" : ""
      }`}
      onClick={canSelect ? () => onSelect?.(event) : undefined}
      role={canSelect ? "button" : undefined}
      tabIndex={canSelect ? 0 : undefined}
      onKeyDown={
        canSelect
          ? (keyboardEvent) => {
              if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
                keyboardEvent.preventDefault();
                onSelect?.(event);
              }
            }
          : undefined
      }
    >
      <div className="history-event-head">
        <span>{label[event.type]}</span>
        <strong>{text(event.title)}</strong>
      </div>
      <small>
        {text(event.scenarioLabel)}
        {event.at ? ` · ${formatEventTime(event.at, locale)}` : ""}
      </small>
      <p>{text(event.detail)}</p>
      {event.items.length > 0 ? (
        <ul>
          {event.items.slice(0, 4).map((item) => (
            <li key={item}>{text(item)}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function formatEventTime(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString(locale === "ko" ? "ko-KR" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function beginResize(
  event: ReactPointerEvent<HTMLButtonElement>,
  cursor: string,
  onMove: (event: PointerEvent) => void,
  onEnd?: () => void,
) {
  event.preventDefault();

  const previousCursor = document.body.style.cursor;
  const previousUserSelect = document.body.style.userSelect;
  document.body.style.cursor = cursor;
  document.body.style.userSelect = "none";

  function stopResize() {
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = previousUserSelect;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", stopResize);
    onEnd?.();
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", stopResize, { once: true });
}

function useResizeObserverLoopGuard() {
  useEffect(() => {
    function isResizeObserverLoopMessage(message: unknown) {
      return (
        typeof message === "string" &&
        RESIZE_OBSERVER_LOOP_MESSAGES.has(message)
      );
    }

    function handleWindowError(event: ErrorEvent) {
      if (!isResizeObserverLoopMessage(event.message)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      const reason = event.reason;
      const message =
        reason instanceof Error ? reason.message : String(reason ?? "");
      if (!isResizeObserverLoopMessage(message)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    window.addEventListener("error", handleWindowError, true);
    window.addEventListener("unhandledrejection", handleUnhandledRejection, true);

    return () => {
      window.removeEventListener("error", handleWindowError, true);
      window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection,
        true,
      );
    };
  }, []);
}

export function WhereAmIClient() {
  useResizeObserverLoopGuard();

  const [locale, setLocale] = useState<Locale>("en");
  const [scenarioId, setScenarioId] = useState<ScenarioId>("current-work");
  const [query, setQuery] = useState("");
  const [graphMode, setGraphMode] = useState<GraphMode>("focus");
  const [selectedRepoNames, setSelectedRepoNames] = useState<string[]>([]);
  const [scanRepoName, setScanRepoName] = useState<string | null>(null);
  const [scanPrQuery, setScanPrQuery] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [riskOnly, setRiskOnly] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState("ui-dashboard");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectionFocusActive, setSelectionFocusActive] = useState(false);
  const [selectedTeamUpdateKey, setSelectedTeamUpdateKey] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<WhereAmISnapshot | null>(null);
  const [snapshotState, setSnapshotState] = useState<SnapshotState>("loading");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState("");
  const [leftPanelWidth, setLeftPanelWidth] = useState(286);
  const [leftPanelDraftWidth, setLeftPanelDraftWidth] = useState<number | null>(null);
  const [detailPanelHeight, setDetailPanelHeight] = useState(420);

  const t = useCallback(
    (key: MessageKey, values?: Record<string, string | number>) =>
      translate(locale, key, values),
    [locale],
  );
  const text = useCallback(
    (value: string) => localizeText(locale, value),
    [locale],
  );

  useEffect(() => {
    let storedLocale: string | null = null;
    try {
      storedLocale = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    } catch {
      storedLocale = null;
    }
    if (!storedLocale) {
      storedLocale = document.cookie
        .split(";")
        .map((item) => item.trim())
        .find((item) => item.startsWith(`${LANGUAGE_STORAGE_KEY}=`))
        ?.split("=")[1] ?? null;
    }
    const nextLocale = storedLocale
      ? resolveLocale(storedLocale)
      : resolveLocale(window.navigator.language);
    const timer = window.setTimeout(() => {
      setLocale(nextLocale);
      document.documentElement.lang = nextLocale;
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLocale);
    } catch {
      // The language still changes for this session when storage is unavailable.
    }
    document.cookie = `${LANGUAGE_STORAGE_KEY}=${nextLocale}; path=/; max-age=31536000; SameSite=Lax`;
    document.documentElement.lang = nextLocale;
  }

  useEffect(() => {
    let alive = true;
    let eventSource: EventSource | null = null;

    async function loadSnapshotFromDisk(nextRefreshNote?: string) {
      try {
        const nextSnapshot = await readSnapshot();
        if (alive) {
          setSnapshot(nextSnapshot);
          setSnapshotState("live");
          if (nextRefreshNote) setRefreshNote(nextRefreshNote);
        }
      } catch {
        if (alive) {
          setSnapshot(null);
          setSnapshotState("sample");
          if (nextRefreshNote) setRefreshNote("snapshot 없음");
        }
      }
    }

    loadSnapshotFromDisk();
    const timer = window.setInterval(
      loadSnapshotFromDisk,
      SNAPSHOT_REFRESH_INTERVAL_MS,
    );
    eventSource = new EventSource(LOCAL_SCAN_EVENTS_URL);
    eventSource.addEventListener("scan-start", () => {
      if (alive) setRefreshNote("작업 감지");
    });
    eventSource.addEventListener("scan-complete", (event) => {
      loadSnapshotFromDisk(scanRefreshNote(event));
    });
    eventSource.addEventListener("scan-error", () => {
      if (alive) setRefreshNote("자동 스캔 실패");
    });
    eventSource.onerror = () => {};

    return () => {
      alive = false;
      window.clearInterval(timer);
      eventSource?.close();
    };
  }, []);

  const availableScenarios = useMemo(
    () =>
      (snapshot?.scenarios?.length ? snapshot.scenarios : scenarios).map(
        normalizeScenario,
      ),
    [snapshot],
  );

  const scenario =
    availableScenarios.find((item) => item.id === scenarioId) ??
    availableScenarios[0];

  const selectedRepoSet = useMemo(
    () => new Set(selectedRepoNames),
    [selectedRepoNames],
  );
  const hasRepoFilter = selectedRepoNames.length > 0;
  const selectedTeamUpdate = useMemo(
    () => findTeamUpdate(snapshot?.repos ?? [], selectedTeamUpdateKey),
    [selectedTeamUpdateKey, snapshot?.repos],
  );
  const selectedTeamFileSet = useMemo(
    () =>
      new Set(
        selectedTeamUpdate
          ? (selectedTeamUpdate.update.files ?? []).map((file) =>
              teamUpdateFileKey(selectedTeamUpdate.repo.name, file),
            )
          : [],
      ),
    [selectedTeamUpdate],
  );

  const filteredGraph = useMemo(() => {
    const lowerQuery = query.trim().toLowerCase();
    const directlyMatched = new Set<string>();
    const hasQuery = lowerQuery.length > 0;
    const sourceNodes =
      hasQuery || graphMode !== "focus" || hasRepoFilter || selectedTeamUpdate
        ? scenario.allNodes ?? scenario.nodes
        : scenario.nodes;
    const sourceEdges =
      hasQuery || graphMode !== "focus" || hasRepoFilter || selectedTeamUpdate
        ? scenario.allEdges ?? scenario.edges
        : scenario.edges;
    const sourceNodeMap = new Map(sourceNodes.map((node) => [node.id, node]));
    const repoAllowed = (nodeId: string) => {
      const node = sourceNodeMap.get(nodeId);
      return !hasRepoFilter || selectedRepoSet.has(node?.data.repo ?? "");
    };

    sourceNodes.forEach((node) => {
      const searchable = [
        node.data.title,
        text(node.data.title),
        node.data.repo,
        node.data.path,
        node.data.summary,
        text(node.data.summary),
        node.data.impact,
        text(node.data.impact),
        node.data.evidence,
        ...(node.data.evidenceItems ?? []).map((item) => item.text),
        ...node.data.badges,
      ]
        .join(" ")
        .toLowerCase();

      const matchesQuery =
        !hasQuery || searchable.includes(lowerQuery);
      const matchesRepo =
        !hasRepoFilter || selectedRepoSet.has(node.data.repo);
      const matchesTeamUpdate =
        !selectedTeamUpdate || node.data.repo === selectedTeamUpdate.repo.name;
      const matchesMode =
        hasQuery ||
        (graphMode === "focus" &&
          !node.id.startsWith("file:") &&
          (node.data.kind === "ui" ||
            node.data.kind === "wrapper" ||
            node.data.kind === "api" ||
            node.data.kind === "engine" ||
            node.data.kind === "handler" ||
            node.data.kind === "function" ||
            node.data.kind === "external" ||
            node.data.kind === "error" ||
            node.data.kind === "db")) ||
        graphMode === "all" ||
        (graphMode === "api" &&
          (node.data.kind === "ui" ||
            node.data.kind === "wrapper" ||
            node.data.kind === "api" ||
            node.data.kind === "engine" ||
            node.data.kind === "handler" ||
            node.data.kind === "function" ||
            node.data.kind === "external")) ||
        (graphMode === "verify" &&
          (node.data.kind === "docs" ||
            node.data.kind === "test" ||
            node.data.kind === "api" ||
            node.data.kind === "error" ||
            node.data.status === "risk"));
      const matchesChanged =
        !changedOnly ||
        node.data.status === "active" ||
        node.data.status === "added" ||
        node.data.status === "changed" ||
        node.data.status === "risk";
      const matchesRisk =
        !riskOnly || node.data.status === "risk";

      if (
        matchesRepo &&
        matchesTeamUpdate &&
        matchesQuery &&
        matchesMode &&
        matchesChanged &&
        matchesRisk
      ) {
        directlyMatched.add(node.id);
      }
    });

    if (hasQuery) {
      sourceEdges.forEach((edge) => {
        if (
          repoAllowed(edge.source) &&
          repoAllowed(edge.target) &&
          (directlyMatched.has(edge.source) || directlyMatched.has(edge.target))
        ) {
          directlyMatched.add(edge.source);
          directlyMatched.add(edge.target);
        }
      });
    }

    let matchedNodes = sourceNodes.filter(
      (node) => directlyMatched.has(node.id) && node.data.kind !== "repo",
    );
    if (matchedNodes.length === 0 && graphMode === "focus" && !hasQuery) {
      matchedNodes = sourceNodes
        .filter(
          (node) =>
            node.data.kind !== "repo" &&
            (node.data.status === "active" ||
              node.data.status === "added" ||
              node.data.status === "changed" ||
              node.data.status === "risk"),
        )
        .slice(0, 12);
    }
    const nodes = selectedTeamUpdate
      ? compactTeamGraphNodes(matchedNodes)
      : matchedNodes;

    return {
      nodes,
      edges: sourceEdges.filter(
        (edge) =>
          directlyMatched.has(edge.source) && directlyMatched.has(edge.target),
      ),
    };
  }, [
    changedOnly,
    graphMode,
    hasRepoFilter,
    query,
    riskOnly,
    scenario,
    selectedRepoSet,
    selectedTeamUpdate,
    text,
  ]);
  const displayGraph = useMemo(
    () => layoutApiFlowGraph(filteredGraph.nodes, filteredGraph.edges),
    [filteredGraph],
  );

  const allScenarioNodes = scenario.allNodes ?? scenario.nodes;
  const hiddenCount = Math.max(0, allScenarioNodes.length - scenario.nodes.length);
  const graphModeLabel = {
    focus: t("flow"),
    all: t("all"),
    api: "API",
    verify: t("verify"),
  }[graphMode];

  const selectedNode =
    filteredGraph.nodes.find((node) => node.id === selectedNodeId) ??
    filteredGraph.nodes[0] ??
    allScenarioNodes.find((node) => node.id === selectedNodeId) ??
    scenario.nodes.find((node) => node.id === scenario.focusNodeId) ??
    scenario.nodes[0];
  const selectedEdge =
    filteredGraph.edges.find((edge) => edge.id === selectedEdgeId) ?? null;

  const filteredFeatureChanges = useMemo(() => {
    const featureChanges = scenario.featureChanges ?? [];
    if (selectedTeamUpdate) {
      return featureChanges.filter((feature) =>
        feature.files.some((file) => selectedTeamFileSet.has(file)),
      );
    }

    if (!hasRepoFilter) return featureChanges;

    return featureChanges.filter(
      (feature) =>
        feature.repos.some((repoName) => selectedRepoSet.has(repoName)) ||
        feature.files.some((file) =>
          selectedRepoNames.some((repoName) => file.startsWith(`${repoName}/`)),
        ),
    );
  }, [
    hasRepoFilter,
    scenario.featureChanges,
    selectedRepoNames,
    selectedRepoSet,
    selectedTeamFileSet,
    selectedTeamUpdate,
  ]);
  const filtered = useMemo(() => {
    const highlightedNodeIds = new Set<string>();
    const highlightedEdgeIds = new Set<string>();
    const prChangedNodeIds = new Set(
      selectedTeamUpdate
        ? displayGraph.nodes
            .filter((node) => matchesTeamUpdateFile(node, selectedTeamFileSet))
            .map((node) => node.id)
        : [],
    );
    const selectedRepoNodeIds = new Set(
      hasRepoFilter
        ? displayGraph.nodes
            .filter((node) => selectedRepoSet.has(node.data.repo))
            .map((node) => node.id)
        : [],
    );

    if (selectionFocusActive && selectedEdge) {
      highlightedEdgeIds.add(selectedEdge.id);
      highlightedNodeIds.add(selectedEdge.source);
      highlightedNodeIds.add(selectedEdge.target);
    } else if (
      selectionFocusActive &&
      selectedTeamUpdate &&
      prChangedNodeIds.size > 0
    ) {
      prChangedNodeIds.forEach((nodeId) => highlightedNodeIds.add(nodeId));
      displayGraph.edges.forEach((edge) => {
        if (!prChangedNodeIds.has(edge.source) && !prChangedNodeIds.has(edge.target)) {
          return;
        }
        highlightedEdgeIds.add(edge.id);
        highlightedNodeIds.add(edge.source);
        highlightedNodeIds.add(edge.target);
      });
    } else if (selectionFocusActive && selectedRepoNodeIds.size > 0) {
      selectedRepoNodeIds.forEach((nodeId) => highlightedNodeIds.add(nodeId));
      displayGraph.edges.forEach((edge) => {
        if (
          !selectedRepoNodeIds.has(edge.source) &&
          !selectedRepoNodeIds.has(edge.target)
        ) {
          return;
        }
        highlightedEdgeIds.add(edge.id);
        highlightedNodeIds.add(edge.source);
        highlightedNodeIds.add(edge.target);
      });
    } else if (selectionFocusActive && selectedNode) {
      highlightedNodeIds.add(selectedNode.id);
      displayGraph.edges.forEach((edge) => {
        if (edge.source !== selectedNode.id && edge.target !== selectedNode.id) {
          return;
        }
        highlightedEdgeIds.add(edge.id);
        highlightedNodeIds.add(edge.source);
        highlightedNodeIds.add(edge.target);
      });
    }

    const hasFocus = selectionFocusActive && highlightedNodeIds.size > 0;

    return {
      nodes: displayGraph.nodes.map((node) => {
        const isHighlighted = highlightedNodeIds.has(node.id);
        const isPrChanged = prChangedNodeIds.has(node.id);
        return {
          ...node,
          selected: node.id === selectedNode.id,
          className: [
            node.className,
            isPrChanged ? "is-pr-node" : "",
            hasFocus && isHighlighted ? "is-focus-node" : "",
            hasFocus && !isHighlighted ? "is-dimmed-node" : "",
          ]
            .filter(Boolean)
            .join(" "),
        };
      }),
      edges: displayGraph.edges.map((edge) => {
        const localizedEdge = {
          ...edge,
          label: edge.label ? text(String(edge.label)) : edge.label,
        };
        if (!hasFocus) return localizedEdge;

        const isSelectedEdge = edge.id === selectedEdgeId;
        const isHighlighted = highlightedEdgeIds.has(edge.id);

        return {
          ...localizedEdge,
          animated: false,
          selected: isSelectedEdge,
          className: [
            edge.className,
            isSelectedEdge
              ? "is-selected-edge"
              : isHighlighted
                ? "is-highlight-edge"
                : "is-muted-edge",
          ]
            .filter(Boolean)
            .join(" "),
          style: {
            ...edge.style,
            strokeOpacity: isHighlighted ? 0.96 : 0.1,
            strokeWidth: isSelectedEdge ? 6 : isHighlighted ? 4 : 1.5,
          },
          labelStyle: {
            ...edge.labelStyle,
            fill: isHighlighted ? "#020617" : "#64748b",
            fontWeight: isHighlighted ? 900 : edge.labelStyle?.fontWeight,
          },
          labelBgStyle: {
            ...edge.labelBgStyle,
            fillOpacity: isHighlighted ? 1 : 0.24,
          },
        };
      }),
    };
  }, [
    displayGraph,
    hasRepoFilter,
    selectedEdge,
    selectedEdgeId,
    selectedNode,
    selectedRepoSet,
    selectedTeamFileSet,
    selectedTeamUpdate,
    selectionFocusActive,
    text,
  ]);
  const scanDelta = normalizeScanDelta(snapshot?.scanDelta);
  const scanHistory = normalizeHistoryEvents(snapshot?.history);
  const visibleScanDelta = useMemo(
    () =>
      buildTeamUpdateEvents(
        snapshot?.repos ?? [],
        scanDelta,
        scanRepoName,
        scanPrQuery,
      ),
    [scanDelta, scanPrQuery, scanRepoName, snapshot?.repos],
  );
  const commitScope = useMemo(
    () =>
      buildCommitScope(
        snapshot?.repos ?? [],
        selectedRepoNames,
        scenario.branch,
      ),
    [scenario.branch, selectedRepoNames, snapshot?.repos],
  );
  const teamAlertScope = useMemo(
    () => buildTeamAlertScope(snapshot?.repos ?? [], selectedRepoNames),
    [selectedRepoNames, snapshot?.repos],
  );

  const statusCounts = useMemo(
    () =>
      filteredGraph.nodes.reduce(
        (counts, node) => {
          counts[node.data.status] += 1;
          return counts;
        },
        { active: 0, added: 0, changed: 0, risk: 0, stable: 0 },
      ),
    [filteredGraph.nodes],
  );
  const selectedEvidenceCount = selectedEdge
    ? normalizeEvidenceItems(selectedEdge.data?.evidenceItems).length
    : selectedNode.data.evidenceItems?.length ?? 0;
  const visibleRepoCount = useMemo(
    () =>
      snapshot?.repos?.length ??
      new Set(filteredGraph.nodes.map((node) => node.data.repo)).size,
    [filteredGraph.nodes, snapshot?.repos],
  );
  const selectedStructureRepoCount = visibleRepoCount;
  const structureFocusLabel = selectedEdge
    ? text(String(selectedEdge.label ?? t("connection")))
    : selectedNode.data.title;

  function selectScenario(nextScenarioId: ScenarioId) {
    const nextScenario = availableScenarios.find((item) => item.id === nextScenarioId);
    setScenarioId(nextScenarioId);
    setSelectedEdgeId(null);
    setSelectionFocusActive(false);
    setSelectedTeamUpdateKey(null);
    setSelectedNodeId(nextScenario?.focusNodeId ?? "");
  }

  function findRepoFlowNodeId(repoName: string, targetScenario = scenario) {
    return (
      (targetScenario.allNodes ?? targetScenario.nodes).find(
        (node) => node.data.kind !== "repo" && node.data.repo === repoName,
      )?.id ?? ""
    );
  }

  function selectRepoForMap(repo: RepoSummary) {
    const alreadySelected = selectedRepoNames.includes(repo.name);
    const nextSelectedRepoNames = alreadySelected
      ? selectedRepoNames.filter((repoName) => repoName !== repo.name)
      : [...selectedRepoNames, repo.name];
    const teamScenario =
      availableScenarios.find((item) => item.id === "team-briefing") ?? scenario;

    setScenarioId("team-briefing");
    setSelectedRepoNames(nextSelectedRepoNames);
    setSelectedTeamUpdateKey(null);
    setSelectedEdgeId(null);
    setSelectionFocusActive(nextSelectedRepoNames.length > 0);
    setGraphMode("all");
    setChangedOnly(false);
    setRiskOnly(false);
    setQuery("");
    setSelectedNodeId(
      nextSelectedRepoNames.length === 0
        ? teamScenario.focusNodeId
        : findRepoFlowNodeId(
            alreadySelected ? nextSelectedRepoNames[0] : repo.name,
            teamScenario,
          ) || teamScenario.focusNodeId,
    );
  }

  function selectScanEvent(event: ScanHistoryEvent) {
    if (!event.repoName || !event.updateKey) return;
    setScenarioId("team-briefing");
    setSelectedRepoNames([]);
    setSelectedTeamUpdateKey(event.updateKey);
    setSelectedEdgeId(null);
    setSelectionFocusActive(true);
    setGraphMode("all");
    setChangedOnly(false);
    setRiskOnly(false);
    setQuery("");
    const teamScenario =
      availableScenarios.find((item) => item.id === "team-briefing") ?? scenario;
    setSelectedNodeId(
      findRepoFlowNodeId(event.repoName, teamScenario) || teamScenario.focusNodeId,
    );
  }

  function clearTeamUpdateFilter() {
    setSelectedTeamUpdateKey(null);
    setSelectionFocusActive(false);
    setSelectedNodeId(
      selectedRepoNames.length === 1
        ? findRepoFlowNodeId(selectedRepoNames[0]) || scenario.focusNodeId
        : scenario.focusNodeId,
    );
  }

  function startLeftPanelResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const startX = event.clientX;
    const startWidth = leftPanelWidth;
    let nextWidth = startWidth;
    setLeftPanelDraftWidth(startWidth);
    beginResize(event, "col-resize", (moveEvent) => {
      nextWidth = clamp(
        startWidth + moveEvent.clientX - startX,
        LEFT_PANEL_MIN_WIDTH,
        LEFT_PANEL_MAX_WIDTH,
      );
      setLeftPanelDraftWidth(nextWidth);
    }, () => {
      setLeftPanelWidth(nextWidth);
      setLeftPanelDraftWidth(null);
    });
  }

  function startDetailPanelResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const startY = event.clientY;
    const startHeight = detailPanelHeight;
    beginResize(event, "row-resize", (moveEvent) => {
      setDetailPanelHeight(
        clamp(
          startHeight - (moveEvent.clientY - startY),
          DETAIL_PANEL_MIN_HEIGHT,
          DETAIL_PANEL_MAX_HEIGHT,
        ),
      );
    });
  }

  async function refreshNow() {
    setIsRefreshing(true);
    setRefreshNote(t("refreshing"));

    let scanServerUsed = false;
    try {
      const response = await fetch(LOCAL_SCAN_URL, { method: "POST" });
      scanServerUsed = response.ok;
    } catch {
      scanServerUsed = false;
    }

    try {
      const nextSnapshot = await readSnapshot();
      setSnapshot(nextSnapshot);
      setSnapshotState("live");
      setRefreshNote(scanServerUsed ? t("rescanned") : t("snapshotReloaded"));
    } catch {
      setSnapshot(null);
      setSnapshotState("sample");
      setRefreshNote(t("snapshotMissing"));
    } finally {
      setIsRefreshing(false);
    }
  }

  const scanLabel =
    snapshotState === "live" && snapshot
      ? t("latestScan", { time: new Date(snapshot.generatedAt).toLocaleTimeString(locale === "ko" ? "ko-KR" : "en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }) })
      : snapshotState === "loading"
        ? t("checkingScan")
        : t("sampleMode");

  return (
    <I18nContext.Provider value={{ locale, t, text }}>
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <div className="brand-mark brand-mark--lost" aria-hidden="true">
            <span className="lost-person">
              <i className="lost-person-head" />
              <i className="lost-person-back" />
              <i className="lost-person-arm" />
              <i className="lost-person-leg" />
            </span>
          </div>
          <div>
            <h1>Where am I</h1>
            <p>{t("tagline")}</p>
          </div>
        </div>
        <div className="top-meta" aria-label={t("latestCommit")}>
          <span className="commit-pill" title={commitScope.title}>
            <GitCommitHorizontal size={16} />
            {text(commitScope.label)}
          </span>
          {teamAlertScope ? (
            <span className="team-alert-pill" title={teamAlertScope.title}>
              <AlertTriangle size={16} />
              {text(teamAlertScope.label)}
            </span>
          ) : null}
          <span>{text(scenario.compare)}</span>
          <span className={`scan-pill scan-pill--${snapshotState}`}>{scanLabel}</span>
          <button
            className="refresh-button"
            disabled={isRefreshing}
            onClick={refreshNow}
            type="button"
          >
            <ArrowRight size={15} />
            {isRefreshing ? t("refreshing") : t("refresh")}
          </button>
          {refreshNote ? <span>{text(refreshNote)}</span> : null}
          <div className="language-toggle" aria-label={t("language")} role="group">
            <button
              aria-pressed={locale === "en"}
              className={locale === "en" ? "is-active" : ""}
              onClick={() => changeLocale("en")}
              title={t("switchToEnglish")}
              type="button"
            >
              EN
            </button>
            <button
              aria-pressed={locale === "ko"}
              className={locale === "ko" ? "is-active" : ""}
              onClick={() => changeLocale("ko")}
              title={t("switchToKorean")}
              type="button"
            >
              한국어
            </button>
          </div>
        </div>
      </header>

      <div
        className="workspace"
        style={
          {
            "--left-panel-width": `${leftPanelWidth}px`,
            "--left-panel-draft-width": `${leftPanelDraftWidth ?? leftPanelWidth}px`,
            "--detail-panel-height": `${detailPanelHeight}px`,
          } as CSSProperties
        }
      >
        <aside className="side-panel side-panel--left">
          <section className="panel-section">
            <h2>{t("perspectives")}</h2>
            <div className="mode-list">
              {availableScenarios.map((item) => (
                <button
                  key={item.id}
                  className={item.id === scenario.id ? "is-active" : ""}
                  onClick={() => selectScenario(item.id)}
                  type="button"
                >
                  {item.id === "team-briefing" ? (
                    <Users size={18} />
                  ) : item.id === "contract-check" ? (
                    <CheckCircle2 size={18} />
                  ) : item.id === "engine-flow" ? (
                    <ServerCog size={18} />
                  ) : (
                    <FileDiff size={18} />
                  )}
                  <span>
                    <strong>{text(item.label)}</strong>
                    <small>{text(item.description)}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          {snapshot?.repos?.length ? (
            <section className="panel-section">
              <div className="section-title-row">
                <h2>{t("connectedRepos")}</h2>
                <span className="muted-count">{t("inspect")}</span>
              </div>
              <div className="repo-list">
                {snapshot.repos.map((repo) => {
                  const isSelected = selectedRepoSet.has(repo.name);
                  const teamUpdateLabel = repoTeamUpdateLabel(repo);

                  return (
                    <article
                      aria-label={t("repoWorkflowLabel", { repo: repo.name })}
                      aria-pressed={isSelected}
                      className={`repo-item repo-item--selectable ${
                        isSelected ? "is-selected" : ""
                      }`}
                      key={repo.path}
                      onClick={() => selectRepoForMap(repo)}
                      onKeyDown={(keyboardEvent) => {
                        if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
                          keyboardEvent.preventDefault();
                          selectRepoForMap(repo);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="repo-item-title">
                        <strong>{repo.name}</strong>
                        <span>{repo.type}</span>
                      </div>
                      <span>{repo.branch}</span>
                      <small>
                        {t("local")} {repo.changedCount} / {t("team")} {repo.teamChangedCount}
                        {teamUpdateLabel ? ` / ${teamUpdateLabel}` : ""} /
                        {t("route")} {repo.routeCount} / {t("engine")} {repo.engineEndpointCount}
                      </small>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="panel-section">
            <h2>{t("status")}</h2>
            <div className="status-grid">
              {Object.entries(statusMeta).map(([status, meta]) => (
                <div key={status} className="status-count">
                  <span style={{ backgroundColor: meta.color }} />
                  <strong>{statusCounts[status as NodeStatus]}</strong>
                  <small>{statusLabel(locale, status as NodeStatus)}</small>
                </div>
              ))}
            </div>
          </section>

        </aside>
        <button
          aria-label={t("resizeLeft")}
          className="resize-grip resize-grip--left"
          onPointerDown={startLeftPanelResize}
          type="button"
        >
          <GripVertical size={16} />
        </button>

        <section className="graph-panel" aria-label={t("graph")}>
          <div className="graph-toolbar">
            <div>
              <strong>{text(scenario.label)}</strong>
              <span>{graphModeLabel} {t("view")}</span>
              {hasRepoFilter ? (
                <span>
                  repo{" "}
                  {selectedRepoNames.length === 1
                    ? selectedRepoNames[0]
                    : `${selectedRepoNames.length} ${t("selected")}`}
                </span>
              ) : null}
              {selectedTeamUpdate ? (
                <span>
                  PR{" "}
                  {selectedTeamUpdate.update.prNumber
                    ? `#${selectedTeamUpdate.update.prNumber}`
                    : selectedTeamUpdate.update.hash}
                </span>
              ) : null}
              <span>{filtered.nodes.length} nodes</span>
              <span>{filtered.edges.length} edges</span>
              {selectedEdge ? (
                <span>{t("selectedEdge")} {text(String(selectedEdge.label ?? t("connection")))}</span>
              ) : null}
              {hiddenCount > 0 &&
              graphMode === "focus" &&
              !query.trim() ? (
                <span>{t("hidden")} {hiddenCount}</span>
              ) : null}
            </div>
            <div className="legend">
              <span>
                <i className="legend-dot legend-dot--added" />
                {t("added")}
              </span>
              <span>
                <i className="legend-dot legend-dot--changed" />
                {t("changed")}
              </span>
              <span>
                <i className="legend-dot legend-dot--risk" />
                {t("attention")}
              </span>
            </div>
          </div>
          <div className="graph-filter-bar" aria-label={t("graphFilters")}>
            <div className="view-toggle" aria-label={t("graphRange")}>
              {[
                ["focus", t("flow")],
                ["all", t("all")],
                ["api", "API"],
                ["verify", t("verify")],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  className={graphMode === mode ? "is-active" : ""}
                  onClick={() => setGraphMode(mode as GraphMode)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="search-box">
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("searchPlaceholder")}
              />
            </label>
            <label className="toggle-row">
              <input
                checked={changedOnly}
                onChange={(event) => setChangedOnly(event.target.checked)}
                type="checkbox"
              />
              {t("changedOnly")}
            </label>
            <label className="toggle-row">
              <input
                checked={riskOnly}
                onChange={(event) => setRiskOnly(event.target.checked)}
                type="checkbox"
              />
              {t("riskOnly")}
            </label>
          </div>
          <StructureOverview
            changedCount={
              statusCounts.active + statusCounts.added + statusCounts.changed
            }
            edgeCount={filtered.edges.length}
            evidenceCount={selectedEvidenceCount}
            featureCount={filteredFeatureChanges.length}
            focusLabel={structureFocusLabel}
            repoCount={visibleRepoCount}
            riskCount={statusCounts.risk}
            scenarioLabel={scenario.label}
            selectedRepoCount={selectedStructureRepoCount}
          />

          <ReactFlowProvider>
            <ReactFlow
              className={`flow-stage ${selectionFocusActive ? "has-selection-focus" : ""}`}
              colorMode="light"
              edges={filtered.edges}
              fitView
              fitViewOptions={{ padding: 0.16 }}
              maxZoom={1.5}
              minZoom={0.45}
              nodeTypes={nodeTypes}
              nodes={filtered.nodes}
              nodesDraggable={false}
              onEdgeClick={(event, edge) => {
                event.stopPropagation();
                setSelectedEdgeId(edge.id);
                setSelectionFocusActive(true);
              }}
              onNodeClick={(_, node) => {
                setSelectedEdgeId(null);
                setSelectedNodeId(node.id);
                setSelectionFocusActive(true);
              }}
              onPaneClick={() => {
                setSelectedEdgeId(null);
                setSelectionFocusActive(false);
              }}
              panOnScroll
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#c7d2fe" gap={24} size={1.4} />
              <MiniMap
                maskColor="rgba(15, 23, 42, 0.08)"
                nodeColor={(node) =>
                  statusMeta[(node.data.status as NodeStatus) ?? "stable"].color
                }
                pannable
                zoomable
              />
              <Controls position="bottom-left" />
            </ReactFlow>
          </ReactFlowProvider>
        </section>

        <aside className="side-panel side-panel--right">
          <button
            aria-label={t("resizeBottom")}
            className="resize-grip resize-grip--bottom"
            onPointerDown={startDetailPanelResize}
            type="button"
          >
            <GripHorizontal size={18} />
          </button>
          <ScanHistoryPanel
            delta={visibleScanDelta}
            history={selectedTeamUpdate ? [] : scanHistory}
            onChangePrQuery={setScanPrQuery}
            onSelectRepo={setScanRepoName}
            onSelectEvent={selectScanEvent}
            prQuery={scanPrQuery}
            repos={snapshot?.repos ?? []}
            selectedRepoName={scanRepoName}
          />
          {selectedTeamUpdate ? (
            <TeamUpdateDetail
              onClear={clearTeamUpdateFilter}
              selection={selectedTeamUpdate}
            />
          ) : (
            <FeatureChangeList features={filteredFeatureChanges} />
          )}

          <section className="panel-section selected-section">
            {selectedEdge ? (
              <EdgeSummary edge={selectedEdge} />
            ) : selectedTeamUpdate ? (
              <>
                <div className="section-title-row">
                  <h2>{t("selectedPoint")}</h2>
                  <span className="detail-status detail-status--changed">{t("code")}</span>
                </div>
                <h3>
                  {selectedTeamUpdate.update.prNumber
                    ? `PR #${selectedTeamUpdate.update.prNumber}`
                    : selectedTeamUpdate.update.hash}
                </h3>
                <p>{text(selectedTeamUpdate.update.summary || selectedTeamUpdate.update.subject)}</p>
                <dl className="detail-list">
                  <div>
                    <dt>repo</dt>
                    <dd>{selectedTeamUpdate.repo.name}</dd>
                  </div>
                  <div>
                    <dt>path</dt>
                    <dd>{selectedTeamUpdate.update.codePreview?.file ?? t("representativeDiff")}</dd>
                  </div>
                  <div>
                    <dt>{t("evidence")}</dt>
                    <dd>{selectedTeamUpdate.update.subject}</dd>
                  </div>
                </dl>
                <ChangeSummary change={selectedTeamUpdate.update.codePreview} />
              </>
            ) : (
              <>
                <div className="section-title-row">
                  <h2>{t("selectedPoint")}</h2>
                  <span
                    className={`detail-status detail-status--${selectedNode.data.status}`}
                  >
                    {statusLabel(locale, selectedNode.data.status)}
                  </span>
                </div>
                <h3>{text(selectedNode.data.title)}</h3>
                <p>{text(selectedNode.data.summary)}</p>
                <dl className="detail-list">
                  <div>
                    <dt>repo</dt>
                    <dd>{selectedNode.data.repo}</dd>
                  </div>
                  <div>
                    <dt>path</dt>
                    <dd>{selectedNode.data.path}</dd>
                  </div>
                  <div>
                    <dt>{t("evidence")}</dt>
                    <dd>{text(selectedNode.data.evidence)}</dd>
                  </div>
                </dl>
                <EvidenceList
                  fallback={selectedNode.data.evidence}
                  items={selectedNode.data.evidenceItems}
                />
                <ChangeSummary change={selectedNode.data.change} />
              </>
            )}
          </section>

          <section className="panel-section briefing-section">
            <div className="section-title-row">
              <h2>{t("briefing")}</h2>
              <Filter size={16} />
            </div>
            <div className="briefing-list">
              {scenario.briefing.map((item) => (
                <article
                  key={`${item.type}-${item.title}`}
                  className={`briefing-item briefing-item--${briefingTone(item.type)}`}
                >
                  <span>{briefingLabel(locale, item.type)}</span>
                  <h3>{text(item.title)}</h3>
                  <p>{text(item.detail)}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="panel-section next-section">
            <h2>{t("nextChecks")}</h2>
            <div className="next-checks">
              <div>
                <AlertTriangle size={17} />
                <span>Swagger example field diff</span>
              </div>
              <div>
                <ArrowRight size={17} />
                <span>UI click flow to backend route</span>
              </div>
              <div>
                <CheckCircle2 size={17} />
                <span>route path unchanged check</span>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </main>
    </I18nContext.Provider>
  );
}
