"""Tree arithmetic and the view (spec §2-3). Pure: no I/O, no clocks, no locks."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, List, Optional, Sequence, Tuple

Built = Callable[["Part"], bool]
Size = Callable[["Part"], int]


@dataclass(frozen=True, order=True)
class Part:
    """node(l, i): the 2^l messages from i·2^l on, named ``id+n``."""

    l: int
    i: int

    @property
    def start(self) -> int:
        return self.i << self.l

    @property
    def count(self) -> int:
        return 1 << self.l

    @property
    def end(self) -> int:
        """One past its last message."""
        return self.start + self.count

    @property
    def name(self) -> str:
        return f"{self.start}+{self.count}"

    def children(self) -> Tuple["Part", "Part"]:
        return Part(self.l - 1, 2 * self.i), Part(self.l - 1, 2 * self.i + 1)

    def parent(self) -> "Part":
        return Part(self.l + 1, self.i >> 1)

    def sibling(self) -> "Part":
        return Part(self.l, self.i ^ 1)


def part_named(id_: int, n: int) -> Optional[Part]:
    """The part ``id+n``, or None when n is not a power of 2 or id is not a multiple of n."""
    if n < 1 or n & (n - 1) or id_ < 0 or id_ % n:
        return None
    l = n.bit_length() - 1
    return Part(l, id_ >> l)


def most_due(view: Sequence[Part], T: int, built: Built) -> int:
    """Index of the left half of the sibling pair most due to merge, or -1 (§3.2).

    due = (T - last) / 2^l, measured from the pair's LAST message; written (T + 1) / 2^l - i,
    the same order. Measuring from the first message rewrites old lines that push keeps.
    Ties go to the oldest pair; only pairs whose parent is built can merge.
    """
    best, best_due = -1, None
    for k in range(len(view) - 1):
        a, b = view[k], view[k + 1]
        if a.l != b.l or a.i % 2 or b.i != a.i + 1 or not built(a.parent()):
            continue
        due = (T + 1) / (1 << a.l) - a.i
        if best_due is None or due > best_due:
            best, best_due = k, due
    return best


def merge_at(view: List[Part], k: int) -> List[Part]:
    return view[:k] + [view[k].parent()] + view[k + 2:]


@dataclass(frozen=True)
class View:
    """A view and whether a batch merge is still under way (§3.2's sawtooth)."""

    parts: Tuple[Part, ...] = ()
    merging: bool = False


def grow(view: View, i: int, *, size: Size, built: Built, high: int, low: int, force: bool = False) -> Tuple[View, bool]:
    """Append message i's line; past ``high`` bytes (or when ``force``), merge the most due pairs
    down to ``low``. Returns the new view and whether anything merged.

    Between batches the view only grows at its end, so each turn's view is a prefix of the next
    and stays in the prompt cache. A batch that runs out of built parents resumes at the next message.
    """
    parts = list(view.parts) + [Part(0, i)]
    total = sum(size(p) for p in parts)
    merging = view.merging or force or total > high
    merged = False
    while merging and total > low:
        k = most_due(parts, i + 1, built)
        if k < 0:
            return View(tuple(parts), True), merged
        total += size(parts[k].parent()) - size(parts[k]) - size(parts[k + 1])
        parts = merge_at(parts, k)
        merged = True
    return View(tuple(parts), False), merged


def fit(parts: Sequence[Part], T: int, *, size: Size, built: Built, budget: int) -> List[Part]:
    """Merge the most due pairs until the view is at most ``budget`` bytes or nothing can merge."""
    out = list(parts)
    total = sum(size(p) for p in out)
    while total > budget:
        k = most_due(out, T, built)
        if k < 0:
            break
        total += size(out[k].parent()) - size(out[k]) - size(out[k + 1])
        out = merge_at(out, k)
    return out


def view_before(parts: Sequence[Part], upto: int) -> List[Part]:
    """The view of messages [0, upto): a part reaching past ``upto`` opens into its children."""
    out: List[Part] = []

    def cut(p: Part) -> None:
        if p.end <= upto:
            out.append(p)
        elif p.start < upto and p.l > 0:
            for c in p.children():
                cut(c)

    for p in parts:
        cut(p)
    return out


def contiguous_prefix(pairs: object, total: int) -> List[Part]:
    """Parse view.json's ``[l, i]`` pairs, keeping the longest prefix that tiles [0, ...) within ``total``."""
    out: List[Part] = []
    pos = 0
    if not isinstance(pairs, list):
        return out
    for pair in pairs:
        if not (isinstance(pair, list) and len(pair) == 2 and all(isinstance(x, int) and x >= 0 for x in pair)):
            break
        p = Part(pair[0], pair[1])
        if p.start != pos or p.end > total:
            break
        out.append(p)
        pos = p.end
    return out
