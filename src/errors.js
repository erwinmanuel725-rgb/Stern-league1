'use strict';
class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || {}; this.expose = true; }
}
module.exports = { HttpError };
