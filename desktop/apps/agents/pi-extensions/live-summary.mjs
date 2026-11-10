// Print a readable transcript of a live-run.sh run: node live-summary.mjs <run-dir>
import { readFileSync } from "node:fs";

const run = process.argv[2];
const events = readFileSync(`${run}/events.jsonl`, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const clip = (text, n = 600) => (text.length > n ? `${text.slice(0, n)}…[+${text.length - n}]` : text);
const text = (content) =>
  typeof content === "string"
    ? content
    : (content ?? [])
        .map((b) => (b.type === "text" ? b.text : b.type === "toolCall" ? `<toolCall ${b.name} ${JSON.stringify(b.arguments)}>` : b.type === "thinking" ? "" : `<${b.type}>`))
        .join("");

for (const e of events) {
  if (e.type === "agent_start" || e.type === "agent_end") console.log(`--- ${e.type}`);
  if (e.type === "message_end") {
    const m = e.message;
    if (m.role === "system") continue;
    const tag = m.role === "custom" ? `custom:${m.customType}` : m.role;
    const stop = m.stopReason ? ` [${m.stopReason}]` : "";
    console.log(`${tag}${stop}: ${clip(text(m.content))}`);
  }
  if (e.type === "tool_execution_end") console.log(`  tool ${e.toolName}${e.isError ? " ERROR" : ""} -> ${clip(text(e.result?.content), 900)}`);
}
