import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Config = { timeoutMs: number; maxChars: number; disabled: string[] };

export const DEFAULTS: Config = { timeoutMs: 15000, maxChars: 4000, disabled: [] };

const positiveInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

export function parseConfig(raw: unknown, knownIds: readonly string[], source: string): Config {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${source}: expected a JSON object`);
  const { timeoutMs = DEFAULTS.timeoutMs, maxChars = DEFAULTS.maxChars, disabled = DEFAULTS.disabled } = raw as Record<string, unknown>;
  if (!positiveInt(timeoutMs)) throw new Error(`${source}: timeoutMs must be a positive integer`);
  if (!positiveInt(maxChars)) throw new Error(`${source}: maxChars must be a positive integer`);
  if (!Array.isArray(disabled) || !disabled.every((id) => typeof id === "string" && knownIds.includes(id))) {
    throw new Error(`${source}: disabled must list checker ids from ${knownIds.join(", ")}`);
  }
  return { timeoutMs, maxChars, disabled };
}

export function loadConfig(knownIds: readonly string[]): Config {
  const path = process.env.PI_DIAGNOSTICS_CONFIG ?? join(process.env.HOME ?? "/tmp", ".pi", "agent", "diagnostics.json");
  if (!existsSync(path)) return DEFAULTS;
  return parseConfig(JSON.parse(readFileSync(path, "utf8")), knownIds, path);
}
