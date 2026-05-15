"use strict";

const { spawnSync } = require("child_process");

const siteKey = String(process.env.TURNSTILE_SITE_KEY || "").trim();
const requireTurnstile = process.env.VERAFIDES_REQUIRE_TURNSTILE !== "false";

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
