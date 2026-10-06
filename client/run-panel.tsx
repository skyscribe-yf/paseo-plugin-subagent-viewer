import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { runDetail, runsList } from "../shared/runs";
import { usePanelStyles } from "./styles";

/** pi-subagents writes while running; poll faster then, slower when idle. */
const LIVE_POLL_MS = 1500;
const IDLE_POLL_MS = 15_000;

const STATE_COLOR_KEYS = {
  running: "statusWarning",
  complete: "statusSuccess",
  failed: "statusDanger",
  stopped: "foregroundMuted",
} as const;

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}

export function RunPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const list = useRpc(runsList);
  const detail = useRpc(runDetail);
  const workspaceDirectory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [allWorkspaces, setAllWorkspaces] = useState(false);
  const styles = usePanelStyles(theme, layout.compact);

  const runs = useQuery({
    queryKey: ["subagent-viewer", "runs", workspaceId, selectedAgent, allWorkspaces, workspaceDirectory],
    queryFn: () =>
      list({
        workspaceId,
        workspaceDirectory: workspaceDirectory ?? undefined,
        agentId: selectedAgent ?? undefined,
        allWorkspaces: allWorkspaces || undefined,
        limit: 40,
      }),
    refetchInterval: (query) =>
      query.state.data?.runs.some((run) => run.state === "running") ? LIVE_POLL_MS : IDLE_POLL_MS,
    refetchIntervalInBackground: true,
  });

  const data = runs.data;
  const activeRun = expanded ?? data?.runs.find((run) => run.state === "running")?.runId ?? null;

  const detailQuery = useQuery({
    queryKey: ["subagent-viewer", "detail", activeRun],
    queryFn: () => detail({ runId: activeRun as string }),
    enabled: Boolean(activeRun),
    refetchInterval: LIVE_POLL_MS,
  });

  const runningCount = data?.runs.filter((run) => run.state === "running").length ?? 0;

  return (
    <View style={styles.screen}>
      <View style={[styles.body, { flexDirection: layout.compact ? "column" : "row" }]}>
        <View style={styles.column}>
          <ScrollView contentContainerStyle={styles.columnPad}>
            <Text style={styles.title}>
              {data ? `${data.runs.length} 个 pi-subagents run` : "正在读取 pi-subagents 运行目录…"}
            </Text>
            {data ? (
              <Text style={styles.meta}>
                {runningCount > 0 ? `${runningCount} 个运行中` : "当前没有运行中的 run"} · 数据目录{" "}
                {data.tempRoots.join(", ") || "（未找到）"}
              </Text>
            ) : null}

            {data && data.targets.length > 1 ? (
              <View style={styles.rowMeta}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Show runs of every pi agent in this workspace"
                  onPress={() => setSelectedAgent(null)}
                  style={[styles.chip, selectedAgent === null && styles.chipActive]}
                >
                  <Text style={styles.chipText}>全部</Text>
                </Pressable>
                {data.targets.map((target) => (
                  <Pressable
                    key={target.agentId}
                    accessibilityRole="button"
                    accessibilityLabel={`Show runs of ${target.title || target.agentId}`}
                    onPress={() => setSelectedAgent(target.agentId)}
                    style={[styles.chip, selectedAgent === target.agentId && styles.chipActive]}
                  >
                    <Text style={styles.chipText}>{(target.title || target.agentId).slice(0, 24)}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {data ? (
              <View style={styles.rowMeta}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Show every workspace on this machine"
                  onPress={() => setAllWorkspaces((value) => !value)}
                  style={[styles.chip, allWorkspaces && styles.chipActive]}
                >
                  <Text style={styles.chipText}>{allWorkspaces ? "全部机器" : "仅此 workspace"}</Text>
                </Pressable>
              </View>
            ) : null}

            {runs.isError ? <Text style={styles.empty}>读取失败：{String(runs.error)}</Text> : null}
            {data && data.runs.length === 0 && !runs.isError ? (
              <Text style={styles.empty}>
                {allWorkspaces
                  ? "这台机器上没有 pi-subagents 运行记录。"
                  : "这个 workspace 下没有 pi-subagents 运行记录（可用上方按钮查看整机）。"}
              </Text>
            ) : null}

            {data?.runs.map((run) => {
              const stalled = run.state === "running" && run.pidAlive === false;
              const stateKey = (STATE_COLOR_KEYS as Record<string, keyof typeof theme.colors>)[run.state];
              const stateColor = theme.colors[stalled ? "statusDanger" : (stateKey ?? "foregroundMuted")];
              const runningStep = run.steps.find((step) => step.status === "running");
              const agents = [...new Set(run.steps.map((step) => step.agent))].join(", ");
              const live = run.state === "running";
              return (
                <Pressable
                  key={run.runId}
                  accessibilityRole="button"
                  accessibilityLabel={`${live ? "Running " : ""}${run.mode} run ${run.shortId}, ${run.state}`}
                  onPress={() => setExpanded(activeRun === run.runId ? null : run.runId)}
                  style={[styles.row, activeRun === run.runId && styles.rowSelected]}
                >
                  <View style={styles.rowHeader}>
                    <Text style={styles.title}>
                      {live ? "● " : ""}
                      {run.mode} {run.shortId}
                    </Text>
                    <Text style={[styles.meta, { color: stateColor }]}>{stalled ? "stalled" : run.state}</Text>
                  </View>
                  <Text style={styles.meta} numberOfLines={1}>
                    {agents || "—"}
                  </Text>
                  <View style={styles.rowMeta}>
                    <Text style={styles.meta}>已跑 {formatDuration(run.elapsedMs)}</Text>
                    <Text style={styles.meta}>静默 {formatDuration(run.idleMs)}</Text>
                    {run.steps.length > 1 ? (
                      <Text style={styles.meta}>
                        步骤 {run.steps.filter((step) => step.status === "complete").length}/{run.steps.length}
                        {runningStep ? ` · 当前 #${runningStep.index}` : ""}
                      </Text>
                    ) : null}
                    {run.pid ? <Text style={styles.meta}>pid {run.pid}</Text> : null}
                  </View>
                  {run.logTail ? (
                    <Text style={styles.monospace} numberOfLines={2}>
                      {run.logTail}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.column}>
          <ScrollView contentContainerStyle={styles.detailSection}>
            {detailQuery.data?.run ? (
              <>
                <Text style={styles.title}>
                  {detailQuery.data.run.shortId} · {detailQuery.data.run.mode} · {detailQuery.data.run.state}
                </Text>
                <Text style={styles.meta}>{detailQuery.data.run.cwd}</Text>
                {detailQuery.data.run.deadlineAt ? (
                  <Text style={styles.meta}>
                    剩余 {formatDuration(Math.max(0, (detailQuery.data.run.deadlineAt ?? 0) - Date.now()))} 到 run 超时
                  </Text>
                ) : null}

                <Text style={styles.title}>步骤</Text>
                {detailQuery.data.run.steps.map((step) => (
                  <Text key={step.index} style={styles.meta}>
                    #{step.index} {step.agent} — {step.status}
                    {step.durationMs ? ` · ${formatDuration(step.durationMs)}` : ""}
                  </Text>
                ))}

                <Text style={styles.title}>最近活动</Text>
                {detailQuery.data.lastTool ? (
                  <Text style={styles.pre}>
                    {detailQuery.data.lastTool.status === "running" ? "▶ " : "✔ "}
                    {detailQuery.data.lastTool.name}
                    {"\n"}
                    {detailQuery.data.lastTool.argsSummary}
                  </Text>
                ) : (
                  <Text style={styles.meta}>events.jsonl 里还没有工具调用。</Text>
                )}
                {detailQuery.data.toolNames.length ? (
                  <Text style={styles.meta}>
                    工具分布：
                    {detailQuery.data.toolNames.map((entry) => `${entry.name}×${entry.count}`).join("  ")}
                  </Text>
                ) : null}

                {detailQuery.data.outputTail ? (
                  <>
                    <Text style={styles.title}>输出尾部</Text>
                    <Text style={styles.pre}>{detailQuery.data.outputTail}</Text>
                  </>
                ) : null}
              </>
            ) : (
              <Text style={styles.empty}>
                {activeRun ? "读取该 run 的明细…" : "选中左侧一个 run 查看当前工具、步骤与输出尾部。"}
              </Text>
            )}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}
