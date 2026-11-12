# StandFrame examples

**English** | [Русский](README.ru.md)

How to use the script from the inside: write modules, features and menu packs, build menus, keep a log, show
notifications, read the profile, translations and JSON, call natives.

Comments in the code are in English, as in the rest of the project. Each folder's README has the explanations, in
English and Russian.

| Folder | What's inside |
|---|---|
| [basics/](basics/) | The foundation needed everywhere: log and notifications, profile, translations, JSON files, natives, checks, parsers and colours |
| [modules/](modules/) | Modules: internal parts of the script that it starts by itself (no menu item) |
| [features/](features/) | Features: what the user switches on and off or clicks in the menu |
| [menu/](menu/) | Menu files: `MenuNode` items, features in the menu, the settings section, module debugging in your own menu, ready-made helpers |
| [pack/](pack/) | A complete menu pack, `ExamplePack`: info.json, features, menu, translations, copied and loaded as a whole |
| [utils/](utils/) | What is built on natives in `Atdar.util.game`: Graceland (a fall from any height, steered with the stick), game helpers, `tools.states` |

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
| Parsers | `Atdar.parsers.<kind>` | `Atdar.parsers.proglang.pluto.args.parse("5, true")` |
| Modules | `Atdar.modules` | `Atdar.modules.get("VehicleManager")` |
| Features | `Atdar.features` | `Atdar.features.get("self.godmode")` |
| Colours | `Atdar.color` | `Atdar.color.from_hex("FF8000")` |
| Argument checks | `core/check` | `check.expecter("my/file")` |
| Debug mode | `Atdar.debug` | `if Atdar.debug then ... end` |

## Trying an example in the game

1. Put the file where its folder's README says (`src/lib/AnitaDarin/modules/`, a pack's folder and so on).
2. `python build.py sync` copies the project to Stand (`%APPDATA%/Stand/Lua Scripts`).
3. Restart the script in Stand; a module can simply be reloaded with "Reload" in Settings > Debug > Modules.

`python tests/run.py` checks every example's syntax. `test_examples` also runs the module, feature, pack and menu-helper
examples, plus basics `06_check` and `07_parsers_and_colors`, against Stand stubs. The native examples' wrapper names
are checked, but their game calls aren't run; the other basics examples are syntax-checked only.
