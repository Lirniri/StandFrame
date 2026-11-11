"""Stand's menu API is called only in ui/stand/core: everything else makes items through MenuNode and changes them
through MenuItem (ui/stand/core/menu_node, menu_item), and logic reaches Stand's command refs through
ui/stand/core/stand_refs. A menu.* call anywhere else is a layer leak.

Calls are found as `menu.<name>` not preceded by a word or a dot (Atdar.menu.spoiler, script_menu.build don't count),
outside comments and string literals."""

import pathlib
import re

TESTS = pathlib.Path(__file__).resolve().parent
LIB = TESTS.parent / "src" / "lib" / "AnitaDarin"
ALLOWED = LIB / "ui" / "stand" / "core"

CALL = re.compile(r"(?<![\w.])menu\.([a-z_]+)")
BLOCK_COMMENT = re.compile(r"--\[(=*)\[.*?\]\1\]", re.S)
STRING = re.compile(r'"(?:\\.|[^"\\])*"' + r"|'(?:\\.|[^'\\])*'")

passed, failed = 0, 0


def check(cond, name):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL  {name}")


def blank(match):
    """A block comment as the empty lines it took, so line numbers stay right"""
    return "\n" * match.group(0).count("\n")


files = 0
leaks = []
for path in sorted(LIB.rglob("*.pluto")):
    files += 1
    if ALLOWED in path.parents:
        continue
    text = BLOCK_COMMENT.sub(blank, path.read_text(encoding="utf-8"))
    for number, line in enumerate(text.splitlines(), 1):
        code = re.sub(r"--.*$", "", STRING.sub('""', line))
        for match in CALL.finditer(code):
            leaks.append(f"{path.relative_to(LIB)}:{number}: menu.{match.group(1)}")

check(files > 100, f"the library is read ({files} files)")
check(not leaks, "menu.* only in ui/stand/core:\n      " + "\n      ".join(leaks))

print(f"test_menu_layer: {passed} passed, {failed} failed")
raise SystemExit(0 if failed == 0 else 1)
