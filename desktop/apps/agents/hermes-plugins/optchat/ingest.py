"""Hermes's OpenAI-style message list -> OptChat rows. Pure: the caller supplies what it logged."""

from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from .model import Kind

Row = Tuple[Kind, str]
# The message as its author wrote it, or None for rows Hermes made up (compaction summaries, nudges).
Authored = Callable[[Dict[str, Any]], Optional[Dict[str, Any]]]
# The kinds a session's message list turns into; ``note`` and ``work`` come from other hooks.
CHAT_KINDS = frozenset({"user", "talk", "tool", "echo"})


def cap(text: str, limit: int) -> str:
    """Head and tail of a tool result, ``limit`` characters in all (spec §1)."""
    if len(text) <= limit:
        return text
    marker = "\n\n[... optchat cut {} chars ...]\n\n"
    half = (limit - len(marker) - 8) // 2
    return text[:half] + marker.format(len(text) - 2 * half) + text[-half:]


def pages(text: str, limit: int) -> List[str]:
    """Long text is never cut but logged as several messages in a row (spec §1), each at most
    ``limit`` characters, split at a line end or else a space where one falls in its second half."""
    out = []
    text = text.strip()
    while len(text) > limit:
        cut = text.rfind("\n", limit // 2, limit)
        if cut < 0:
            cut = text.rfind(" ", limit // 2, limit)
        if cut < 0:
            cut = limit
        out.append(text[:cut].strip())
        text = text[cut:].strip()
    return [p for p in out + [text] if p]


def text_of(content: Any) -> str:
    """Text parts only: thinking blocks are never logged (spec §1). An image is "[screenshot]",
    as Hermes's session DB stores it, so a turn reads the same live and reloaded."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for p in content:
            if not isinstance(p, dict):
                continue
            if p.get("type") in ("text", "input_text", "output_text"):
                parts.append(p.get("text") or "")
            elif p.get("type") in ("image_url", "image", "input_image"):
                parts.append("[screenshot]")
        return "\n".join(x for x in parts if x)
    return ""


def carries_view(messages: Sequence[Any]) -> bool:
    """Whether a user row holds a <chat> view inside Hermes's <memory-context> fence: in the
    api_content sidecar (the bytes a string turn sent) or in a multimodal turn's text parts."""
    for msg in messages:
        if not (isinstance(msg, dict) and msg.get("role") == "user"):
            continue
        for text in (msg.get("api_content"), text_of(msg.get("content"))):
            start = text.find("<memory-context>") if isinstance(text, str) else -1
            while start >= 0:
                end = text.find("</memory-context>", start)
                if "\n<chat>\n" in text[start:end if end >= 0 else None]:
                    return True
                start = text.find("<memory-context>", start + 1)
    return False


def rows_of(msg: Dict[str, Any], *, cap_chars: int) -> List[Row]:
    """The rows one authored message logs, each text stripped as the log stores it."""
    role = msg.get("role")
    if role == "user":
        return [("user", p) for p in pages(text_of(msg.get("content")), cap_chars)]
    if role == "assistant":
        out: List[Row] = [("talk", p) for p in pages(text_of(msg.get("content")), cap_chars)]
        for call in msg.get("tool_calls") or []:
            fn = (call or {}).get("function") or {}
            args = fn.get("arguments")
            args = args if isinstance(args, str) else json.dumps(args, ensure_ascii=False)
            out += [("tool", p) for p in pages(f"{fn.get('name') or '?'} {args or '{}'}", cap_chars)]
        return out
    if role == "tool":
        text = text_of(msg.get("content")).strip()
        return [("echo", cap(text, cap_chars))] if text else []
    return []


def resume_point(rows: Sequence[Row], logged: Sequence[Row]) -> int:
    """How many leading ``rows`` are already in ``logged``, the session's latest logged rows.

    Hermes's list is not stable: a restart, a compression, a gateway reload from its DB or an
    /undo hands over a list this process never saw, or one rewritten in place. So rather than
    trust an index, align the list with the log, three ways:

    - the longest run of rows that ends the log, so logging resumes where it stopped. The
      earliest of equal runs wins, so a turn repeated word for word is logged again, not lost.
    - the longest start of the list found anywhere in the log: after an /undo the last logged
      rows are gone from the list, but the list still starts as the log did.
    - both spliced: a start of the list found in the log, then the rows that end the log. After
      an /undo and a new turn, the list keeps the log's start and its last rows, not the rows
      between.

    The first two compete on how many rows they match; the splice, which accounts for every row
    before its end, goes further when it can. With no match at all, every row is new.
    """
    if not logged:
        return 0
    n, m = len(rows), len(logged)
    # tail[m + 1 + n - e]: how many rows end both rows[:e] and logged.
    tail = _z([*reversed(logged), _SEP, *reversed(rows)])
    run, end = 0, 0
    for e in range(1, n + 1):
        if tail[m + 1 + n - e] > run:
            run, end = tail[m + 1 + n - e], e
    # head[j]: how many leading rows logged[j:] starts with.
    head = _z([*rows, _SEP, *logged])[n + 1:]
    start = max(head, default=0)
    # within[k]: the longest start of the list found in logged[:k]; j is the first place a match
    # still reaching k starts.
    within, j = [0] * (m + 1), 0
    for k in range(1, m + 1):
        while j < k and j + head[j] < k:
            j += 1
        within[k] = max(within[k - 1], k - j)
    # A longer tail never hurts the splice, so each end tries only its longest.
    spliced = max((e for e in range(1, n + 1)
                   if (z := tail[m + 1 + n - e]) and within[m - z] >= e - z), default=0)
    return max(spliced, start if start > run else end)


def last_turn(rows: Sequence[Row]) -> int:
    """Where the list's last user turn starts: the rows a session the log never saw logs."""
    k = len(rows)
    while k and rows[k - 1][0] != "user":
        k -= 1
    while k and rows[k - 1][0] == "user":
        k -= 1
    return k if any(kind == "user" for kind, _ in rows[:k]) else 0


_SEP = object()


def _z(s: Sequence[Any]) -> List[int]:
    """z[i]: the length of the longest common prefix of s and s[i:] (z[0] = 0)."""
    z = [0] * len(s)
    lo = hi = 0
    for i in range(1, len(s)):
        k = min(hi - i, z[i - lo]) if i < hi else 0
        while i + k < len(s) and s[k] == s[i + k]:
            k += 1
        z[i] = k
        if i + k > hi:
            lo, hi = i, i + k
    return z


def all_rows(messages: Sequence[Any], *, cap_chars: int, authored: Authored) -> List[Row]:
    out: List[Row] = []
    for msg in messages:
        own = authored(msg) if isinstance(msg, dict) else None
        if own is not None:
            out += rows_of(own, cap_chars=cap_chars)
    return out
