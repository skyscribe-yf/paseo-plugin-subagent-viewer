import type { PluginServerContext } from "@getpaseo/plugin/server";
import { registerRunRpcs } from "./server/runs";

export default function contribute(server: PluginServerContext) {
  registerRunRpcs(server);
  return () => {};
}
