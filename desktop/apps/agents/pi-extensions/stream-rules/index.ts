import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { FIRED_ENTRY, FireCap, firedRules } from "./fires.ts";
import { type Block, type Fire, findFire } from "./match.ts";
import { type AssistantLike, keptText, reminderText, sectionText, truncate } from "./rewrite.ts";
import { loadConfig } from "./rules.ts";

const MESSAGE_TYPE = "stream-rule";
const SECTION = "stream-rules";

type BranchEntry = { type: string; message?: { role: string; content?: unknown } };

const latestUserText = (branch: BranchEntry[]): string => {
  const content = branch.findLast((e) => e.type === "message" && e.message?.role === "user")?.message?.content;
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.filter((b) => b?.type === "text").map((b) => b.text).join("\n") : "";
};

export default function (pi: ExtensionAPI) {
  const { config, problems } = loadConfig();
  const cap = new FireCap(config.maxFiresPerRule);
  // The fire that aborted the current run; kept until the run settles.
  let pending: { fire: Fire; kept?: string[] } | undefined;

  pi.on("session_start", async (_event, ctx) => {
    for (const p of problems) ctx.ui.notify(`stream-rules: ${p}`, "warning");
  });

  // Not a context_with_system edit: when any before_agent_start handler returns
  // systemPrompt (gondolin and OptMem both do), Pi replaces every system message
  // of the request with that forced text. Once a prompt is forced, a section
  // edit no longer renders, so append to the forced text instead; later
  // forcers chain from it.
  pi.on("before_agent_start", async (event, ctx) => {
    if (event.messageType === "user") cap.reset();
    const text = sectionText(firedRules(ctx.sessionManager.getBranch() as any[], config.rules));
    if (!text) return;
    if (event.systemPromptOptions.forceSystemPrompt === undefined) {
      event.systemPromptOptions.sections[SECTION] = text;
      return;
    }
    return { systemPrompt: `${event.systemPrompt}\n\n<${SECTION}>\n${text}\n</${SECTION}>` };
  });

  pi.on("message_update", async (event, ctx) => {
    if (pending || config.rules.length === 0) return;
    const update = event.assistantMessageEvent as { type: string; contentIndex?: number };
    if (update.contentIndex === undefined) return;
    const block = (event.message as { content?: Block[] }).content?.[update.contentIndex];
    const fire = findFire(config.rules.filter((r) => cap.isOn(r)), { type: update.type, contentIndex: update.contentIndex }, block);
    if (!fire) return;
    pending = { fire };
    const where = fire.kind === "tool" ? `${fire.tool}${fire.path ? ` ${fire.path}` : ""} call` : "text";
    ctx.ui.notify(`stream-rules: "${fire.rule.id}" matched in ${where}; regenerating`, "info");
    if (cap.record(fire.rule)) {
      ctx.ui.notify(`stream-rules: "${fire.rule.id}" fired ${cap.max} times this prompt; off until the next prompt`, "warning");
    }
    ctx.abort();
  });

  pi.on("message_end", async (event) => {
    if (!pending || pending.kept || event.message.role !== "assistant") return;
    const message = event.message as unknown as AssistantLike;
    pending.kept = keptText(message, pending.fire);
    return { message: truncate(message, pending.kept) as any };
  });

  // Only a run this extension aborted has pending set, so a user's Esc never resumes.
  pi.on("agent_settled", async (_event, ctx) => {
    if (!pending) return;
    const { fire, kept = [] } = pending;
    pending = undefined;
    pi.appendEntry(FIRED_ENTRY, { id: fire.rule.id });
    pi.sendMessage(
      {
        customType: MESSAGE_TYPE,
        content: reminderText(fire, kept, latestUserText(ctx.sessionManager.getBranch() as any)),
        display: true,
        details: { ruleId: fire.rule.id, kind: fire.kind, ...(fire.kind === "tool" ? { tool: fire.tool, path: fire.path } : {}) },
      },
      { triggerTurn: true },
    );
  });

  pi.registerMessageRenderer(MESSAGE_TYPE, (message, { expanded, outputPad }, theme) => {
    const details = message.details as { ruleId?: string } | undefined;
    const body = typeof message.content === "string" ? message.content : "";
    const summary = `${theme.fg("warning", `[stream rule ${details?.ruleId ?? "?"}]`)} ${body.split("\n")[0]}`;
    const box = new Box(outputPad, 1, (t: string) => theme.bg("customMessageBg", t));
    box.addChild(new Text(expanded ? `${summary}\n${theme.fg("dim", body)}` : summary, 0, 0));
    return box;
  });
}
