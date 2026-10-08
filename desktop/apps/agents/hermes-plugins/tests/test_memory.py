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

    def test_compressed_child_session_resumes_after_its_parents_rows(self):
        p = self.provider()
        p.sync_turn("a", "b", session_id="s1", messages=turn("a", "b"))
        p.on_session_switch("s2", parent_session_id="s1", reset=False, reason="compression")
        p.sync_turn("c", "d", session_id="s2", messages=turn("a", "b") + turn("c", "d"))
        self.assertEqual([r["text"] for r in self.main_rows()], ["a", "b", "c", "d"])
        self.assertEqual([r["source"] for r in self.main_rows()], ["cli:s1"] * 2 + ["cli:s2"] * 2)

    def test_mid_turn_compression_logs_the_whole_turn_and_never_the_summary(self):
        from agent.context_compressor import COMPRESSED_SUMMARY_METADATA_KEY, SUMMARY_PREFIX

        def call(k, name):
            return {"role": "assistant", "content": "", "tool_calls": [
                {"id": k, "type": "function", "function": {"name": name, "arguments": "{}"}}]}

        p = self.provider()
        p.sync_turn("a", "b", session_id="s1", messages=turn("a", "b"))
        live = turn("a", "b") + [
            {"role": "user", "content": "migrate the db"},
            call("c1", "migrate"), {"role": "tool", "tool_call_id": "c1", "content": "migrated 12 tables"},
            call("c2", "check"), {"role": "tool", "tool_call_id": "c2", "content": "all green"},
        ]
        # Mid-turn, Hermes compresses: on_pre_compress sees the list first, then the session
        # rotates and the turn goes on over the summary plus the protected tail.
        self.assertEqual(p.on_pre_compress(live), "")
        p.on_session_switch("s2", parent_session_id="s1", reset=False, reason="compression")
        summary = {"role": "user", "content": SUMMARY_PREFIX + "\nThe user asked a; then to migrate the db.",
                   COMPRESSED_SUMMARY_METADATA_KEY: True}
        compressed = [summary, *live[-2:], {"role": "assistant", "content": "done"}]
        p.sync_turn("migrate the db", "done", session_id="s2", messages=compressed)
        self.assertEqual([r["text"] for r in self.main_rows()], [
            "a", "b", "migrate the db", "migrate {}", "migrated 12 tables", "check {}", "all green", "done"])

    def test_reloaded_rows_and_an_interrupted_turn_are_resumed_not_skipped(self):
        p = self.provider()
        first = turn("plan the trip", "Lisbon in May.")
        p.sync_turn("plan the trip", "Lisbon in May.", session_id="s1", messages=first)
        # Hermes never syncs an interrupted turn, and the gateway reloads history from its DB
        # with bookkeeping keys the live rows lacked.
        interrupted = turn("book flights", "", tool=("search", {"q": "LIS flights"}, "TAP 09:40"))[:-1]
        reloaded = [{**m, "_db_persisted": True, "_row_id": k, "timestamp": 1.5}
                    for k, m in enumerate(first + interrupted)]
        p.sync_turn("window seat", "Done.", session_id="s1", messages=reloaded + turn("window seat", "Done."))
        self.assertEqual([r["text"] for r in self.main_rows()], [
            "plan the trip", "Lisbon in May.", "book flights", 'search {"q": "LIS flights"}', "TAP 09:40",
            "window seat", "Done."])

    def test_after_a_restart_an_unseen_list_resumes_after_the_logged_rows(self):
        p = self.provider()
        p.sync_turn("a", "b", session_id="s1", messages=turn("a", "b"))
        p.shutdown()
        self.providers.remove(p)
        p = self.provider()
        history = turn("a", "b") + turn("missed", "while down") + turn("c", "d")
        p.sync_turn("c", "d", session_id="s1", messages=history)
        p.sync_turn("c", "d", session_id="s1", messages=history)
        self.assertEqual([r["text"] for r in self.main_rows()], ["a", "b", "missed", "while down", "c", "d"])

    def test_a_repeated_turn_is_logged_again(self):
        p = self.provider()
        p.sync_turn("hi", "hello", session_id="s1", messages=turn("hi", "hello"))
        p.shutdown()
        self.providers.remove(p)
        p = self.provider()
        p.sync_turn("hi", "hello", session_id="s1", messages=turn("hi", "hello") + turn("hi", "hello"))
        self.assertEqual([r["text"] for r in self.main_rows()], ["hi", "hello", "hi", "hello"])

    def test_a_rewound_list_logs_only_the_new_turn(self):
        p = self.provider()
        msgs = turn("a", "ok") + turn("b", "ok")
        p.sync_turn("a", "ok", session_id="s1", messages=msgs[:2])
        p.sync_turn("b", "ok", session_id="s1", messages=msgs)
        p.sync_turn("oops", "ok", session_id="s1", messages=msgs + turn("oops", "ok"))
        p.on_session_switch("s1", parent_session_id="", reset=False, rewound=True)
        p.sync_turn("c", "ok", session_id="s1", messages=msgs + turn("c", "ok"))
        self.assertEqual([r["text"] for r in self.main_rows()], ["a", "ok", "b", "ok", "oops", "ok", "c", "ok"])

    def test_turns_after_an_undo_are_logged_once(self):
        p = self.provider()
        kept = turn("a", "b") + turn("c", "d")
        p.sync_turn("a", "b", session_id="s1", messages=kept[:2])
        p.sync_turn("c", "d", session_id="s1", messages=kept)
        p.sync_turn("e", "f", session_id="s1", messages=kept + turn("e", "f"))
        p.on_session_switch("s1", parent_session_id="", reset=False, rewound=True)
        p.sync_turn("x", "y", session_id="s1", messages=kept + turn("x", "y"))
        p.sync_turn("p", "q", session_id="s1", messages=kept + turn("x", "y") + turn("p", "q"))
        self.assertEqual([r["text"] for r in self.main_rows()], list("abcdefxypq"))

    def test_a_logged_turn_reloaded_in_another_form_is_not_logged_again(self):
        # The gateway reloads history from its DB: images become "[screenshot]" text, and with
        # gateway.message_timestamps on, user text gains a leading timestamp.
        image = {"role": "user", "content": [
            {"type": "text", "text": "look"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA"}}]}
        reloaded = {"role": "user", "content": "[Wed 2026-10-07 09:00:00 UTC] look\n[screenshot]"}
        p = self.provider()
        first = turn("hi", "hello")
        p.sync_turn("hi", "hello", session_id="s1", messages=first)
        p.sync_turn("look", "a cat", session_id="s1", messages=first + [image, {"role": "assistant", "content": "a cat"}])
        p.sync_turn("and now?", "ok", session_id="s1",
                    messages=first + [reloaded, {"role": "assistant", "content": "a cat"}] + turn("and now?", "ok"))
        self.assertEqual([r["text"] for r in self.main_rows()],
                         ["hi", "hello", "look\n[screenshot]", "a cat", "and now?", "ok"])

    def test_a_session_older_than_the_log_logs_from_its_last_turn(self):
        # Enabling the provider meets gateway sessions with history it never saw: logging all of
        # it would date it today and summarize it row by row.
        p = self.provider()
        history = turn("old", "talk") + turn("older", "still", tool=("ls", {}, "a.txt"))
        p.sync_turn("now", "ok", session_id="s1", messages=history + turn("now", "ok"))
        self.assertEqual([r["text"] for r in self.main_rows()], ["now", "ok"])
        # An /undo drops the one logged turn; the history before it is still not today's.
        p.sync_turn("then", "sure", session_id="s1", messages=history + turn("then", "sure"))
        self.assertEqual([r["text"] for r in self.main_rows()], ["now", "ok", "then", "sure"])
        # Compression strikes mid-turn in another such session.
        p.on_session_switch("s2")
        p.on_pre_compress(history + [{"role": "user", "content": "migrate"}] + turn("x", "y")[1:])
        self.assertEqual([r["text"] for r in self.main_rows()][4:], ["migrate", "y"])

    def test_a_compressed_child_first_synced_after_a_restart_resumes_after_its_parent(self):
        p = self.provider()
        p.sync_turn("a", "b", session_id="s1", messages=turn("a", "b"))
        live = turn("a", "b") + turn("migrate", "", tool=("migrate", {}, "12 tables"))[:-1]
        p.on_pre_compress(live)
        p.on_session_switch("s2", parent_session_id="s1", reset=False, reason="compression")
        p.shutdown()
        self.providers.remove(p)
        p = self.provider(session="s2")
        p.sync_turn("migrate", "done", session_id="s2", messages=live + [{"role": "assistant", "content": "done"}])
        self.assertEqual([r["text"] for r in self.main_rows()], ["a", "b", "migrate", "migrate {}", "12 tables", "done"])

    def test_a_row_appended_during_a_sync_is_logged_by_the_next(self):
        # Hermes hands sync_turn its live list on a background worker while the next turn appends to it.
        class Growing(list):
            """Gains a row right after the sync first reads it."""

            grown = False

            def _read(self, items):
                if not self.grown:
                    self.grown = True
                    self.append({"role": "user", "content": "typed meanwhile"})
                return items

            def __iter__(self):
                return iter(self._read(list(super().__iter__())))

            def __getitem__(self, k):
                return self._read(super().__getitem__(k)) if isinstance(k, slice) else super().__getitem__(k)

        p = self.provider()
        live = Growing(turn("a", "b"))
        p.sync_turn("a", "b", session_id="s1", messages=live)
        p.sync_turn("typed meanwhile", "", session_id="s1", messages=list(live))
        self.assertEqual([r["text"] for r in self.main_rows()], ["a", "b", "typed meanwhile"])

    def test_the_injected_view_is_not_logged_as_user_words(self):
        from agent.memory_manager import build_memory_context_block

        p = self.provider()
        p.sync_turn("first", "ok", session_id="s0", messages=turn("first", "ok"))
        fence = build_memory_context_block(p.prefetch("look", session_id="s1"))
        self.assertIn("<chat>", fence)
        # Hermes appends the fenced view to multimodal (list) content as a durable text part.
        image_turn = {"role": "user", "content": [
            {"type": "text", "text": "look at this"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
            {"type": "text", "text": fence},
        ]}
        p.sync_turn("look at this", "a cat", session_id="s1",
                    messages=[image_turn, {"role": "assistant", "content": "a cat"}])
        string_turn = {"role": "user", "content": "and this?\n\n" + fence}
        p.sync_turn("and this?", "a dog", session_id="s2",
                    messages=[string_turn, {"role": "assistant", "content": "a dog"}])
        users = [r["text"] for r in self.main_rows() if r["kind"] == "user"]
        self.assertEqual(users, ["first", "look at this\n[screenshot]", "and this?"])

    def test_a_reply_promoted_from_reasoning_is_logged_and_a_hidden_placeholder_is_not(self):
        # A reasoning-only stop keeps content empty and replays its text from api_content.
        promoted = {"role": "assistant", "content": "", "reasoning_content": "Use port 8080.",
                    "api_content": "Use port 8080."}
        hidden = {"role": "assistant", "content": "", "display_kind": "hidden", "api_content": "[response interrupted]"}
        p = self.provider()
        first = [{"role": "user", "content": "deploy"}, hidden]
        p.sync_turn("deploy", "", session_id="s1", messages=first)
        p.sync_turn("which port?", "Use port 8080.", session_id="s1",
                    messages=first + [{"role": "user", "content": "which port?"}, promoted])
        self.assertEqual([(r["kind"], r["text"]) for r in self.main_rows()],
                         [("user", "deploy"), ("user", "which port?"), ("talk", "Use port 8080.")])

    def test_an_interim_reply_hermes_reprompted_past_is_not_logged(self):
        # A stall ("I'll check X" with no tool call) or a degenerate fragment is kept as an
        # "incomplete" row, a nudge follows, and the model answers again.
        from agent.conversation_loop import _CODEX_ACK_CONTINUATION_NUDGE, _DEGENERATE_FINAL_NUDGE

        stall = {"role": "assistant", "content": "I'll check the logs next.", "finish_reason": "incomplete"}
        fragment = {"role": "assistant", "content": "", "reasoning_content": "...", "api_content": "Ok",
                    "finish_reason": "incomplete"}
        msgs = [{"role": "user", "content": "why is it down?"},
                stall, {"role": "user", "content": _CODEX_ACK_CONTINUATION_NUDGE},
                fragment, {"role": "user", "content": _DEGENERATE_FINAL_NUDGE},
                {"role": "assistant", "content": "The disk is full.", "finish_reason": "stop"}]
        p = self.provider()
        p.sync_turn("why is it down?", "The disk is full.", session_id="s1", messages=msgs)
        self.assertEqual([(r["kind"], r["text"]) for r in self.main_rows()],
                         [("user", "why is it down?"), ("talk", "The disk is full.")])

    def test_tool_results_are_clipped_head_and_tail(self):
        p = self.provider(cfg=Config(cap_chars=1000))
        out = "HEAD" + "x" * 5000 + "TAIL"
        p.sync_turn("go", "ok", session_id="s1", messages=turn("go", "ok", tool=("read", {}, out)))
        echo = next(r for r in self.main_rows() if r["kind"] == "echo")
        self.assertLessEqual(len(echo["text"]), 1000)
        self.assertTrue(echo["text"].startswith("HEAD") and echo["text"].endswith("TAIL"))

    def test_long_text_is_logged_as_several_messages_in_a_row(self):
        p = self.provider(cfg=Config(cap_chars=1000))
        reply = "\n".join(f"line {k} " + "word " * 12 for k in range(60))
        p.sync_turn("go", reply, session_id="s1", messages=turn("go", reply))
        p.on_delegation("audit", "finding " * 300, child_session_id="kid")
        rows = self.main_rows()
        talk = [r["text"] for r in rows if r["kind"] == "talk"]
        self.assertGreater(len(talk), 3)
        self.assertTrue(all(len(t) <= 1000 for t in talk))
        self.assertEqual("\n".join(talk).split(), reply.split())
        self.assertTrue(all(t.startswith("line ") for t in talk), "cut at line ends")
        work = [r["text"] for r in rows if r["kind"] == "work"]
        self.assertEqual(len(work), 3)
        self.assertEqual(" ".join(work).split(), ["[kid]", "task:", "audit"] + ["finding"] * 300)
        p.sync_turn("go", reply, session_id="s1", messages=turn("go", reply))
        self.assertEqual(len(self.main_rows()), len(rows), "split rows still align with the log")

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

    def sent(self, user, view):
        """A user row as Hermes keeps it after sending the view: the sent bytes in api_content."""
        from agent.memory_manager import build_memory_context_block

        return {"role": "user", "content": user, "api_content": user + "\n\n" + build_memory_context_block(view)}

    def test_a_restart_does_not_inject_a_view_the_history_already_carries(self):
        p = self.provider()
        p.sync_turn("hello", "hi", session_id="s0", messages=turn("hello", "hi"))
        view = p.prefetch("q", session_id="s1")
        self.assertIn("<chat>", view)
        p.sync_turn("q", "a", session_id="s1", messages=[self.sent("q", view), {"role": "assistant", "content": "a"}])
        p.shutdown()
        self.providers.remove(p)
        p = self.provider(session="s1")
        self.assertEqual(p.prefetch("resumed", session_id="s1"), "")

    def test_a_view_that_never_landed_is_offered_again(self):
        # Hermes drops a prefetch that outlasts its 8 s timeout.
        p = self.provider()
        p.sync_turn("hello", "hi", session_id="s0", messages=turn("hello", "hi"))
        self.assertTrue(p.prefetch("q", session_id="s1"))
        p.sync_turn("q", "a", session_id="s1", messages=turn("q", "a"))
        self.assertTrue(p.prefetch("q2", session_id="s1"), "the view never reached the session")

    def test_a_turn_that_never_syncs_is_settled_by_the_next_sync(self):
        # Hermes skips sync_turn for an interrupted or failed turn. Its user row may keep the view
        # it was sent with, and a sync still queued looks the same, so the next prefetch waits.
        p = self.provider()
        p.sync_turn("hello", "hi", session_id="s0", messages=turn("hello", "hi"))
        view = p.prefetch("q", session_id="s1")
        self.assertEqual(p.prefetch("retry", session_id="s1"), "")
        p.sync_turn("retry", "ok", session_id="s1", messages=[self.sent("q", view)] + turn("retry", "ok"))
        self.assertEqual(p.prefetch("next", session_id="s1"), "", "the interrupted row kept the view")
        self.assertTrue(p.prefetch("q", session_id="s2"))
        self.assertEqual(p.prefetch("retry", session_id="s2"), "")
        p.sync_turn("retry", "ok", session_id="s2", messages=turn("retry", "ok"))
        self.assertTrue(p.prefetch("next", session_id="s2"), "the failed turn's row was dropped")

    def test_compression_and_branches_reinject_only_when_the_view_is_gone(self):
        p = self.provider()
        p.sync_turn("hello", "hi", session_id="s0", messages=turn("hello", "hi"))
        view = p.prefetch("q", session_id="s1")
        head = [self.sent("q", view), {"role": "assistant", "content": "a"}]
        p.sync_turn("q", "a", session_id="s1", messages=head)
        p.on_session_switch("b1", parent_session_id="s1", reset=False, reason="branch")
        self.assertEqual(p.prefetch("q", session_id="b1"), "", "a branch copies the history, view and all")
        # The first compression keeps the protected head, and the view in it.
        p.on_session_switch("s2", parent_session_id="s1", reset=False, reason="compression")
        p.sync_turn("go on", "ok", session_id="s2", messages=head + turn("go on", "ok"))
        self.assertEqual(p.prefetch("next", session_id="s2"), "")
        # A later one summarizes it away.
        p.on_session_switch("s3", parent_session_id="s2", reset=False, reason="compression")
        p.sync_turn("more", "ok", session_id="s3", messages=turn("more", "ok"))
        self.assertTrue(p.prefetch("next", session_id="s3"))

    def test_resume_keeps_the_resumed_sessions_own_history(self):
        # /resume names the session it left as parent_session_id; that session is no ancestor.
        p = self.provider()
        p.sync_turn("hello", "hi", session_id="s0", messages=turn("hello", "hi"))
        view = p.prefetch("q", session_id="s1")
        p.sync_turn("q", "a", session_id="s1", messages=[self.sent("q", view), {"role": "assistant", "content": "a"}])
        p.on_session_switch("s2", parent_session_id="s1", reset=True, reason="new_session")
        p.on_session_switch("s1", parent_session_id="s2", reset=False, reason="resume")
        self.assertEqual(p.prefetch("next", session_id="s1"), "", "s1's history still carries its view")
        parents = self.home / "optchat" / "parents.json"
        self.assertNotIn("s1", json.loads(parents.read_text()) if parents.exists() else {})

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


class StoreTest(Fixture):
    def test_a_replaced_file_is_on_disk_before_and_after_the_rename(self):
        # Without an fsync of the new bytes before the rename and of the directory after it, a
        # power loss can leave view.json empty or the old one in place.
        import os
        from unittest import mock

        from optchat.store import Store

        store = Store(self.home / "optchat")
        self.assertTrue(store.try_lock())
        events = []
        real_fsync, real_replace = os.fsync, os.replace

        def fsync(fd):
            events.append(("fsync", os.path.realpath(f"/proc/self/fd/{fd}")))
            real_fsync(fd)

        def replace(src, dst):
            events.append(("replace", os.path.realpath(src)))
            real_replace(src, dst)

        with mock.patch("optchat.store.os.fsync", fsync), mock.patch("optchat.store.os.replace", replace):
            store.save_parents({"s2": "s1"})
        store.unlock()
        root = os.path.realpath(store.root)
        tmp = os.path.join(root, "parents.json.tmp")
        self.assertEqual(events, [("fsync", tmp), ("replace", tmp), ("fsync", root)])
        self.assertEqual(store.load_parents(), {"s2": "s1"})

    def test_a_new_file_or_directory_is_on_disk_once_its_parent_is_synced(self):
        # An fsynced append survives a power loss only if the directory entry naming its file
        # does too: a new day file syncs its directory once, and each open syncs the directories.
        import os
        from unittest import mock

        from optchat.model import Message, Node
        from optchat.store import Store

        events = []
        real_fsync = os.fsync

        def fsync(fd):
            events.append(os.path.realpath(f"/proc/self/fd/{fd}"))
            real_fsync(fd)

        store = Store(self.home / "optchat")
        day1, day2 = "2026-10-01T09:00:00-06:00", "2026-10-02T09:00:00-06:00"
        with mock.patch("optchat.store.os.fsync", fsync):
            self.assertTrue(store.try_lock())
            store.append_message(Message(0, "user", "a", 7, day1))
            store.append_message(Message(1, "talk", "b", 7, day1))
            store.append_message(Message(2, "user", "c", 7, day2))
            store.append_node(Node(0, 0, "a", 1))
            store.append_node(Node(0, 1, "b", 1))
            store.unlock()
            self.assertTrue(Store(self.home / "optchat").try_lock())
        home, root = os.path.realpath(self.home), os.path.realpath(store.root)
        main, tree = os.path.join(root, "main"), os.path.join(root, "tree")
        tree_day = next(iter(os.listdir(tree)))
        self.assertEqual(events, [
            home, root, main, tree,
            f"{main}/2026-10-01.jsonl", main,
            f"{main}/2026-10-01.jsonl",
            f"{main}/2026-10-02.jsonl", main,
            f"{tree}/{tree_day}", tree,
            f"{tree}/{tree_day}",
            home, root, main, tree,
        ])


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
