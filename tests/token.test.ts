import { describe, expect, it } from "vitest";

import { parseToken, tokenPreview } from "@/lib/token";

const KEY = "ep_d5KRt9vQ2mXbW4zY7pLc1nJh8sA3fG6e";

describe("parseToken", () => {
  it("accepts a Mailflare API key", () => {
    expect(parseToken(KEY)).toEqual({ kind: "api", mailboxId: null });
  });

  it("trims surrounding whitespace", () => {
    expect(parseToken(`  ${KEY}\n`)).toEqual({ kind: "api", mailboxId: null });
  });

  it("rejects the fork's scoped tokens", () => {
    const secret = "d5KRt9vQ2mXbW4zY7pLc1nJh8sA3fG6eU0iR2oT5wZq";
    expect(parseToken(`ain1_636f646562616d_${secret}`)).toBeNull();
    expect(parseToken(`ain2_${secret}`)).toBeNull();
  });

  it("rejects other prefixes, short secrets and empty input", () => {
    expect(parseToken("sk_live_123456789")).toBeNull();
    expect(parseToken("ep_short")).toBeNull();
    expect(parseToken("")).toBeNull();
    expect(parseToken("ep_")).toBeNull();
  });
});

describe("tokenPreview", () => {
  it("keeps the prefix and the tail but never the whole secret", () => {
    const preview = tokenPreview(KEY);
    expect(preview.startsWith("ep_")).toBe(true);
    expect(preview).toContain("…");
    expect(preview.length).toBeLessThan(KEY.length);
    expect(KEY).toContain(preview.slice(-4));
  });

  it("leaves very short values alone", () => {
    expect(tokenPreview("ep_1234")).toBe("ep_1234");
  });
});
