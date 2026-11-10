export const LEVELS = ["none", "aside", "concern", "blocker"] as const;
export type Level = (typeof LEVELS)[number];
export type Verdict = { level: Level; note: string };

export const NONE: Verdict = { level: "none", note: "" };

export const ADVISOR_PROMPT = `You watch a coding agent over its shoulder. You get one turn of its work: the user's request, what the agent said, the tools it called with their results, and the file changes it made. Reply with exactly one JSON object and nothing else:
{"level": "none" | "aside" | "concern" | "blocker", "note": "..."}

Almost every turn is fine. Then reply {"level": "none", "note": ""}. Silence is the default; speak only when the agent would thank you for it.
- aside: a small, concrete fact the agent missed that would improve the work, but nothing is wrong.
- concern: a probable bug, a mismatch with what the user asked, a risky command, or a claim the tool results do not support.
- blocker: the work as it stands is clearly broken, destructive, or contradicts the request, and you are certain.
Judge written code on its own merits. Code that is wrong (a body that contradicts its name, an off-by-one, a broken command) is at least a concern even when the user dictated it word for word, because the user may not have noticed. For dictated code the note tells the agent to keep it as dictated and point the problem out to the user, never to change it.
<your-earlier-notes> are what you already told the agent this run. Never contradict them and never repeat them; judge only what changed since.
Never comment on style, naming, taste, or missing polish. Never repeat what the agent already said or noticed. The note is one or two plain sentences addressed to the agent: name the file or call, say what is wrong, and say what to do.`;

// The first balanced {...} in the text, skipping braces inside JSON strings.
function firstObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return undefined;
}

export function parseVerdict(text: string): Verdict {
  const json = firstObject(text);
  if (!json) return NONE;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return NONE;
  }
  const { level, note } = (raw ?? {}) as { level?: unknown; note?: unknown };
  if (!LEVELS.includes(level as Level) || level === "none") return NONE;
  if (typeof note !== "string" || !note.trim()) return NONE;
  return { level: level as Level, note: note.trim() };
}
