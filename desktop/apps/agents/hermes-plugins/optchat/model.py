"""The records OptChat logs (spec §1-2). Sizes are UTF-8 bytes, never tokens."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal, Optional, get_args

Kind = Literal["user", "talk", "tool", "echo", "work", "note"]
KINDS = frozenset(get_args(Kind))


def byte_len(text: str) -> int:
    return len(text.encode("utf-8"))


@dataclass(frozen=True)
class Message:
    """One line of main/YYYY-MM-DD.jsonl. ``i`` is the message's permanent id."""

    i: int
    kind: Kind
    text: str
    size: int
    date: str
    source: Optional[str] = None

    @property
    def body(self) -> str:
        """What a leaf summarizes and what zoom(id, 1) returns."""
        return f"{self.kind}: {self.text}"

    def to_json(self) -> dict:
        d = asdict(self)
        if self.source is None:
            del d["source"]
        return d

    @staticmethod
    def from_json(d: dict) -> Optional["Message"]:
        if not (isinstance(d.get("i"), int) and d.get("kind") in KINDS and isinstance(d.get("text"), str)):
            return None
        return Message(d["i"], d["kind"], d["text"], int(d.get("size") or 0), str(d.get("date") or ""), d.get("source"))


@dataclass(frozen=True)
class Node:
    """One line of tree/YYYY-MM-DD.jsonl: node(l, i) covers messages i·2^l to (i+1)·2^l - 1."""

    l: int
    i: int
    text: str
    size: int

    def to_json(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_json(d: dict) -> Optional["Node"]:
        if not (isinstance(d.get("l"), int) and isinstance(d.get("i"), int) and isinstance(d.get("text"), str)):
            return None
        return Node(d["l"], d["i"], d["text"], byte_len(d["text"]))


@dataclass(frozen=True)
class Config:
    node_bytes: int = 512
    view_bytes: int = 128_000
    # The compactions' own view (§4): merged to 16 KB, again past 32 KB.
    context_bytes: int = 32_000
    jobs: int = 8
    tries: int = 5
    # The longest message logged: a tool result is clipped to it, any other text split (spec §1).
    cap_chars: int = 30_000
    # "model" calls the compactor model; "heuristic" never calls a model.
    compactor: str = "model"
    compactor_provider: str = "anthropic"
    compactor_model: str = "claude-haiku-4-5-20251001"
    compactor_max_tokens: int = 2048
    compactor_timeout: float = 120.0

    @staticmethod
    def from_mapping(raw: object) -> "Config":
        """Overrides from config.yaml ``memory.optchat``; unknown keys and bad values keep the default."""
        base = Config()
        if not isinstance(raw, dict):
            return base
        values = {}
        for name, default in asdict(base).items():
            if name not in raw or raw[name] is None:
                continue
            try:
                values[name] = type(default)(raw[name])
            except (TypeError, ValueError):
                continue
        return Config(**{**asdict(base), **values})
