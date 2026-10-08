"""One chat's memory in this process: the log, the tree, the views, and the compaction queues.

A process opens each store once (``acquire``), however many sessions it serves: the gateway runs
one provider per session, and they all write the same log through the one flock this holds.
"""

from __future__ import annotations

import bisect
import heapq
import logging
import threading
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Callable, Deque, Dict, List, Optional, Sequence, Set, Union

from . import compaction
from .compaction import Call, Job
from .ingest import CHAT_KINDS, Authored, all_rows, resume_point
from .model import Config, Kind, Message, Node, byte_len
from .prompt import PLACEHOLDER, leaf_task, merge_task, render_line
from .store import Store
from .tree import Part, View, contiguous_prefix, fit, grow, part_named, view_before

logger = logging.getLogger(__name__)

Spawn = Callable[..., threading.Thread]
PLACEHOLDER_BYTES = byte_len(PLACEHOLDER)


def source_of(platform: str, session_id: str) -> str:
    return f"{platform}:{session_id}"


class Memory:
    def __init__(self, root: Path, cfg: Config, *, call: Optional[Call], spawn: Spawn):
        self.cfg = cfg
        self.store = Store(root)
        self._call = call
        self._spawn = spawn
        self.lock = threading.RLock()
        self.messages: List[Message] = []
        self.nodes: Dict[Part, Node] = {}
        self.view = View()
        # The compactions' own, coarser view (§4).
        self.cview = View()
        self._stamp: tuple = ()
        self._closed = False
        # Compaction queues (§4 "the order"): never scan the tree for work.
        self._unbuilt_leaves: List[int] = []
        self._ready_leaves: List[int] = []
        self._ready_merges: Deque[Part] = deque()
        self._failed: List[Part] = []
        self._fails: Dict[Part, int] = {}
        self._running: Set[Part] = set()
        # Per session id, across every provider instance in this process.
        self._injected: Set[str] = set()
        # A compressed or branched session's parent: its rows are this session's history too.
        self._parents: Dict[str, str] = {}
        # Ids of the messages each source logged from a session's list (CHAT_KINDS), in order.
        self._by_source: Dict[str, List[int]] = {}

    @property
    def writable(self) -> bool:
        return self.store.writable

    def open(self) -> "Memory":
        with self.lock:
            self.store.try_lock()
            self._load()
            if self.writable:
                self.store.save_view(self.view.parts)
                self._seed()
        self.pump()
        return self

    def _load(self) -> None:
        loaded = self.store.load()
        if loaded.torn:
            logger.warning("optchat: skipped %d torn line(s) in %s", loaded.torn, self.store.root)
        self.messages, self.nodes = loaded.messages, loaded.nodes
        self._by_source = {}
        for m in self.messages:
            self._index(m)
        self._stamp = self.store.stamp()
        # §3.2: a rebuilt view differs from the live one and kills every cache entry, so the saved
        # view is kept; only messages logged after its last save are appended.
        view = View(tuple(contiguous_prefix(loaded.view_pairs, len(self.messages))))
        done = view.parts[-1].end if view.parts else 0
        for i in range(done, len(self.messages)):
            if self.writable:
                view, _ = self._grow(view, i, self.cfg.view_bytes)
            else:
                view = View(view.parts + (Part(0, i),))
        self.view = view
        self.cview = View(tuple(fit(view.parts, len(self.messages), size=self._size, built=self._built,
                                    budget=self.cfg.context_bytes // 2)))

    def _seed(self) -> None:
        """Queue what a past process left unbuilt; from here on, only events add work."""
        self._unbuilt_leaves = [i for i in range(len(self.messages)) if Part(0, i) not in self.nodes]
        self._ready_leaves = list(self._unbuilt_leaves)
        heapq.heapify(self._ready_leaves)
        for p in sorted(self.nodes):
            if p.i % 2 == 0:
                self._queue_parent(p)

    def refresh(self) -> None:
        """A read-only reader picks up what the writer appended since it last looked."""
        with self.lock:
            if not self.writable and self.store.stamp() != self._stamp:
                self._load()

    def _built(self, p: Part) -> bool:
        return p in self.nodes

    def _size(self, p: Part) -> int:
        n = self.nodes.get(p)
        return n.size if n else PLACEHOLDER_BYTES

    def _grow(self, view: View, i: int, high: int, force: bool = False):
        return grow(view, i, size=self._size, built=self._built, high=high, low=high // 2, force=force)

    def log(self, kind: Kind, text: str, source: Optional[str] = None) -> Optional[int]:
        text = (text or "").strip()
        if not text:
            return None
        with self.lock:
            if not self.writable or self._closed:
                return None
            self._append(kind, text, source)
        self.pump()
        return len(self.messages) - 1

    def _append(self, kind: Kind, text: str, source: Optional[str]) -> None:
        i = len(self.messages)
        m = Message(i, kind, text, byte_len(f"{kind}: {text}"), datetime.now().astimezone().isoformat(), source)
        self.store.append_message(m)
        self.messages.append(m)
        self._index(m)
        self.view, merged = self._grow(self.view, i, self.cfg.view_bytes)
        self.cview, _ = self._grow(self.cview, i, self.cfg.context_bytes, force=merged)
        self.store.save_view(self.view.parts)
        bisect.insort(self._unbuilt_leaves, i)
        heapq.heappush(self._ready_leaves, i)
        # §4: a failed call is tried again at the next message.
        for p in self._failed:
            self._requeue(p)
        self._failed.clear()

    def _index(self, m: Message) -> None:
        if m.source and m.kind in CHAT_KINDS:
            self._by_source.setdefault(m.source, []).append(m.i)

    def _logged(self, platform: str, session_id: str, limit: int) -> List[tuple]:
        """The last ``limit`` rows logged from this session's list or its ancestors'."""
        ids: List[int] = []
        seen: Set[str] = set()
        sid: Optional[str] = session_id
        while sid and sid not in seen:
            seen.add(sid)
            ids += self._by_source.get(source_of(platform, sid), [])[-limit:]
            sid = self._parents.get(sid)
        return [(self.messages[i].kind, self.messages[i].text) for i in sorted(ids)[-limit:]]

    def link(self, session_id: str, parent_id: str) -> None:
        with self.lock:
            if parent_id and parent_id != session_id:
                self._parents[session_id] = parent_id

    def ingest(self, session_id: str, messages: Sequence[dict], platform: str, authored: Authored) -> int:
        """Log the rows of ``messages`` this session has not logged yet; returns how many."""
        # Hermes passes its live list, which the next turn may grow while this reads it.
        rows = all_rows(list(messages), cap_chars=self.cfg.cap_chars, authored=authored)
        with self.lock:
            if not self.writable or self._closed:
                return 0
            # The list overlaps at most len(rows) logged rows; the slack covers rows an /undo dropped.
            new = rows[resume_point(rows, self._logged(platform, session_id, 2 * len(rows) + 256)):]
            for kind, text in new:
                self._append(kind, text, source_of(platform, session_id))
        self.pump()
        return len(new)

    def take_injection(self, session_id: str) -> bool:
        """True the first time a session asks: its first prefetch carries the view, later ones don't,
        since Hermes replays each turn's prefetch block on every later request."""
        with self.lock:
            if session_id in self._injected:
                return False
            self._injected.add(session_id)
            return True

    def forget_session(self, session_id: str) -> None:
        with self.lock:
            self._injected.discard(session_id)

    def _line(self, p: Part) -> str:
        n = self.nodes.get(p)
        return render_line(p, n.text if n else None)

    def render(self) -> str:
        with self.lock:
            if not self.view.parts:
                return ""
            return "<chat>\n" + "\n".join(self._line(p) for p in self.view.parts) + "\n</chat>"

    def zoom(self, id_: int, n: int) -> str:
        with self.lock:
            p = part_named(id_, n)
            if p is None or p.end > len(self.messages):
                return f"No line {id_}+{n}."
            if p.l == 0:
                m = self.messages[id_]
                return f"{p.name}|{m.body}"
            return "\n".join(self._line(c) for c in p.children())

    def date(self, id_: int) -> str:
        with self.lock:
            if not 0 <= id_ < len(self.messages):
                return f"No message {id_}."
            return self.messages[id_].date

    def settled(self) -> bool:
        with self.lock:
            return not self._unbuilt_leaves and not self._running and not self._ready_merges

    def _requeue(self, p: Part) -> None:
        if p.l == 0:
            heapq.heappush(self._ready_leaves, p.i)
        else:
            self._ready_merges.append(p)

    def _queue_parent(self, p: Part) -> None:
        parent = p.parent()
        if p.sibling() in self.nodes and parent not in self.nodes:
            self._ready_merges.append(parent)

    def _next(self) -> Optional[Part]:
        # Leaves first, in order: a turn needs its last messages summarized. A leaf starts once
        # fewer than ``jobs`` lines before it are unbuilt, so its context is nearly all built.
        while self._ready_leaves:
            i = self._ready_leaves[0]
            p = Part(0, i)
            if p in self.nodes or p in self._running:
                heapq.heappop(self._ready_leaves)
                continue
            if bisect.bisect_left(self._unbuilt_leaves, i) >= self.cfg.jobs:
                break
            heapq.heappop(self._ready_leaves)
            return p
        while self._ready_merges:
            p = self._ready_merges.popleft()
            if p not in self.nodes and p not in self._running:
                return p
        return None

    def _plan(self, p: Part) -> Union[str, Job]:
        """The node's text when its source fits in a line (§2: no model call), else the job."""
        limit = self.cfg.node_bytes
        if p.l == 0:
            m = self.messages[p.i]
            if byte_len(m.body) <= limit:
                return m.body
            source, task = m.body, leaf_task(p.i, m.body, limit)
        else:
            a, b = (" ".join(self.nodes[c].text.split()) for c in p.children())
            source = f"{a}\n{b}"
            if byte_len(source) <= limit:
                return source
            task = merge_task(p, a, b, limit)
        # The compaction view ends at the node and stops at the first unbuilt line (§4).
        context = []
        for q in view_before(self.cview.parts, p.end if p.l else p.start):
            if q not in self.nodes:
                break
            context.append(self._line(q))
        return Job(p, tuple(context), task, source)

    def _add_node(self, p: Part, text: str) -> None:
        if p in self.nodes:
            return
        node = Node(p.l, p.i, text, byte_len(text))
        self.store.append_node(node)
        self.nodes[p] = node
        if p.l == 0:
            k = bisect.bisect_left(self._unbuilt_leaves, p.i)
            if k < len(self._unbuilt_leaves) and self._unbuilt_leaves[k] == p.i:
                del self._unbuilt_leaves[k]
        self._queue_parent(p)

    def pump(self) -> None:
        with self.lock:
            while self.writable and not self._closed and len(self._running) < self.cfg.jobs:
                p = self._next()
                if p is None:
                    return
                plan = self._plan(p)
                if isinstance(plan, str):
                    self._add_node(p, plan)
                    continue
                self._running.add(p)
                self._spawn(self._work, args=(plan,), name=f"optchat-compact-{p.name}").start()

    def _work(self, job: Job) -> None:
        p = job.part
        try:
            text = compaction.run(job, self._call, self.cfg) if self._call else compaction.heuristic(job, self.cfg)
        except Exception as exc:
            with self.lock:
                self._fails[p] = self._fails.get(p, 0) + 1
                gave_up = self._fails[p] >= self.cfg.tries
                if not gave_up:
                    self._running.discard(p)
                    self._failed.append(p)
            logger.warning("optchat: compaction of %s failed (%s)%s", p.name, exc,
                           "; using a heuristic line" if gave_up else "; retrying at the next message")
            if not gave_up:
                return
            text = compaction.heuristic(job, self.cfg)
        with self.lock:
            self._running.discard(p)
            if not self._closed:
                self._add_node(p, text)
        self.pump()

    def close(self) -> None:
        with self.lock:
            self._closed = True
            self.store.unlock()


_OPEN: Dict[Path, List] = {}
_OPEN_LOCK = threading.Lock()


def acquire(root: Path, cfg: Config, *, call: Optional[Call], spawn: Spawn) -> Memory:
    """This process's Memory for ``root``, opened on first use and shared after."""
    key = Path(root).resolve()
    with _OPEN_LOCK:
        entry = _OPEN.get(key)
        if entry is None:
            entry = _OPEN[key] = [Memory(key, cfg, call=call, spawn=spawn).open(), 0]
        entry[1] += 1
        return entry[0]


def release(mem: Memory) -> None:
    with _OPEN_LOCK:
        key = mem.store.root
        entry = _OPEN.get(key)
        if entry is None or entry[0] is not mem:
            return
        entry[1] -= 1
        if entry[1] <= 0:
            del _OPEN[key]
            mem.close()
