// Contract check: run the real handlers and validate their output against the
// published zod schemas. Paseo validates RPC output on both sides, so a mismatch
// here is a client-side load error even when the daemon reports "ready".
//
//   npm run check:rpc

import { runDetail, runsList } from "../shared/runs.ts";
import { detailHandler, inWorkspace, listHandler } from "../server/runs.ts";

let failures = 0;

function check(label: string, fn: () => unknown) {
  try {
    const value = fn();
    console.log(`ok   ${label}`);
    return value;
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${label}\n     ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// listHandler returns the shape the RPC declares; validate it exactly as Paseo would.
const listRaw = check("runsList handler runs", () => listHandler({ allWorkspaces: true, limit: 5 }));
check("runsList output matches its zod schema", () => runsList.output.parse(listRaw));

const runs = (listRaw as { runs?: { runId: string }[] } | null)?.runs ?? [];
if (runs.length > 0) {
  const detailRaw = check("runDetail handler runs", () => detailHandler({ runId: runs[0].runId }));
  check("runDetail output matches its zod schema", () => runDetail.output.parse(detailRaw));
  const detail = detailRaw as { run?: unknown; outputTail?: string | null } | null;
  check("runDetail returned the requested run", () => {
    if (!detail?.run) throw new Error("run was null for a run id that just listed");
    return true;
  });
} else {
  console.log("skip no runs on disk to validate detail against");
}

// The client also re-parses list input; make sure the panel's actual call is valid.
check("panel list input is valid", () =>
  runsList.input.parse({
    workspaceId: "wks_test",
    workspaceDirectory: "/home/nobody/project",
    projectRootPath: "/home/nobody/project",
    agentId: undefined,
    allWorkspaces: undefined,
    limit: 40,
  }),
);
check("timeline card list input is valid", () => runsList.input.parse({ agentId: "agent-1", limit: 40 }));

// Scope widening: a worktree workspace nests its lanes under the project root
// (pool slots, .worktrees), so the project-root scope must match them while
// still rejecting other projects.
check("project-root scope matches nested lanes and rejects other projects", () => {
  if (!inWorkspace("/repo", "/repo")) throw new Error("workspace root not matched");
  if (!inWorkspace("/repo/.git/wt-pool/pool/lane-c", "/repo"))
    throw new Error("nested pool lane not matched");
  if (!inWorkspace("/repo/.worktrees/fix/lane", "/repo"))
    throw new Error("nested worktree not matched");
  if (inWorkspace("/other/repo", "/repo")) throw new Error("other project matched");
  if (inWorkspace("/repo-sibling", "/repo")) throw new Error("prefix sibling matched");
  return true;
});

console.log(failures === 0 ? "\nOK — RPC contract holds." : `\n${failures} contract check(s) failed.`);
if (failures > 0) process.exitCode = 1;
