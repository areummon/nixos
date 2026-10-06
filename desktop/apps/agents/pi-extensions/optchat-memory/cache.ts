// Spec §8, Anthropic: `cache_control` on every view piece except the last (the
// piece cut at each 50k/80k/100k mark), plus the request-end mark Pi adds to
// the last message. At most 4 breakpoints per request, so the marks Pi puts on
// the system blocks and the last tool are removed: the first view mark already
// caches the tools and system prompt before it.

type Block = { type?: string; text?: string; cache_control?: unknown; [k: string]: unknown };
type Message = { role?: string; content?: string | Block[] };

const EPHEMERAL = { type: "ephemeral" };

function stripMarks(blocks: unknown): void {
  if (!Array.isArray(blocks)) return;
  for (const b of blocks) if (b && typeof b === "object") delete (b as Block).cache_control;
}

// Returns the payload with breakpoints on `pieces[0..n-1)`, or undefined when
// the request is not an Anthropic Messages request whose messages start with
// exactly these pieces (then the request goes out unchanged).
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

  stripMarks(params.system);
  stripMarks(params.tools);
  for (const block of targets) block.cache_control = EPHEMERAL;

  return params;
}
