"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const errors = [];

function fail(message) {
  errors.push(message);
}

function walk(dir, predicate, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(filePath, predicate, results);
    } else if (entry.isFile() && predicate(filePath)) {
      results.push(filePath);
    }
  }
  return results;
}

function rel(filePath) {
  return path.relative(publicDir, filePath).replaceAll(path.sep, "/");
}

function isAliasPage(html) {
  return /http-equiv=(?:"|')?refresh/i.test(html);
}

function shouldSkipSeo(filePath, html) {
  const relative = rel(filePath);
  return relative.startsWith("admin/") || isAliasPage(html);
}

function getAttribute(tag, name) {
  const pattern = new RegExp(`${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(pattern);
  return match ? match[1] || match[2] || match[3] || "" : "";
}

function localUrlExists(url) {
  if (!url || url.startsWith("#")) return true;
  if (/^(https?:|mailto:|tel:|data:|javascript:)/i.test(url)) return true;

  const clean = url.split("#")[0].split("?")[0];
  if (!clean || !clean.startsWith("/")) return true;

  if (clean === "/") return fs.existsSync(path.join(publicDir, "index.html"));
  if (/\.[a-z0-9]+$/i.test(clean)) return fs.existsSync(path.join(publicDir, clean));

  return (
    fs.existsSync(path.join(publicDir, clean, "index.html")) ||
    fs.existsSync(path.join(publicDir, `${clean}.html`))
  );
}

function checkSeo(filePath, html) {
  if (shouldSkipSeo(filePath, html)) return;

  const relative = rel(filePath);
  const titleCount = (html.match(/<title>/g) || []).length;
  if (titleCount !== 1) fail(`${relative}: expected exactly one <title>, found ${titleCount}`);

  const description = html.match(/<meta\s+name=(?:"|')?description(?:"|')?\s+content=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  if (!description) fail(`${relative}: missing non-empty meta description`);

  if (!/<link\s+rel=(?:"|')?canonical(?:"|')?\s+href=/i.test(html)) {
    fail(`${relative}: missing canonical link`);
  }

  if (!/<meta\s+name=(?:"|')?robots(?:"|')?\s+content=/i.test(html)) {
    fail(`${relative}: missing robots meta tag`);
  }

  for (const property of ["og:title", "og:description", "og:type", "og:url", "og:site_name"]) {
    const pattern = new RegExp(`<meta\\s+property=(?:"|')?${property}(?:"|')?\\s+content=`, "i");
    if (!pattern.test(html)) fail(`${relative}: missing ${property}`);
  }

  for (const name of ["twitter:card", "twitter:title", "twitter:description"]) {
    const pattern = new RegExp(`<meta\\s+name=(?:"|')?${name}(?:"|')?\\s+content=`, "i");
    if (!pattern.test(html)) fail(`${relative}: missing ${name}`);
  }
}

function checkJsonLd(filePath, html) {
  const relative = rel(filePath);
  const pattern = /<script\s+type=(?:"|')?application\/ld\+json(?:"|')?[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    try {
      JSON.parse(match[1]);
    } catch (error) {
      fail(`${relative}: invalid JSON-LD: ${error.message}`);
    }
  }
}

function checkInternalLinks(filePath, html) {
  if (rel(filePath).startsWith("admin/")) return;
  const linkPattern = /href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let match;
  while ((match = linkPattern.exec(html))) {
    const url = match[1] || match[2] || match[3] || "";
    if (!localUrlExists(url)) fail(`${rel(filePath)}: missing internal link target ${url}`);
  }
}

function checkRobotsAndSitemap() {
  const robotsPath = path.join(publicDir, "robots.txt");
  const sitemapPath = path.join(publicDir, "sitemap.xml");

  if (!fs.existsSync(robotsPath)) {
    fail("robots.txt: missing");
  } else {
    const robots = fs.readFileSync(robotsPath, "utf8");
    if (!/User-agent:\s*\*/i.test(robots)) fail("robots.txt: missing User-agent: *");
    if (!/Sitemap:\s*https:\/\/verafides\.ch\/sitemap\.xml/i.test(robots)) {
      fail("robots.txt: missing sitemap reference");
    }
  }

  if (!fs.existsSync(sitemapPath)) {
    fail("sitemap.xml: missing");
  } else {
    const sitemap = fs.readFileSync(sitemapPath, "utf8");
    for (const technicalUrl of ["/categories/", "/tags/", "/pages/", "/documents/"]) {
      if (sitemap.includes(`https://verafides.ch${technicalUrl}`)) {
        fail(`sitemap.xml: technical URL should not be indexed: ${technicalUrl}`);
      }
    }
  }
}

if (!fs.existsSync(publicDir)) {
  fail("public/: missing; run npm run build first");
} else {
  const htmlFiles = walk(publicDir, (filePath) => filePath.endsWith(".html"));
  for (const filePath of htmlFiles) {
    const html = fs.readFileSync(filePath, "utf8");
    checkSeo(filePath, html);
    checkJsonLd(filePath, html);
    checkInternalLinks(filePath, html);
  }
  checkRobotsAndSitemap();
}

if (errors.length > 0) {
  console.error(`Site lint failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Site lint passed.");
