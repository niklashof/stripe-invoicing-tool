import { appendLine } from "./storage";

const AUDIT_LOG_FILE = "audit.log";

export function logAuditEvent(event: string, details: Record<string, unknown> = {}): void {
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    ...details,
  };

  appendLine(AUDIT_LOG_FILE, JSON.stringify(entry));
}
