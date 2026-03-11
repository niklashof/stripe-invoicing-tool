const { appendLine } = require("./storage");

const AUDIT_LOG_FILE = "audit.log";

function logAuditEvent(event, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    ...details,
  };
  appendLine(AUDIT_LOG_FILE, JSON.stringify(entry));
}

module.exports = { logAuditEvent };
