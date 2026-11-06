"""build.py: install under the found name, keep user data, clean, rebuild. Writes into tests/.tmp only"""

import contextlib
import io
import pathlib
import shutil
import sys

TESTS = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS.parent))
import build  # noqa: E402

passed, failed = 0, 0


def check(cond, name):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL  {name}")


def fresh_target(name):
    target = TESTS / ".tmp" / name
    shutil.rmtree(target, ignore_errors=True)
    target.mkdir(parents=True)
    return target


def run(*args):
    """build.main with its output swallowed; returns (exit code, output)"""
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = build.main(list(args))
    return code, out.getvalue()


# ─── First install, then a sync that keeps what the script wrote ─────────────

target = fresh_target("build_target")
code, _ = run("sync", "--target", str(target))
check(code == 0, "sync into an empty Lua Scripts")
check((target / "AnitaDarin.pluto").exists(), "the launcher is installed")
check((target / "lib" / "AnitaDarin" / "bootstrap.pluto").exists(), "lib is installed")
check((target / "store" / "AnitaDarin" / "profiles" / "main.json").exists(), "default profile on a first install")

profile = target / "store" / "AnitaDarin" / "profiles" / "main.json"
config = target / "store" / "AnitaDarin" / "config.json"
profile.write_text('{"short_name": "Mine"}', encoding="utf-8")
config.write_text('{"profile": "mine"}', encoding="utf-8")
(target / "store" / "AnitaDarin" / "profiles" / "mine.json").write_text("{}", encoding="utf-8")
(target / "lib" / "AnitaDarin" / "bootstrap.pluto").write_text("-- outdated", encoding="utf-8")
code, out = run("sync", "--target", str(target))
check("Mine" in profile.read_text(encoding="utf-8"), "sync keeps the user's profile")
check("mine" in config.read_text(encoding="utf-8"), "sync keeps config.json")
check("outdated" not in (target / "lib" / "AnitaDarin" / "bootstrap.pluto").read_text(encoding="utf-8"),
      "sync updates the script's own files")
check("1 copied" in out, "only the changed file is copied")

# ─── Clean keeps user data; clean --all removes it ───────────────────────────

(target / "lib" / "AnitaDarin" / "gone.pluto").write_text("x", encoding="utf-8")
run("clean", "--target", str(target))
check(not (target / "AnitaDarin.pluto").exists() and not (target / "lib" / "AnitaDarin").exists(), "clean removes the script")
check(not (target / "store" / "AnitaDarin" / "menu").exists(), "clean removes the store files that come from the project")
check("Mine" in profile.read_text(encoding="utf-8") and config.exists(), "clean keeps profiles and settings")
run("sync", "--target", str(target))
check(not (target / "lib" / "AnitaDarin" / "gone.pluto").exists(), "after clean + sync a removed file is gone (rebuild)")
check("Mine" in profile.read_text(encoding="utf-8"), "and the profile is still the user's")
run("clean", "--all", "--target", str(target))
check(not (target / "store" / "AnitaDarin").exists(), "clean --all removes profiles and settings too")

# ─── A renamed install gets updated, not installed a second time ─────────────

target = fresh_target("build_renamed")
run("sync", "--target", str(target), "--name", "StandX")
check((target / "StandX.pluto").exists() and (target / "lib" / "StandX").is_dir(), "--name installs under that name")
check(build.installed_names(target) == ["StandX"], "the launcher is recognised under its new name")
code, out = run("sync", "--target", str(target))
check(code == 0 and "'StandX'" in out, "a plain sync finds StandX")
check(not (target / "AnitaDarin.pluto").exists(), "and doesn't install AnitaDarin next to it")

# Two installs: build.py won't guess
run("sync", "--target", str(target), "--name", "AnitaDarin")
code, out = run("sync", "--target", str(target))
check(code == 1 and "pick one with --name" in out, "with two installs it asks for --name")

# Another script's .pluto isn't taken for ours
(target / "Other.pluto").write_text("util.toast('hi')", encoding="utf-8")
check(build.installed_names(target) == ["AnitaDarin", "StandX"], "other scripts aren't counted")

print(f"test_build: {passed} passed, {failed} failed")
sys.exit(0 if failed == 0 else 1)
