// memory_find: rank messages and summaries by words (BM25), nothing indexed.
// Ported from upstream's `memo find` (VictorTaelin/OptMem PR 18): case and
// accents are ignored, and each word also matches by its stem, its first five
// letters after a plural `s` goes, so `memories` finds `memory`; the exact word
// ranks above another form of it. hermes-plugins/optmem/search.py is the same
// algorithm; keep the two in step.

const STEM = 5;
const WORD = /[\p{L}\p{N}]{2,}/gu;

// [newest message it covers, text ranked, what to hand back]
export type Doc<T> = [number, string, T];

export const fold = (text: string) => {
  text = text.toLowerCase();
  return /^[\x00-\x7f]*$/.test(text) ? text : text.normalize("NFKD").replace(/\p{Mn}/gu, "");
};

export const stem = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w).slice(0, STEM);

const words = (text: string) => fold(text).match(WORD) ?? [];

export const terms = (text: string) => {
  const ws = words(text);
  return [...ws, ...ws.map(w => `~${stem(w)}`)];
};

// The `top` best documents for `query`, newest first, and how many matched at
// all. BM25 with k1=1.2, b=0.75: a rare word outweighs a common one, and a
// long line does not win by length alone.
export function rank<T>(docs: Iterable<Doc<T>>, query: string, top: number): [T[], number] {
  const want = [...new Set(terms(query))];
  if (!want.length) return [[], 0];
  const df = new Map(want.map(t => [t, 0]));
  const hits: [Map<string, number>, number, number, T][] = [];
  let n = 0, total = 0;
  for (const [hi, text, item] of docs) {
    const ws = words(text);
    const tf = new Map<string, number>();
    for (const t of want) {
      const c = t[0] === "~" ? ws.filter(w => stem(w) === t.slice(1)).length : ws.filter(w => w === t).length;
      if (c) { tf.set(t, c); df.set(t, df.get(t)! + 1); }
    }
    n++; total += 2 * ws.length;
    if (tf.size) hits.push([tf, 2 * ws.length, hi, item]);
  }
  const avg = total ? total / n : 1;
  const idf = new Map(want.map(t => [t, Math.log(1 + (n - df.get(t)! + 0.5) / (df.get(t)! + 0.5))]));
  const scored = hits.map(([tf, dl, hi, item]) => {
    let s = 0;
    for (const [t, c] of tf) s += idf.get(t)! * c * 2.2 / (c + 1.2 * (0.25 + 0.75 * dl / avg));
    return [s, hi, item] as const;
  });
  const best = [...scored].sort((a, b) => b[0] - a[0] || b[1] - a[1]).slice(0, top);
  best.sort((a, b) => b[1] - a[1]);
  return [best.map(h => h[2]), scored.length];
}
