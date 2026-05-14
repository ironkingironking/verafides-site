"use strict";

require("dotenv").config();

const express = require("express");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const { execFile } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3001;

// ── Body parsing ──────────────────────────────────────────────────────────────

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── SMTP transport ────────────────────────────────────────────────────────────

function createTransport() {
  const host = process.env.SMTP_HOST || "mail.verafides.ch";
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE === "true";
  const transport = {
    host,
    port,
    secure,
  };

  const smtpUser = String(process.env.SMTP_USER || "").trim();
  const smtpPass = String(process.env.SMTP_PASS || "").trim();
  if (smtpUser && smtpPass) {
    transport.auth = {
      user: smtpUser,
      pass: smtpPass,
    };
  }

  return nodemailer.createTransport(transport);
}

async function sendMail({ to, replyTo, subject, html, text }) {
  const fromUser = String(process.env.SMTP_USER || "").trim() || "noreply@verafides.ch";
  const from = process.env.SMTP_FROM || `Verafides <${fromUser}>`;
  const transport = createTransport();
  await transport.sendMail({ from, to, replyTo, subject, html, text });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  if (!response.ok) return false;
  return Boolean((await response.json()).success);
}

function renderMessagePage(title, message, backPath = "/") {
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
      main { max-width: 680px; margin: 48px auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 24px; }
      h1 { margin: 0 0 12px; font-size: 1.4rem; }
      p { margin: 0 0 18px; line-height: 1.5; }
      a { color: #0f172a; text-underline-offset: 3px; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
      <a href="${backPath}">Zurück</a>
    </main>
  </body>
</html>`;
}

// ── /api/deploy/verafides/:token ─────────────────────────────────────────────

let activeDeploy = null;

function safeTokenEquals(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 1024 * 1024 * 2,
      timeout: options.timeout || 120000,
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function ensureCleanTrackedWorktree() {
  await runCommand("git", ["diff", "--quiet"], { timeout: 30000 });
  await runCommand("git", ["diff", "--cached", "--quiet"], { timeout: 30000 });
}

async function deployVerafidesSite() {
  await ensureCleanTrackedWorktree();
  await runCommand("git", ["fetch", "--prune", "origin", "main"], { timeout: 120000 });
  await runCommand("git", ["merge", "--ff-only", "origin/main"], { timeout: 120000 });
  await runCommand("npm", ["ci"], { timeout: 180000 });
  await runCommand("npm", ["run", "build"], { timeout: 180000 });
}

app.post("/api/deploy/verafides/:token", async (req, res) => {
  const expectedToken = process.env.VERAFIDES_DEPLOY_TOKEN;
  if (!expectedToken || !safeTokenEquals(req.params.token, expectedToken)) {
    return res.status(404).send("Not found");
  }

  const payload = req.body || {};
  if (payload.deleted || payload.ref !== "refs/heads/main") {
    return res.status(202).json({ ok: true, skipped: true });
  }

  if (activeDeploy) {
    return res.status(409).json({ ok: false, error: "Deploy already running." });
  }

  activeDeploy = deployVerafidesSite();
  try {
    await activeDeploy;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[deploy] failed:", err.stderr || err.message);
    res.status(500).json({ ok: false, error: "Deploy failed. Check service logs." });
  } finally {
    activeDeploy = null;
  }
});

// ── /api/contact ──────────────────────────────────────────────────────────────

const THANK_YOU_PATH = "/danke/";
const MEMBERSHIP_THANK_YOU_PATH = "/danke/mitgliedschaft/";
const DEFAULT_TO_EMAIL = "redaktion@verafides.ch";

app.post("/api/contact", async (req, res) => {
  const payload = req.body || {};

  const subject = (payload.subject || "Kontaktanfrage").trim();
  const normalizedSubject = subject.toLowerCase();
  const isMembershipRequest = normalizedSubject.includes("mitglied");
  const isAbuseReport =
    payload.report_type === "liturgical-abuse" ||
    (normalizedSubject.includes("liturg") && normalizedSubject.includes("missbrauch"));

  // Honeypot
  if (payload.website) {
    return res.redirect(303, isMembershipRequest ? MEMBERSHIP_THANK_YOU_PATH : THANK_YOU_PATH);
  }

  const firstName = (payload.first_name || "").trim();
  const lastName = (payload.last_name || "").trim();
  const derivedName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const name = (payload.name || derivedName).trim();
  const email = (payload.email || "").trim();
  const message = (payload.message || "").trim();
  const eventName = (payload.event || "").trim();
  const address = (payload.address || "").trim();
  const phone = (payload.phone || "").trim();
  const sharePermission = (payload.share_permission || "").trim();
  const reportedElsewhere = (payload.reported_elsewhere || "").trim();
  const reportedOutcome = (payload.reported_outcome || "").trim();
  const membershipType = (payload.membership_type || "").trim();
  const turnstileToken = payload["cf-turnstile-response"];

  if (isAbuseReport) {
    if (!firstName || !lastName || !email || !message || !sharePermission || !reportedElsewhere) {
      return res.status(400).send("Missing required report fields.");
    }
    if (reportedElsewhere === "ja" && !reportedOutcome) {
      return res.status(400).send("Please add the outcome for previous reports.");
    }
  } else if (!name || !email) {
    return res.status(400).send("Name and email are required.");
  }

  const isEventRegistration = Boolean(eventName);
  const turnstileSiteKey = String(process.env.TURNSTILE_SITE_KEY || "").trim();
  const hasTurnstileSecret = Boolean(process.env.TURNSTILE_SECRET_KEY);
  const turnstileEnabled =
    hasTurnstileSecret &&
    Boolean(turnstileSiteKey) &&
    turnstileSiteKey !== "your_turnstile_site_key";
  const inProduction = (process.env.NODE_ENV || "").toLowerCase() === "production";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").toLowerCase();
  const isLocalRequest = host.includes("localhost") || host.includes("127.0.0.1");

  if (!isEventRegistration) {
    if (!turnstileEnabled && inProduction) {
      console.warn("[contact] TURNSTILE_SECRET_KEY missing in production; skipping captcha check.");
    } else if (turnstileEnabled && (inProduction || !isLocalRequest)) {
      const ip = req.headers["x-forwarded-for"] || req.ip;
      const valid = await verifyTurnstile(turnstileToken, ip);
      if (!valid) return res.status(400).send("Captcha validation failed.");
    }
  }

  const finalSubject = isEventRegistration
    ? `Anmeldung: ${eventName || "Veranstaltung"}`
    : isAbuseReport
      ? subject || "Meldung liturgische Missbräuche"
      : subject;

  const to = process.env.CONTACT_TO_EMAIL || DEFAULT_TO_EMAIL;

  const safe = (v) => escapeHtml(v || "(nicht angegeben)");

  const html = isEventRegistration
    ? `<h2>Neue Veranstaltungsanmeldung</h2>
<p><strong>Name:</strong> ${safe(name)}<br>
<strong>E-Mail:</strong> ${safe(email)}<br>
<strong>Event:</strong> ${safe(eventName)}</p>
<p><strong>Bemerkung:</strong><br>${safe(message)}</p>`
    : isMembershipRequest
      ? `<h2>Neue Mitgliedschaftsanfrage</h2>
<p><strong>Name:</strong> ${safe(name)}<br>
<strong>E-Mail:</strong> ${safe(email)}<br>
<strong>Mitgliedschaft:</strong> ${safe(membershipType)}<br>
<strong>Adresse:</strong> ${safe(address)}</p>
<p><strong>Nachricht:</strong><br>${safe(message)}</p>`
      : isAbuseReport
        ? `<h2>Neue Meldung: Liturgische Missbräuche</h2>
<p><strong>Vorname:</strong> ${safe(firstName)}<br>
<strong>Name:</strong> ${safe(lastName)}<br>
<strong>E-Mail:</strong> ${safe(email)}<br>
<strong>Adresse:</strong> ${safe(address)}<br>
<strong>Telefon:</strong> ${safe(phone)}</p>
<p><strong>Sachverhalt:</strong><br>${safe(message)}</p>
<p><strong>Weitergabe der Personalien:</strong><br>${safe(sharePermission)}</p>
<p><strong>Bereits an andere Stelle gemeldet:</strong><br>${safe(reportedElsewhere)}</p>
<p><strong>Ergebnis der bisherigen Meldung:</strong><br>${safe(reportedOutcome)}</p>`
        : `<h2>Neue Kontaktanfrage</h2>
<p><strong>Name:</strong> ${safe(name)}<br>
<strong>E-Mail:</strong> ${safe(email)}<br>
<strong>Betreff:</strong> ${escapeHtml(subject)}</p>
<p><strong>Nachricht:</strong><br>${safe(message)}</p>`;

  const text = isEventRegistration
    ? `Neue Veranstaltungsanmeldung\n\nName: ${name}\nE-Mail: ${email}\nEvent: ${eventName || "-"}\nBemerkung: ${message || "-"}`
    : isMembershipRequest
      ? `Neue Mitgliedschaftsanfrage\n\nName: ${name}\nE-Mail: ${email}\nMitgliedschaft: ${membershipType || "-"}\nAdresse: ${address || "-"}\nNachricht: ${message || "-"}`
      : isAbuseReport
        ? `Neue Meldung: Liturgische Missbräuche\n\nVorname: ${firstName}\nName: ${lastName}\nE-Mail: ${email}\nAdresse: ${address || "-"}\nTelefon: ${phone || "-"}\n\nSachverhalt:\n${message || "-"}\n\nWeitergabe der Personalien:\n${sharePermission || "-"}\n\nBereits an andere Stelle gemeldet:\n${reportedElsewhere || "-"}\n\nErgebnis der bisherigen Meldung:\n${reportedOutcome || "-"}`
        : `Neue Kontaktanfrage\n\nName: ${name}\nE-Mail: ${email}\nBetreff: ${subject}\nNachricht: ${message || "-"}`;

  try {
    await sendMail({ to, replyTo: email, subject: finalSubject, html, text });
  } catch (err) {
    console.error("[contact] sendMail failed:", err);
    return res.status(502).send("Message delivery failed.");
  }

  res.redirect(303, isMembershipRequest ? MEMBERSHIP_THANK_YOU_PATH : THANK_YOU_PATH);
});

// ── /api/newsletter-subscribe ─────────────────────────────────────────────────

const NEWSLETTER_BACK_PATH = "/unterstuetzen/informiert-bleiben/";

function normalizeListUuids(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value).split(",").map((v) => v.trim()).filter(Boolean);
}

app.post("/api/newsletter-subscribe", async (req, res) => {
  const payload = req.body || {};

  if (payload.website) {
    return res.status(200)
      .type("html")
      .send(renderMessagePage("Newsletter-Anmeldung", "Deine Anmeldung wurde verarbeitet.", NEWSLETTER_BACK_PATH));
  }

  const listmonkUrl = (process.env.LISTMONK_BASE_URL || "").replace(/\/+$/, "");
  const listUuids = normalizeListUuids(process.env.LISTMONK_LIST_UUIDS || process.env.LISTMONK_LIST_UUID);

  if (!listmonkUrl || listUuids.length === 0) {
    console.error("[newsletter-subscribe] Missing LISTMONK_BASE_URL or LISTMONK_LIST_UUID(S).");
    return res.status(500).send("Newsletter config missing.");
  }

  const email = (payload.email || "").trim();
  const name = (payload.name || "").trim();
  if (!email) return res.status(400).send("Email is required.");

  let response;
  try {
    response = await fetch(`${listmonkUrl}/api/public/subscription`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name: name || undefined, list_uuids: listUuids }),
    });
  } catch (err) {
    console.error("[newsletter-subscribe] listmonk request failed:", err);
    return res.status(502).type("html").send(
      renderMessagePage(
        "Newsletter derzeit nicht erreichbar",
        "Der Newsletter-Dienst ist momentan nicht erreichbar. Bitte versuche es später erneut.",
        NEWSLETTER_BACK_PATH
      )
    );
  }

  if (!response.ok) {
    const details = await response.text();
    console.error("[newsletter-subscribe] listmonk error:", response.status, details);
    return res.status(502).type("html").send(
      renderMessagePage(
        "Newsletter-Anmeldung fehlgeschlagen",
        "Die Anmeldung konnte nicht verarbeitet werden. Bitte versuche es später erneut.",
        NEWSLETTER_BACK_PATH
      )
    );
  }

  res.status(200).type("html").send(
    renderMessagePage(
      "Newsletter-Anmeldung erfolgreich",
      "Danke. Deine E-Mail wurde für den Newsletter eingetragen.",
      NEWSLETTER_BACK_PATH
    )
  );
});

// ── /api/newsletter-unsubscribe ───────────────────────────────────────────────

function authHeader(username, token) {
  return `token ${username}:${token}`;
}

async function getListmonkSessionCookie() {
  const baseUrl = (process.env.LISTMONK_BASE_URL || "").replace(/\/+$/, "");
  const username = process.env.LISTMONK_ADMIN_USER || "";
  const password = process.env.LISTMONK_ADMIN_PASSWORD || "";

  if (!baseUrl || !username || !password) {
    throw new Error("Missing listmonk admin login env vars.");
  }

  const loginPage = await fetch(`${baseUrl}/admin/login`);
  if (!loginPage.ok) {
    throw new Error(`Listmonk login page failed: ${loginPage.status}`);
  }

  const loginHtml = await loginPage.text();
  const nonceMatch = loginHtml.match(/name="nonce" value="([^"]+)"/);
  if (!nonceMatch) {
    throw new Error("Could not extract listmonk login nonce.");
  }

  const loginResponse = await fetch(`${baseUrl}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ nonce: nonceMatch[1], username, password }).toString(),
    redirect: "manual",
  });

  if (![302, 303].includes(loginResponse.status)) {
    throw new Error(`Listmonk login failed: ${loginResponse.status}`);
  }

  const setCookie = loginResponse.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Listmonk login did not return a session cookie.");
  }

  return setCookie.split(";")[0];
}

function escapeSqlString(value) {
  return String(value).replaceAll("'", "''");
}

app.post("/api/newsletter-unsubscribe", async (req, res) => {
  const payload = req.body || {};

  if (payload.website) {
    return res.status(200).type("html").send(
      renderMessagePage("Newsletter-Abmeldung", "Deine Abmeldung wurde verarbeitet.", NEWSLETTER_BACK_PATH)
    );
  }

  const listmonkUrl = (process.env.LISTMONK_BASE_URL || "").replace(/\/+$/, "");
  const listId = Number.parseInt(process.env.LISTMONK_LIST_ID || "", 10);

  if (!listmonkUrl || !Number.isInteger(listId)) {
    console.error("[newsletter-unsubscribe] Missing listmonk admin env vars.");
    return res.status(500).send("Newsletter config missing.");
  }

  const email = (payload.email || "").trim().toLowerCase();
  if (!email) return res.status(400).send("Email is required.");

  let sessionCookie;
  try {
    sessionCookie = await getListmonkSessionCookie();
  } catch (err) {
    console.error("[newsletter-unsubscribe] listmonk session login failed:", err);
    return res.status(502).type("html").send(
      renderMessagePage(
        "Newsletter derzeit nicht erreichbar",
        "Der Newsletter-Dienst ist momentan nicht erreichbar. Bitte versuche es später erneut.",
        NEWSLETTER_BACK_PATH
      )
    );
  }

  const query = `subscribers.email = '${escapeSqlString(email)}'`;
  const lookupUrl = `${listmonkUrl}/api/subscribers?per_page=100&query=${encodeURIComponent(query)}`;

  let lookupResponse;
  try {
    lookupResponse = await fetch(lookupUrl, { headers: { Cookie: sessionCookie } });
  } catch (err) {
    console.error("[newsletter-unsubscribe] lookup request failed:", err);
    return res.status(502).type("html").send(
      renderMessagePage(
        "Newsletter derzeit nicht erreichbar",
        "Der Newsletter-Dienst ist momentan nicht erreichbar. Bitte versuche es später erneut.",
        NEWSLETTER_BACK_PATH
      )
    );
  }

  if (!lookupResponse.ok) {
    const details = await lookupResponse.text();
    console.error("[newsletter-unsubscribe] lookup failed:", lookupResponse.status, details);
    return res.status(502).send("Newsletter unsubscribe failed.");
  }

  const lookupPayload = await lookupResponse.json();
  const results = Array.isArray(lookupPayload?.data?.results) ? lookupPayload.data.results : [];
  const ids = results.map((row) => row?.id).filter((id) => Number.isInteger(id));

  if (ids.length > 0) {
    let batchResponse;
    try {
      batchResponse = await fetch(`${listmonkUrl}/api/subscribers/lists`, {
        method: "PUT",
        headers: { Cookie: sessionCookie, "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action: "unsubscribe", target_list_ids: [listId] }),
      });
    } catch (err) {
      console.error("[newsletter-unsubscribe] update request failed:", err);
      return res.status(502).type("html").send(
        renderMessagePage(
          "Newsletter derzeit nicht erreichbar",
          "Der Newsletter-Dienst ist momentan nicht erreichbar. Bitte versuche es später erneut.",
          NEWSLETTER_BACK_PATH
        )
      );
    }

    if (!batchResponse.ok) {
      const details = await batchResponse.text();
      console.error("[newsletter-unsubscribe] update failed:", batchResponse.status, details);
      return res.status(502).send("Newsletter unsubscribe failed.");
    }
  }

  res.status(200).type("html").send(
    renderMessagePage(
      "Newsletter-Abmeldung erfolgreich",
      "Du wurdest erfolgreich vom Newsletter abgemeldet.",
      NEWSLETTER_BACK_PATH
    )
  );
});

// ── /api/cms/auth ─────────────────────────────────────────────────────────────

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

function getOrigin(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "localhost:3001")
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}

function signState(payloadB64, secret) {
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function createOAuthState(secret) {
  const payload = { iat: Date.now(), nonce: crypto.randomBytes(16).toString("hex") };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${signState(payloadB64, secret)}`;
}

function verifyOAuthState(state, secret) {
  if (!state || !state.includes(".")) throw new Error("Invalid OAuth state");
  const [payloadB64, signature] = state.split(".");
  const expected = signState(payloadB64, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw new Error("State signature mismatch");
  }
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  if (!payload.iat || Date.now() - Number(payload.iat) > STATE_MAX_AGE_MS) {
    throw new Error("State expired");
  }
  return payload;
}

function renderCmsErrorPage(message) {
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
        <p>Set <code>GITHUB_CLIENT_ID</code>, <code>GITHUB_CLIENT_SECRET</code>, and <code>CMS_OAUTH_SECRET</code> in .env.</p>
      </div>
    </main>
  </body>
</html>`;
}

function renderCmsResultPage({ success, token, message }) {
  const statusText = success ? "Authorized" : "Authorization Error";
  const detailText = success
    ? "Authorization completed. You can close this window."
    : String(message || "Unknown authorization error.");
  const channelMessage = success
    ? `authorization:github:success:${JSON.stringify({ token, provider: "github" })}`
    : `authorization:github:error:${JSON.stringify(detailText)}`;

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
        document.getElementById("status").textContent = ${JSON.stringify(statusText)};
        document.getElementById("message").textContent = ${JSON.stringify(detailText)};
        const channelMessage = ${JSON.stringify(channelMessage)};
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

app.get("/api/cms/auth", (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const oauthSecret = process.env.CMS_OAUTH_SECRET;

  if (!clientId || !oauthSecret) {
    res.setHeader("Cache-Control", "no-store").status(500).type("html").send(
      renderCmsErrorPage("Missing server environment variables for GitHub OAuth.")
    );
    return;
  }

  const provider = String(req.query.provider || "github").toLowerCase();
  if (provider !== "github") return res.status(400).send("Unsupported provider");

  const scope = String(req.query.scope || "repo");
  const origin = getOrigin(req);
  const redirectUri = process.env.CMS_OAUTH_REDIRECT_URL || `${origin}/api/cms/callback`;
  const state = createOAuthState(oauthSecret);
  const authorizeUrl = `${GITHUB_AUTHORIZE_URL}?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
  })}`;

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
        const handshake = "authorizing:github";
        const authorizeUrl = ${JSON.stringify(authorizeUrl)};
        let started = false;
        const startAuth = () => { if (started) return; started = true; window.location.replace(authorizeUrl); };
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(handshake, window.location.origin);
            window.addEventListener("message", (e) => {
              if (e.origin === window.location.origin && e.data === handshake) startAuth();
            });
            setTimeout(startAuth, 1200);
          } else { startAuth(); }
        } catch (_) { startAuth(); }
      })();
    </script>
  </body>
</html>`;

  res.setHeader("Cache-Control", "no-store").status(200).type("html").send(html);
});

// ── /api/cms/callback ─────────────────────────────────────────────────────────

app.get("/api/cms/callback", async (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const oauthSecret = process.env.CMS_OAUTH_SECRET;

  res.setHeader("Cache-Control", "no-store").type("html");

  if (!clientId || !clientSecret || !oauthSecret) {
    return res.status(500).send(
      renderCmsResultPage({
        success: false,
        message: "Missing server environment variables. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and CMS_OAUTH_SECRET.",
      })
    );
  }

  const origin = getOrigin(req);
  const redirectUri = process.env.CMS_OAUTH_REDIRECT_URL || `${origin}/api/cms/callback`;

  try {
    if (req.query.error) {
      const desc = String(req.query.error_description || "");
      throw new Error(desc ? `${req.query.error}: ${desc}` : String(req.query.error));
    }

    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    if (!code) throw new Error("Missing OAuth code");
    verifyOAuthState(state, oauthSecret);

    const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "verafides-cms-oauth" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, state, redirect_uri: redirectUri }),
    });

    const tokenJson = await tokenResponse.json();
    if (!tokenResponse.ok || tokenJson.error || !tokenJson.access_token) {
      throw new Error(String(tokenJson.error_description || tokenJson.error || "Token exchange failed"));
    }

    res.status(200).send(renderCmsResultPage({ success: true, token: tokenJson.access_token }));
  } catch (err) {
    res.status(400).send(renderCmsResultPage({ success: false, message: err.message }));
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[api] listening on http://127.0.0.1:${PORT}`);
});
