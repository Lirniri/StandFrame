"""Makes updater/manifest.json: every file of src the repo tracks, with its sha256 - what a release is for
the auto-updater (updater/updater.pluto). Make it before pushing a release to main.

    python updater/manifest.py                    write it (the version it has, "dev" for a first one)
    python updater/manifest.py --version 0.1.0    write it with this version
    python updater/manifest.py --check            exit 1 if it isn't up to date with src

Hashes are of text without \\r (a Windows copy has \\r\\n), like updater.pluto counts them.
Left out: store/<project>/logs/ - what the script writes there is never part of a release.
"""

import argparse
import hashlib
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
MANIFEST = ROOT / "updater" / "manifest.json"
PROJECT = "AnitaDarin"
FORMAT = 1

# The same list as BINARY in updater.pluto
BINARY = {"png", "jpg", "jpeg", "gif", "bmp", "ico", "dds", "ytd",
          "ttf", "otf", "wav", "mp3", "ogg", "zip", "dll", "bin"}
# Not part of a release: written by the script, or leftovers
SKIPPED_SUFFIXES = (".json.tmp", ".json.bak", ".json.broken")


def file_hash(path: str, content: bytes) -> str:
    extension = path.rsplit(".", 1)[-1].lower() if "." in path.rsplit("/", 1)[-1] else ""
    if extension not in BINARY:
        content = content.replace(b"\r\n", b"\n")
    return hashlib.sha256(content).hexdigest()


def is_released(path: str, project: str) -> bool:
    if path.endswith(SKIPPED_SUFFIXES):
        return False
    return not path.startswith(f"store/{project}/logs/")


def tracked_files(src: pathlib.Path) -> list:
    """The files of src git tracks, relative to src with "/"; all files when it isn't a git checkout"""
    try:
        out = subprocess.run(["git", "ls-files", "-z", "--", "."], cwd=src, capture_output=True, check=True).stdout
        return sorted(p for p in out.decode("utf-8").split("\0") if p)
    except (OSError, subprocess.CalledProcessError):
        return sorted(p.relative_to(src).as_posix() for p in src.rglob("*") if p.is_file())


def collect(src: pathlib.Path, project: str = PROJECT, files: list = None) -> dict:
    """{path: {"sha256", "size"}} of the files of src that make a release"""
    result = {}
    for path in files if files is not None else tracked_files(src):
        full = src / path
        if not full.is_file() or not is_released(path, project):
            continue
        content = full.read_bytes()
        result[path] = {"sha256": file_hash(path, content), "size": len(content)}
    return result


def read(path: pathlib.Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def build(version: str, src: pathlib.Path = SRC, project: str = PROJECT) -> dict:
    return {"format": FORMAT, "project": project, "version": version, "files": collect(src, project)}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Makes updater/manifest.json for the auto-updater")
    parser.add_argument("--version", help="the release's version (default: the one the manifest has)")
    parser.add_argument("--check", action="store_true", help="exit 1 if the manifest isn't up to date with src")
    parser.add_argument("--out", default=str(MANIFEST), help="where to write it")
    args = parser.parse_args(argv)
    out = pathlib.Path(args.out)
    old = read(out)

    if args.check:
        current = collect(SRC)
        listed = old.get("files", {})
        changed = sorted(p for p in set(current) | set(listed) if current.get(p) != listed.get(p))
        if changed:
            print(f"manifest is out of date: {len(changed)} files differ")
            for path in changed[:20]:
                print(f"  {path}")
            return 1
        print("manifest is up to date")
        return 0

    version = args.version or old.get("version") or "dev"
    manifest = build(version)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    print(f"{out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}: {len(manifest['files'])} files, version {version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
