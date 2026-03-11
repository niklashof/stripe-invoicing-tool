import { readJsonFile, writeJsonFile } from "./storage";
import type { ProcessedSessionsState } from "./types/app-types";

const FILE_NAME = "processed-sessions.json";

export function loadProcessedSessions(): ProcessedSessionsState {
  return readJsonFile<ProcessedSessionsState>(FILE_NAME, {});
}

export function hasProcessedSession(accountSlug: string, sessionId: string): boolean {
  const state = loadProcessedSessions();
  return Boolean(state[accountSlug]?.[sessionId]);
}

export function markProcessedSession(accountSlug: string, sessionId: string): void {
  const state = loadProcessedSessions();
  if (!state[accountSlug]) {
    state[accountSlug] = {};
  }
  state[accountSlug]![sessionId] = {
    processedAt: new Date().toISOString(),
  };
  writeJsonFile(FILE_NAME, state);
}
