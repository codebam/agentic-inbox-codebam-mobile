import { describe, expect, it } from "vitest";

import {
  buildEmailDocument,
  extractImageUrls,
  htmlToPlainText,
  plainTextToHtml,
  sanitizeEmailHtml,
  stripHtmlToText,
} from "@/lib/email-html";

describe("extractImageUrls", () => {
  it("collects absolute srcs in order, deduplicated", () => {
    const html = '<img src="https://a.example/1.png"><img src=\'https://b.example/2.jpg\' alt="x"><img src="https://a.example/1.png">';
    expect(extractImageUrls(html)).toEqual(["https://a.example/1.png", "https://b.example/2.jpg"]);
  });

  it("ignores relative, data and cid sources", () => {
    const html = '<img src="/tracking/pixel.gif"><img src="data:image/png;base64,AAAA"><img src="cid:abc">';
    expect(extractImageUrls(html)).toEqual([]);
  });
});

describe("htmlToPlainText", () => {
  it("turns block boundaries into newlines and decodes entities", () => {
    expect(htmlToPlainText("<p>One &amp; two</p><p>Three<br>four</p>")).toBe("One & two\nThree\nfour");
  });

  it("drops scripts and styles", () => {
    expect(htmlToPlainText("<style>b{}</style><div>Keep</div><script>x()</script>")).toBe("Keep");
  });
});

describe("stripHtmlToText", () => {
  it("strips tags and decodes entities", () => {
    expect(stripHtmlToText("<p>Hello &amp; welcome</p><p>Second&nbsp;line</p>")).toBe(
      "Hello & welcome Second line",
    );
  });

  it("drops script and style content", () => {
    expect(stripHtmlToText("<style>p{}</style><p>Readable</p><script>alert(1)</script>")).toBe("Readable");
  });
});

describe("plainTextToHtml", () => {
  it("builds the canonical pre-wrap shape", () => {
    expect(plainTextToHtml("Hello\n\nWorld")).toBe('<div style="white-space:pre-wrap">Hello<br><br>World</div>');
  });

  it("keeps single newlines and escapes markup", () => {
    expect(plainTextToHtml("a\nb < c")).toBe('<div style="white-space:pre-wrap">a<br>b &lt; c</div>');
  });

  it("returns empty for blank input", () => {
    expect(plainTextToHtml("   \n  ")).toBe("");
  });
});

describe("sanitizeEmailHtml", () => {
  it("inlines mapped images as data URLs and keeps placeholders for the rest", () => {
    const html = '<img src="https://a.example/1.png" alt="photo"><img src="https://b.example/track.gif">';
    const out = sanitizeEmailHtml(html, new Map([["https://a.example/1.png", "data:image/png;base64,AAAA"]]));
    expect(out).toContain('<img src="data:image/png;base64,AAAA" alt="photo">');
    expect(out).toContain("🖼 image");
    expect(out).not.toContain("b.example");
  });
  it("strips scripts case-insensitively", () => {
    expect(sanitizeEmailHtml('<SCRIPT>alert(1)</SCRIPT><p>ok</p>')).not.toContain("alert");
  });

  it("strips event handlers", () => {
    expect(sanitizeEmailHtml('<p onclick="evil()" onmouseover=\'x\'>x</p>')).not.toContain("onclick");
  });

  it("extracts the body of a full document", () => {
    const out = sanitizeEmailHtml("<html><head><title>t</title></head><body><p>inner</p></body></html>");
    expect(out).toContain("inner");
    expect(out).not.toContain("<body");
  });
});

describe("buildEmailDocument", () => {
  const build = (bodyHtml: string, scheme: "light" | "dark" = "light") =>
    buildEmailDocument({
      subject: "Hello <world>",
      sender: "Ada <ada@x.test>",
      recipient: "bob@y.test",
      date: "Mon, Sep 28, 2026, 18:04",
      bodyHtml,
      scheme,
    });

  it("carries the locking CSP", () => {
    expect(build("<p>hi</p>")).toContain("default-src 'none'");
  });

  it("escapes the header content", () => {
    const doc = build("<p>hi</p>");
    expect(doc).toContain("Hello &lt;world&gt;");
    expect(doc).toContain("Ada &lt;ada@x.test&gt;");
  });

  it("strips scripts and event handlers from the body", () => {
    const doc = build('<p onclick="evil()">x</p><script>alert(1)</script>');
    expect(doc).not.toContain("<script");
    expect(doc).not.toContain("onclick");
    expect(doc).toContain("<p");
  });

  it("replaces images with their alt text and never references the remote URL", () => {
    const doc = build('<img src="https://tracker.test/p.gif" alt="Logo">');
    expect(doc).not.toContain("tracker.test");
    expect(doc).toContain("🖼 Logo");
  });

  it("renders the dark palette on request", () => {
    const doc = build("<p>x</p>", "dark");
    expect(doc).toContain("#0f1012");
  });

  it("renders a placeholder for an empty body", () => {
    expect(build("")).toContain("(no content)");
  });
});
