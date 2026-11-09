import json
import unittest

from optmem.redact import redact
from optmem.search import rank
from test_memory import Fixture, turn

# Fake keys built from pieces, so this file does not itself look like it holds a secret.
KEYS = [
    "sk-" + "ant-api03-" + "aB3dE5fG7hJ9kL1mN3pQ5rS7",
    "sk-" + "proj-" + "Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2",
    "sk-" + "or-v1-" + "0a1b2c3d4e5f60718293a4b5c6d7e8f9",
    "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
    "AK" + "IA" + "IOSFODNN7EXAMPLE",
    "xox" + "b-" + "1234567890-abcdefghij",
    "AI" + "za" + "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q",
    "sk" + "_live_" + "4eC39HqLyjWDarjtT1zdp7dc",
    "gl" + "pat-" + "xYz123AbC456dEf789gHiJ",
    "hf" + "_" + "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    "ey" + "JhbGciOiJIUzI1NiJ9.ey" + "JzdWIiOiIxMjM0NTY3ODkwIn0.sig_part",
]


class RedactTest(unittest.TestCase):
    def test_each_key_shape_is_replaced_and_the_text_around_it_kept(self):
        for key in KEYS:
            with self.subTest(key=key[:8]):
                out = redact(f"export TOKEN={key} # mine")
                self.assertNotIn(key, out)
                self.assertEqual(out, "export TOKEN=[redacted] # mine")

    def test_a_private_key_block_goes_whole_even_when_cut_short(self):
        block = "-----BEGIN OPENSSH " + "PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEA\n-----END OPENSSH " + "PRIVATE KEY-----"
        self.assertEqual(redact(f"key:\n{block}\ndone"), "key:\n[redacted private key]\ndone")
        self.assertEqual(redact("-----BEGIN RSA " + "PRIVATE KEY-----\nMIIEow"), "[redacted private key]")

    def test_a_password_in_a_url_goes_but_placeholders_stay(self):
        self.assertEqual(redact("postgres://app:hunter2x@db:5432/x"), "postgres://app:[redacted]@db:5432/x")
        for kept in ["postgres://postgres:postgres@localhost/x", "https://u:${PASS}@h", "https://u:xxxx@h",
                     "https://u:<password>@h", "https://u:REDACTED@h", "https://u:[redacted]@h"]:
            self.assertEqual(redact(kept), kept)

    def test_words_that_merely_look_alike_are_kept(self):
        for text in ["sk-learn-v1-2-notes", "use scikit sk-learn", "ghp_short", "the AKIA prefix", "hf_hub"]:
            self.assertEqual(redact(text), text)


class LoggedRedactionTest(Fixture):
    def test_no_key_reaches_the_log_from_any_kind_of_row(self):
        key = KEYS[0]
        p = self.provider()
        msgs = turn(f"my key is {key}", f"noted {key}", tool=("terminal", {"cmd": f"echo {key}"}, f"{key}\n"))
        p.sync_turn("", "", session_id="s1", messages=msgs)
        p.on_memory_write("add", "memory", f"key {key}")
        raw = (self.home / "optmem" / "main").glob("*.jsonl")
        text = "".join(f.read_text() for f in raw)
        self.assertNotIn(key, text)
        self.assertEqual(text.count("[redacted]"), 5)

    def test_a_reloaded_turn_with_a_key_is_not_logged_twice(self):
        p = self.provider()
        msgs = turn(f"key {KEYS[1]}", "ok")
        p.sync_turn("", "", session_id="s1", messages=msgs)
        p.sync_turn("", "", session_id="s1", messages=msgs)
        self.assertEqual(len(self.main_rows()), 2)

    def test_zoom_redacts_a_key_logged_before_redaction_existed(self):
        p = self.provider()
        p.sync_turn("", "", session_id="s1", messages=turn("hello", "ok"))
        with p._mem.lock:
            m = p._mem.messages[0]
            p._mem.messages[0] = type(m)(m.i, m.kind, f"old {KEYS[3]}", m.size, m.date, m.source)
        out = json.loads(p.handle_tool_call("optmem_zoom", {"id": 0, "n": 1}))["result"]
        self.assertEqual(out, "0+1|user: old [redacted]")


class RankTest(unittest.TestCase):
    def test_case_accents_and_word_forms_match_and_the_exact_word_ranks_first(self):
        docs = [(0, "Configuração do Hyprland", "a"), (1, "the memories folder", "b"),
                (2, "unrelated words here", "c"), (3, "memory is short", "d")]
        self.assertEqual(rank(docs, "configuracao", 10), (["a"], 1))
        self.assertEqual(rank(docs, "memory", 1), (["d"], 2))
        self.assertEqual(rank(docs, "memory", 10)[0], ["d", "b"])

    def test_a_rare_word_outweighs_a_common_one(self):
        docs = [(i, "nix build again", str(i)) for i in range(5)] + [(9, "nix flake lockfile", "rare")]
        self.assertEqual(rank(docs, "build lockfile", 1)[0], ["rare"])

    def test_no_words_no_matches(self):
        self.assertEqual(rank([(0, "x", "a")], "?!", 10), ([], 0))


class FindToolTest(Fixture):
    def find(self, p, **args):
        return json.loads(p.handle_tool_call("optmem_find", args))["result"]

    def test_find_returns_message_lines_newest_first_with_a_count(self):
        p = self.provider()
        msgs = []
        for q, a in [("set up the gondolin vm", "done"), ("what about kitty", "fine"), ("gondolin is slow", "tuned")]:
            msgs += turn(q, a)
            p.sync_turn("", "", session_id="s1", messages=list(msgs))
        self.settle(p)
        out = self.find(p, query="Gondolin").split("\n")
        self.assertIn("4+1|user: gondolin is slow", out)
        self.assertIn("0+1|user: set up the gondolin vm", out)
        self.assertNotIn("2+1|user: what about kitty", out)
        hi = [int(a) + int(n) for a, n in (line.split("|")[0].split("+") for line in out[:-1])]
        self.assertEqual(hi, sorted(hi, reverse=True))
        self.assertRegex(out[-1], r"^\d+ of \d+ matching lines")
        self.assertEqual(self.find(p, query="zzzz"), "No matches.")
        self.assertEqual(len(self.find(p, query="gondolin", top=1).split("\n")), 2)

    def test_find_cuts_a_long_message_and_redacts_old_keys(self):
        p = self.provider()
        p.sync_turn("", "", session_id="s1", messages=turn("needle " + "pad " * 500, "ok"))
        with p._mem.lock:
            m = p._mem.messages[1]
            p._mem.messages[1] = type(m)(m.i, m.kind, f"needle {KEYS[4]}", m.size, m.date, m.source)
        lines = self.find(p, query="needle").split("\n")
        self.assertEqual(lines[0], "1+1|talk: needle [redacted]")
        self.assertLessEqual(len(lines[1].encode()), 400 + len("0+1|"))

    def test_find_with_kinds_ranks_only_those_messages_and_no_summaries(self):
        p = self.provider()
        msgs = turn("gondolin should boot faster", "on it", tool=("terminal", {"cmd": "gondolin start"}, "gondolin booted in 40s"))
        p.sync_turn("", "", session_id="s1", messages=msgs)
        p.on_delegation("gondolin check", "gondolin report", child_session_id="kid")
        self.settle(p)
        self.assertRegex(self.find(p, query="gondolin"), r"(?m)^\d+\+[2-9]", "unfiltered find includes a summary")
        self.assertEqual(self.find(p, query="gondolin", kinds=["user"]).split("\n")[:-1],
                         ["0+1|user: gondolin should boot faster"])
        lines = self.find(p, query="gondolin", kinds=["echo", "work"]).split("\n")[:-1]
        self.assertEqual([line.split("|", 1)[1].split(":")[0] for line in lines], ["work", "echo"])
        self.assertEqual(self.find(p, query="gondolin", kinds=[]), self.find(p, query="gondolin"))
        bad = json.loads(p.handle_tool_call("optmem_find", {"query": "gondolin", "kinds": ["chat"]}))
        self.assertIn("unknown kinds: chat", bad["error"])

    def test_find_is_a_listed_tool(self):
        p = self.provider()
        self.assertIn("optmem_find", [s["name"] for s in p.get_tool_schemas()])


if __name__ == "__main__":
    unittest.main()
