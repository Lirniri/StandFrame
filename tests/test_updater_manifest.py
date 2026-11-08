"""updater/manifest.py: hashes like updater.pluto, logs left out, version kept. Writes into tests/.tmp only"""

import contextlib
import io
import json
import pathlib
import shutil
import sys

TESTS = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS.parent / "updater"))
import manifest  # noqa: E402

passed, failed = 0, 0


def check(cond, name):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL  {name}")


# The same sha256 as test_updater.pluto checks updater.hash against
AB = "911169ddaaf146aff539f58c26c489af3b892dff0fe283c1c264c65ae5aa59a2"
check(manifest.file_hash("x.pluto", b"a\nb\n") == AB, "sha256 of the text")
check(manifest.file_hash("x.pluto", b"a\r\nb\r\n") == AB, "\\r\\n and \\n hash the same in text")
check(manifest.file_hash("x.png", b"a\r\nb\r\n") != AB, "a binary file is hashed as it is")

src = TESTS / ".tmp" / "manifest_src"
shutil.rmtree(src, ignore_errors=True)
for path, content in {
    "AnitaDarin.pluto": b"launcher\r\n",
    "lib/AnitaDarin/core/loader.pluto": b"a\nb\n",
    "store/AnitaDarin/config.json": b"{}",
    "store/AnitaDarin/logs/today.log": b"written by the script",
    "store/AnitaDarin/profiles/main.json.tmp": b"leftover",
}.items():
    (src / path).parent.mkdir(parents=True, exist_ok=True)
    (src / path).write_bytes(content)

files = manifest.collect(src, files=sorted(p.relative_to(src).as_posix() for p in src.rglob("*") if p.is_file()))
check(sorted(files) == ["AnitaDarin.pluto", "lib/AnitaDarin/core/loader.pluto", "store/AnitaDarin/config.json"],
      "the release's files: logs and leftovers left out")
check(files["lib/AnitaDarin/core/loader.pluto"]["sha256"] == AB, "each with its hash")

# Writing: the version given, then kept; --check tells whether it's up to date with src
out = TESTS / ".tmp" / "manifest.json"
out.unlink(missing_ok=True)
with contextlib.redirect_stdout(io.StringIO()):
    manifest.main(["--out", str(out)])
    first = json.loads(out.read_text(encoding="utf-8"))
    manifest.main(["--out", str(out), "--version", "0.1.0"])
    manifest.main(["--out", str(out)])
    second = json.loads(out.read_text(encoding="utf-8"))
    up_to_date = manifest.main(["--out", str(out), "--check"])
check(first["version"] == "dev" and first["project"] == "AnitaDarin" and first["format"] == 1, "a first one: version dev")
check(second["version"] == "0.1.0", "the version given is kept by the next write")
check("lib/AnitaDarin/core/loader.pluto" in second["files"], "it lists the repo's src")
check(up_to_date == 0, "--check: up to date right after writing")
second["files"]["lib/AnitaDarin/core/loader.pluto"]["sha256"] = "changed"
out.write_text(json.dumps(second), encoding="utf-8")
with contextlib.redirect_stdout(io.StringIO()):
    check(manifest.main(["--out", str(out), "--check"]) == 1, "--check: a file differs, exit 1")

print(f"test_updater_manifest: {passed} passed, {failed} failed")
sys.exit(0 if failed == 0 else 1)
