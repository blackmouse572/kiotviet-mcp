export interface ConsentPageVars {
  /** Optional URL we'll redirect to after issuing the bearer. */
  redirectUri?: string;
  /** Echoed back to caller as `state=…`. */
  state?: string;
  /** Sticky error from the previous POST. */
  error?: string;
}

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderConsentPage(vars: ConsentPageVars): string {
  const banner = vars.error
    ? `<div class="err">${esc(vars.error)}</div>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Connect KiotViet</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 5vh auto; padding: 0 1rem; color: #1f2937; }
    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    p { color: #4b5563; margin-top: 0; }
    label { display: block; margin-top: 1rem; font-size: 0.9rem; color: #374151; }
    input { display: block; width: 100%; padding: 0.55rem 0.7rem; margin-top: 0.25rem; border: 1px solid #d1d5db; border-radius: 6px; box-sizing: border-box; font: inherit; }
    button { margin-top: 1.5rem; padding: 0.6rem 1rem; background: #2563eb; color: white; border: 0; border-radius: 6px; font: inherit; cursor: pointer; }
    .err { background: #fef2f2; color: #991b1b; padding: 0.75rem; border-radius: 6px; margin-bottom: 1rem; }
    .hint { font-size: 0.8rem; color: #6b7280; margin-top: 0.25rem; }
  </style>
</head>
<body>
  <h1>Connect KiotViet shop</h1>
  <p>Enter the API credentials issued for your retailer.</p>
  ${banner}
  <form method="post" action="/authorize">
    <input type="hidden" name="redirect_uri" value="${esc(vars.redirectUri ?? "")}" />
    <input type="hidden" name="state" value="${esc(vars.state ?? "")}" />
    <label>Retailer name
      <input name="retailer" required placeholder="abcstore" autocomplete="off" />
      <div class="hint">As shown in <code>https://&lt;retailer&gt;.kiotviet.vn</code></div>
    </label>
    <label>Client ID
      <input name="clientId" required autocomplete="off" />
    </label>
    <label>Client Secret
      <input name="clientSecret" type="password" required autocomplete="off" />
    </label>
    <button type="submit">Connect</button>
  </form>
</body>
</html>`;
}
