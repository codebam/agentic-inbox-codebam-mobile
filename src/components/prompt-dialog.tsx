import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export interface PromptField {
  key: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  autoFocus?: boolean;
  /** Initial value, applied when the dialog opens. */
  initial?: string;
}

/**
 * A small form dialog: labelled text inputs plus Cancel/Save. Like
 * ConfirmDialog, this exists because `Alert.prompt` does not exist on
 * react-native-web; a Modal plus TextInputs works everywhere.
 *
 * The form below is mounted only while the dialog is visible, so each open
 * starts fresh from the fields' initials and a cancelled edit leaves no
 * residue — no effect needed to reset state.
 */
export function PromptDialog({
  visible,
  title,
  fields,
  confirmLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  title: string;
  fields: PromptField[];
  confirmLabel: string;
  busy?: boolean;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        {visible ? (
          <PromptForm
            title={title}
            fields={fields}
            confirmLabel={confirmLabel}
            busy={busy}
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
        ) : null}
      </View>
    </Modal>
  );
}

function PromptForm({
  title,
  fields,
  confirmLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  title: string;
  fields: PromptField[];
  confirmLabel: string;
  busy?: boolean;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of fields) initial[field.key] = field.initial ?? "";
    return initial;
  });

  return (
    <View style={[styles.card, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <ScrollView style={styles.fields} keyboardShouldPersistTaps="handled">
        {fields.map((field) => (
          <View key={field.key} style={styles.field}>
            <ThemedText type="small" themeColor="textSecondary">
              {field.label}
            </ThemedText>
            <View style={[styles.inputBox, { backgroundColor: theme.backgroundElement }]}>
              <TextInput
                value={values[field.key] ?? ""}
                onChangeText={(text) =>
                  setValues((current) => ({ ...current, [field.key]: text }))
                }
                placeholder={field.placeholder}
                placeholderTextColor={theme.textSecondary}
                multiline={field.multiline}
                autoFocus={field.autoFocus}
                autoCapitalize="none"
                autoCorrect={false}
                textAlignVertical={field.multiline ? "top" : "center"}
                style={[styles.input, field.multiline && styles.multiline, { color: theme.text }]}
              />
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={styles.buttons}>
        <Pressable
          onPress={onCancel}
          disabled={busy}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.backgroundElement, opacity: pressed || busy ? 0.6 : 1 },
          ]}>
          <ThemedText type="smallBold">Cancel</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => onSubmit(values)}
          disabled={busy}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.tint, opacity: pressed || busy ? 0.6 : 1 },
          ]}>
          <ThemedText type="smallBold" style={styles.confirmLabel}>
            {busy ? "Working…" : confirmLabel}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.four,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
    maxHeight: "85%",
  },
  fields: {
    flexGrow: 0,
  },
  field: {
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  inputBox: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
  },
  input: {
    fontSize: 15,
    paddingVertical: 10,
  },
  multiline: {
    minHeight: 120,
    maxHeight: 240,
  },
  buttons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  button: {
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    minWidth: 88,
    alignItems: "center",
  },
  confirmLabel: {
    color: "#ffffff",
  },
});
