"""Keeps the translation files in step with the English ones, like Stand's lang/update.php does for its .axis files.

    python tools/i18n_sync.py                 report for every language folder of the project
    python tools/i18n_sync.py --write         also add the keys a translation lacks (as stubs)
    python tools/i18n_sync.py --lang ru-ru    another language (ru-ru by default)
    python tools/i18n_sync.py --prune --write also remove the keys English no longer has
    python tools/i18n_sync.py DIR [DIR ...]   only these language folders

Our label system stays as it is: the English text is the label's identity (en-us.json), a translation file holds the
same keys with other text. A stub is the English text under the key: the game then shows English, and the tool counts
the key as untranslated until the text differs from the English one.

Context for translators: a plain text file `context.txt` next to the json files (never loaded by the script, which reads
only <code>.json). One line each, like the "!" lines of Stand's .axis files:

    # a comment
    menu.self.godmode.name: Toggle: the player cannot be hurt at all
    @same menu.self.name          the text is the same in every language (a name), not untranslated

The report prints the note beside a missing or untranslated key, and warns about a note whose key is gone.
"""

import argparse
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENGLISH = "en-us"

# Language folders of the project (each has en-us.json and the translations)
DEFAULT_DIRS = [
    ROOT / "src/store/AnitaDarin/core/language",
    ROOT / "src/store/AnitaDarin/menu/AnitaDarin/language",
    ROOT / "src/lib/AnitaDarin/modules/VehicleManager/language",
    ROOT / "src/lib/AnitaDarin/modules/PedManager/language",
]


def flatten(data, prefix=""):
    """{ "a": { "b": "x" } } -> { "a.b": "x" }"""
    flat = {}
    for key, value in data.items():
        if isinstance(value, dict):
            flat.update(flatten(value, f"{prefix}{key}."))
        else:
            flat[f"{prefix}{key}"] = value
    return flat


def unflatten(flat):
    data = {}
    for path, value in flat.items():
        node = data
        parts = path.split(".")
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = value
    return data


def read_context(folder):
    """(notes by key, keys marked @same) from context.txt, empty when there is no file"""
    notes, same = {}, set()
    path = folder / "context.txt"
    if not path.exists():
        return notes, same
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("@same"):
            same.add(line[len("@same"):].split()[0])
            continue
        key, _, note = line.partition(":")
        notes[key.strip()] = note.strip()
    return notes, same


def compare(english, translated, same):
    """The keys the translation lacks, the ones it has and English doesn't, and the ones left as the English text"""
    missing = [key for key in english if key not in translated]
    obsolete = [key for key in translated if key not in english]
    untranslated = [key for key in english
                    if key in translated and translated[key] == english[key] and key not in same]
    return missing, obsolete, untranslated


def percent(english, untranslated, missing):
    if not english:
        return 100.0
    return 100.0 * (len(english) - len(untranslated) - len(missing)) / len(english)


def sync(folder, language, write=False, prune=False, out=print):
    """Reports one folder, writes the stubs when asked. Returns the numbers for a caller that checks them."""
    en_path = folder / f"{ENGLISH}.json"
    tr_path = folder / f"{language}.json"
    if not en_path.exists():
        return None
    english = flatten(json.loads(en_path.read_text(encoding="utf-8")))
    translated = flatten(json.loads(tr_path.read_text(encoding="utf-8"))) if tr_path.exists() else {}
    notes, same = read_context(folder)
    missing, obsolete, untranslated = compare(english, translated, same)

    name = folder.relative_to(ROOT).as_posix() if ROOT in folder.parents else str(folder)
    out(f"{name}: {language} {percent(english, untranslated, missing):.1f}% translated "
        f"({len(english)} strings, {len(missing)} missing, {len(untranslated)} untranslated, {len(obsolete)} obsolete)")

    def line(prefix, key):
        note = notes.get(key)
        out(f"  {prefix} {key}" + (f"    [{note}]" if note else ""))

    for key in missing:
        line("missing     ", key)
    for key in untranslated:
        line("untranslated", key)
    for key in obsolete:
        out(f"  obsolete     {key}")
    for key in notes:
        if key not in english:
            out(f"  note for a key that is gone: {key}")

    if write and (missing or (prune and obsolete)):
        # English order, so a diff of the file shows what was added
        result = {}
        for key in english:
            result[key] = translated.get(key, english[key])
        if not prune:
            for key in obsolete:
                result[key] = translated[key]
        tr_path.write_text(json.dumps(unflatten(result), indent=4, ensure_ascii=False) + "\n", encoding="utf-8")
        out(f"  wrote {tr_path.name}: {len(missing)} stubs added" + (f", {len(obsolete)} removed" if prune else ""))

    return { "total": len(english), "missing": missing, "obsolete": obsolete, "untranslated": untranslated }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("folders", nargs="*", type=pathlib.Path)
    parser.add_argument("--lang", default="ru-ru")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--prune", action="store_true")
    args = parser.parse_args(argv)

    folders = [f.resolve() for f in args.folders] or DEFAULT_DIRS
    results = [sync(folder, args.lang, args.write, args.prune) for folder in folders]
    missing = sum(len(r["missing"]) for r in results if r)
    return 1 if missing and not args.write else 0


if __name__ == "__main__":
    sys.exit(main())
