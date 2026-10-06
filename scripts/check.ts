// Runnable self-check for the discovery/join logic: `npm run check`.
// Read-only; prints what the panel would show for the current machine.

import { findRunDir, listRuns, readRun, scanEvents } from "../server/discover.ts";

const listed = listRuns({ limit: 60 });
const live = listed.runs.filter((run) => run.state === "running");
console.log(`temp roots: ${listed.roots.join(", ") || "(none)"}`);
console.log(`paseo agents with a pi session: ${listed.agents.bySession.size}`);
console.log(`runs: ${listed.runs.length} (live ${live.length})`);
for (const run of listed.runs.slice(0, 8)) {
  const scan = scanEvents(run.dir);
  console.log(
    [
      run.state === "running" ? "LIVE" : "    ",
      run.shortId,
      run.mode.padEnd(8),
      `${Math.round(run.elapsedMs / 60000)}m`.padEnd(5),
      `idle ${Math.round(run.idleMs / 1000)}s`.padEnd(10),
      run.owner ? `${run.owner.agentId.slice(0, 8)} ${run.owner.title.slice(0, 18)}` : "(no paseo owner)",
      scan?.lastTool ? `| ${scan.lastTool.name} ${scan.lastTool.argsSummary.slice(0, 40)}` : "",
    ].join(" "),
  );
}

// Invariants that must hold for any machine with at least one run on disk.
if (listed.runs.length > 0) {
  const first = listed.runs[0];
  if (!findRunDir(first.shortId)) throw new Error(`findRunDir missed prefix ${first.shortId}`);
  if (!readRun(first.dir)) throw new Error(`readRun failed for ${first.dir}`);
  if (listed.runs.some((run) => run.state === "running" && run.pidAlive === null)) {
    throw new Error("running run without a pid probe result");
  }
  console.log("\nOK — discovery, prefix lookup, and event scan agree.");
} else {
  console.log("\nOK — no runs on disk to check against.");
}
