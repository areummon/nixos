import math
import unittest

from optchat.tree import Part, View, fit, grow, most_due, part_named, view_before


def push(state, states):
    """Taelin's rollback push (spec §3.1) without ``life``: newest first, (keep, state, older)."""
    if states is None:
        return (0, state, None)
    keep, top, older = states
    if keep == 0:
        return (1, top, older)
    return (0, state, push(top, older))


def push_view(states, t):
    starts = []
    while states is not None:
        starts.insert(0, states[1])
        states = states[2]
    bounds = starts[1:] + [t + 1]
    return [f"{s}+{e - s}" for s, e in zip(starts, bounds)]


def names(parts):
    return [p.name for p in parts]


ALWAYS = lambda p: True  # noqa: E731
ONE = lambda p: 1  # noqa: E731


class PartTest(unittest.TestCase):
    def test_node_naming(self):
        self.assertEqual(Part(3, 5).name, "40+8")
        self.assertEqual(part_named(40, 8), Part(3, 5))
        self.assertEqual(Part(3, 5).children(), (Part(2, 10), Part(2, 11)))

    def test_part_named_rejects_misaligned(self):
        self.assertIsNone(part_named(4, 3))
        self.assertIsNone(part_named(6, 4))
        self.assertIsNone(part_named(0, 0))


class PushTest(unittest.TestCase):
    SPEC_TABLE = {
        0: ["0+1"],
        1: ["0+2"],
        2: ["0+2", "2+1"],
        3: ["0+2", "2+2"],
        4: ["0+4", "4+1"],
        5: ["0+4", "4+2"],
        6: ["0+4", "4+2", "6+1"],
        7: ["0+4", "4+2", "6+2"],
        8: ["0+4", "4+4", "8+1"],
        9: ["0+4", "4+4", "8+2"],
    }

    def run_push(self, last):
        states, view = None, []
        for t in range(last + 1):
            states = push(t, states)
            expected = push_view(states, t)
            view = fit(view + [Part(0, t)], t + 1, size=ONE, built=ALWAYS, budget=len(expected))
            yield t, names(view), expected

    def test_matches_spec_table(self):
        for t, got, _ in self.run_push(9):
            self.assertEqual(got, self.SPEC_TABLE[t], f"t={t}")

    def test_matches_push_and_stays_logarithmic(self):
        for t, got, expected in self.run_push(5000):
            self.assertEqual(got, expected, f"t={t}")
            self.assertLessEqual(len(got), 2 * math.log2(t + 1) + 1, f"t={t}")

    def test_pair_age_counts_from_last_message(self):
        # §3.2: at T=10 with 0+4, 4+4, 8+1, 9+1, push merges 8-9, not 0-7.
        view = [Part(2, 0), Part(2, 1), Part(0, 8), Part(0, 9)]
        self.assertEqual(most_due(view, 10, ALWAYS), 2)

    def test_unbuilt_parent_blocks_merge(self):
        view = [Part(0, 0), Part(0, 1)]
        self.assertEqual(most_due(view, 2, lambda p: p != Part(1, 0)), -1)


class GrowTest(unittest.TestCase):
    def test_sawtooth_only_grows_at_end_between_batches(self):
        view, batches = View(), 0
        size = lambda p: 100  # noqa: E731
        for i in range(400):
            before = view.parts
            view, merged = grow(view, i, size=size, built=ALWAYS, high=2000, low=1000)
            total = 100 * len(view.parts)
            if merged:
                batches += 1
                self.assertLessEqual(total, 1000)
            else:
                self.assertEqual(view.parts[:-1], before, f"message {i} rewrote the view")
                self.assertLessEqual(total, 2000)
        self.assertGreater(batches, 5)

    def test_batch_waits_for_built_parents(self):
        view = View()
        built = set()
        for i in range(30):
            view, _ = grow(view, i, size=lambda p: 100, built=lambda p: p in built, high=2000, low=1000)
        self.assertTrue(view.merging)
        self.assertEqual(len(view.parts), 30)
        built.update(Part(1, k) for k in range(15))
        view, merged = grow(view, 30, size=lambda p: 100, built=lambda p: p in built, high=2000, low=1000)
        self.assertTrue(merged)
        self.assertEqual(len(view.parts), 16)
        built.update(Part(2, k) for k in range(8))
        view, _ = grow(view, 31, size=lambda p: 100, built=lambda p: p in built, high=2000, low=1000)
        self.assertFalse(view.merging)
        self.assertLessEqual(100 * len(view.parts), 1000)


class ViewBeforeTest(unittest.TestCase):
    def test_opens_parts_that_reach_past_the_cut(self):
        self.assertEqual(names(view_before([Part(2, 0), Part(1, 2)], 6)), ["0+4", "4+2"])
        self.assertEqual(names(view_before([Part(2, 0), Part(1, 2)], 3)), ["0+2", "2+1"])


if __name__ == "__main__":
    unittest.main()
