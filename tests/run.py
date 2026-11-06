"""Runs every check of the project outside the game.

    python tests/run.py            everything
    python tests/run.py json       only tests whose name contains "json" (syntax and natives still run)
    python tests/run.py -v         also print the output of passing tests

Steps:
  1. syntax   - plutoc parses every .pluto in src, examples and tests (with the launcher's pluto_use line)
  2. natives  - every NAMESPACE.NATIVE(...) call in src exists in the natives dump
                (experiments/natives-3407a/init.lua, kept locally; skipped if missing)
  3. tests    - each tests/test_*.pluto runs in its own pluto process against the fake Stand API (tests/stand.pluto)

Exit code 0 if everything passed.
"""

import pathlib
import re
import shutil
import subprocess
import sys

TESTS = pathlib.Path(__file__).resolve().parent
ROOT = TESTS.parent
TMP = TESTS / ".tmp"
NATIVES_DUMP = ROOT / "experiments" / "natives-3407a" / "init.lua"
# Same line as src/AnitaDarin.pluto: reserves Pluto's keywords (switch, class, new, ...)
PLUTO_USE = 'pluto_use "0.13.2"\n'


def find_tool(name):
    found = shutil.which(name)
    if found:
        return found
    default = pathlib.Path("C:/Program Files/pluto") / f"{name}.exe"
    if default.exists():
        return str(default)
    sys.exit(f"{name} not found: install Pluto or add it to PATH")


def check_syntax(plutoc):
    """plutoc -p on every file, with the pluto_use line the launcher has"""
    TMP.mkdir(exist_ok=True)
    probe = TMP / "syntax.pluto"
    failures = []
    files = [p for folder in ("src", "examples", "tests") for p in sorted((ROOT / folder).rglob("*.pluto"))
             # Files the tests write, some broken on purpose
             if TMP not in p.parents]
    for path in files:
        probe.write_text(PLUTO_USE + path.read_text(encoding="utf-8"), encoding="utf-8")
        result = subprocess.run([plutoc, "-p", "-o", str(TMP / "syntax.out"), str(probe)],
                                capture_output=True, text=True, encoding="utf-8", errors="replace")
        if result.returncode != 0:
            # Line numbers in the message are one off: the pluto_use line comes first
            failures.append(f"{path.relative_to(ROOT)}\n{result.stderr.strip()}")
    return len(files), failures


def check_natives():
    """Every NAMESPACE.NATIVE( in src must exist in that namespace of the dump"""
    if not NATIVES_DUMP.exists():
        return None, []
    natives, namespace = {}, None
    for line in NATIVES_DUMP.read_text(encoding="utf-8", errors="replace").splitlines():
        match = re.match(r"^([A-Z_]+)=\{", line)
        if match:
            namespace = match.group(1)
            natives.setdefault(namespace, set())
            continue
        match = re.match(r"^\s*([A-Z0-9_]+)=", line)
        if match and namespace:
            natives[namespace].add(match.group(1))
    where = {}
    for namespace, names in natives.items():
        for name in names:
            where.setdefault(name, []).append(namespace)

    calls, failures = 0, []
    for path in sorted((ROOT / "src").rglob("*.pluto")):
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            code = re.sub(r"--.*$", "", line)
            for namespace, name in re.findall(r"\b([A-Z_]{3,})\.([A-Z0-9_]+)\s*\(", code):
                if namespace not in natives:
                    continue
                calls += 1
                if name not in natives[namespace]:
                    hint = f", it's in {', '.join(where[name])}" if name in where else ""
                    failures.append(f"{path.relative_to(ROOT)}:{number}: {namespace}.{name} doesn't exist{hint}")
    return calls, failures


def run_tests(pluto, name_filter, verbose):
    results = []
    # .pluto tests run the script's code; .py tests check the Python tools (build.py)
    paths = sorted(list(TESTS.glob("test_*.pluto")) + list(TESTS.glob("test_*.py")), key=lambda p: p.stem)
    for path in paths:
        if name_filter and name_filter not in path.stem:
            continue
        runner = pluto if path.suffix == ".pluto" else sys.executable
        # cwd = tests, so require("stand") finds tests/stand.pluto
        result = subprocess.run([runner, str(path)], cwd=TESTS, capture_output=True,
                                text=True, encoding="utf-8", errors="replace")
        output = (result.stdout + result.stderr).strip()
        # Pluto's type-hint warnings aren't failures; keep them out of the way
        lines = [l for l in output.splitlines()
                 if not re.match(r"^(Pluto warning:|\s+\d+ \||\s+\||\s+\^)", l)]
        summary = next((l for l in reversed(lines) if re.match(r"^test_\w+: \d+ passed", l)), None)
        ok = result.returncode == 0 and summary is not None
        results.append((path.stem, ok, summary or "crashed", "\n".join(lines)))
    return results


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    verbose = "-v" in sys.argv
    name_filter = args[0] if args else None
    pluto, plutoc = find_tool("pluto"), find_tool("plutoc")
    failed = False

    count, failures = check_syntax(plutoc)
    print(f"syntax   {'ok' if not failures else 'FAIL'}  {count} files")
    for failure in failures:
        print("  " + failure.replace("\n", "\n  "))
    failed |= bool(failures)

    calls, failures = check_natives()
    if calls is None:
        print("natives  skipped  (no experiments/natives-3407a/init.lua)")
    else:
        print(f"natives  {'ok' if not failures else 'FAIL'}  {calls} calls")
        for failure in failures:
            print("  " + failure)
    failed |= bool(failures)

    for name, ok, summary, output in run_tests(pluto, name_filter, verbose):
        print(f"ok       {summary}" if ok else f"FAIL     {name}: {summary}")
        if (not ok or verbose) and output:
            print("  " + output.replace("\n", "\n  "))
        failed |= not ok

    print("\nall passed" if not failed else "\nsome checks FAILED")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
