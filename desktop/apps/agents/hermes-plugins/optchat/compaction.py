"""One compaction: one node built by one model conversation (spec §4)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Sequence

from .model import Config, byte_len
from .prompt import COMPACTION_SYSTEM, too_long
from .tree import Part

# messages (OpenAI shape) -> the reply's text
Call = Callable[[List[Dict[str, Any]]], str]

_HEAD_RE = re.compile(r"^\s*\d+\+\d+\|")


@dataclass(frozen=True)
class Job:
    part: Part
    context: Sequence[str]
    task: str
    # The text a heuristic summary cuts down when no model is used.
    source: str


def cut_bytes(text: str, limit: int) -> str:
    return text.encode("utf-8")[:max(0, limit)].decode("utf-8", errors="ignore")


def context_blocks(lines: Sequence[str]) -> List[Dict[str, Any]]:
    """The compaction view as text blocks of 4 lines, a cache mark on the last whole block (§3.3).

    Calls ending at later messages share every whole block before theirs, so Anthropic finds the
    earlier mark within its 20-block lookback and reads that prefix from the cache.
    """
    text = ["<chat>\n", *(f"{line}\n" for line in lines), "</chat>\n"]
    blocks = [{"type": "text", "text": "".join(text[k:k + 4])} for k in range(0, len(text), 4)]
    whole = len(text) // 4
    if whole:
        blocks[whole - 1]["cache_control"] = {"type": "ephemeral"}
    return blocks


def run(job: Job, call: Call, cfg: Config) -> str:
    """Ask for the line; past the limit, show the cut and ask again, up to ``tries`` replies.
    Keeps the shortest: a few bytes over is fine, since the view measures real sizes."""
    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": COMPACTION_SYSTEM},
        {"role": "user", "content": [*context_blocks(job.context), {"type": "text", "text": job.task}]},
    ]
    replies: List[str] = []
    while True:
        raw = call(messages)
        line = _HEAD_RE.sub("", (raw or "").strip()).strip()
        if not line:
            raise RuntimeError(f"empty compaction reply for {job.part.name}")
        replies.append(line)
        size = byte_len(line)
        if size <= cfg.node_bytes or len(replies) >= cfg.tries:
            break
        messages += [
            {"role": "assistant", "content": raw},
            {"role": "user", "content": too_long(size, cfg.node_bytes, cut_bytes(line, cfg.node_bytes))},
        ]
    return min(replies, key=byte_len)


def heuristic(job: Job, cfg: Config) -> str:
    """The line without a model: the source flattened and cut, each half of a merge kept in part."""
    halves = job.source.split("\n", 1) if job.part.l > 0 else [job.source]
    share = cfg.node_bytes // len(halves)
    return " ".join(cut_bytes(" ".join(h.split()), share) for h in halves)


def hermes_call(cfg: Config) -> Call:
    """``agent.auxiliary_client.call_llm`` on the configured compactor provider and model."""

    def call(messages: List[Dict[str, Any]]) -> str:
        from agent.auxiliary_client import call_llm

        response = call_llm(
            task="optchat_compaction", provider=cfg.compactor_provider, model=cfg.compactor_model,
            messages=messages, max_tokens=cfg.compactor_max_tokens, timeout=cfg.compactor_timeout,
        )
        content = response.choices[0].message.content
        if isinstance(content, list):
            return "".join(p.get("text", "") if isinstance(p, dict) else getattr(p, "text", "") or "" for p in content)
        return content or ""

    return call
