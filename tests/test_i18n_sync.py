"""tools/i18n_sync.py: the report, the stubs, @same and the notes of context.txt, and the project's own files:
the Russian files must have every key of the English ones."""

import json
import pathlib
import shutil
import sys

TESTS = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS.parent / "tools"))

import i18n_sync  # noqa: E402

passed, failed = 0, 0


def check(cond, name):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL  {name}")


def write(path, data):
    path.write_text(json.dumps(data, indent=4, ensure_ascii=False) + "\n", encoding="utf-8")


tmp = TESTS / ".tmp" / "i18n_sync"
shutil.rmtree(tmp, ignore_errors=True)
tmp.mkdir(parents=True)

write(tmp / "en-us.json", {"a": {"name": "Alpha", "help": "Help"}, "b": "Beta", "c": "OK", "d": "Delta"})
write(tmp / "ru-ru.json", {"a": {"name": "Альфа"}, "b": "Beta", "c": "OK", "old": "Старое"})
(tmp / "context.txt").write_text("# note\n@same c\na.help: shown under the name\nb: a name\ngone.key: x\n", encoding="utf-8")

before = (tmp / "ru-ru.json").read_text(encoding="utf-8")
lines = []
result = i18n_sync.sync(tmp, "ru-ru", out=lines.append)
text = "\n".join(lines)
check(result["missing"] == ["a.help", "d"], "missing keys are the ones Russian lacks, in English order")
check(result["obsolete"] == ["old"], "obsolete is what English no longer has")
check(result["untranslated"] == ["b"], "a text equal to English is untranslated, unless marked @same")
check("a.help    [shown under the name]" in text, "the note of context.txt is printed beside the key")
check("note for a key that is gone: gone.key" in text, "a note whose key is gone is reported")
check("40.0% translated" in text, "the percentage counts neither the missing nor the untranslated (2 of 5: a.name and the @same c)")

# Without --write nothing changes
check(before == (tmp / "ru-ru.json").read_text(encoding="utf-8"), "a report doesn't write")

# --write adds stubs with the English text, in English order, and keeps the obsolete key
i18n_sync.sync(tmp, "ru-ru", write=True, out=lambda _: None)
after = json.loads((tmp / "ru-ru.json").read_text(encoding="utf-8"))
check(after["a"]["help"] == "Help" and after["d"] == "Delta", "stubs hold the English text")
check(after["a"]["name"] == "Альфа", "a translation is kept")
check("old" in after, "the obsolete key stays without --prune")
check(list(after)[:4] == ["a", "b", "c", "d"], "keys follow the English order")

# A second run finds nothing missing, the stubs now count as untranslated
again = i18n_sync.sync(tmp, "ru-ru", out=lambda _: None)
check(again["missing"] == [] and "d" in again["untranslated"], "stubs are untranslated until they are changed")

i18n_sync.sync(tmp, "ru-ru", write=True, prune=True, out=lambda _: None)
pruned = json.loads((tmp / "ru-ru.json").read_text(encoding="utf-8"))
check("old" not in pruned, "--prune removes the obsolete key")

# A language file that doesn't exist yet is made from the English one
i18n_sync.sync(tmp, "de-de", write=True, out=lambda _: None)
check((tmp / "de-de.json").exists(), "a new language file is created with stubs")

# The project: Russian lacks nothing English has
for folder in i18n_sync.DEFAULT_DIRS:
    if (folder / "en-us.json").exists():
        found = i18n_sync.sync(folder, "ru-ru", out=lambda _: None)
        name = folder.relative_to(i18n_sync.ROOT).as_posix()
        check(not found["missing"], f"{name}: ru-ru has every key ({found['missing'][:5]})")
        check(not found["obsolete"], f"{name}: ru-ru has no key English lacks ({found['obsolete'][:5]})")

print(f"test_i18n_sync: {passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
