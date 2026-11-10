import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { loadConfig } from "./config.ts";
import { buildDigest, renderDigest, textOf, toolCallsOf } from "./digest.ts";
import {
  CALL_ENTRY, type AdvisorState, type CallRecord, isRepeat, latestState, parseCommand, shouldContinue, skipReason, STATE_ENTRY, tally,
} from "./policy.ts";
import { ADVISOR_PROMPT, NONE, parseVerdict, type Verdict } from "./verdict.ts";

// Reasoning tokens count against this, so it is small but not tight.
const MAX_TOKENS = 2048;

export default function (pi: ExtensionAPI) {
  const { config, problems } = loadConfig();
  const fallback: AdvisorState = { enabled: config.enabled, model: config.model };
  let state = fallback;
  let continuedThisRun = false;

  const showStatus = (ctx: ExtensionContext, extra?: string) => {
    const base = `advisor ${state.enabled ? "on" : "off"} (${state.model})`;
    const bad = problems.length ? ` bad advisor.json: ${problems.join(", ")}` : "";
    ctx.ui.setStatus("advisor", base + (extra ? ` ${extra}` : "") + bad);
  };

  const setState = (ctx: ExtensionContext, next: AdvisorState) => {
    state = next;
    pi.appendEntry(STATE_ENTRY, state);
    showStatus(ctx);
  };

  const restore = (ctx: ExtensionContext) => {
    state = latestState(ctx.sessionManager.getBranch() as any) ?? fallback;
    showStatus(ctx);
  };
  pi.on("session_start", async (_e, ctx) => restore(ctx));
  pi.on("session_tree", async (_e, ctx) => restore(ctx));
  pi.on("agent_start", async () => {
    continuedThisRun = false;
  });

  async function advise(ctx: ExtensionContext, digest: string): Promise<{ verdict: Verdict; record: CallRecord }> {
    const started = Date.now();
    const fail = (error: string) => ({ verdict: NONE, record: { model: state.model, ms: Date.now() - started, level: NONE.level, error } });
    const slash = state.model.indexOf("/");
    const model = ctx.modelRegistry.find(state.model.slice(0, slash), state.model.slice(slash + 1));
    if (!model) return fail("unknown model");
    const signal = AbortSignal.any([AbortSignal.timeout(config.timeoutMs), ...(ctx.signal ? [ctx.signal] : [])]);
    try {
      const messages: any[] = [
        { role: "system", content: ADVISOR_PROMPT },
        { role: "user", content: digest, timestamp: Date.now() },
      ];
      // No sessionId: transports cache a socket per id (codex keeps one open for
      // 5 minutes) and Pi only closes its own session's on exit.
      const options: any = { maxTokens: MAX_TOKENS, signal, ...(config.thinking ? { reasoning: config.thinking } : {}) };
      const msg: any = await ctx.modelRegistry.streamSimple(model, { messages } as any, options).result();
      if (msg?.stopReason === "error" || msg?.stopReason === "aborted") return fail(msg.errorMessage ?? msg.stopReason);
      const verdict = parseVerdict(textOf(msg?.content));
      return { verdict, record: { model: state.model, ms: Date.now() - started, level: verdict.level, usage: msg?.usage } };
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  pi.on("turn_end", async (event, ctx) => {
    const calls = toolCallsOf(event.message.content);
    const finalAnswer = calls.length === 0;
    const skip = skipReason({
      enabled: state.enabled,
      outcome: event.outcome,
      aborted: ctx.signal?.aborted ?? false,
      toolNames: calls.map((c) => c.name),
      finalText: textOf(event.message.content),
    });
    if (skip) return;
    const digest = buildDigest(
      { contextMessages: event.context.contextMessages as any, message: event.message, toolResults: event.toolResults as any },
      config.maxDigestChars,
    );
    const { verdict, record } = await advise(ctx, renderDigest(digest, config.maxDigestChars));
    showStatus(ctx, record.error ? `failed: ${record.error}` : undefined);
    const repeat = verdict.level !== "none" && isRepeat(verdict.note, digest.earlierNotes);
    const entries = [...event.entries, { type: "custom" as const, customType: CALL_ENTRY, data: repeat ? { ...record, repeat } : record }];
    if (verdict.level === "none" || repeat) return { entries };
    entries.push({
      type: "custom_message",
      customType: "advisor",
      content: `[advisor ${verdict.level}] ${verdict.note}`,
      display: true,
      details: { ...verdict, usage: record.usage },
    } as any);
    if (verdict.level === "blocker") ctx.ui.notify(`advisor blocker: ${verdict.note}`, "error");
    if (!shouldContinue(verdict.level, finalAnswer, continuedThisRun)) return { entries };
    continuedThisRun = true;
    return { entries, continue: true };
  });

  pi.registerMessageRenderer("advisor", (message, { outputPad }, theme) => {
    const { level, note } = (message.details ?? {}) as Partial<Verdict>;
    const label = `advisor ${level ?? ""}`.trim();
    const body = note ?? String(message.content);
    if (level === "blocker") {
      const rule = { render: (width: number) => [theme.fg("error", "━".repeat(Math.max(1, width)))], invalidate() {} };
      const box = new Container();
      box.addChild(rule);
      box.addChild(new Text(theme.fg("error", theme.bold(`${label.toUpperCase()}: ${body}`)), outputPad, 0));
      box.addChild(rule);
      return box;
    }
    const color = level === "concern" ? "warning" : "dim";
    return new Text(theme.fg(color, `[${label}] ${body}`), outputPad, 0);
  });

  pi.registerCommand("advisor", {
    description: "Toggle the advisor model, or: on | off | status | model <provider/id>",
    handler: async (args, ctx) => {
      const cmd = parseCommand(args);
      switch (cmd.kind) {
        case "toggle":
          return setState(ctx, { ...state, enabled: !state.enabled });
        case "on":
        case "off":
          return setState(ctx, { ...state, enabled: cmd.kind === "on" });
        case "model": {
          const slash = cmd.model.indexOf("/");
          if (!ctx.modelRegistry.find(cmd.model.slice(0, slash), cmd.model.slice(slash + 1))) {
            return ctx.ui.notify(`advisor: unknown model ${cmd.model}`, "error");
          }
          return setState(ctx, { ...state, model: cmd.model });
        }
        case "status": {
          const t = tally(ctx.sessionManager.getBranch() as any);
          return ctx.ui.notify(
            `advisor ${state.enabled ? "on" : "off"}, ${state.model}: ${t.calls} calls, ${t.nonNone} notes, ${t.failures} failed, ${t.tokens} tokens, $${t.cost.toFixed(4)}`,
            "info",
          );
        }
        case "usage":
          return ctx.ui.notify("usage: /advisor [on|off|status|model <provider/id>]", "warning");
      }
    },
  });
}
