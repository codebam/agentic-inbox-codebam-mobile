import { describe, expect, it } from "vitest";

import { canOfferUnsubscribe, moveTargets, sendLaterPresets, snoozePresets } from "@/lib/manage";

describe("moveTargets", () => {
  it("drops the folder the message is in", () => {
    expect(moveTargets("inbox").map((folder) => folder.id)).toEqual(["archive", "spam", "trash"]);
    expect(moveTargets("archive").map((folder) => folder.id)).toEqual(["inbox", "spam", "trash"]);
  });

  it("tolerates case and unknown folders", () => {
    expect(moveTargets("SPAM").map((folder) => folder.id)).toEqual(["inbox", "archive", "trash"]);
    expect(moveTargets("custom-folder").map((folder) => folder.id)).toEqual([
      "inbox",
      "archive",
      "spam",
      "trash",
    ]);
  });
});

describe("snoozePresets", () => {
  it("offers a shorthand and two local-morning instants", () => {
    const now = new Date(2026, 8, 29, 14, 30, 0); // Sep 29, 2026, 14:30 local time
    const presets = snoozePresets(now);
    expect(presets.map((preset) => preset.label)).toEqual(["In 3 hours", "Tomorrow morning", "Next week"]);
    expect(presets[0]?.until).toBe("3h");
    expect(new Date(presets[1]?.until ?? "").getHours()).toBe(8);
    expect(new Date(presets[1]?.until ?? "").getDate()).toBe(30);
    // Sep 29 + 7 days = Oct 6, local 8:00.
    expect(new Date(presets[2]?.until ?? "").getHours()).toBe(8);
    expect(new Date(presets[2]?.until ?? "").getDate()).toBe(6);
  });
});

describe("sendLaterPresets", () => {
  it("returns future ISO instants the schedule tool accepts", () => {
    const now = new Date(2026, 8, 29, 14, 30, 0); // Sep 29, 2026, 14:30 local time
    const presets = sendLaterPresets(now);
    expect(presets.map((preset) => preset.label)).toEqual(["In 3 hours", "Tomorrow morning", "Next week"]);
    for (const preset of presets) {
      const at = new Date(preset.sendAt);
      expect(at.getTime()).toBeGreaterThan(now.getTime());
      // A real instant, not the snooze shorthand: round-trips as ISO.
      expect(preset.sendAt).toBe(at.toISOString());
    }
    expect(new Date(presets[0]?.sendAt ?? "").getTime()).toBe(now.getTime() + 3 * 60 * 60 * 1000);
    expect(new Date(presets[1]?.sendAt ?? "").getDate()).toBe(30);
    expect(new Date(presets[1]?.sendAt ?? "").getHours()).toBe(8);
    // Sep 29 + 7 days = Oct 6, local 8:00.
    expect(new Date(presets[2]?.sendAt ?? "").getDate()).toBe(6);
    expect(new Date(presets[2]?.sendAt ?? "").getHours()).toBe(8);
  });
});

describe("canOfferUnsubscribe", () => {
  it("offers unsubscribe for received mail, not for outbound", () => {
    expect(canOfferUnsubscribe({ status: "received" })).toBe(true);
    expect(canOfferUnsubscribe({ status: "archived" })).toBe(true);
    expect(canOfferUnsubscribe({ status: "draft" })).toBe(false);
    expect(canOfferUnsubscribe({ status: "sent" })).toBe(false);
    expect(canOfferUnsubscribe({ status: "queued" })).toBe(false);
  });
});
