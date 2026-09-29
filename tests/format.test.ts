import { describe, expect, it } from "vitest";

import {
  folderDisplayName,
  formatEmailDate,
  formatFileSize,
  formatFullDate,
  replySubject,
  senderAddress,
  senderName,
  truncate,
} from "@/lib/format";

// A fixed "now" in local time so the assertions are timezone-independent.
const now = new Date(2026, 8, 28, 22, 30);

describe("formatEmailDate", () => {
  it("shows a time for today", () => {
    expect(formatEmailDate(new Date(2026, 8, 28, 9, 5).toISOString(), now)).toBe("09:05");
  });

  it("shows a short date earlier this year", () => {
    expect(formatEmailDate(new Date(2026, 8, 20, 12, 0).toISOString(), now)).toBe("Sep 20");
  });

  it("includes the year for older mail", () => {
    expect(formatEmailDate(new Date(2025, 11, 31, 12, 0).toISOString(), now)).toBe("Dec 31, 2025");
  });

  it("returns empty for missing or invalid input", () => {
    expect(formatEmailDate(null, now)).toBe("");
    expect(formatEmailDate("not-a-date", now)).toBe("");
  });
});

describe("formatFullDate", () => {
  it("formats a full timestamp", () => {
    expect(formatFullDate(new Date(2026, 8, 28, 18, 4).toISOString())).toBe("Mon, Sep 28, 2026, 18:04");
  });
});

describe("addresses", () => {
  it("reads display names and addresses", () => {
    expect(senderName('"Ada Lovelace" <ada@x.test>')).toBe("Ada Lovelace");
    expect(senderName("ada@x.test")).toBe("ada@x.test");
    expect(senderName(null)).toBe("(unknown sender)");
    expect(senderAddress('"Ada Lovelace" <ada@x.test>')).toBe("ada@x.test");
    expect(senderAddress("ada@x.test")).toBe("ada@x.test");
  });
});

describe("replySubject", () => {
  it("adds exactly one Re: prefix", () => {
    expect(replySubject("Hello")).toBe("Re: Hello");
    expect(replySubject("Re: Hello")).toBe("Re: Hello");
    expect(replySubject("RE: Hello")).toBe("RE: Hello");
    expect(replySubject(null)).toBe("Re:");
  });
});

describe("misc formatting", () => {
  it("truncates with an ellipsis", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("a very long sentence", 10)).toBe("a very lo…");
  });

  it("formats file sizes", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("names the system folders", () => {
    expect(folderDisplayName("inbox")).toBe("Inbox");
    expect(folderDisplayName("draft")).toBe("Drafts");
    expect(folderDisplayName("custom")).toBe("Custom");
  });
});
