# StandFrame examples

**English** | [Русский](README.ru.md)

How to use the script from the inside: write modules, features and menu packs, build menus, keep a log, show
notifications, read the profile, translations and JSON, call natives.

Comments in the code are in English, as in the rest of the project. Each folder's README has the explanations, in
English and Russian.

| Folder | What's inside |
|---|---|
| [basics/](script/basics/) | The foundation needed everywhere: log and notifications, profile, translations, JSON files, natives, checks, parsers and colours |
| [modules/](script/modules/) | Modules: internal parts of the script that it starts by itself (no menu item) |
| [features/](script/features/) | Features: what the user switches on and off or clicks in the menu |
| [call_function/](script/call_function/) | Calling functions by hand: Debug > Call Function (the Function Name's rules, arguments, vectors, `#N`, commands) and a module's Function Call list |
| [menu/](script/menu/) | Menu files: `MenuNode` items, features in the menu, the settings section, module debugging in your own menu, ready-made helpers |
| [pack/](script/pack/) | A complete menu pack, `ExamplePack`: info.json, features, menu, translations, copied and loaded as a whole |
| [utils/](script/utils/) | What is built on natives in `Atdar.util.game`: Graceland (a fall from any height, steered with the stick), the player's functions (`auto_heal`, `levitate`, `freecam` ...), the world (clock, clouds, timecycle), game helpers, `tools.states` |

## Lessons

Step-by-step lessons that walk through the engine's real code. Each has a short theory part, a comparison with
plain Lua, fragments of StandFrame with the paths of their files, and "Try it yourself" tasks.
The lessons are written in Russian.

### The Pluto language compared with Lua 5.4 — [programing/](programing/)

| Lesson | What it covers |
|---|---|
| [1. Pluto against plain Lua](programing/01-lua-vs-pluto-syntax.md) | A table of the differences; `$"..."`, type hints, `??`, `?.`, `+=`, `?:`, `<close>` on the code of `core/loader` and `core/i18n` |
| [2. OOP and the type system](programing/02-oop-classes-and-types.md) | Metatables against `class`; how `Feature` and `Module` are built; the checks of `core/check` |
| [3. Pluto's standard library and the parsers](programing/03-pluto-stdlib-and-parsers.md) | `pluto:json`, `pluto:crypto`, `io.listdir`, `startswith`; the `json`, `color` and `source` parsers; how Call Function works |

### The StandFrame engine — [script/](script/)

| Lesson | What it covers |
|---|---|
| [1. The entry point and the core's architecture](script/01-engine-architecture-and-entry.md) | The launcher, the start order in bootstrap, the loader `core/loader`, the overall scheme |
| [2. Modules and their life cycle](script/02-modules-and-lifecycle.md) | A module as a table and as a class, dependencies, statuses, ticks, hot reload, `file_watch` |
| [3. Features and building Stand's menu](script/03-features-and-stand-ui.md) | The three kinds of features, the registry, `MenuNode` and `MenuItem`, `menu_builder`, the modules debugger |
| [4. Making your own menu packs](script/04-creating-menu-packs.md) | What a pack is made of, loading and unloading, how its resources are kept apart, a pack of your own step by step |
| [5. Data, translations and commands](script/05-profiles-i18n-and-commands.md) | `JsonFile`, profiles with autosave, translations and lazy loading of languages, the log, Stand's commands |
| [6. Testing on stubs of Stand's API](script/06-testing-with-stand-stubs.md) | The runner `tests/run.py`, the stub `tests/stand.pluto`, how to write tests of your own |

Where to start: with `programing/` if Pluto is new to you, straight with `script/` if you know the language.
The ready example files the lessons point to are in the folders of the table above.

## What's where in `Atdar`

| What | Where | Example |
|---|---|---|
| Loading files from `lib` | `Atdar.loader.load("path")` | `local Module = Atdar.loader.load("core/module")` |
| Log and notifications | `core/logger` | `local log = new Logger("Name")`, `log:notify("...")` |
| A plain notification | `Atdar.util.toast(text, opts)` | `Atdar.util.toast("Done", { target = "game" })` |
| Profile (settings) | `Atdar.profile` | `Atdar.profile.get("notify")` |
| Translations | `Atdar.lang` | `Atdar.lang.translate("menu.self.menu_name")` |
| Paths | `Atdar.filesystem.paths` | `paths.store`, `paths.lib`, `paths.resources` |
| JSON file | `Atdar.filesystem.json.File` | `new File(path):read()` / `:write(t)` |
| Natives | `Atdar.natives.<section>` | `Atdar.natives.entity.vehicle.delete(handle)` |
| Game memory | `Atdar.natives.memory` | `Atdar.natives.memory.pointers.get("roll_check")` |
| Your own Call Function code | `Atdar.user_script` | `Atdar.user_script.hello("you")` |
| Parsers | `Atdar.parsers.<kind>` | `Atdar.parsers.proglang.pluto.args.parse("5, true")` |
| Modules | `Atdar.modules` | `Atdar.modules.get("VehicleManager")` |
| Features | `Atdar.features` | `Atdar.features.get("self.godmode")` |
| Player and world | `Atdar.util.game` | `Atdar.util.game.players.user.auto_heal.enable()` |
| Colours | `Atdar.color` | `Atdar.color.from_hex("FF8000")` |
| Argument checks | `core/check` | `check.expecter("my/file")` |
| Debug mode | `Atdar.debug` | `if Atdar.debug then ... end` |

## Trying an example in the game

1. Put the file where its folder's README says (`src/lib/AnitaDarin/modules/`, a pack's folder and so on).
2. `python build.py sync` copies the project to Stand (`%APPDATA%/Stand/Lua Scripts`).
3. Restart the script in Stand; a module can simply be reloaded with "Reload" in Settings > Debug > Modules.

`python tests/run.py` checks every example's syntax. `test_examples` also runs the module, feature, pack and menu-helper
examples, plus basics `06_check` and `07_parsers_and_colors` and the `call_function` examples, against Stand stubs. The native examples' wrapper names
are checked, but their game calls aren't run; the other basics examples are syntax-checked only.
