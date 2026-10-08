import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * pi-subagents observability contract.
 *
 * Everything in here is read-only: the daemon handlers scan pi-subagents run
 * artifacts and Paseo agent records, they never touch, steer, or stop a run.
 */

const stepSchema = z.object({
  index: z.number().int().nonnegative(),
  agent: z.string(),
  status: z.enum(["pending", "running", "complete", "completed", "failed", "stopped", "unknown"]),
  durationMs: z.number().nonnegative().nullable(),
  sessionFile: z.string().nullable(),
});

const runSchema = z.object({
  runId: z.string(),
  shortId: z.string(),
  mode: z.string(),
  state: z.string(),
  /** False when status.json still says running but the runner pid is gone. */
  pidAlive: z.boolean().nullable(),
  pid: z.number().int().nullable(),
  cwd: z.string(),
  startedAt: z.number(),
  lastActivityAt: z.number(),
  deadlineAt: z.number().nullable(),
  elapsedMs: z.number(),
  idleMs: z.number(),
  steps: z.array(stepSchema),
  /** Fallback activity text from output-<n>.log when events.jsonl is unreadable. */
  logTail: z.string().nullable(),
});

const targetSchema = z.object({
  /** Paseo agent owning these runs, resolved through the pi session id. */
  agentId: z.string(),
  title: z.string(),
  status: z.string().nullable(),
  model: z.string().nullable(),
  cwd: z.string().nullable(),
  piSessionId: z.string().nullable(),
});

export const runsList = defineRpc({
  name: "subagent-viewer.runs-list",
  input: z.object({
    /** Paseo workspace id; kept for cache keying in the panel. */
    workspaceId: z.string().optional(),
    /** Default scope: only runs whose cwd or owner cwd sits under this directory. */
    workspaceDirectory: z.string().optional(),
    /**
     * Project root of the current workspace. A worktree workspace's directory is
     * one checkout, so matching its project root too keeps the main checkout and
     * nested pool/.worktrees lanes visible without leaking other projects.
     */
    projectRootPath: z.string().optional(),
    /** Restrict the result to one Paseo agent (its pi session and nothing else). */
    agentId: z.string().optional(),
    /** Ignore workspaceDirectory and return runs from every agent on this machine. */
    allWorkspaces: z.boolean().optional(),
    limit: z.number().int().min(1).max(60).optional(),
  }),
  output: z.object({
    /** True when a live process wrote any known run directory recently. */
    scanning: z.boolean(),
    tempRoots: z.array(z.string()),
    targets: z.array(targetSchema),
    runs: z.array(runSchema),
  }),
});

export const runDetail = defineRpc({
  name: "subagent-viewer.run-detail",
  input: z.object({
    runId: z.string().min(1),
    agentId: z.string().optional(),
  }),
  output: z.object({
    run: runSchema.nullable(),
    /** Most recent tool call seen in the run's events.jsonl. */
    lastTool: z
      .object({
        name: z.string(),
        argsSummary: z.string(),
        status: z.string().nullable(),
        ts: z.number().nullable(),
      })
      .nullable(),
    /** Last structured event type, e.g. tool_execution_end. */
    lastEventType: z.string().nullable(),
    lastEventTs: z.number().nullable(),
    toolNames: z.array(z.object({ name: z.string(), count: z.number().int() })),
    /** Bounded tail of the per-step output log. */
    outputTail: z.string().nullable(),
    /** Workflow-only: current step index among live steps. */
    activeStep: z.number().int().nullable(),
  }),
});

export type RunsListInput = z.input<typeof runsList.input>;
export type RunsListOutput = z.output<typeof runsList.output>;
export type RunDetailInput = z.input<typeof runDetail.input>;
export type RunDetailOutput = z.output<typeof runDetail.output>;
export type SubagentRunView = RunDetailOutput["run"];
