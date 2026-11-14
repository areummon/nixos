import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type Thinking = (typeof THINKING)[number];

export type AdvisorConfig = {
  enabled: boolean;
  model: string;
  timeoutMs: number;
  maxDigestChars: number;
  thinking?: Thinking;
};

export const DEFAULTS: AdvisorConfig = {
  enabled: true,
  model: "anthropic/claude-sonnet-5-5",
  timeoutMs: 20000,
  maxDigestChars: 12000,
};

// Each bad field is named and replaced by its default, so one typo does not
// silently disable the rest of the file.
export function parseConfig(raw: unknown): { config: AdvisorConfig; problems: string[] } {
  const problems: string[] = [];
  if (raw === undefined) return { config: DEFAULTS, problems };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { config: DEFAULTS, problems: ["not an object"] };
  const r = raw as Record<string, unknown>;
  const pick = <T>(key: keyof AdvisorConfig, ok: (v: unknown) => boolean, fallback: T): T => {
    if (r[key] === undefined) return fallback;
    if (ok(r[key])) return r[key] as T;
    problems.push(key);
    return fallback;
  };
  const positive = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
  return {
    config: {
      enabled: pick("enabled", (v) => typeof v === "boolean", DEFAULTS.enabled),
      model: pick("model", (v) => typeof v === "string" && v.indexOf("/") > 0, DEFAULTS.model),
      timeoutMs: pick("timeoutMs", positive, DEFAULTS.timeoutMs),
      maxDigestChars: pick("maxDigestChars", positive, DEFAULTS.maxDigestChars),
      thinking: pick<Thinking | undefined>("thinking", (v) => THINKING.includes(v as Thinking), undefined),
    },
    problems,
  };
}

export function loadConfig(): { config: AdvisorConfig; problems: string[] } {
  const path = process.env.PI_ADVISOR_CONFIG ?? join(process.env.HOME ?? "/tmp", ".pi", "agent", "advisor.json");
  if (!existsSync(path)) return parseConfig(undefined);
  try {
    return parseConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch (err) {
    return { config: DEFAULTS, problems: [`${path}: ${(err as Error).message}`] };
  }
}
