const { readJsonFile, writeJsonFile } = require("./storage");

const FILE_NAME = "processed-sessions.json";

function loadProcessedSessions() {
  return readJsonFile(FILE_NAME, {});
}

function hasProcessedSession(accountSlug, sessionId) {
  const state = loadProcessedSessions();
  return Boolean(state[accountSlug]?.[sessionId]);
}

function markProcessedSession(accountSlug, sessionId) {
  const state = loadProcessedSessions();
  if (!state[accountSlug]) {
    state[accountSlug] = {};
  }
  state[accountSlug][sessionId] = {
    processedAt: new Date().toISOString(),
  };
  writeJsonFile(FILE_NAME, state);
}

module.exports = {
  hasProcessedSession,
  loadProcessedSessions,
  markProcessedSession,
};
