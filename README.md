# paseo-plugin-subagent-viewer

A read-only [Paseo](https://paseo.sh) plugin that makes **pi-subagents** runs visible:
live child agents, their current tool call, step progress, and output tail — without leaving Paseo.

## The problem

`pi-subagents` children run inside the parent Pi process (or inside a detached runner process).
They are neither Paseo agents nor Paseo terminals, so Paseo only ever shows the parent agent —
the children are an observability blind spot.

Every run, however, leaves its state on disk:

| Data | Location |
|------|----------|
| Run status | `<tempRoot>/async-subagent-runs/<runId>/status.json` — state, steps, pid, deadline, budget |
| Live log | same directory, `output-<n>.log` (written continuously while running) |
| Structured events | same directory, `events.jsonl` — `tool_execution_start` carries full tool args |
| Child sessions | `steps[].sessionFile` → `~/.pi/agent/sessions/<slug>/<ts>_<uuid>.jsonl` |

`<tempRoot>` is `$PI_SUBAGENTS_TEMP_ROOT`, otherwise `/tmp/pi-subagents-<uid|user|home>-<scope>`.

**The join key** is the pi session UUID embedded in `status.json.sessionId` (an absolute session
jsonl path). It matches `persistence.sessionId` in `~/.paseo/agents/<slug>/<agentId>.json`, which
is what ties a run back to the Paseo agent that owns it.

## What it contributes

- **`Subagents` workspace panel** — scoped to the current workspace by default (runs whose cwd, or
  whose owner agent's cwd, is inside the workspace directory), with a one-click switch to every
  agent on the machine. Live rows poll every 1.5s and show agent, state, elapsed/idle time, step
  progress and pid; selecting a run shows its current tool call, tool histogram and output tail.
- **Inline timeline card** — pi's `subagent` and `subagent_supervisor` tool calls in the parent
  agent's timeline are replaced by a live fleet card (2s poll while something is running), so you
  can watch children without switching panels.
- **Command Center item** — `Open pi-subagents runs` opens the panel.

## Read-only guarantee

Every filesystem access is a `stat`, a `read`, or a bounded tail: locate run directories, read
`status.json`, tail `events.jsonl` (96 KiB) and `output-*.log` (2 KiB in rows, 16 KiB in detail).
The plugin never launches, steers, or stops a run, and never writes a file.

Process liveness is probed with `process.kill(pid, 0)` (a signal-0 existence check). A run whose
`status.json` still says `running` but whose pid is gone is reported as `stalled` instead of live —
that is how a crashed or orphaned runner becomes visible instead of silently hanging forever.

## Install

Requires Paseo `>=0.10.3` with plugins enabled and `pi-subagents` installed for Pi.

```bash
git clone https://github.com/skyscribe-yf/paseo-plugin-subagent-viewer.git
cd paseo-plugin-subagent-viewer
npm install

paseo plugin install "$PWD"
paseo plugin ls        # expect: running
```

After editing the source:

```bash
npm run typecheck
paseo plugin reload subagent-viewer
paseo plugin logs subagent-viewer
```

## Commands

```bash
npm run typecheck   # tsc --noEmit
npm run check       # standalone read-only self-check: discovery + join + event scan
```

`npm run check` prints the runs it finds and asserts that prefix lookup, directory reading and the
event scan agree, so the discovery logic can be validated without a running Paseo.

## How it is built

```
paseo-plugin.json     manifest (plugin id: subagent-viewer)
shared/runs.ts        Zod RPC contracts shared by both runtimes
server/discover.ts    read-only discovery, join, pid probe, bounded tail helpers
server/runs.ts        RPC handlers + workspace scoping + startup probe log
client/run-panel.tsx  workspace panel
client/timeline-card.tsx  timeline transformer + renderer
client/styles.ts      theme-driven styles
scripts/check.ts      standalone self-check
```

RPCs: `subagent-viewer.runs-list` and `subagent-viewer.run-detail`.

### Plugin authoring notes

Two things cost real debugging time and are worth knowing before you fork this:

- **Do not ship runtime-only modules as `.mjs` inside `server/`.** Paseo's esbuild runtime-boundary
  check resolves `.mjs` imports but then fails with a completely unhelpful
  `Cannot read properties of undefined (reading 'endsWith')` when the plugin is loaded. Plain
  `.ts` modules with explicit types in `server/` work fine. This is why `discover.ts` is typed
  TypeScript rather than the annotated JavaScript it started as.
- **`locations` defaults to `["workspace"]`**, even though the plugin reference lists
  `["workspace","explorer"]` alongside it. Pass both explicitly if you want the panel in the
  Explorer too.

## Known limits

- Observation only — no control. Steer or stop runs through Pi itself
  (`subagent({action: "steer" | "interrupt"})`, or `subagent_supervisor`).
- Only temp-root run directories are scanned. If you set `artifactDir: "project"` so runs land in
  `<cwd>/.pi/subagents/artifacts/`, this plugin will not find them.
- Paseo has a native provider-subagent track (`agent.provider_subagents.*`) with `parentAgentId`,
  `toolCallId` and `subtitle`. The Pi provider in 0.10.3 does not report into it (no
  `providerSubagent` references in its implementation), and a plugin cannot report on behalf of
  another provider — so a truly native subagent tab requires an upstream Paseo change. Until then,
  this plugin reads the run artifacts directly.

## License

MIT — see [LICENSE](LICENSE).
