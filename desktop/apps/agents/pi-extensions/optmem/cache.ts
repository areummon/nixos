// Spec §3.3, Anthropic: `cache_control` on the last whole view block, so the
// next call, looking back up to 20 blocks from its own mark, finds this one and
// writes only the lines after it. A second mark LOOKBACK blocks earlier covers
// a turn that logs more than 20 blocks of lines. With Pi's mark on the last
// system block and on the request end that makes 4, the API's limit, so Pi's
// marks on earlier system blocks and on the last tool are removed.

type Block = { type?: string; text?: string; cache_control?: unknown; [k: string]: unknown };
type Message = { role?: string; content?: string | Block[] };

const EPHEMERAL = { type: "ephemeral" };
const LOOKBACK = 19;

function stripMarks(blocks: unknown, keepLast = false): void {
  if (!Array.isArray(blocks)) return;
  const end = keepLast ? blocks.length - 1 : blocks.length;
  for (const b of blocks.slice(0, end)) if (b && typeof b === "object") delete (b as Block).cache_control;
}

// Returns the payload with breakpoints on the view's whole blocks
// (`pieces[0..n-1)`), or undefined when the request is not an Anthropic
// Messages request whose messages start with exactly these pieces (then the
// request goes out unchanged).
export function markViewBreakpoints(payload: unknown, pieces: string[]): unknown | undefined {
  const params = payload as { system?: unknown; tools?: unknown; messages?: Message[] } | undefined;
  if (!params || !Array.isArray(params.messages) || pieces.length < 2) return undefined;

  // Locate each piece as a text block, in order, from the start of the messages.
  const targets: Block[] = [];
  let next = 0;
  for (const msg of params.messages) {
    if (next === pieces.length - 1) break;
    if (msg.role !== "user") return undefined;
    if (typeof msg.content === "string") msg.content = [{ type: "text", text: msg.content }];
    if (!Array.isArray(msg.content)) return undefined;
    for (const block of msg.content) {
      if (next === pieces.length - 1) break;
      if (block.type !== "text" || block.text !== pieces[next]) return undefined;
      targets.push(block);
      next++;
    }
  }
  if (targets.length !== pieces.length - 1) return undefined;

  stripMarks(params.system, true);
  stripMarks(params.tools);
  const last = targets.length - 1;
  targets[last].cache_control = EPHEMERAL;
  if (last >= LOOKBACK) targets[last - LOOKBACK].cache_control = EPHEMERAL;

  return params;
}
