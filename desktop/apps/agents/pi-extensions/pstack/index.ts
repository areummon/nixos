import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const contract = readFileSync(join(root, "PI-COMPATIBILITY.md"), "utf8");
const marker = "[PSTACK PI RUNTIME]";
const stateType = "pstack-mode";
const body = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, "");
const skills = readdirSync(join(root, "skills"), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => {
    const path = join(root, "skills", entry.name, "SKILL.md");
    const text = readFileSync(path, "utf8");
    const description = /^description:\s*(.+)$/m.exec(text)?.[1]?.replace(/^['"]|['"]$/g, "") ?? entry.name;
    return { name: entry.name, path, description, mode: /^mode:\s*true\s*$/m.test(text) };
  });

export default function pstack(pi: ExtensionAPI) {
  let active: string | undefined;
  const status = (ctx: ExtensionContext) => ctx.ui.setStatus("pstack", active ? `pstack: ${active}` : undefined);
  const restore = (ctx: ExtensionContext) => {
    active = undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === stateType) {
        const name = (entry.data as { mode?: string } | undefined)?.mode;
        active = skills.some(skill => skill.mode && skill.name === name) ? name : undefined;
      }
    }
    status(ctx);
  };
  const setMode = (name: string | undefined, ctx: ExtensionContext) => {
    active = name;
    pi.appendEntry(stateType, { mode: name ?? null });
    status(ctx);
  };
  const guidance = () => {
    const skill = skills.find(skill => skill.name === active);
    const mode = skill ? `\n\nActive mode ${skill.name}. Resolve its references from ${dirname(skill.path)}.\n${body(readFileSync(skill.path, "utf8")).split("## Adapted upstream workflow\n").pop()}` : "";
    return `${marker}\nPackage root: ${root}\n${contract}${mode}\n[/PSTACK PI RUNTIME]`;
  };
  for (const event of ["session_start", "session_switch", "session_tree", "session_fork"] as const) {
    pi.on(event, async (_event, ctx) => restore(ctx));
  }

  // Also runs on OptChat report-driven continuations which can bypass
  // before_agent_start. System guidance survives replacement of older messages.
  pi.on("context_with_system", async event => {
    const messages = [...event.messages];
    const i = messages.findIndex(message => message.role === "system");
    if (i < 0) return;
    const message = messages[i] as any;
    const content = message.content;
    const text = typeof content === "string" ? content : JSON.stringify(content);
    if (text.includes(marker)) return;
    messages[i] = {
      ...message,
      content: typeof content === "string"
        ? `${content}\n\n${guidance()}`
        : [...content, { type: "text", text: guidance() }],
    };
    return { messages };
  });

  pi.registerCommand("pstack", {
    description: "Pstack status and commands: /pstack [off]",
    handler: async (args, ctx) => {
      if (args.trim() === "off") setMode(undefined, ctx);
      else if (args.trim() && args.trim() !== "status") {
        ctx.ui.notify("Usage: /pstack [status|off]", "warning");
        return;
      }
      ctx.ui.notify(`Pstack: ${skills.length} skills; mode ${active ?? "off"}.\nCommands: ${skills.map(s => `/${s.name}`).join(", ")}\nOptChat delegates inherit its configured model. /loop is not installed.`, "info");
    },
  });

  for (const skill of skills) {
    pi.registerCommand(skill.name, {
      description: skill.mode ? `${skill.description} (on|off|status|task)` : skill.description,
      handler: async (args, ctx) => {
        const task = args.trim();
        if (skill.mode) {
          if (task === "off") {
            setMode(undefined, ctx);
            ctx.ui.notify(`${skill.name} disabled`, "info");
            return;
          }
          if (task === "status") {
            ctx.ui.notify(`${skill.name}: ${active === skill.name ? "on" : "off"}`, "info");
            return;
          }
          setMode(skill.name, ctx);
          if (!task || task === "on") {
            ctx.ui.notify(`${skill.name} enabled for this session. Supply a task when ready.`, "info");
            return;
          }
        }
        // A workflow command grants delegation only for this task. The model
        // still follows the user's approval rules and never waits for children.
        pi.sendUserMessage(`Apply the pstack ${skill.name} workflow. Read ${skill.path} and ${join(root, "PI-COMPATIBILITY.md")} first. Resolve references relative to the skill directory.\n\n${task || "Explain this workflow and ask what task to apply it to."}`, { deliverAs: "followUp" });
      },
    });
  }
}
