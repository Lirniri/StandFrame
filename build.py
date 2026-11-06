"""Installs the script into Stand's Lua Scripts folder.

    python build.py                 menu (as before)
    python build.py sync            copy the project into Stand
    python build.py rebuild         clean, then sync: also drops files removed from the project
    python build.py clean           remove the installed script (keeps profiles and settings)
    python build.py clean --all     remove it with profiles and settings
    python build.py status          show what's installed
    python build.py watch           sync now and after every change in src (Ctrl+C stops)

Options:
    --name NAME     install under this name (default: see below)
    --target DIR    Stand's Lua Scripts folder (default: %APPDATA%/Stand/Lua Scripts)

The name: the script can rename itself (Settings > Rename Script), so build.py looks for this
script's launchers in Lua Scripts and installs under the name it finds. A renamed script isn't
installed a second time. With nothing installed the name is AnitaDarin; with several installs
--name picks one.

User data in store/<name>/ - config.json and profiles/ - is never overwritten or removed (except
clean --all): the script writes it while it runs, the copies in src are only defaults for a first install.
"""

import argparse
import os
import pathlib
import shutil
import sys
import time

# Name of the script's files and folders in src: src/AnitaDarin.pluto, src/lib/AnitaDarin/, ...
PROJECT_NAME = "AnitaDarin"
SRC = pathlib.Path(__file__).resolve().parent / "src"
# Folders in Lua Scripts that hold a <name>/ folder of the script
SHARED_DIRS = ("lib", "store", "resources")
# In store/<name>/: written by the script while it runs, never touched by sync or clean
USER_DATA = ("config.json", "profiles")


class BuildError(Exception):
    pass


def default_target() -> pathlib.Path:
    appdata = os.getenv("APPDATA")
    if not appdata:
        raise BuildError("APPDATA isn't set: pass Stand's Lua Scripts folder with --target")
    return pathlib.Path(appdata) / "Stand" / "Lua Scripts"


def is_launcher(path: pathlib.Path) -> bool:
    """Whether a .pluto file in Lua Scripts is this script's launcher, under whatever name"""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False
    return "_G.Atdar" in text and "/bootstrap" in text


def installed_names(target: pathlib.Path) -> list:
    if not target.is_dir():
        return []
    return sorted(p.stem for p in target.glob("*.pluto") if is_launcher(p))


def resolve_name(target: pathlib.Path, name: str = None) -> str:
    """--name, else the one installed name, else PROJECT_NAME"""
    if name:
        return name
    names = installed_names(target)
    if len(names) > 1:
        raise BuildError(f"the script is installed several times ({', '.join(names)}): pick one with --name")
    return names[0] if names else PROJECT_NAME


def is_user_data(relative: pathlib.PurePath) -> bool:
    """relative: a path inside store/<name>/"""
    return bool(relative.parts) and relative.parts[0] in USER_DATA


def install_plan(target: pathlib.Path, name: str) -> list:
    """(source, destination, user_data) for every file of the project"""
    plan = [(SRC / f"{PROJECT_NAME}.pluto", target / f"{name}.pluto", False)]
    for shared in SHARED_DIRS:
        source_dir = SRC / shared / PROJECT_NAME
        if not source_dir.is_dir():
            continue
        for source in sorted(p for p in source_dir.rglob("*") if p.is_file()):
            relative = source.relative_to(source_dir)
            user_data = shared == "store" and is_user_data(relative)
            plan.append((source, target / shared / name / relative, user_data))
    return plan


def same_file(a: pathlib.Path, b: pathlib.Path) -> bool:
    return b.exists() and a.stat().st_size == b.stat().st_size and a.read_bytes() == b.read_bytes()


def sync(target: pathlib.Path, name: str, quiet: bool = False) -> dict:
    """Copies changed files; user data that already exists is kept"""
    counts = {"copied": 0, "unchanged": 0, "kept": 0}
    for source, destination, user_data in install_plan(target, name):
        if user_data and destination.exists():
            counts["kept"] += 1
            continue
        if same_file(source, destination):
            counts["unchanged"] += 1
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        counts["copied"] += 1
    if not quiet:
        print(f"synced '{name}' into {target}: {counts['copied']} copied, {counts['unchanged']} unchanged, "
              f"{counts['kept']} kept (profiles and settings)")
    return counts


def clean(target: pathlib.Path, name: str, everything: bool = False, quiet: bool = False) -> int:
    """Removes the installed script; profiles and settings stay unless everything is set"""
    removed = 0
    launcher = target / f"{name}.pluto"
    if launcher.exists():
        launcher.unlink()
        removed += 1
    for shared in SHARED_DIRS:
        folder = target / shared / name
        if not folder.is_dir():
            continue
        if shared != "store" or everything:
            removed += sum(1 for p in folder.rglob("*") if p.is_file())
            shutil.rmtree(folder)
            continue
        for path in sorted(folder.rglob("*"), key=lambda p: len(p.parts), reverse=True):
            if is_user_data(path.relative_to(folder)):
                continue
            if path.is_file():
                path.unlink()
                removed += 1
            elif not any(path.iterdir()):
                path.rmdir()
        if not any(folder.iterdir()):
            folder.rmdir()
    if not quiet:
        kept = "" if everything else " (profiles and settings kept)"
        print(f"removed '{name}' from {target}: {removed} file(s){kept}")
    return removed


def status(target: pathlib.Path, name: str) -> None:
    print(f"project:      {SRC}")
    print(f"Lua Scripts:  {target}")
    names = installed_names(target)
    print(f"installed as: {', '.join(names) if names else 'not installed'}")
    print(f"syncs as:     {name}")
    store = target / "store" / name
    data = [p for d in USER_DATA for p in ([store / d] if (store / d).is_file() else sorted((store / d).glob("*")))]
    if data:
        print("user data:    " + ", ".join(str(p.relative_to(store)) for p in data))


def source_state() -> dict:
    return {p: p.stat().st_mtime for p in SRC.rglob("*") if p.is_file()}


def watch(target: pathlib.Path, name: str, interval: float = 1.0) -> None:
    sync(target, name)
    print("watching src for changes, Ctrl+C stops")
    state = source_state()
    try:
        while True:
            time.sleep(interval)
            current = source_state()
            if current != state:
                state = current
                print(time.strftime("[%H:%M:%S] "), end="")
                sync(target, name)
    except KeyboardInterrupt:
        print("stopped")


def menu(target: pathlib.Path, name: str) -> None:
    actions = {
        "1": ("Update files", lambda: sync(target, name)),
        "2": ("Clean and update", lambda: (clean(target, name), sync(target, name))),
        "3": ("Clean only (keeps profiles and settings)", lambda: clean(target, name)),
        "4": ("Show status", lambda: status(target, name)),
        "5": ("Watch src and update on every change", lambda: watch(target, name)),
    }
    while True:
        print(f"\n===== {name} Build =====")
        for key, (title, _) in actions.items():
            print(f"  {key}. {title}")
        print("  0. Exit")
        choice = input("Select an option: ").strip()
        if choice == "0":
            break
        if choice in actions:
            actions[choice][1]()
        else:
            print("Invalid option, please try again.")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Installs the script into Stand's Lua Scripts folder")
    parser.add_argument("command", nargs="?", choices=["sync", "rebuild", "clean", "status", "watch"])
    parser.add_argument("--name", help="install under this name")
    parser.add_argument("--target", type=pathlib.Path, help="Stand's Lua Scripts folder")
    parser.add_argument("--all", action="store_true", help="with clean: also remove profiles and settings")
    args = parser.parse_args(argv)
    try:
        target = args.target or default_target()
        name = resolve_name(target, args.name)
        if args.command is None:
            menu(target, name)
        elif args.command == "sync":
            sync(target, name)
        elif args.command == "rebuild":
            clean(target, name)
            sync(target, name)
        elif args.command == "clean":
            clean(target, name, everything=args.all)
        elif args.command == "status":
            status(target, name)
        elif args.command == "watch":
            watch(target, name)
    except BuildError as error:
        print(f"[Build] {error}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
