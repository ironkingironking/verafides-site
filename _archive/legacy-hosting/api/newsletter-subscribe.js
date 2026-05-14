"use strict";

const { adaptNetlifyHandler } = require("./_lib/netlify-adapter");
const { handler } = require("../netlify/functions/newsletter-subscribe");

module.exports = adaptNetlifyHandler(handler);
