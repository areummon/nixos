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
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(obj, ensure_ascii=False) + "\n")
            f.flush()
            os.fsync(f.fileno())

    def append_message(self, m: Message) -> None:
        self._append("main", m.to_json(), datetime.fromisoformat(m.date))

    def append_node(self, n: Node) -> None:
        self._append("tree", n.to_json(), datetime.now().astimezone())

    def save_view(self, parts) -> None:
        self._replace("view.json", [[p.l, p.i] for p in parts])

    def load_viewed(self) -> List[str]:
        """Ids of the sessions whose history carries the view (see Memory.observe)."""
        try:
            ids = json.loads((self.root / "viewed.json").read_text())
        except (OSError, ValueError):
            return []
        return [i for i in ids if isinstance(i, str)] if isinstance(ids, list) else []

    def save_viewed(self, ids) -> None:
        self._replace("viewed.json", sorted(ids))

    def load_parents(self) -> Dict[str, str]:
        """Each compressed or branched session's parent (see Memory.link)."""
        try:
            links = json.loads((self.root / "parents.json").read_text())
        except (OSError, ValueError):
            return {}
        if not isinstance(links, dict):
            return {}
        return {k: v for k, v in links.items() if isinstance(k, str) and isinstance(v, str)}

    def save_parents(self, links: Dict[str, str]) -> None:
        self._replace("parents.json", links)

    def _replace(self, name: str, obj) -> None:
        assert self.writable, "optchat store is read-only"
        path = self.root / name
        tmp = path.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(json.dumps(obj))
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
        fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
