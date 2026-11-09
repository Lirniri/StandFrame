# Auto-update

**English** | [Русский](README.ru.md)

The script's updater. For now it stands apart: the script doesn't load it. It grows with the project and will be
connected later.

The script's Settings menu already has an Update section, but its check and install actions are placeholders. The
automatic-update toggle and interval currently save profile settings only; they do not call this updater.

| File | What it does |
|---|---|
| [updater.pluto](updater.pluto) | The updater for Stand: compares installed files with the release, downloads changed ones, removes dropped ones |
| [manifest.py](manifest.py) | Makes `manifest.json`: every file of `src` from git with its sha256; that is the release |

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
local updater = require("updater")
util.create_thread(function()
    local plan, err = updater.check({ name = Atdar.name })
    if plan == nil then
        util.toast(err)
        return
    end
    if updater.is_up_to_date(plan) then
        return
    end
    local ok, apply_err = updater.apply(plan, |done, total| -> util.draw_debug_text($"{done}/{total}"))
    if ok then
        util.restart_script()
    end
end)
```

Tests: [tests/test_updater.pluto](../tests/test_updater.pluto) (a fake GitHub) and
[tests/test_updater_manifest.py](../tests/test_updater_manifest.py).
