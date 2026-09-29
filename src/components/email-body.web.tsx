/**
 * Web build of the email body renderer: a fully sandboxed iframe (no
 * scripts, no forms, no navigation rights) showing the CSP-locked document
 * from buildEmailDocument. Exists for the web preview and headless E2E; the
 * phone renders through email-body.tsx's WebView.
 */

export function EmailBody({ html }: { html: string }) {
  return (
    <iframe
      title="Email body"
      srcDoc={html}
      sandbox=""
      style={{ border: "none", width: "100%", height: "100%", background: "transparent" }}
    />
  );
}
