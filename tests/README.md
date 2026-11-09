# Tests

**English** | [Русский](README.ru.md)

They check the script's code outside the game, against stubs of the Stand API. Pluto has to be installed (`pluto` and
`plutoc`).

```
python tests/run.py          every check
python tests/run.py json     only tests with "json" in the name
python tests/run.py -v       also show the output of passing tests
```

What's checked:

1. **syntax**: `plutoc` parses every `.pluto` in `src`, `examples`, `tests` and `updater` (with the `pluto_use` line, as
   in the launcher).
2. **natives**: every `NAMESPACE.NATIVE(...)` call in `src` is in the natives dump `experiments/natives-3407a/init.lua`.
   The dump isn't kept in git; without it the step is skipped.
3. **tests**: each `tests/test_*.pluto` runs in its own `pluto` process.

| Test | What it checks |
|---|---|
| `test_loader` | `loader.load` survives broken files; `loader.auto` reaches every file in `natives` |
| `test_natives` | natives as functions: `entity`, `ped` and its parts, `vehicle`, `player`, `hud.blip`; the `hud_color` and `feed_picture` tables |
| `test_feature` | Feature's option checks, hook order, switching off on error, repeated clicks |
| `test_file_watch` | Stop After Changes: off watches nothing, a written, added or removed file (and the launcher) stops the script, once a second |
| `test_module_manager` | dependencies, stopping along a chain, restarting, tick, reloading from disk |
| `test_modules_menu` | the modules menu: visibility in debug mode, actions, translation |
| `test_script_menu` | the script's section: layout, language choice, profiles, placeholders, renaming |
| `test_menu_startup` | startup as in bootstrap: copying a pack into the core, loading the built-in menu |
| `test_menu_utils` | `utils/menu`: colour picker, spoiler; `utils/color`: hex, Stand, game |
| `test_installer` | renaming the script with its log file open, a name already taken, a folder held open |
| `test_logger` | the logger: a file per day `<script>_<date>.log` in `store/<script>/logs`, a new file on a new day, retention, cleanup, a broken file |
| `test_notify` | where notifications go: Stand, the game's feed, log only; the rule for errors |
| `test_build.py` | `build.py`: installing under the found name, keeping profiles and logs, cleaning |
| `test_json_file` | JsonFile: safe writing, damaged files, `.bak`; profiles on top of it |
| `test_commands` | command names with the profile's prefix and renaming on the fly |
| `test_i18n` | strings from language files through Stand labels, layers of sources |
| `test_i18n_keys.py` | every key written out in the code (`lang.translate`, `i18n.label`/`text`, `label`/`text` of a scope) is in the English files |
| `test_streaming` | loading each kind of asset (and `texture_dict`, `model`), `request(false)`, timeouts |
| `test_examples` | runs modules, features, the pack, `menu/helpers`, and `basics/06_check` plus `basics/07_parsers_and_colors` against stubs; checks the wrapper names used by the native examples |
| `test_check` | `core/check`: `expecter` for function arguments and `validator` for options; errors from `Module` and `Feature` point at the line with the options, through `extends` too |
| `test_parsers` | `parsers/`: hex colour (`color`), strict JSON (`json`); Pluto in `proglang.pluto`: arguments (`args`), words of a name (`name`), types from the source (`source`), paths (`path`); Stand command names (`stand.command_box`); the facades |
| `test_updater` / `test_updater_manifest.py` | the updater from `updater/` on a fake GitHub, and the manifest generator |

## Writing a test

```lua
local stand = require("stand")   -- the Stand stub: util, filesystem, menu, lang
stand.boot()                     -- Atdar with its loader, as in the launcher

local thing = Atdar.loader.load("core/...")
stand.equal(thing.value(), 5, "what's being checked")
stand.check(stand.find_log("text"), "something was logged")

stand.finish()                   -- the result and the exit code
```

Useful things in `stand.pluto`:
- `stand.click(item, option)` clicks a menu item, like a user;
- `stand.frame(n)` runs n frames (module ticks and `toggle_loop`);
- `stand.clock` and `stand.on_yield` are the time for `util.yield`;
- `stand.tmpdir(name)` is an empty folder in `tests/.tmp`;
- `stand.store` is where `filesystem.store_dir()` looks; for tests that write files, set it to `stand.tmpdir(...)`.

A test fakes the game's natives (`PLAYER`, `ENTITY`, ...) by itself; see `test_streaming.pluto` for examples.
The stub repeats Stand's behaviour only where the tests need it. So tests don't replace checking in the game: they catch
logic errors before that.
