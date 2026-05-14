"use strict";

function normalizeHeaders(headers) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers || {})) {
    normalized[String(key).toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value);
  }
  return normalized;
}

function serializeParsedBody(body, contentType) {
  if (!body || typeof body !== "object") return "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return new URLSearchParams(body).toString();
  }

  try {
    return JSON.stringify(body);
  } catch {
    return "";
  }
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : "";
}

async function getBodyString(req, contentType) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");

  if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
    return serializeParsedBody(req.body, contentType);
  }

  return readRawBody(req);
}

function adaptNetlifyHandler(netlifyHandler) {
  return async function vercelHandler(req, res) {
    const headers = normalizeHeaders(req.headers || {});
    const contentType = headers["content-type"] || "";
    const body = await getBodyString(req, contentType);

    const event = {
      httpMethod: String(req.method || "GET").toUpperCase(),
      headers,
      body,
      queryStringParameters: req.query || {},
      rawUrl: req.url || "",
      path: String(req.url || "").split("?")[0]
    };

    let result;
    try {
      result = await netlifyHandler(event, {});
    } catch (error) {
      console.error("[api] handler error:", error);
      res.status(500).send("Internal Server Error");
      return;
    }

    const statusCode = Number(result?.statusCode) || 200;
    const responseHeaders = result?.headers || {};
    const responseBody = result?.body ?? "";

    for (const [key, value] of Object.entries(responseHeaders)) {
      if (value !== undefined) {
        res.setHeader(key, value);
      }
    }

    res.status(statusCode).send(responseBody);
  };
}

module.exports = { adaptNetlifyHandler };
