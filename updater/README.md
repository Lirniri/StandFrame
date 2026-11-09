# Auto-update

**English** | [Русский](README.ru.md)

The script's auto-updater. The engine is part of the script ([core/updater.pluto](../src/lib/AnitaDarin/core/updater.pluto));
[core/update_manager.pluto](../src/lib/AnitaDarin/core/update_manager.pluto) keeps what a check found and runs it for the
Settings > Update menu and for the automatic check.

| File | What it does |
|---|---|
| [core/updater.pluto](../src/lib/AnitaDarin/core/updater.pluto) | The engine: compares installed files with the release, downloads changed ones, removes dropped ones |
| [core/update_manager.pluto](../src/lib/AnitaDarin/core/update_manager.pluto) | Check and install one at a time, notifications, the automatic check, restart after an update |
| [manifest.py](manifest.py) | Makes `manifest.json`: every file of `src` from git with its sha256; that is the release |

The Update menu shows the installed and available versions, the last check and the files an update would change.
Settings (profile): `update_branch`, `update_check_before` (Update checks first and stops if nothing is newer),
`auto_update` (install what the automatic check finds), `update_check_days` (0 = never), `update_last_check`.
The automatic check runs a few seconds after the start and then looks hourly whether it is due.

The manifest must be on the branch updates come from, so run `manifest.py` before pushing to `main` and to `experiment`.

## How it works

1. Before pushing to `main`, run `python updater/manifest.py` (`--version 0.1.0` sets the version). `--check` tells
   whether the manifest is behind `src`.
2. `updater.check()` downloads `updater/manifest.json` from `main` and compares each file with the installed one by
   hash. Text is compared without `\r`, so a copy with `\r\n` doesn't count as changed.
3. `updater.apply(plan)` downloads the changed files, checks each against the manifest's hash and writes them only if
   all match: first alongside (`.update`), then over the originals. An error at any step changes nothing.

A script with another name is updated under its own: `lib/AnitaDarin/...` from the repository is written to
`lib/<name>/...`. The manifest can't write to paths outside the script's folders.

## What's left alone

- The user's data in `store/<name>/`: `config.json` and the `profiles`, `logs`, `commands` folders (for menu packs too).
  They're created only if missing.
- Files the updater didn't install: a menu copied into the core, your own packs and modules. Only files that were in
  the last installed release (`store/<name>/updater/installed.json`) and are gone from the new one get removed. After an
  install with `build.py`, the first update removes nothing.

## Example

```lua
local manager = Atdar.loader.load("core/update_manager")
util.create_thread(function()
    manager.check()             -- tells what it found
    manager.install_and_restart()
end)
```

Tests: [tests/test_updater.pluto](../tests/test_updater.pluto) (a fake GitHub) and
[tests/test_updater_manifest.py](../tests/test_updater_manifest.py).
