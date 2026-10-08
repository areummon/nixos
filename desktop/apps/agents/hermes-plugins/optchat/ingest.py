"""Hermes's OpenAI-style message list -> OptChat rows. Pure: the caller owns the cursor."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from .model import Kind

Row = Tuple[Kind, str]
CleanUser = Callable[[str], Optional[str]]


@dataclass(frozen=True)
class Cursor:
    """How much of one session's list is logged, and a fingerprint of the last logged row so a
    list rewritten in place (compression, rewind) is not mistaken for the one already logged."""

    count: int
    last: str


def fingerprint(msg: Any) -> str:
    return hashlib.sha256(json.dumps(msg, sort_keys=True, default=str).encode()).hexdigest()


def cap(text: str, limit: int) -> str:
    """Head and tail of a tool result, ``limit`` characters in all (spec §1)."""
    if len(text) <= limit:
        return text
    marker = "\n\n[... optchat cut {} chars ...]\n\n"
    half = (limit - len(marker) - 8) // 2
    return text[:half] + marker.format(len(text) - 2 * half) + text[-half:]


def _text(content: Any) -> str:
    """Text parts only: thinking blocks are never logged (spec §1)."""
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
                parts.append("[image]")
        return "\n".join(x for x in parts if x)
    return ""


def rows_of(msg: Dict[str, Any], *, cap_chars: int, clean_user: CleanUser) -> List[Row]:
    role = msg.get("role")
    if role == "user":
        text = clean_user(_text(msg.get("content")))
        return [("user", text)] if text and text.strip() else []
    if role == "assistant":
        out: List[Row] = []
        text = _text(msg.get("content")).strip()
        if text:
            out.append(("talk", text))
        for call in msg.get("tool_calls") or []:
            fn = (call or {}).get("function") or {}
            args = fn.get("arguments")
            args = args if isinstance(args, str) else json.dumps(args, ensure_ascii=False)
            out.append(("tool", f"{fn.get('name') or '?'} {args or '{}'}"))
        return out
    if role == "tool":
        text = _text(msg.get("content")).strip()
        return [("echo", cap(text, cap_chars))] if text else []
    return []


def turn_start(messages: Sequence[Dict[str, Any]]) -> int:
    """Index of the last user row: where a list this process has not seen begins its new turn."""
    for k in range(len(messages) - 1, -1, -1):
        if isinstance(messages[k], dict) and messages[k].get("role") == "user":
            return k
    return 0


def new_rows(messages: Sequence[Dict[str, Any]], cursor: Optional[Cursor], *, cap_chars: int,
             clean_user: CleanUser) -> Tuple[List[Row], Cursor]:
    """Rows not logged yet, and the cursor after them.

    A list seen before resumes after its cursor, so the same list twice adds nothing. A list not
    seen before (a new process, a resumed or compressed session, a rewritten one) holds history an
    earlier sync already logged: only its last turn is new.
    """
    # Hermes passes its live list, which the next turn may grow while this reads it.
    messages = list(messages)
    known = (cursor is not None and cursor.count <= len(messages)
             and (cursor.count == 0 or fingerprint(messages[cursor.count - 1]) == cursor.last))
    start = cursor.count if known else turn_start(messages)
    rows: List[Row] = []
    for msg in messages[start:]:
        if isinstance(msg, dict):
            rows += rows_of(msg, cap_chars=cap_chars, clean_user=clean_user)
    end = len(messages)
    return rows, Cursor(end, fingerprint(messages[end - 1]) if end else "")
