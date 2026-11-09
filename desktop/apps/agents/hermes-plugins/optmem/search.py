"""optmem_find: rank messages and summaries by words (BM25). Pure: no I/O, nothing indexed.

Ported from upstream's ``memo find`` (VictorTaelin/OptMem PR 18): case and accents are ignored,
and each word also matches by its stem, its first five letters after a plural ``s`` goes, so
``memories`` finds ``memory``; the exact word ranks above another form of it.
pi-extensions/optmem/search.ts is the same algorithm; keep the two in step.
"""

from __future__ import annotations

import math
import re
import unicodedata
from typing import Any, Iterable, List, Tuple

STEM = 5
_WORD = re.compile(r"[^\W_]{2,}")

# (newest message it covers, text ranked, what to hand back)
Doc = Tuple[int, str, Any]


def fold(text: str) -> str:
    text = text.lower()
    if text.isascii():
        return text
    return "".join(c for c in unicodedata.normalize("NFKD", text) if unicodedata.category(c) != "Mn")


def stem(w: str) -> str:
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        w = w[:-1]
    return w[:STEM]


def terms(text: str) -> List[str]:
    ws = _WORD.findall(fold(text))
    return ws + ["~" + stem(w) for w in ws]


def rank(docs: Iterable[Doc], query: str, top: int) -> Tuple[List[Any], int]:
    """The ``top`` best documents for ``query``, newest first, and how many matched at all.
    BM25 with k1=1.2, b=0.75: a rare word outweighs a common one, and a long line does not win
    by length alone."""
    want = set(terms(query))
    if not want:
        return [], 0
    hits, n, total, df = [], 0, 0, dict.fromkeys(want, 0)
    for hi, text, line in docs:
        ws = _WORD.findall(fold(text))
        tf = {}
        for t in want:
            c = sum(stem(w) == t[1:] for w in ws) if t[0] == "~" else ws.count(t)
            if c:
                tf[t] = c
                df[t] += 1
        n, total = n + 1, total + 2 * len(ws)
        if tf:
            hits.append((tf, 2 * len(ws), hi, line))
    avg = total / n if total else 1.0
    idf = {t: math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5)) for t in want}
    scored = [(sum(idf[t] * c * 2.2 / (c + 1.2 * (0.25 + 0.75 * dl / avg)) for t, c in tf.items()), hi, line)
              for tf, dl, hi, line in hits]
    best = sorted(scored, key=lambda h: (-h[0], -h[1]))[:top]
    best.sort(key=lambda h: -h[1])
    return [line for _, _, line in best], len(scored)
