import { Modal, Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export interface SheetAction {
  label: string;
  destructive?: boolean;
  onPress: () => void;
}

/**
 * A small bottom sheet of actions. Like ConfirmDialog, this exists because
 * `Alert` and native action sheets do not behave identically across the
 * phone and the web preview; a Modal plus Pressables does.
 */
export function ActionSheet({
  visible,
  title,
  actions,
  onCancel,
}: {
  visible: boolean;
  title?: string;
  actions: SheetAction[];
  onCancel: () => void;
}) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <View style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border }]}>
          {title ? (
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.title}>
              {title}
            </ThemedText>
          ) : null}
          {actions.map((action) => (
            <Pressable
              key={action.label}
              accessibilityRole="button"
              onPress={action.onPress}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? theme.backgroundSelected : "transparent" },
              ]}>
              <ThemedText type="small" style={action.destructive ? { color: theme.danger } : undefined}>
                {action.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  title: {
    paddingBottom: Spacing.one,
  },
  row: {
    borderRadius: 10,
    paddingHorizontal: Spacing.two,
    paddingVertical: 12,
  },
});
