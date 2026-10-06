import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Platform, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

type Theme = PluginWorkspacePanelProps["theme"];
type Styles = Record<string, StyleProp<ViewStyle | TextStyle>>;
type MonoStyles = Record<string, StyleProp<TextStyle>>;

const monospace = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

/** Theme-driven styles for the runs panel; keeps every color on `theme.colors`. */
export function usePanelStyles(theme: Theme, compact: boolean): Styles & MonoStyles {
  return useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      body: { flex: 1 },
      column: {
        flex: 1,
        maxWidth: compact ? undefined : 560,
        borderRightWidth: compact ? 0 : 1,
        borderBottomWidth: compact ? 1 : 0,
        borderColor: theme.colors.border,
      },
      columnPad: { padding: compact ? 12 : 16, gap: 10 },
      title: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" },
      meta: { color: theme.colors.foregroundMuted, fontSize: 12 },
      chip: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      chipActive: { borderColor: theme.colors.accent, backgroundColor: theme.colors.surface2 },
      chipText: { color: theme.colors.foreground, fontSize: 12 },
      row: {
        padding: 10,
        gap: 4,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      rowSelected: { borderColor: theme.colors.accent, backgroundColor: theme.colors.surface2 },
      rowHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
      rowMeta: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
      empty: { color: theme.colors.foregroundMuted, fontSize: 13, padding: 12 },
      detailSection: { padding: compact ? 12 : 16, gap: 10 },
      monospace: { color: theme.colors.foregroundMuted, fontFamily: monospace, fontSize: 11 },
      pre: { color: theme.colors.foreground, fontFamily: monospace, fontSize: 11 },
      stack: { gap: 10 },
    }),
    [theme, compact],
  );
}
