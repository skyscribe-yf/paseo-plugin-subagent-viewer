import type { PluginClientContext } from "@getpaseo/plugin/client";
import { RunPanel } from "./client/run-panel";
import { SubagentCard, createSubagentTransformer, subagentCardSchema } from "./client/timeline-card";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "runs",
    title: "Subagents",
    icon: "GitBranch",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: RunPanel,
  });
  client.addCommandCenterItem({
    id: "open-runs",
    title: "Open pi-subagents runs",
    icon: "GitBranch",
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("runs");
    },
  });

  // Replace the parent agent's `subagent` tool call with a live fleet card.
  client.addTimelineTransformer(createSubagentTransformer());
  client.addTimelineRenderer({
    kind: "subagent-card",
    version: 1,
    schema: subagentCardSchema,
    Component: SubagentCard,
  });

  return () => {};
}
