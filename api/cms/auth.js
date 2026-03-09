const crypto = require("crypto");

const PROVIDER = "github";
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";

function getOrigin(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = (
    req.headers["x-forwarded-host"] ||
    req.headers.host ||
    "localhost:3000"
  )
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}

function sign(payloadB64, secret) {
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function createState(secret) {
  const payload = {
    iat: Date.now(),
    nonce: crypto.randomBytes(16).toString("hex"),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

function renderErrorPage(message) {
  const escaped = JSON.stringify(String(message || "Unknown error"));
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CMS Auth Error</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
      main { max-width: 720px; margin: 4rem auto; padding: 0 1rem; }
      .card { background: #111827; border: 1px solid #334155; border-radius: 12px; padding: 1rem 1.25rem; }
      code { background: #1f2937; padding: 0.15rem 0.35rem; border-radius: 6px; }
    </style>
  </head>
  <body>
    <main>
      <div class="card">
        <h1>CMS OAuth is not configured</h1>
        <p>${escaped.slice(1, -1)}</p>
        <p>Set <code>GITHUB_CLIENT_ID</code>, <code>GITHUB_CLIENT_SECRET</code>, and <code>CMS_OAUTH_SECRET</code> in Vercel project environment variables.</p>
      </div>
    </main>
  </body>
</html>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const provider = String(req.query.provider || PROVIDER).toLowerCase();
  if (provider !== PROVIDER) {
    res.status(400).send("Unsupported provider");
    return;
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const oauthSecret = process.env.CMS_OAUTH_SECRET;
  if (!clientId || !oauthSecret) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(500).send(
      renderErrorPage(
        "Missing server environment variables for GitHub OAuth."
      )
    );
    return;
  }

  const scope = String(req.query.scope || "repo");
  const origin = getOrigin(req);
  const redirectUri = process.env.CMS_OAUTH_REDIRECT_URL || `${origin}/api/cms/callback`;

  // Keep state self-contained (signed + short-lived), no server-side session needed.
  const state = createState(oauthSecret);
  const authorizeUrl = `${GITHUB_AUTHORIZE_URL}?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
  }).toString()}`;

  const authorizeUrlJs = JSON.stringify(authorizeUrl);
  const providerJs = JSON.stringify(provider);

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connecting to GitHub...</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; display: grid; place-items: center; min-height: 100vh; }
      p { opacity: 0.9; }
    </style>
  </head>
  <body>
    <p>Redirecting to GitHub login...</p>
    <script>
      (() => {
        const provider = ${providerJs};
        const handshake = "authorizing:" + provider;
        const authorizeUrl = ${authorizeUrlJs};
        let started = false;

        const startAuth = () => {
          if (started) return;
          started = true;
          window.location.replace(authorizeUrl);
        };

        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(handshake, window.location.origin);
            window.addEventListener("message", (event) => {
              if (event.origin === window.location.origin && event.data === handshake) {
                startAuth();
              }
            });
            setTimeout(startAuth, 1200);
          } else {
            startAuth();
          }
        } catch (_) {
          startAuth();
        }
      })();
    </script>
  </body>
</html>`;

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
};
