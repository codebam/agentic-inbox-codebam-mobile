import { describe, expect, it } from "vitest";

import { parseToken, tokenPreview } from "@/lib/token";

// The hex is the UTF-8 bytes of "codebam@codebam.ca", the mailbox segment
// shape the agentic-inbox worker's formatAccessToken emits.
const HEX = "636f646562616d40636f646562616d2e6361";
const SECRET = "d5KRt9vQ2mXbW4zY7pLc1nJh8sA3fG6eU0iR2oT5wZq";
const MAILBOX_TOKEN = `ain1_${HEX}_${SECRET}`;
const APP_TOKEN = `ain2_${SECRET}`;

describe("parseToken", () => {
  it("parses a mailbox token and decodes its mailbox id", () => {
    expect(parseToken(MAILBOX_TOKEN)).toEqual({ kind: "mailbox", mailboxId: "codebam@codebam.ca" });
  });

  it("parses an app token with no mailbox", () => {
    expect(parseToken(APP_TOKEN)).toEqual({ kind: "app", mailboxId: null });
  });

  it("trims surrounding whitespace", () => {
    expect(parseToken(`  ${APP_TOKEN}\n`)).toEqual({ kind: "app", mailboxId: null });
  });

  it("refuses near misses", () => {
    expect(parseToken("")).toBeNull();
    expect(parseToken("hello")).toBeNull();
    expect(parseToken(`ain2_${SECRET.slice(0, 42)}`)).toBeNull();
    expect(parseToken(`ain2_${SECRET}x`)).toBeNull();
    expect(parseToken(`ain2_${SECRET} extra`)).toBeNull();
    expect(parseToken(`AIN2_${SECRET}`)).toBeNull();
    expect(parseToken(`ain3_${SECRET}`)).toBeNull();
    expect(parseToken(`ain1_${HEX}_${SECRET.slice(0, 42)}`)).toBeNull();
    expect(parseToken(`ain1_${HEX.slice(0, 13)}_${SECRET}`)).toBeNull();
    expect(parseToken(`ain1_ff_${SECRET}`)).toBeNull();
    expect(parseToken(`ain2_${"x".repeat(42)}!`)).toBeNull();
  });

  it("keeps the two kinds disjoint", () => {
    expect(parseToken(`ain1_${SECRET}`)).toBeNull();
    expect(parseToken(`ain2_${HEX}`)).toBeNull();
  });
});

describe("tokenPreview", () => {
  it("names the key without revealing the secret", () => {
    const preview = tokenPreview(MAILBOX_TOKEN);
    expect(preview.startsWith("ain1_636f")).toBe(true);
    expect(preview.endsWith(SECRET.slice(-4))).toBe(true);
    expect(preview).not.toContain(SECRET);
  });
});
