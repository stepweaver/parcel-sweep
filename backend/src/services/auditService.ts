import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/index.js";
import { exec } from "../db/helpers.js";

export interface AuditEventInput {
  entityType: string;
  entityId: string;
  action: string;
  actor?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

export function writeAuditEvent(input: AuditEventInput): string {
  const id = uuidv4();
  const now = new Date().toISOString();
  exec(
    getDb().prepare(`
      INSERT INTO audit_events
        (id, entity_type, entity_id, action, actor, before_json, after_json, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    id,
    input.entityType,
    input.entityId,
    input.action,
    input.actor ?? "supervisor",
    input.before != null ? JSON.stringify(input.before) : null,
    input.after != null ? JSON.stringify(input.after) : null,
    input.reason ?? null,
    now
  );
  return id;
}
