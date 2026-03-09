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

function authHeader(username, token) {
  const raw = `${username}:${token}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

function escapeSqlString(value) {
  return String(value).replaceAll("'", "''");
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
        "Newsletter-Abmeldung",
        "Deine Abmeldung wurde verarbeitet."
      )
    };
  }

  const listmonkUrl = (process.env.LISTMONK_BASE_URL || "").replace(/\/+$/, "");
  const username = process.env.LISTMONK_API_USERNAME || "";
  const token = process.env.LISTMONK_API_TOKEN || "";
  const listIdRaw = process.env.LISTMONK_LIST_ID || "";
  const listId = Number.parseInt(listIdRaw, 10);

  if (!listmonkUrl || !username || !token || !Number.isInteger(listId)) {
    console.error("[newsletter-unsubscribe] Missing listmonk admin env vars.");
    return { statusCode: 500, body: "Newsletter config missing." };
  }

  const email = (payload.email || "").trim().toLowerCase();
  if (!email) {
    return { statusCode: 400, body: "Email is required." };
  }

  const query = `subscribers.email = '${escapeSqlString(email)}'`;
  const lookupUrl = `${listmonkUrl}/api/subscribers?per_page=100&query=${encodeURIComponent(query)}`;
  let lookupResponse;
  try {
    lookupResponse = await fetch(lookupUrl, {
      headers: { Authorization: authHeader(username, token) }
    });
  } catch (error) {
    console.error("[newsletter-unsubscribe] lookup request failed:", error);
    return {
      statusCode: 502,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: renderMessagePage(
        "Newsletter derzeit nicht erreichbar",
        "Der Newsletter-Dienst ist momentan nicht erreichbar. Bitte versuche es spaeter erneut."
      )
    };
  }

  if (!lookupResponse.ok) {
    const details = await lookupResponse.text();
    console.error("[newsletter-unsubscribe] lookup failed:", lookupResponse.status, details);
    return { statusCode: 502, body: "Newsletter unsubscribe failed." };
  }

  const lookupPayload = await lookupResponse.json();
  const results = Array.isArray(lookupPayload?.data?.results) ? lookupPayload.data.results : [];
  const ids = results.map((row) => row?.id).filter((id) => Number.isInteger(id));

  if (ids.length > 0) {
    let batchResponse;
    try {
      batchResponse = await fetch(`${listmonkUrl}/api/subscribers/lists`, {
        method: "PUT",
        headers: {
          Authorization: authHeader(username, token),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ids,
          action: "unsubscribe",
          target_list_ids: [listId]
        })
      });
    } catch (error) {
      console.error("[newsletter-unsubscribe] update request failed:", error);
      return {
        statusCode: 502,
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: renderMessagePage(
          "Newsletter derzeit nicht erreichbar",
          "Der Newsletter-Dienst ist momentan nicht erreichbar. Bitte versuche es spaeter erneut."
        )
      };
    }

    if (!batchResponse.ok) {
      const details = await batchResponse.text();
      console.error("[newsletter-unsubscribe] update failed:", batchResponse.status, details);
      return { statusCode: 502, body: "Newsletter unsubscribe failed." };
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: renderMessagePage(
      "Newsletter-Abmeldung erfolgreich",
      "Du wurdest erfolgreich vom Newsletter abgemeldet."
    )
  };
};
