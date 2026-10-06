import { useRpc } from "@getpaseo/plugin/client";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { z } from "zod";
import { runsList } from "../shared/runs";
import { usePanelStyles } from "./styles";

/** Live rows shown inside the card before collapsing into a summary line. */
const MAX_ROWS = 4;
const POLL_MS = 2000;

/** Identity of the parent agent's subagent call; the live data is fetched by the card. */
export const subagentCardSchema = z.object({
  callId: z.string(),
  phase: z.enum(["streaming", "complete"]),
  /** True for `subagent_supervisor`, which observes rather than launches. */
  isSupervisor: z.boolean(),
});

export type SubagentCardData = z.output<typeof subagentCardSchema>;

/** pi's own tool name is `subagent`; the supervisor variant is read-only messaging. */
const PI_SUBAGENT_TOOLS = new Set(["subagent", "subagent_supervisor"]);

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}

export function SubagentCard({ agentId, item, theme, layout }: PluginTimelineItemProps<SubagentCardData>) {
  const list = useRpc(runsList);
  const styles = usePanelStyles(theme, layout.compact);

  const runs = useQuery({
    queryKey: ["subagent-viewer", "timeline", agentId],
    queryFn: () => list({ agentId, limit: 40 }),
    refetchInterval: (query) =>
      query.state.data?.runs.some((run) => run.state === "running") ? POLL_MS : 30_000,
    refetchIntervalInBackground: true,
  });

  const data = runs.data;
  const live = data?.runs.filter((run) => run.state === "running") ?? [];
  const shown = live.length > 0 ? live : (data?.runs.slice(0, 1) ?? []);

  const summary = useMemo(() => {
    if (!data) return "读取 subagent 状态…";
    if (data.runs.length === 0) return "这个 agent 没有 pi-subagents 运行记录";
    const parts = [`${live.length} 个运行中`];
    if (data.runs.length !== live.length) parts.push(`共 ${data.runs.length} 个 run`);
    const stalled = live.filter((run) => run.pidAlive === false).length;
    if (stalled > 0) parts.push(`${stalled} 个进程已消失`);
    return parts.join(" · ");
  }, [data, live]);

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.title}>
          {item.data.isSupervisor ? "子 agent 监督" : "子 agent 舰队"}
          {live.length > 0 ? ` · ${live.length} 运行中` : ""}
        </Text>
        {item.data.phase === "streaming" ? <Text style={styles.meta}>调用中…</Text> : null}
      </View>
      <Text style={styles.meta}>{summary}</Text>

      {shown.slice(0, MAX_ROWS).map((run) => {
        const runningStep = run.steps.find((step) => step.status === "running");
        const agents = [...new Set(run.steps.map((step) => step.agent))].join(", ");
        const stalled = run.state === "running" && run.pidAlive === false;
        return (
          <Text
            key={run.runId}
            style={[styles.monospace, stalled ? { color: theme.colors.statusDanger } : null]}
            numberOfLines={1}
          >
            {run.state === "running" ? "● " : "○ "}
            {run.mode}/{run.shortId} · {agents || "—"} · 已跑 {formatDuration(run.elapsedMs)} · 静默{" "}
            {formatDuration(run.idleMs)}
            {run.steps.length > 1 && runningStep ? ` · 步骤 #${runningStep.index}` : ""}
            {stalled ? " · 进程已消失" : ""}
          </Text>
        );
      })}

      {shown.length > MAX_ROWS ? (
        <Text style={styles.meta}>还有 {shown.length - MAX_ROWS} 个，见 workspace 的 Subagents 面板</Text>
      ) : null}
    </View>
  );
}

/**
 * Claim only pi's `subagent` tool call, so the built-in row is replaced by a live
 * card. Everything else returns `undefined` and keeps Paseo's native rendering.
 */
export function createSubagentTransformer() {
  return {
    id: "subagent-card",
    query: { itemType: "tool_call" as const },
    transform({ item, phase }: { item: any; phase: "streaming" | "complete" }) {
      const name = typeof item?.name === "string" ? item.name : "";
      if (!PI_SUBAGENT_TOOLS.has(name)) return undefined;
      return {
        items: [
          {
            type: "plugin" as const,
            kind: "subagent-card",
            version: 1,
            id: String(item.callId ?? name),
            data: {
              callId: String(item.callId ?? ""),
              phase,
              isSupervisor: name === "subagent_supervisor",
            },
          },
        ],
      };
    },
  };
}
