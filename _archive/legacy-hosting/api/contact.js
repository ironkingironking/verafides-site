"use strict";

const { adaptNetlifyHandler } = require("./_lib/netlify-adapter");
const { handler } = require("../netlify/functions/contact");

module.exports = adaptNetlifyHandler(handler);
