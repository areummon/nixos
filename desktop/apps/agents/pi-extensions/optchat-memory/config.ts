import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./types.ts";

function readJsonConfig(home: string): Partial<Config> {
  const path = process.env.PI_OPTCHAT_CONFIG ?? join(home, ".pi", "agent", "optchat-memory.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function num(env: string, fileValue: unknown, fallback: number): number {
  const value = process.env[env] ?? fileValue ?? fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(env: string, fileValue: unknown, fallback = false): boolean {
  if (process.env[env] !== undefined) return process.env[env] === "1" || process.env[env] === "true";
  if (typeof fileValue === "boolean") return fileValue;
  if (typeof fileValue === "string") return fileValue === "1" || fileValue === "true";
  return fallback;
}

// /home/u/projects/foo -> projects--foo; the home directory itself -> home.
function cwdKey(home: string): string {
  const cwd = process.cwd();
  const rel = cwd === home ? "" : cwd.startsWith(`${home}/`) ? cwd.slice(home.length + 1) : cwd.replace(/^\/+/, "");
  return rel.replaceAll("/", "--") || "home";
}

export function config(): Config {
  const home = process.env.HOME ?? "/tmp";
  const xdg = process.env.XDG_DATA_HOME ?? join(home, ".local", "share");
  const file = readJsonConfig(home);
  const projectBaseDir = process.env.PI_OPTCHAT_PROJECT_BASE_DIR || file.projectBaseDir || undefined;
  return {
    memoryDir: process.env.PI_OPTCHAT_MEMORY_DIR
      ?? (projectBaseDir ? join(projectBaseDir, cwdKey(home)) : file.memoryDir ?? join(xdg, "pi", "optchat-memory", "default")),
    projectBaseDir,
    globalMemoryDir: process.env.PI_OPTCHAT_GLOBAL_MEMORY_DIR || file.globalMemoryDir || undefined,
    nodeBytes: num("PI_OPTCHAT_NODE_BYTES", file.nodeBytes, 512),
    viewBytes: num("PI_OPTCHAT_VIEW_BYTES", file.viewBytes, 128000),
    jobs: num("PI_OPTCHAT_JOBS", file.jobs, 8),
    tries: num("PI_OPTCHAT_TRIES", file.tries, 5),
    retryMs: num("PI_OPTCHAT_RETRY_MS", file.retryMs, 10000),
    capChars: num("PI_OPTCHAT_CAP_CHARS", file.capChars, 30000),
    replaceContext: bool("PI_OPTCHAT_REPLACE_CONTEXT", file.replaceContext, false),
    disableModelCompactor: bool("PI_OPTCHAT_DISABLE_MODEL_COMPACTOR", file.disableModelCompactor, false),
    // A cheap but competent model (§4.2, §10), e.g. "anthropic/claude-sonnet-5-5".
    compactorModel: process.env.PI_OPTCHAT_COMPACTOR_MODEL || file.compactorModel || undefined,
    compactorThinking: process.env.PI_OPTCHAT_COMPACTOR_THINKING || file.compactorThinking || undefined,
    // Reasoning tokens count against this, so leave room beyond the 512-byte line.
    compactorMaxTokens: num("PI_OPTCHAT_COMPACTOR_MAX_TOKENS", file.compactorMaxTokens, 16000),
  };
}
