"""script-store.js — what Save, Rename, Open and Delete MEAN for the saved-scripts list, executed under Node
(there is no browser in this suite; the view and the storage are script-library.js, pinned in
test_script_library.py and driven in Chromium).

The rules worth holding to the letter:
  * Save overwrites the open script ONLY while the name is still its name — any other name is a new script, and
    a taken name becomes "Name (2)": nothing is ever replaced by accident;
  * the question "would opening another script throw something away?" has one answer, needsSaving;
  * a store that cannot be read, or has odd entries, loads what is sound and drops the rest.
"""

import json
import shutil
import subprocess
import unittest
from pathlib import Path

FRONT = Path(__file__).resolve().parents[3] / "console" / "frontend"
NODE = shutil.which("node")
NOW = 1_790_000_000_000          # a fixed instant: 2026-09-21 ~ — only differences and the calendar day matter


def run(expr: str):
    script = (f"const S = require({json.dumps(str(FRONT / 'script-store.js'))});\n"
              f"process.stdout.write(JSON.stringify({expr}));")
    # the script goes in on stdin: a 400 000-character source would not fit in the argument list
    done = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    if done.returncode != 0:
        raise AssertionError(done.stderr)
    return json.loads(done.stdout) if done.stdout else None


def item(id_, name, source="plot(close)", inputs=None, saved=NOW, inputs_for=""):
    return {"id": id_, "name": name, "source": source, "inputs": inputs or {}, "inputsFor": inputs_for, "savedAt": saved}


def store(items=(), active=None):
    return {"v": 1, "items": list(items), "activeId": active}


def working(name="Untitled script", source="plot(close)", inputs=None):
    return {"name": name, "source": source, "inputs": inputs or {}, "inputsFor": ""}


def save(st, w, **opts):
    return run(f"S.save({json.dumps(st)}, {json.dumps(w)}, {json.dumps({'now': NOW, **opts})})")


@unittest.skipUnless(NODE, "node is not installed")
class Reading(unittest.TestCase):
    def test_a_blob_that_cannot_be_read_is_an_empty_list(self):
        for raw in ("", "not json", "null", "[]", '{"items": 5}', '{"v": 1}'):
            self.assertEqual(run(f"S.parse({json.dumps(raw)}).items"), [], raw)
        self.assertEqual(run("S.parse(null).items"), [])

    def test_odd_entries_are_dropped_and_the_sound_ones_kept(self):
        raw = json.dumps({"v": 1, "activeId": "b", "items": [
            item("a", "Good"), "junk", None, {"id": "x"}, item("", "No id"), item("c", ""), item("d", "No source"),
            {**item("e", "Bad source"), "source": 5}, item("a", "Duplicate id"), item("b", "Second good")]})
        got = run(f"S.parse({json.dumps(raw)})")
        self.assertEqual([i["name"] for i in got["items"]], ["Good", "No source", "Second good"])
        self.assertEqual(got["activeId"], "b")

    def test_an_active_id_that_is_not_in_the_list_is_dropped(self):
        raw = json.dumps({"v": 1, "activeId": "ghost", "items": [item("a", "A")]})
        self.assertIsNone(run(f"S.parse({json.dumps(raw)}).activeId"))

    def test_the_list_is_cut_to_fifty_and_a_huge_script_is_dropped(self):
        many = json.dumps({"v": 1, "items": [item(f"i{n}", f"S{n}") for n in range(80)]})
        self.assertEqual(run(f"S.parse({json.dumps(many)}).items.length"), 50)
        big = json.dumps({"v": 1, "items": [item("a", "Big", source="x" * 400_001), item("b", "Fine")]})
        self.assertEqual([i["name"] for i in run(f"S.parse({json.dumps(big)}).items")], ["Fine"])

    def test_line_endings_are_normalised_and_inputs_are_flat_scalars_only(self):
        raw = json.dumps({"v": 1, "items": [{**item("a", "A", source="a\r\nb\rc"), "inputs": {"k": 1, "o": {"x": 1}, "l": [1], "n": None, "b": True, "bad": float(10**400) if False else "ok"}}]})
        got = run(f"S.parse({json.dumps(raw)}).items[0]")
        self.assertEqual(got["source"], "a\nb\nc")
        self.assertEqual(got["inputs"], {"k": 1, "b": True, "bad": "ok"})

    def test_it_round_trips(self):
        st = store([item("a", "A", inputs={"len|Length|int": 5}), item("b", "B")], "a")
        self.assertEqual(run(f"S.parse(S.serialize({json.dumps(st)}))"), st)


@unittest.skipUnless(NODE, "node is not installed")
class Names(unittest.TestCase):
    def test_a_name_is_trimmed_collapsed_and_cut(self):
        self.assertEqual(run("S.cleanName('  Hull   Butterfly \\n tight ')"), "Hull Butterfly tight")
        self.assertEqual(len(run("S.cleanName('x'.repeat(200))")), 80)
        self.assertEqual(run("S.cleanName('   ')"), "")
        self.assertEqual(run("S.cleanName(null)"), "")

    def test_a_taken_name_gets_a_number_ignoring_case(self):
        items = [item("a", "Hull"), item("b", "hull (2)")]
        self.assertEqual(run(f"S.uniqueName({json.dumps(items)}, 'HULL')"), "HULL (3)")
        self.assertEqual(run(f"S.uniqueName({json.dumps(items)}, 'Other')"), "Other")

    def test_a_script_does_not_collide_with_itself(self):
        items = [item("a", "Hull")]
        self.assertEqual(run(f"S.uniqueName({json.dumps(items)}, 'Hull', 'a')"), "Hull")

    def test_a_long_name_keeps_room_for_its_number(self):
        long = "x" * 80
        got = run(f"S.uniqueName({json.dumps([item('a', long)])}, {json.dumps(long)})")
        self.assertEqual(len(got), 80)
        self.assertTrue(got.endswith(" (2)"))


@unittest.skipUnless(NODE, "node is not installed")
class Saving(unittest.TestCase):
    def test_the_first_save_creates_and_attaches(self):
        r = save(store(), working("Hull tight", inputs={"len|Length|int": 5}))
        self.assertTrue(r["ok"] and r["created"])
        self.assertEqual((r["item"]["name"], r["item"]["inputs"], r["item"]["savedAt"]), ("Hull tight", {"len|Length|int": 5}, NOW))
        self.assertEqual(r["store"]["activeId"], r["item"]["id"])
        self.assertIsNone(r["nameChanged"])

    def test_saving_the_open_script_under_its_own_name_overwrites_it(self):
        st = store([item("a", "Hull tight", "old", saved=1)], "a")
        r = save(st, working("Hull tight", "new code", {"k": 1}))
        self.assertFalse(r["created"])
        self.assertEqual(len(r["store"]["items"]), 1)
        self.assertEqual((r["item"]["id"], r["item"]["source"], r["item"]["inputs"], r["item"]["savedAt"]), ("a", "new code", {"k": 1}, NOW))

    def test_a_different_name_is_a_new_script_and_the_open_one_is_untouched(self):
        st = store([item("a", "Hull tight", "old")], "a")
        r = save(st, working("Hull loose", "new"))
        self.assertTrue(r["created"])
        self.assertEqual(len(r["store"]["items"]), 2)
        self.assertEqual(next(i for i in r["store"]["items"] if i["id"] == "a")["source"], "old")
        self.assertEqual(r["store"]["activeId"], r["item"]["id"])            # the editor now belongs to the new one

    def test_a_script_loaded_from_elsewhere_never_overwrites_the_one_that_was_open(self):
        """The Library's "Edit a copy" names the copy "X (copy)"; the attachment is also cleared, but even
        if it were not, the name differs, so Save could not replace the open script."""
        st = store([item("a", "Smart Money", "mine")], "a")
        r = save(st, working("Smart Money (copy)", "library code"))
        self.assertTrue(r["created"])
        self.assertEqual(next(i for i in r["store"]["items"] if i["id"] == "a")["source"], "mine")

    def test_an_unattached_script_with_a_taken_name_is_numbered_not_merged(self):
        st = store([item("a", "Hull", "kept")], None)
        r = save(st, working("Hull", "other"))
        self.assertEqual(r["item"]["name"], "Hull (2)")
        self.assertEqual(r["nameChanged"], "Hull (2)")
        self.assertEqual(len(r["store"]["items"]), 2)

    def test_save_a_copy_is_always_new(self):
        st = store([item("a", "Hull", "v1")], "a")
        r = save(st, working("Hull", "v2"), asNew=True)
        self.assertTrue(r["created"])
        self.assertEqual(r["item"]["name"], "Hull (2)")
        self.assertEqual(len(r["store"]["items"]), 2)

    def test_an_empty_editor_has_nothing_to_save(self):
        for source in ("", "   \n  "):
            r = save(store(), working("X", source))
            self.assertFalse(r["ok"])
            self.assertIn("nothing to save", r["error"])

    def test_a_script_over_the_limit_is_refused_with_both_numbers(self):
        r = save(store(), working("Big", "x" * 400_001))
        self.assertFalse(r["ok"])
        self.assertIn("400,001", r["error"])
        self.assertIn("400,000", r["error"])

    def test_at_fifty_a_new_script_is_refused_but_the_open_one_can_still_be_saved(self):
        items = [item(f"i{n}", f"S{n}") for n in range(50)]
        full = store(items, "i3")
        refused = save(full, working("Brand new", "x"))
        self.assertFalse(refused["ok"])
        self.assertIn("50 scripts", refused["error"])
        again = save(full, working("S3", "edited"))
        self.assertTrue(again["ok"] and not again["created"])

    def test_the_stored_settings_are_flat_scalars_only(self):
        r = save(store(), working("X", inputs={"a": 1, "b": {"x": 1}, "c": [1], "d": "t", "e": None}))
        self.assertEqual(r["item"]["inputs"], {"a": 1, "d": "t"})

    def test_line_endings_are_normalised_on_the_way_in(self):
        self.assertEqual(save(store(), working("X", "a\r\nb"))["item"]["source"], "a\nb")


@unittest.skipUnless(NODE, "node is not installed")
class Changes(unittest.TestCase):
    ST = store([item("a", "Hull", "plot(close)", {"k": 1})], "a")

    def dirty(self, w, st=None):
        return run(f"S.isDirty({json.dumps(st or self.ST)}, {json.dumps(w)})")

    def test_a_copy_equal_to_the_saved_script_is_clean(self):
        self.assertFalse(self.dirty(working("Hull", "plot(close)", {"k": 1})))

    def test_a_changed_name_source_or_setting_is_dirty(self):
        self.assertTrue(self.dirty(working("Hull 2", "plot(close)", {"k": 1})))
        self.assertTrue(self.dirty(working("Hull", "plot(open)", {"k": 1})))
        self.assertTrue(self.dirty(working("Hull", "plot(close)", {"k": 2})))
        self.assertTrue(self.dirty(working("Hull", "plot(close)", {})))

    def test_line_endings_and_key_order_do_not_count(self):
        st = store([item("a", "Hull", "a\nb", {"x": 1, "y": 2})], "a")
        self.assertFalse(self.dirty(working("Hull", "a\r\nb", {"y": 2, "x": 1}), st))

    def test_an_unattached_copy_is_never_dirty(self):
        self.assertFalse(self.dirty(working("Hull", "anything"), store([item("a", "Hull")], None)))

    def needs(self, w, st):
        return run(f"S.needsSaving({json.dumps(st)}, {json.dumps(w)})")

    def test_opening_another_script_asks_only_when_something_would_be_lost(self):
        self.assertTrue(self.needs(working("Hull", "plot(open)", {"k": 1}), self.ST))                  # attached, changed
        self.assertFalse(self.needs(working("Hull", "plot(close)", {"k": 1}), self.ST))                # attached, clean
        self.assertTrue(self.needs(working("New", "code nobody saved"), store([item("a", "Hull")], None)))
        self.assertFalse(self.needs(working("New", ""), store([item("a", "Hull")], None)))             # nothing in the editor
        self.assertFalse(self.needs(working("Hull", "plot(close)"), store([item("a", "Hull")], None)))  # identical to a saved one

    def test_a_script_saved_nowhere_is_unsaved_even_with_an_empty_list(self):
        self.assertTrue(self.needs(working("X", "plot(1)"), store()))
        self.assertFalse(self.needs(working("X", ""), store()))


@unittest.skipUnless(NODE, "node is not installed")
class RenamingAndDeleting(unittest.TestCase):
    ST = store([item("a", "Hull tight"), item("b", "Hull loose")], "a")

    def rename(self, id_, name):
        return run(f"S.rename({json.dumps(self.ST)}, {json.dumps(id_)}, {json.dumps(name)})")

    def test_a_rename_changes_only_the_name(self):
        r = self.rename("a", "  Hull   wide ")
        self.assertTrue(r["ok"])
        self.assertEqual([i["name"] for i in r["store"]["items"]], ["Hull wide", "Hull loose"])
        self.assertEqual(r["store"]["activeId"], "a")

    def test_an_empty_taken_or_unknown_name_is_refused_not_quietly_changed(self):
        self.assertEqual(self.rename("a", "   ")["error"], "A script needs a name.")
        self.assertEqual(self.rename("a", "HULL LOOSE")["error"], "Another script already has that name.")
        self.assertEqual(self.rename("zz", "Fine")["error"], "That script is gone.")

    def test_a_script_may_be_renamed_to_its_own_name_in_another_case(self):
        self.assertTrue(self.rename("a", "HULL TIGHT")["ok"])

    def test_deleting_the_open_script_leaves_the_editor_attached_to_nothing(self):
        r = run(f"S.remove({json.dumps(self.ST)}, 'a')")
        self.assertEqual([i["id"] for i in r["store"]["items"]], ["b"])
        self.assertIsNone(r["store"]["activeId"])
        self.assertEqual(r["removed"]["name"], "Hull tight")

    def test_deleting_another_one_keeps_the_attachment(self):
        r = run(f"S.remove({json.dumps(self.ST)}, 'b')")
        self.assertEqual(r["store"]["activeId"], "a")

    def test_deleting_something_that_is_not_there_changes_nothing(self):
        r = run(f"S.remove({json.dumps(self.ST)}, 'zz')")
        self.assertIsNone(r["removed"])
        self.assertEqual(len(r["store"]["items"]), 2)

    def test_attaching_to_an_unknown_script_attaches_to_nothing(self):
        self.assertIsNone(run(f"S.setActive({json.dumps(self.ST)}, 'zz').activeId"))
        self.assertEqual(run(f"S.setActive({json.dumps(self.ST)}, 'b').activeId"), "b")


@unittest.skipUnless(NODE, "node is not installed")
class Listing(unittest.TestCase):
    def test_newest_save_first_then_by_name(self):
        items = [item("a", "B", saved=5), item("b", "A", saved=9), item("c", "A2", saved=9), item("d", "C", saved=1)]
        self.assertEqual([i["name"] for i in run(f"S.sorted({json.dumps(store(items))})")], ["A", "A2", "B", "C"])

    def test_a_row_says_how_long_how_many_settings_and_when(self):
        now = 1_790_000_000_000
        one = item("a", "A", "x", {}, saved=now)
        self.assertEqual(run(f"S.meta({json.dumps(one)}, {now})"), "1 line · today")
        many = item("b", "B", "\n".join(["l"] * 124), {"a": 1, "b": 2}, saved=now - 86_400_000)
        self.assertEqual(run(f"S.meta({json.dumps(many)}, {now})"), "124 lines · 2 inputs set · yesterday")
        two = item("c", "C", "a\nb", {"k": 1}, saved=now)
        self.assertEqual(run(f"S.meta({json.dumps(two)}, {now})"), "2 lines · 1 input set · today")

    def test_dates_read_as_today_yesterday_a_day_and_month_and_then_the_year(self):
        # local-time calendar days: pick instants at local noon so the test does not depend on the zone
        script = ("const d = (y, m, dd) => new Date(y, m, dd, 12).getTime();"
                  "const now = d(2026, 9, 5);"
                  "process.stdout.write(JSON.stringify([S.relativeWhen(now, now), S.relativeWhen(d(2026, 9, 4), now),"
                  " S.relativeWhen(d(2026, 8, 21), now), S.relativeWhen(d(2025, 11, 31), now), S.relativeWhen(0, now), S.relativeWhen(NaN, now)]));")
        done = subprocess.run([NODE, "-"], input=f"const S = require({json.dumps(str(FRONT / 'script-store.js'))});\n" + script,
                              capture_output=True, text=True, timeout=30)
        self.assertEqual(json.loads(done.stdout), ["today", "yesterday", "21 Sep", "31 Dec 2025", "", ""])


if __name__ == "__main__":
    unittest.main()
