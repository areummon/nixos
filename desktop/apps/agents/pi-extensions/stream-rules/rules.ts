import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Where = "text" | "tool";

export type Rule = {
  id: string;
  regex: RegExp;
  in: ReadonlySet<Where>;
  tools?: ReadonlySet<string>;
  paths?: readonly RegExp[];
  reminder: string;
};

export type Config = { maxFiresPerRule: number; rules: readonly Rule[] };

export type Loaded = { config: Config; problems: string[] };

const DEFAULT_MAX_FIRES = 2;

export function configPath(): string {
  return process.env.PI_STREAM_RULES_CONFIG ?? join(homedir(), ".pi", "agent", "stream-rules.json");
}

export function loadConfig(path = configPath()): Loaded {
  if (!existsSync(path)) return parseConfig({});
  try {
    return parseConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch (err) {
    return { config: { maxFiresPerRule: DEFAULT_MAX_FIRES, rules: [] }, problems: [`${path}: ${String(err)}`] };
  }
}

export function parseConfig(raw: unknown): Loaded {
  const problems: string[] = [];
  const obj = isObject(raw) ? raw : {};
  if (!isObject(raw)) problems.push("config is not a JSON object; no rules loaded");
  let maxFiresPerRule = DEFAULT_MAX_FIRES;
  if (obj.maxFiresPerRule !== undefined) {
    if (Number.isInteger(obj.maxFiresPerRule) && (obj.maxFiresPerRule as number) >= 1) maxFiresPerRule = obj.maxFiresPerRule as number;
    else problems.push(`maxFiresPerRule must be a positive integer; using ${DEFAULT_MAX_FIRES}`);
  }
  const rules: Rule[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(obj.rules) ? obj.rules : [];
  if (obj.rules !== undefined && !Array.isArray(obj.rules)) problems.push("rules must be an array");
  list.forEach((entry, i) => {
    const rule = compileRule(entry);
    const label = isObject(entry) && typeof entry.id === "string" ? `rule "${entry.id}"` : `rule #${i}`;
    if (typeof rule === "string") problems.push(`${label} skipped: ${rule}`);
    else if (seen.has(rule.id)) problems.push(`${label} skipped: duplicate id`);
    else {
      seen.add(rule.id);
      rules.push(rule);
    }
  });
  return { config: { maxFiresPerRule, rules }, problems };
}

function compileRule(raw: unknown): Rule | string {
  if (!isObject(raw)) return "not an object";
  const { id, pattern, flags = "", scope = {}, reminder } = raw;
  if (typeof id !== "string" || id === "") return "id must be a non-empty string";
  if (typeof pattern !== "string" || pattern === "") return "pattern must be a non-empty string";
  if (typeof flags !== "string") return "flags must be a string";
  if (typeof reminder !== "string" || reminder.trim() === "") return "reminder must be a non-empty string";
  if (!isObject(scope)) return "scope must be an object";
  let regex: RegExp;
  try {
    // g and y make exec() stateful through lastIndex; every scan starts fresh.
    regex = new RegExp(pattern, flags.replace(/[gy]/g, ""));
  } catch (err) {
    return `bad regex: ${(err as Error).message}`;
  }
  const tools = stringList(scope.tools, "scope.tools");
  const paths = stringList(scope.paths, "scope.paths");
  if (typeof tools === "string") return tools;
  if (typeof paths === "string") return paths;
  const narrowsTools = tools !== undefined || paths !== undefined;
  const where = stringList(scope.in, "scope.in") ?? (narrowsTools ? ["tool"] : ["text", "tool"]);
  if (typeof where === "string") return where;
  if (where.length === 0 || where.some((w) => w !== "text" && w !== "tool")) return 'scope.in must list "text" and/or "tool"';
  if (narrowsTools && !where.includes("tool")) return 'scope.tools and scope.paths need "tool" in scope.in';
  return {
    id,
    regex,
    in: new Set(where as Where[]),
    ...(tools ? { tools: new Set(tools) } : {}),
    ...(paths ? { paths: paths.map(globToRegExp) } : {}),
    reminder: reminder.trim(),
  };
}

function stringList(value: unknown, name: string): string[] | undefined | string {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return `${name} must be an array of strings`;
  return value;
}

// A glob without "/" matches the basename, like .gitignore; one with "/" must
// match a whole trailing run of path segments, so "src/*.js" matches "/w/src/a.js".
export function globToRegExp(glob: string): RegExp {
  const g = glob.replace(/^\.\//, "");
  let body = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") {
      body += g[i + 2] === "/" ? "(.*/)?" : ".*";
      i += g[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") body += "[^/]*";
    else if (c === "?") body += "[^/]";
    else body += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`(^|/)${body}$`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
