"""Every translation key written out in the code is in the English files: a missing one shows as the key itself in the menu.

Keys are found as plain string literals: lang.translate("..."), i18n.label/text/get("...") and, in a file that makes
`local label, text = i18n.scope("part")`, label("...") and text("...") under that part. Keys made at run time
($"...{x}") can't be seen here, so they aren't checked."""

import json
import pathlib
import re

TESTS = pathlib.Path(__file__).resolve().parent
SRC = TESTS.parent / "src"

# (English file, prefix its keys are under)
SOURCES = [
    (SRC / "store/AnitaDarin/base/language/en-us.json", ""),
    (SRC / "store/AnitaDarin/menu/AnitaDarin/language/en-us.json", ""),
    (SRC / "lib/AnitaDarin/modules/VehicleManager/language/en-us.json", "module.VehicleManager."),
]

passed, failed = 0, 0


def check(cond, name):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL  {name}")


def leaves(data, prefix):
    for key, value in data.items():
        if isinstance(value, dict):
            yield from leaves(value, f"{prefix}{key}.")
        else:
            yield f"{prefix}{key}"


known = set()
for path, prefix in SOURCES:
    if path.exists():
        known.update(leaves(json.loads(path.read_text(encoding="utf-8")), prefix))
check(len(known) > 500, f"the English files are read ({len(known)} strings)")

ABSOLUTE = re.compile(r'(?<![\w$.])(?:lang\.(?:translate|text|get_key)|i18n\.(?:label|text|get))\(\s*"([^"]+)"')
SCOPE = re.compile(r'local\s+(\w+)(?:\s*,\s*(\w+))?\s*=\s*i18n\.scope\(\s*"([^"]+)"\s*\)')

missing = []
files = 0
for path in sorted(SRC.rglob("*.pluto")):
    files += 1
    lines = path.read_text(encoding="utf-8").split("\n")
    code = [l for l in lines if not l.lstrip().startswith("--")]
    text = "\n".join(code)
    keys = [m.group(1) for m in ABSOLUTE.finditer(text)]
    for m in SCOPE.finditer(text):
        part = m.group(3)
        for name in (m.group(1), m.group(2)):
            if name and name != "_":
                pattern = re.compile(rf'(?<![\w$.:]){re.escape(name)}\(\s*"([^"]+)"')
                keys += [f"{part}.{k.group(1)}" for k in pattern.finditer(text)]
    for key in keys:
        if key not in known:
            missing.append(f"{path.relative_to(SRC).as_posix()}: {key}")

check(files > 50, f"the source files are read ({files})")
for entry in sorted(set(missing)):
    check(False, f"no English string for {entry}")
check(not missing, "every key in the code has an English string")

print(f"test_i18n_keys: {passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
