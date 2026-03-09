const crypto = require("crypto");

const PROVIDER = "github";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

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

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyState(state, secret) {
  if (!state || !state.includes(".")) {
    throw new Error("Invalid OAuth state");
  }
  const [payloadB64, signature] = state.split(".");
  const expected = sign(payloadB64, secret);
  if (!safeEqual(signature, expected)) {
    throw new Error("State signature mismatch");
  }
  const payloadRaw = Buffer.from(payloadB64, "base64url").toString("utf8");
  const payload = JSON.parse(payloadRaw);
  if (!payload.iat || Date.now() - Number(payload.iat) > STATE_MAX_AGE_MS) {
    throw new Error("State expired");
  }
  return payload;
}

function renderResultPage({ success, token, message }) {
  const statusText = success ? "Authorized" : "Authorization Error";
  const detailText = success
    ? "Authorization completed. You can close this window."
    : String(message || "Unknown authorization error.");
  const channelMessage = success
    ? `authorization:${PROVIDER}:success:${JSON.stringify({ token, provider: PROVIDER })}`
    : `authorization:${PROVIDER}:error:${JSON.stringify(detailText)}`;

  const channelMessageJs = JSON.stringify(channelMessage);
  const detailJs = JSON.stringify(detailText);
  const statusJs = JSON.stringify(statusText);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${statusText}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; display: grid; place-items: center; min-height: 100vh; }
      .card { max-width: 680px; margin: 1rem; background: #111827; border: 1px solid #334155; border-radius: 12px; padding: 1rem 1.25rem; }
      h1 { margin-top: 0; font-size: 1.2rem; }
      p { margin-bottom: 0; line-height: 1.45; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1 id="status"></h1>
      <p id="message"></p>
    </div>
    <script>
      (() => {
        const status = ${statusJs};
        const message = ${detailJs};
        const channelMessage = ${channelMessageJs};
        document.getElementById("status").textContent = status;
        document.getElementById("message").textContent = message;
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(channelMessage, window.location.origin);
            window.close();
          }
        } catch (_) {}
      })();
    </script>
  </body>
</html>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const oauthSecret = process.env.CMS_OAUTH_SECRET;
  if (!clientId || !clientSecret || !oauthSecret) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(500).send(
      renderResultPage({
        success: false,
        message:
          "Missing server environment variables. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and CMS_OAUTH_SECRET.",
      })
    );
    return;
  }

  const origin = getOrigin(req);
  const redirectUri = process.env.CMS_OAUTH_REDIRECT_URL || `${origin}/api/cms/callback`;

  try {
    if (req.query.error) {
      const error = String(req.query.error);
      const description = String(req.query.error_description || "");
      throw new Error(description ? `${error}: ${description}` : error);
    }

    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    if (!code) throw new Error("Missing OAuth code");
    verifyState(state, oauthSecret);

    const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "verafides-cms-oauth",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        state,
        redirect_uri: redirectUri,
      }),
    });

    const tokenJson = await tokenResponse.json();
    if (!tokenResponse.ok || tokenJson.error || !tokenJson.access_token) {
      const detail = tokenJson.error_description || tokenJson.error || "Token exchange failed";
      throw new Error(String(detail));
    }

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(
      renderResultPage({
        success: true,
        token: tokenJson.access_token,
      })
    );
  } catch (error) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(400).send(
      renderResultPage({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      })
    );
  }
};
