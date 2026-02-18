"use strict";

const THANK_YOU_PATH = "/danke/";
const MEMBERSHIP_THANK_YOU_PATH = "/danke/mitgliedschaft/";
const DEFAULT_TO_EMAIL = "redaktion@verafides.ch";

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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isProductionContext() {
  const context = String(process.env.CONTEXT || process.env.NODE_ENV || "").toLowerCase();
  return context === "production";
}

function isLocalHostRequest(event) {
  const host = String(event.headers["x-forwarded-host"] || event.headers.host || "").toLowerCase();
  return host.includes("localhost") || host.includes("127.0.0.1");
}

async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (ip) body.set("remoteip", ip);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body
  });
  if (!response.ok) return false;

  const result = await response.json();
  return Boolean(result.success);
}

async function sendViaResend({ to, replyTo, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("[contact] RESEND_API_KEY missing. Payload:", { to, replyTo, subject, text });
    return true;
  }

  const from = process.env.RESEND_FROM || "Verafides <noreply@verafides.ch>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      reply_to: replyTo || undefined,
      html,
      text
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Resend request failed: ${response.status} ${details}`);
  }
  return true;
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
  const payload = parseFormBody(event.body, contentType);

  const subject = (payload.subject || "Kontaktanfrage").trim();
  const isMembershipRequest = subject.toLowerCase().includes("mitglied");

  if (payload.website) {
    return {
      statusCode: 303,
      headers: { Location: isMembershipRequest ? MEMBERSHIP_THANK_YOU_PATH : THANK_YOU_PATH },
      body: ""
    };
  }

  const name = (payload.name || "").trim();
  const email = (payload.email || "").trim();
  const message = (payload.message || "").trim();
  const eventName = (payload.event || "").trim();
  const address = (payload.address || "").trim();
  const membershipType = (payload.membership_type || "").trim();
  const turnstileToken = payload["cf-turnstile-response"];

  if (!name || !email) {
    return { statusCode: 400, body: "Name and email are required." };
  }

  const isEventRegistration = Boolean(eventName);
  const inProduction = isProductionContext();
  const isLocalRequest = isLocalHostRequest(event);
  const hasTurnstileSecret = Boolean(process.env.TURNSTILE_SECRET_KEY);

  // Policy: locally optional, in production mandatory.
  if (!isEventRegistration) {
    if (inProduction && !hasTurnstileSecret) {
      console.error("[contact] TURNSTILE_SECRET_KEY missing in production.");
      return { statusCode: 500, body: "Captcha config missing." };
    }

    if ((inProduction || (!isLocalRequest && hasTurnstileSecret)) && hasTurnstileSecret) {
      const isValidCaptcha = await verifyTurnstile(
        turnstileToken,
        event.headers["x-forwarded-for"]
      );
      if (!isValidCaptcha) {
        return { statusCode: 400, body: "Captcha validation failed." };
      }
    }
  }

  const finalSubject = isEventRegistration ? `Anmeldung: ${eventName || "Veranstaltung"}` : subject;
  const to = process.env.CONTACT_TO_EMAIL || DEFAULT_TO_EMAIL;

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeMessage = escapeHtml(message || "(keine Bemerkung)");
  const safeEvent = escapeHtml(eventName || "(nicht angegeben)");
  const safeAddress = escapeHtml(address || "(nicht angegeben)");
  const safeMembershipType = escapeHtml(membershipType || "(nicht angegeben)");

  const html = isEventRegistration
    ? `<h2>Neue Veranstaltungsanmeldung</h2>\n<p><strong>Name:</strong> ${safeName}<br>\n<strong>E-Mail:</strong> ${safeEmail}<br>\n<strong>Event:</strong> ${safeEvent}</p>\n<p><strong>Bemerkung:</strong><br>${safeMessage}</p>`
    : isMembershipRequest
      ? `<h2>Neue Mitgliedschaftsanfrage</h2>\n<p><strong>Name:</strong> ${safeName}<br>\n<strong>E-Mail:</strong> ${safeEmail}<br>\n<strong>Mitgliedschaft:</strong> ${safeMembershipType}<br>\n<strong>Adresse:</strong> ${safeAddress}</p>\n<p><strong>Nachricht:</strong><br>${safeMessage}</p>`
      : `<h2>Neue Kontaktanfrage</h2>\n<p><strong>Name:</strong> ${safeName}<br>\n<strong>E-Mail:</strong> ${safeEmail}<br>\n<strong>Betreff:</strong> ${escapeHtml(subject)}</p>\n<p><strong>Nachricht:</strong><br>${safeMessage}</p>`;

  const text = isEventRegistration
    ? `Neue Veranstaltungsanmeldung\n\nName: ${name}\nE-Mail: ${email}\nEvent: ${eventName || "-"}\nBemerkung: ${message || "-"}`
    : isMembershipRequest
      ? `Neue Mitgliedschaftsanfrage\n\nName: ${name}\nE-Mail: ${email}\nMitgliedschaft: ${membershipType || "-"}\nAdresse: ${address || "-"}\nNachricht: ${message || "-"}`
      : `Neue Kontaktanfrage\n\nName: ${name}\nE-Mail: ${email}\nBetreff: ${subject}\nNachricht: ${message || "-"}`;

  try {
    await sendViaResend({
      to,
      replyTo: email,
      subject: finalSubject,
      html,
      text
    });
  } catch (error) {
    console.error("[contact] send failed:", error);
    return { statusCode: 502, body: "Message delivery failed." };
  }

  return {
    statusCode: 303,
    headers: { Location: isMembershipRequest ? MEMBERSHIP_THANK_YOU_PATH : THANK_YOU_PATH },
    body: ""
  };
};
