/**
 * Typed wrappers around node:sqlite StatementSync.
 *
 * node:sqlite returns Record<string, SQLOutputValue> from .get()/.all();
 * these helpers cast through unknown to our domain types, keeping all DB
 * access in a single consistent pattern.
 */
import type { StatementSync } from "node:sqlite";

type SQLParam = null | number | bigint | string | Uint8Array;

export function queryAll<T>(stmt: StatementSync, ...params: SQLParam[]): T[] {
  return (stmt.all(...params) as unknown) as T[];
}

export function queryOne<T>(stmt: StatementSync, ...params: SQLParam[]): T | undefined {
  return (stmt.get(...params) as unknown) as T | undefined;
}

/** Convenience: run + return changes count */
export function exec(stmt: StatementSync, ...params: SQLParam[]): number {
  const result = stmt.run(...params);
  return Number(result.changes);
}
