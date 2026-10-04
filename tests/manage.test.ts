import { describe, expect, it } from "vitest";

import { moveTargets, oneClickUnsubscribeTarget, sendLaterPresets, snoozePresets } from "@/lib/manage";

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

describe("oneClickUnsubscribeTarget", () => {
  it("takes the https target when the one-click marker is present", () => {
    expect(
      oneClickUnsubscribeTarget({
        list_unsubscribe: "<mailto:u@x.test>, <https://x.test/unsub?t=1>",
        list_unsubscribe_post: "List-Unsubscribe=One-Click",
      }),
    ).toBe("https://x.test/unsub?t=1");
  });

  it("is null without the marker, without an https target, or with neither", () => {
    expect(oneClickUnsubscribeTarget({ list_unsubscribe: "<https://x.test/u>" })).toBeNull();
    expect(
      oneClickUnsubscribeTarget({
        list_unsubscribe: "<mailto:u@x.test>",
        list_unsubscribe_post: "List-Unsubscribe=One-Click",
      }),
    ).toBeNull();
    expect(oneClickUnsubscribeTarget({})).toBeNull();
  });

  it("ignores an http-only target", () => {
    expect(
      oneClickUnsubscribeTarget({
        list_unsubscribe: "<http://x.test/u>",
        list_unsubscribe_post: "List-Unsubscribe=One-Click",
      }),
    ).toBeNull();
  });
});
