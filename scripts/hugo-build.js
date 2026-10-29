"use strict";

const { spawnSync } = require("child_process");

const siteKey = String(process.env.TURNSTILE_SITE_KEY || "").trim();
// Die Build-Prüfung in GitHub Actions hat keinen Turnstile-Schlüssel; auf dem Server bleibt er Pflicht.
const inCi = process.env.GITHUB_ACTIONS === "true";
const requireTurnstile = process.env.VERAFIDES_REQUIRE_TURNSTILE !== "false" && !inCi;

if (inCi && !siteKey) {
  console.warn("Build-Prüfung in GitHub Actions: ohne TURNSTILE_SITE_KEY gebaut (nur zur Kontrolle).");
}

if (requireTurnstile && (!siteKey || siteKey === "your_turnstile_site_key")) {
  console.error("TURNSTILE_SITE_KEY is missing; refusing to build forms without Turnstile.");
  process.exit(1);
}

const args = process.argv.slice(2);
const result = spawnSync("hugo", args.length > 0 ? args : ["--gc", "--minify", "--cleanDestinationDir"], {
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
