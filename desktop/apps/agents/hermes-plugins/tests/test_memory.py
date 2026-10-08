import json
import logging
import random
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

from optchat import OptChatProvider
from optchat.compaction import Job, run
from optchat.model import Config
from optchat.tree import Part

logging.getLogger("optchat").setLevel(logging.ERROR)


class StubLLM:
    """Stands in for call_llm: replies with the given lines in turn, recording each conversation."""

    def __init__(self, replies=None):
        self.replies = list(replies or [])
        self.calls = []
        self.lock = threading.Lock()

    def __call__(self, messages):
        with self.lock:
            self.calls.append([dict(m) for m in messages])
            if self.replies:
                return self.replies.pop(0)
        task = messages[1]["content"][-1]["text"]
        return "summary of " + task.split("\n", 1)[0][:60]


def turn(user, reply, tool=None):
    msgs = [{"role": "user", "content": user}]
    if tool:
        msgs.append({"role": "assistant", "content": "", "reasoning_content": "secret thoughts",
                     "tool_calls": [{"id": "c1", "type": "function",
                                     "function": {"name": tool[0], "arguments": json.dumps(tool[1])}}]})
        msgs.append({"role": "tool", "tool_call_id": "c1", "content": tool[2]})
    msgs.append({"role": "assistant", "content": reply})
    return msgs


class Fixture(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp(prefix="optchat-test-"))
        self.providers = []

    def tearDown(self):
        for p in self.providers:
            p.shutdown()
        shutil.rmtree(self.home, ignore_errors=True)

    def provider(self, session="s1", cfg=None, call=None, **kwargs):
        p = OptChatProvider(config=cfg or Config(), call=call or StubLLM())
        p.initialize(session, hermes_home=str(self.home), platform="cli", **kwargs)
        self.providers.append(p)
        return p

    def main_rows(self):
        rows = []
        for f in sorted((self.home / "optchat" / "main").glob("*.jsonl")):
            rows += [json.loads(line) for line in f.read_text().splitlines() if line.strip()]
        return rows

    def settle(self, p, timeout=10):
        deadline = time.time() + timeout
        while not p._mem.settled():
            self.assertLess(time.time(), deadline, "compaction never settled")
            time.sleep(0.01)


class IngestTest(Fixture):
    def test_same_messages_twice_log_nothing_new(self):
        p = self.provider()
        msgs = turn("deploy the blog", "done", tool=("terminal", {"cmd": "make deploy"}, "ok"))
        p.sync_turn("deploy the blog", "done", session_id="s1", messages=msgs)
        first = self.main_rows()
        p.sync_turn("deploy the blog", "done", session_id="s1", messages=msgs)
        self.assertEqual(self.main_rows(), first)
        self.assertEqual([r["kind"] for r in first], ["user", "tool", "echo", "talk"])
        self.assertEqual(first[1]["text"], 'terminal {"cmd": "make deploy"}')
        self.assertNotIn("secret thoughts", json.dumps(first))
        self.assertEqual(first[0]["source"], "cli:s1")

    def test_next_turn_logs_only_its_rows(self):
        p = self.provider()
        msgs = turn("a", "b")
        p.sync_turn("a", "b", session_id="s1", messages=msgs)
        msgs = msgs + turn("c", "d")
        p.sync_turn("c", "d", session_id="s1", messages=msgs)
        self.assertEqual([r["text"] for r in self.main_rows()], ["a", "b", "c", "d"])

    def test_unseen_session_logs_only_its_last_turn(self):
        # A resumed or compressed session hands over history an earlier sync already logged.
        p = self.provider()
        history = turn("a", "b") + turn("c", "d")
        p.on_session_switch("s2", parent_session_id="s1", reason="compression")
        p.sync_turn("c", "d", session_id="s2", messages=history)
        self.assertEqual([r["text"] for r in self.main_rows()], ["c", "d"])

    def test_tool_results_are_clipped_head_and_tail(self):
        p = self.provider(cfg=Config(cap_chars=1000))
        out = "HEAD" + "x" * 5000 + "TAIL"
        p.sync_turn("go", "ok", session_id="s1", messages=turn("go", "ok", tool=("read", {}, out)))
        echo = next(r for r in self.main_rows() if r["kind"] == "echo")
        self.assertLessEqual(len(echo["text"]), 1000)
        self.assertTrue(echo["text"].startswith("HEAD") and echo["text"].endswith("TAIL"))

    def test_subagent_context_never_writes(self):
        self.provider(session="parent")
        child = self.provider(session="child", agent_context="subagent")
        child.sync_turn("x", "y", session_id="child", messages=turn("x", "y"))
        child.on_memory_write("add", "memory", "likes tea")
        self.assertEqual(self.main_rows(), [])


class InjectionTest(Fixture):
    def test_view_injected_once_per_session_and_after_switch(self):
        p = self.provider()
        p.sync_turn("hello there", "hi", session_id="s0", messages=turn("hello there", "hi"))
        view = p.prefetch("q", session_id="s1")
        self.assertIn("<chat>\n0+1|user: hello there\n1+1|talk: hi\n</chat>", view)
        self.assertEqual(p.prefetch("q", session_id="s1"), "")
        self.assertEqual(p.prefetch("q", session_id="s1"), "")
        self.assertTrue(p.prefetch("q", session_id="s2"), "a concurrent session gets its own view")
        p.on_session_switch("s1", reset=False, reason="compression")
        self.assertTrue(p.prefetch("q", session_id="s1"))
        self.assertEqual(p.prefetch("q", session_id="s1"), "")

    def test_two_instances_in_one_process_share_the_writer(self):
        a = self.provider(session="discord-1")
        b = self.provider(session="discord-2")
        a.sync_turn("from a", "ok", session_id="discord-1", messages=turn("from a", "ok"))
        b.sync_turn("from b", "ok", session_id="discord-2", messages=turn("from b", "ok"))
        self.assertEqual([r["source"] for r in self.main_rows()], ["cli:discord-1"] * 2 + ["cli:discord-2"] * 2)
        self.assertEqual([r["i"] for r in self.main_rows()], [0, 1, 2, 3])

    def test_another_process_holding_the_lock_makes_it_read_only(self):
        w = self.provider()
        w.sync_turn("remember the milk", "noted", session_id="s1", messages=turn("remember the milk", "noted"))
        w.shutdown()
        self.providers.remove(w)
        holder = subprocess.Popen(
            [sys.executable, "-c",
             "import fcntl, os, sys, time\n"
             f"fd = os.open({str(self.home / 'optchat' / 'lock')!r}, os.O_RDWR)\n"
             "try:\n    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)\n"
             "except BlockingIOError:\n    print('still held', flush=True)\n    sys.exit(1)\n"
             "print('locked', flush=True)\ntime.sleep(60)\n"],
            stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(holder.stdout.readline().strip(), "locked")
            r = self.provider(session="cli")
            self.assertFalse(r._mem.writable)
            r.sync_turn("x", "y", session_id="cli", messages=turn("x", "y"))
            r.on_delegation("t", "report", child_session_id="kid")
            self.assertEqual(len(self.main_rows()), 2)
            self.assertIn("0+1|user: remember the milk", r.prefetch("q", session_id="cli"))
            self.assertIn("talk: noted", json.loads(r.handle_tool_call("optchat_zoom", {"id": 1, "n": 1}))["result"])
        finally:
            holder.kill()
            holder.wait()
            holder.stdout.close()


class ZoomTest(Fixture):
    def test_zoom_one_is_whole_and_zoom_n_is_two_children(self):
        p = self.provider()
        long_reply = "word " * 400
        p.sync_turn("q1", long_reply, session_id="s1", messages=turn("q1", long_reply))
        p.sync_turn("q2", "a2", session_id="s1", messages=turn("q1", long_reply) + turn("q2", "a2"))
        self.settle(p)
        whole = json.loads(p.handle_tool_call("optchat_zoom", {"id": 1, "n": 1}))["result"]
        self.assertEqual(whole, "1+1|talk: " + long_reply.strip())
        pair = json.loads(p.handle_tool_call("optchat_zoom", {"id": 0, "n": 4}))["result"].split("\n")
        self.assertEqual([line.split("|")[0] for line in pair], ["0+2", "2+2"])
        self.assertEqual(pair[1], "2+2|user: q2 talk: a2")
        bad = json.loads(p.handle_tool_call("optchat_zoom", {"id": 1, "n": 2}))["result"]
        self.assertEqual(bad, "No line 1+2.")
        self.assertRegex(json.loads(p.handle_tool_call("optchat_date", {"id": 0}))["result"], r"^\d{4}-\d\d-\d\dT")


class CompactionTest(Fixture):
    def test_small_sources_skip_the_model(self):
        llm = StubLLM()
        p = self.provider(call=llm)
        msgs = []
        for k in range(8):
            msgs += turn(f"short question {k}", f"short answer {k}")
            p.sync_turn("", "", session_id="s1", messages=msgs)
        self.settle(p)
        tasks = [c[1]["content"][-1]["text"] for c in llm.calls]
        self.assertFalse([t for t in tasks if t.startswith("Compaction: compress")],
                         "a short message went to the model")
        self.assertEqual(p._mem.nodes[Part(1, 0)].text, "user: short question 0\ntalk: short answer 0")
        self.assertIn(Part(4, 0), p._mem.nodes, "the tree grew to the top")
        self.assertTrue(all(t.startswith("Compaction: merge") for t in tasks))

    def test_a_long_message_goes_to_the_model_once(self):
        llm = StubLLM(["user asked about the long thing"])
        p = self.provider(call=llm)
        long_text = "please read this " * 100
        p.sync_turn(long_text, "ok", session_id="s1", messages=turn(long_text, "ok"))
        self.settle(p)
        leaf_calls = [c for c in llm.calls if "Compaction: compress message 0" in c[1]["content"][-1]["text"]]
        self.assertEqual(len(leaf_calls), 1)
        self.assertEqual(p._mem.nodes[Part(0, 0)].text, "user asked about the long thing")

    def test_too_long_retry_keeps_the_shortest(self):
        cfg = Config()
        lines = ["a" * 700, "b" * 560, "c" * 530, "d" * 600, "e" * 545, "f" * 10]
        llm = StubLLM(lines)
        job = Job(Part(0, 3), ("0+1|user: hi",), "Compaction: compress message 3 ...", "src")
        self.assertEqual(run(job, llm, cfg), "c" * 530)
        self.assertEqual(len(llm.calls), 5, "stops after 5 tries")
        self.assertEqual([m["role"] for m in llm.calls[-1]], ["system", "user"] + ["assistant", "user"] * 4)

    def test_too_long_reply_shows_the_cut(self):
        llm = StubLLM(["x" * 600, "short enough"])
        job = Job(Part(0, 3), (), "Compaction: compress message 3 ...", "src")
        self.assertEqual(run(job, llm, Config()), "short enough")
        seen = []
        for c in llm.calls:
            seen.append(c[-1]["content"])
        self.assertTrue(seen[-1].startswith("Too long: your line is 600 bytes, over the 512-byte limit."))
        self.assertTrue(seen[-1].endswith("x" * 512 + "| ← LIMIT"))

    def test_failed_call_retries_at_next_message_then_falls_back(self):
        leaf_calls = []

        def down(messages):
            if "compress message 0" in messages[1]["content"][-1]["text"]:
                leaf_calls.append(time.time())
            raise RuntimeError("no provider configured")

        p = self.provider(call=down, cfg=Config(tries=2))
        long_text = "lorem ipsum " * 100
        p.sync_turn(long_text, "ok", session_id="s1", messages=turn(long_text, "ok"))
        deadline = time.time() + 5
        while not p._mem._failed and time.time() < deadline:
            time.sleep(0.01)
        self.assertEqual(len(leaf_calls), 1)
        self.assertNotIn(Part(0, 0), p._mem.nodes)
        p.sync_turn("next", "ok", session_id="s1", messages=turn(long_text, "ok") + turn("next", "ok"))
        self.settle(p)
        self.assertEqual(len(leaf_calls), 2)
        self.assertTrue(p._mem.nodes[Part(0, 0)].text.startswith("user: lorem ipsum"))


class ViewCacheTest(Fixture):
    def message(self, rng, i):
        return f"message {i} " + "lorem ipsum dolor sit amet " * rng.randint(2, 41)

    def test_turns_reuse_nearly_all_of_the_previous_view_across_a_restart(self):
        rng = random.Random(7)
        cfg = Config(view_bytes=48_000, compactor="heuristic")
        p = OptChatProvider(config=cfg)
        p.initialize("s", hermes_home=str(self.home), platform="cli")
        prev, rewritten, total, msgs = "", 0, 0, []
        for t in range(600):
            msgs += turn(self.message(rng, 2 * t), self.message(rng, 2 * t + 1))
            p.sync_turn("", "", session_id="s", messages=msgs)
            self.settle(p)
            if t == 300:
                p.shutdown()
                p = OptChatProvider(config=cfg)
                p.initialize("s", hermes_home=str(self.home), platform="cli")
                self.settle(p)
            view = p._mem.render().removesuffix("</chat>")
            if t >= 150:
                k = 0
                while k < min(len(prev), len(view)) and prev[k] == view[k]:
                    k += 1
                rewritten += len(view) - k
                total += len(view)
            prev = view
        p.shutdown()
        self.assertLess(rewritten / total, 0.15, f"turns rewrote {rewritten / total:.1%} of view bytes")

    def test_restart_keeps_the_view_byte_identical(self):
        rng = random.Random(3)
        cfg = Config(view_bytes=16_000, compactor="heuristic")
        p = OptChatProvider(config=cfg)
        p.initialize("s", hermes_home=str(self.home), platform="cli")
        msgs = []
        for t in range(150):
            msgs += turn(self.message(rng, 2 * t), "ok")
            p.sync_turn("", "", session_id="s", messages=msgs)
        self.settle(p)
        before = p._mem.render()
        p.shutdown()
        p = OptChatProvider(config=cfg)
        p.initialize("s", hermes_home=str(self.home), platform="cli")
        self.providers.append(p)
        self.settle(p)
        self.assertEqual(p._mem.render(), before)


if __name__ == "__main__":
    unittest.main()
