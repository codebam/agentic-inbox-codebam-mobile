import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";

const TONES = {
  error: { background: "rgba(229, 72, 77, 0.14)", text: "#E5484D" },
  success: { background: "rgba(47, 158, 68, 0.16)", text: "#3FA34D" },
  info: { background: "rgba(60, 135, 247, 0.14)", text: "#4D9AFB" },
} as const;

export function Banner({ message, tone = "error" }: { message: string; tone?: keyof typeof TONES }) {
  const palette = TONES[tone];
  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ThemedText type="small" style={{ color: palette.text }}>
        {message}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});
