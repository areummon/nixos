"""The files under <hermes_home>/optchat/ (spec §1): append-only, flushed, day-split JSONL."""

from __future__ import annotations

import fcntl
import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .model import Message, Node
from .tree import Part

# A value and when it was last touched, in epoch seconds.
Stamped = Tuple[str, float]


@dataclass
class Loaded:
    messages: List[Message] = field(default_factory=list)
    nodes: Dict[Part, Node] = field(default_factory=dict)
    view_pairs: object = None
    torn: int = 0


class Store:
    def __init__(self, root: Path):
        self.root = Path(root)
        self._lock_fd: Optional[int] = None

    @property
    def writable(self) -> bool:
        return self._lock_fd is not None

    def try_lock(self) -> bool:
        """Take the single-writer lock (spec §1). flock dies with its holder, so a crash never strands it."""
        self.root.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.root / "lock", os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd)
            return False
        self._lock_fd = fd
        for sub in ("main", "tree"):
            (self.root / sub).mkdir(exist_ok=True)
        # The entries for these directories and the files in them, which a power loss would drop
        # unless synced. Every open syncs them, as a crashed writer may have made one and not.
        for d in (self.root.parent, self.root, self.root / "main", self.root / "tree"):
            _fsync_dir(d)
        return True

    def unlock(self) -> None:
        if self._lock_fd is not None:
            os.close(self._lock_fd)
            self._lock_fd = None

    def _files(self, sub: str) -> List[Path]:
        d = self.root / sub
        return sorted(d.glob("*.jsonl")) if d.is_dir() else []

    def stamp(self) -> Tuple:
        """Changes whenever the writer appends or saves the view; a read-only reader reloads on change."""
        out = []
        for p in [*self._files("main"), *self._files("tree"), self.root / "view.json"]:
            try:
                st = p.stat()
                out.append((p.name, st.st_size, st.st_mtime_ns))
            except FileNotFoundError:
                pass
        return tuple(out)

    def load(self) -> Loaded:
        out = Loaded()
        by_id: Dict[int, Message] = {}
        for obj in self._read("main", out):
            m = Message.from_json(obj)
            if m is None:
                out.torn += 1
            else:
                by_id[m.i] = m
        # Ids are permanent and dense; stop at the first gap rather than renumber.
        while len(out.messages) in by_id:
            out.messages.append(by_id[len(out.messages)])
        for obj in self._read("tree", out):
            n = Node.from_json(obj)
            if n is None:
                out.torn += 1
            else:
                out.nodes.setdefault(Part(n.l, n.i), n)
        try:
            out.view_pairs = json.loads((self.root / "view.json").read_text())
        except (OSError, ValueError):
            out.view_pairs = None
        return out

    def _read(self, sub: str, out: Loaded):
        for path in self._files(sub):
            raw = path.read_text(encoding="utf-8", errors="replace")
            # A crash mid-write leaves a torn last line; end it so the next append starts clean.
            if raw and not raw.endswith("\n") and self.writable:
                with open(path, "a", encoding="utf-8") as f:
                    f.write("\n")
            for line in raw.split("\n"):
                if not line.strip():
                    continue
                try:
                    obj = json.loads(line)
                except ValueError:
                    out.torn += 1
                    continue
                if isinstance(obj, dict):
                    yield obj
                else:
                    out.torn += 1

    def _append(self, sub: str, obj: dict, when: datetime) -> None:
        assert self.writable, "optchat store is read-only"
        path = self.root / sub / f"{when:%Y-%m-%d}.jsonl"
        new = not path.exists()
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(obj, ensure_ascii=False) + "\n")
            f.flush()
            os.fsync(f.fileno())
        if new:
            _fsync_dir(path.parent)

    def append_message(self, m: Message) -> None:
        self._append("main", m.to_json(), datetime.fromisoformat(m.date))

    def append_node(self, n: Node) -> None:
        self._append("tree", n.to_json(), datetime.now().astimezone())

    def save_view(self, parts) -> None:
        self._replace("view.json", [[p.l, p.i] for p in parts])

    def load_viewed(self, now: float) -> Dict[str, float]:
        """The sessions whose history carries the view (see Memory.observe), each with when it was
        last touched. The older file, a bare list of ids, reads as touched ``now``."""
        ids = self._load_json("viewed.json")
        if isinstance(ids, list):
            return {i: now for i in ids if isinstance(i, str)}
        if isinstance(ids, dict):
            return {k: _time(t, now) for k, t in ids.items()}
        return {}

    def save_viewed(self, touched: Dict[str, float]) -> None:
        self._replace("viewed.json", {k: round(t) for k, t in sorted(touched.items())})

    def load_parents(self, now: float) -> Dict[str, Stamped]:
        """Each compressed or branched session's parent (see Memory.link) and when the link was last
        touched. The older file maps a child straight to its parent, read as touched ``now``."""
        links = self._load_json("parents.json")
        out: Dict[str, Stamped] = {}
        for k, v in (links.items() if isinstance(links, dict) else ()):
            if isinstance(v, str):
                out[k] = (v, now)
            elif isinstance(v, dict) and isinstance(v.get("parent"), str):
                out[k] = (v["parent"], _time(v.get("touched"), now))
        return out

    def save_parents(self, links: Dict[str, Stamped]) -> None:
        self._replace("parents.json", {k: {"parent": p, "touched": round(t)} for k, (p, t) in sorted(links.items())})

    def _load_json(self, name: str):
        try:
            return json.loads((self.root / name).read_text())
        except (OSError, ValueError):
            return None

    def _replace(self, name: str, obj) -> None:
        assert self.writable, "optchat store is read-only"
        path = self.root / name
        tmp = path.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(json.dumps(obj))
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
        _fsync_dir(self.root)


def _time(t, now: float) -> float:
    return float(t) if isinstance(t, (int, float)) and not isinstance(t, bool) else now


def _fsync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
