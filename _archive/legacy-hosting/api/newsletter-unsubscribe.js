"use strict";

const { adaptNetlifyHandler } = require("./_lib/netlify-adapter");
const { handler } = require("../netlify/functions/newsletter-unsubscribe");

module.exports = adaptNetlifyHandler(handler);
