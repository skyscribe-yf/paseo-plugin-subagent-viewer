// Read-only discovery of pi-subagents runs and their owning Paseo agents.
//
// Two on-disk sources are joined by the pi session UUID:
//   <tempRoot>/async-subagent-runs/<runId>/status.json  -> sessionId (parent pi session)
//   ~/.paseo/agents/<slug>/<agentId>.json               -> persistence.sessionId
//
// Every access is a stat, a read, or a bounded tail. Nothing is written, and no
// run is started, steered, or stopped.

import { closeSync, openSync, readFileSync, readdirSync, readSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

export interface PaseoAgentRef {
  agentId: string;
  title: string;
  status: string | null;
  model: string | null;
  cwd: string | null;
  piSessionId: string | null;
}

export type StepStatus = "pending" | "running" | "complete" | "failed" | "stopped" | "unknown";

export interface RunStep {
  index: number;
  agent: string;
  status: StepStatus;
  durationMs: number | null;
  sessionFile: string | null;
}

export interface RunToolCall {
  name: string;
  argsSummary: string;
  status: "running" | "completed" | "failed" | null;
  ts: number | null;
}

export interface RunRecord {
  runId: string;
  shortId: string;
  mode: string;
  state: string;
  pid: number | null;
  pidAlive: boolean | null;
  cwd: string;
  startedAt: number;
  lastActivityAt: number;
  deadlineAt: number | null;
  elapsedMs: number;
  idleMs: number;
  steps: RunStep[];
  logTail: string | null;
  dir: string;
  parentSessionId: string | null;
  logFiles: string[];
  owner?: PaseoAgentRef | null;
}

export interface EventScan {
  lastTool: RunToolCall | null;
  lastEventType: string | null;
  lastEventTs: number | null;
  toolNames: { name: string; count: number }[];
}

const PASE0_AGENTS = path.join(homedir(), ".paseo", "agents");
const EVENT_TAIL_BYTES = 96 * 1024;
const LOG_TAIL_BYTES = 2 * 1024;
const ARG_SUMMARY_MAX = 240;
const STEP_STATUSES = new Set<StepStatus>(["pending", "running", "complete", "failed", "stopped"]);

/** pi-subagents temp roots: /tmp/pi-subagents-<scope> (scope is uid-<id> by default). */
export function findTempRoots(): string[] {
  const roots: string[] = [];
  const candidates = [...new Set([tmpdir(), "/tmp"].filter(Boolean))];
  for (const base of candidates) {
    let entries;
    try {
      entries = readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("pi-subagents-")) continue;
      const root = path.join(base, entry.name);
      try {
        if (statSync(path.join(root, "async-subagent-runs")).isDirectory()) roots.push(root);
      } catch {
        // Not a run root; ignore.
      }
    }
  }
  return roots;
}

function readJson(file: string): any {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function statSafe(file: string) {
  try {
    return statSync(file);
  } catch {
    return null;
  }
}

/** Bounded tail read; returns null when the file is missing or empty. */
export function tailFile(file: string, bytes: number): string | null {
  const stat = statSafe(file);
  if (!stat || !stat.isFile() || stat.size === 0) return null;
  const length = Math.min(bytes, stat.size);
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, stat.size - length);
    const text = buffer.toString("utf8");
    // Drop a leading partial line unless we read the whole file.
    const trimmed = (length < stat.size ? text.slice(text.indexOf("\n") + 1) : text).trim();
    return trimmed || null;
  } finally {
    closeSync(fd);
  }
}

const agentCache: {
  at: number;
  bySession: Map<string, PaseoAgentRef>;
  byAgent: Map<string, PaseoAgentRef>;
} = { at: 0, bySession: new Map(), byAgent: new Map() };

/** pi session UUID -> Paseo agent record, refreshed at most once per 5s. */
export function paseoAgentsBySession() {
  if (Date.now() - agentCache.at < 5000) return agentCache;
  const bySession = new Map<string, PaseoAgentRef>();
  const byAgent = new Map<string, PaseoAgentRef>();
  let slugs: string[] = [];
  try {
    slugs = readdirSync(PASE0_AGENTS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    slugs = [];
  }
  for (const slug of slugs) {
    let files: string[] = [];
    try {
      files = readdirSync(path.join(PASE0_AGENTS, slug)).filter((name) => name.endsWith(".json"));
    } catch {
      continue;
    }
    for (const name of files) {
      const record = readJson(path.join(PASE0_AGENTS, slug, name));
      if (!record?.id) continue;
      const view: PaseoAgentRef = {
        agentId: record.id,
        title: typeof record.title === "string" ? record.title : "",
        status: typeof record.lastStatus === "string" ? record.lastStatus : null,
        model: typeof record.config?.model === "string" ? record.config.model : null,
        cwd: typeof record.cwd === "string" ? record.cwd : null,
        piSessionId: record.persistence?.sessionId ?? null,
      };
      byAgent.set(view.agentId, view);
      if (view.piSessionId) bySession.set(view.piSessionId, view);
    }
  }
  agentCache.at = Date.now();
  agentCache.bySession = bySession;
  agentCache.byAgent = byAgent;
  return agentCache;
}

/** Parent pi session UUID from a run's `sessionId` (an absolute jsonl path). */
export function piSessionIdOf(runStatus: any): string | null {
  const value = typeof runStatus?.sessionId === "string" ? runStatus.sessionId : "";
  const match = /_([0-9a-fA-F-]{36})\.jsonl$/.exec(value) ?? /([0-9a-fA-F-]{36})\.jsonl$/.exec(value);
  return match ? match[1].toLowerCase() : null;
}

function pidAlive(pid: unknown): boolean | null {
  if (typeof pid !== "number" || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

function stepView(step: any, index: number): RunStep {
  const raw = typeof step?.status === "string" ? step.status : "unknown";
  const status = raw === "completed" ? "complete" : raw;
  return {
    index,
    agent: typeof step?.agent === "string" ? step.agent : "unknown",
    status: (STEP_STATUSES.has(status as StepStatus) ? status : "unknown") as StepStatus,
    durationMs: typeof step?.durationMs === "number" ? step.durationMs : null,
    sessionFile: typeof step?.sessionFile === "string" ? step.sessionFile : null,
  };
}

/** Read one run directory into the panel view model, or null when unreadable. */
export function readRun(runDir: string): RunRecord | null {
  const statusFile = path.join(runDir, "status.json");
  const status = readJson(statusFile);
  if (!status?.runId) return null;
  const stat = statSafe(statusFile);
  const startedAt = typeof status.startedAt === "number" ? status.startedAt : (stat?.mtimeMs ?? 0);
  const lastActivityAt = typeof status.lastActivityAt === "number" ? status.lastActivityAt : startedAt;
  const now = Date.now();
  const steps: RunStep[] = Array.isArray(status.steps) ? status.steps.map(stepView) : [];
  const logFiles: string[] = [];
  try {
    for (const name of readdirSync(runDir)) {
      if (/^output-\d+\.log$/.test(name)) logFiles.push(path.join(runDir, name));
    }
  } catch {
    // No logs; events.jsonl still carries activity.
  }
  return {
    runId: String(status.runId),
    shortId: String(status.runId).slice(0, 8),
    mode: typeof status.mode === "string" ? status.mode : "single",
    state: typeof status.state === "string" ? status.state : "unknown",
    pid: typeof status.pid === "number" ? status.pid : null,
    pidAlive: status.state === "running" ? pidAlive(status.pid) : null,
    cwd: typeof status.cwd === "string" ? status.cwd : "",
    startedAt,
    lastActivityAt,
    deadlineAt: typeof status.deadlineAt === "number" ? status.deadlineAt : null,
    elapsedMs: Math.max(0, lastActivityAt - startedAt),
    idleMs: Math.max(0, now - lastActivityAt),
    steps,
    logTail: logFiles.length ? tailFile(logFiles[0], LOG_TAIL_BYTES) : null,
    dir: runDir,
    parentSessionId: piSessionIdOf(status),
    logFiles,
  };
}

function summarizeArgs(value: unknown): string {
  if (value == null) return "";
  let text: string;
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > ARG_SUMMARY_MAX ? `${text.slice(0, ARG_SUMMARY_MAX)}…` : text;
}

/** Bounded scan of a run's events.jsonl: last tool call, last event, tool histogram. */
export function scanEvents(runDir: string): EventScan | null {
  const file = path.join(runDir, "events.jsonl");
  const stat = statSafe(file);
  if (!stat || !stat.isFile() || stat.size === 0) return null;
  const start = Math.max(0, stat.size - EVENT_TAIL_BYTES);
  const length = stat.size - start;
  const fd = openSync(file, "r");
  let text: string;
  try {
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, start);
    text = buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
  const lines = text.split("\n");
  if (start > 0) lines.shift();
  let lastTool: RunToolCall | null = null;
  let lastEventType: string | null = null;
  let lastEventTs: number | null = null;
  const counts = new Map<string, number>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: any;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const type = typeof event.type === "string" ? event.type : null;
    if (type) lastEventType = type;
    if (typeof event.ts === "number") lastEventTs = event.ts;
    if (type === "tool_execution_start" || type === "tool_execution_end") {
      const name = typeof event.toolName === "string" ? event.toolName : null;
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
      if (type === "tool_execution_start") {
        lastTool = {
          name: name ?? "tool",
          argsSummary: summarizeArgs(event.args),
          status: "running",
          ts: typeof event.ts === "number" ? event.ts : null,
        };
      } else if (lastTool && (!name || name === lastTool.name)) {
        lastTool.status = typeof event.error === "string" && event.error ? "failed" : "completed";
        if (typeof event.ts === "number") lastTool.ts = event.ts;
      }
    }
  }
  const toolNames = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
  return { lastTool, lastEventType, lastEventTs, toolNames };
}

/** Resolve a run directory by full id or unambiguous prefix. */
export function findRunDir(runId: string): string | null {
  for (const root of findTempRoots()) {
    const dir = path.join(root, "async-subagent-runs");
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    const match = names.find((name) => name === runId) ?? names.find((name) => name.startsWith(runId));
    if (match) return path.join(dir, match);
  }
  return null;
}

/**
 * List runs across every pi-subagents temp root, live ones first.
 * `options.agentId` scopes the result to one Paseo agent's pi session.
 */
export function listRuns(options: { agentId?: string; limit?: number } = {}) {
  const { agentId, limit = 30 } = options;
  const agents = paseoAgentsBySession();
  const roots = findTempRoots();
  const runs: RunRecord[] = [];
  for (const root of roots) {
    const dir = path.join(root, "async-subagent-runs");
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const run = readRun(path.join(dir, entry.name));
      if (!run) continue;
      const owner = run.parentSessionId ? agents.bySession.get(run.parentSessionId) : undefined;
      run.owner = owner ?? null;
      if (agentId && owner?.agentId !== agentId) continue;
      runs.push(run);
    }
  }
  const rank = (run: RunRecord) => (run.state === "running" && run.pidAlive !== false ? 0 : 1);
  runs.sort((a, b) => rank(a) - rank(b) || b.lastActivityAt - a.lastActivityAt);
  return { roots, runs: runs.slice(0, limit), agents };
}

/** View-model shaping shared by the RPC handlers. */
export function toRunView(run: RunRecord) {
  return {
    runId: run.runId,
    shortId: run.shortId,
    mode: run.mode,
    state: run.state,
    pidAlive: run.pidAlive,
    pid: run.pid,
    cwd: run.cwd,
    startedAt: run.startedAt,
    lastActivityAt: run.lastActivityAt,
    deadlineAt: run.deadlineAt,
    elapsedMs: run.elapsedMs,
    idleMs: run.idleMs,
    steps: run.steps,
    logTail: run.logTail,
  };
}
