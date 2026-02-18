"use strict";

const BACK_PATH = "/unterstuetzen/informiert-bleiben/";

function parseFormBody(rawBody, contentType) {
  if (!rawBody) return {};

  if (contentType && contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(rawBody);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  const params = new URLSearchParams(rawBody);
  return Object.fromEntries(params.entries());
}

function normalizeListUuids(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function renderMessagePage(title, message) {
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
      <a href="${BACK_PATH}">Zurueck zur Newsletter-Seite</a>
    </main>
  </body>
</html>`;
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
  const payload = parseFormBody(event.body, contentType);

  if (payload.website) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: renderMessagePage(
        "Newsletter-Anmeldung",
        "Deine Anmeldung wurde verarbeitet."
      )
    };
  }

  const listmonkUrl = (process.env.LISTMONK_BASE_URL || "").replace(/\/+$/, "");
  const listUuids = normalizeListUuids(process.env.LISTMONK_LIST_UUIDS || process.env.LISTMONK_LIST_UUID);

  if (!listmonkUrl || listUuids.length === 0) {
    console.error("[newsletter-subscribe] Missing LISTMONK_BASE_URL or LISTMONK_LIST_UUID(S).");
    return { statusCode: 500, body: "Newsletter config missing." };
  }

  const email = (payload.email || "").trim();
  const name = (payload.name || "").trim();
  if (!email) {
    return { statusCode: 400, body: "Email is required." };
  }

  const response = await fetch(`${listmonkUrl}/api/public/subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      name: name || undefined,
      list_uuids: listUuids
    })
  });

  if (!response.ok) {
    const details = await response.text();
    console.error("[newsletter-subscribe] listmonk error:", response.status, details);
    return { statusCode: 502, body: "Newsletter signup failed." };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: renderMessagePage(
      "Newsletter-Anmeldung erfolgreich",
      "Danke. Deine E-Mail wurde fuer den Newsletter eingetragen."
    )
  };
};
