import type { PluginServerContext } from "@getpaseo/plugin/server";
import { type RunDetailInput, type RunsListInput, runDetail, runsList } from "../shared/runs.ts";
import { findRunDir, listRuns, readRun, scanEvents, tailFile, toRunView } from "./discover.ts";

const OUTPUT_DETAIL_BYTES = 16 * 1024;

const EMPTY_DETAIL = {
  run: null,
  lastTool: null,
  lastEventType: null,
  lastEventTs: null,
  toolNames: [] as { name: string; count: number }[],
  outputTail: null,
  activeStep: null,
};

/** Runs count as "in this workspace" when their own cwd or their owner agent's cwd is inside it. */
export function inWorkspace(cwd: string, directory: string): boolean {
  const normalized = directory.endsWith("/") ? directory : `${directory}/`;
  return cwd === directory || cwd.startsWith(normalized);
}

export function listHandler({
  agentId,
  workspaceDirectory,
  projectRootPath,
  allWorkspaces,
  limit,
}: RunsListInput) {
  // Fetch generous, then scope: the panel shows live runs first, so a small cap
  // would hide exactly the runs the operator wants to watch.
  const listed = listRuns({ agentId, limit: agentId ? limit : 60 });
  // Worktree workspaces nest their lanes (pool slots, .worktrees) under the
  // project root rather than the workspace directory, and pi-subagents children
  // have no Paseo owner to fall back on — matching the project root keeps the
  // whole family visible to the workspace that launched it.
  const scopes = [workspaceDirectory, projectRootPath].filter(
    (directory): directory is string => Boolean(directory),
  );
  const scoped =
    !allWorkspaces && scopes.length > 0
      ? listed.runs.filter((run) =>
          scopes.some(
            (directory) =>
              inWorkspace(run.cwd, directory) ||
              (run.owner?.cwd ? inWorkspace(run.owner.cwd, directory) : false),
          ),
        )
      : listed.runs;

  const targets = new Map<
    string,
    {
      agentId: string;
      title: string;
      status: string | null;
      model: string | null;
      cwd: string | null;
      piSessionId: string | null;
    }
  >();
  for (const run of scoped) {
    const owner = run.owner;
    if (!owner) continue;
    targets.set(owner.agentId, {
      agentId: owner.agentId,
      title: owner.title,
      status: owner.status,
      model: owner.model,
      cwd: owner.cwd,
      piSessionId: owner.piSessionId,
    });
  }
  return {
    scanning: scoped.some((run) => run.state === "running"),
    tempRoots: listed.roots,
    targets: [...targets.values()],
    runs: scoped.slice(0, limit ?? 60).map((run) => toRunView(run)),
  };
}

export function detailHandler({ runId }: RunDetailInput) {
  const dir = findRunDir(runId);
  if (!dir) return EMPTY_DETAIL;
  const run = readRun(dir);
  if (!run) return EMPTY_DETAIL;
  const scan = scanEvents(dir);
  const runningStep = run.steps.find((step) => step.status === "running");
  const outputTail = run.logFiles.length
    ? tailFile(run.logFiles[run.logFiles.length - 1], OUTPUT_DETAIL_BYTES)
    : null;
  return {
    run: toRunView(run),
    lastTool: scan?.lastTool ?? null,
    lastEventType: scan?.lastEventType ?? null,
    lastEventTs: scan?.lastEventTs ?? null,
    toolNames: scan?.toolNames ?? [],
    outputTail,
    activeStep: runningStep ? runningStep.index : null,
  };
}

export function registerRunRpcs(server: PluginServerContext) {
  server.handle(runsList, listHandler);
  server.handle(runDetail, detailHandler);

  // One startup line: proves the daemon bundle reads the run directories, and
  // gives `paseo plugin logs subagent-viewer` something actionable.
  try {
    const probe = listRuns({ limit: 200 });
    const live = probe.runs.filter((run) => run.state === "running").length;
    console.log(
      `[subagent-viewer] roots=${probe.roots.length} runs=${probe.runs.length} live=${live} owners=${probe.agents.bySession.size}`,
    );
  } catch (error) {
    console.error("[subagent-viewer] discovery probe failed:", error);
  }
}
