# StandFrame

**English** | [Русский](README.ru.md)

StandFrame is a script for [Stand](https://stand.sh) (GTA V), written in Pluto. It provides a reusable script
foundation and an in-game menu with profiles, translations, configurable commands, notifications, and debugging tools
for modules.

## What is implemented

- **Menu packs.** Load a menu pack from `store/<script>/menu/`, or copy one into the script's core from the menu.
  Packs can provide their own features, menu layout, translations, and command names.
- **Features and modules.** Features are menu actions, toggles, and loops. Modules are script services that start
  independently and can declare dependencies. In debug mode, inspect modules, call their functions, and reload changed
  files.
- **Profiles.** Create, save, load, delete, and optionally autosave sets of settings.
- **Translations.** Follow Stand's language or select another available language. Create translation files, check
  translation progress, and reload language files without restarting.
- **Command box.** Configure command prefixes and separators, rename script and menu commands, add aliases, and create
  user commands that run a sequence of Stand commands.
- **Notifications and logs.** Choose where notifications appear and configure game-feed style, picture, colours, and
  per-level emoji. Logs are written to daily files.

The built-in menu is still in development. Its current feature items include self/player options (such as god mode,
movement and health/armour/stamina actions) and a vehicle action; some menu sections are present as scaffolding and
don't yet contain features. The Update menu checks for and installs new versions (manually or on an interval). See [updater/README.md](updater/README.md).

## Install and run

Requirements: Python 3 for the build helper, and [Stand](https://stand.sh) to run the script. The project targets Pluto
0.13.2.

From the repository root:

```text
python build.py sync       copy or update the project in Stand
python build.py watch      sync now and after changes in src (Ctrl+C to stop)
python build.py rebuild    remove installed code, then copy the current project
python build.py status     show the detected installation
python build.py clean      remove installed code but keep user data
python build.py clean --all
                           also remove profiles, settings, logs, and saved commands
```

By default, files go to `%APPDATA%/Stand/Lua Scripts`. Pass `--target DIR` to use another folder and `--name NAME` to
choose the installed script name. If multiple copies are installed, specify `--name`.

`sync` preserves existing user data in `store/<name>/`: `config.json`, `profiles/`, `logs/`, `commands/`, and `user/` (your own data, such as short names for Call Function).
`rebuild` removes files that were deleted from the project, but keeps that data. The script can be renamed in its
settings; the build helper detects the installed launcher and continues to use its name.

After syncing, start or restart the script in Stand. In the script's Settings section, choose a profile and language,
configure notifications and command names, and use Load Menu to select or copy a menu pack.

## Project layout

| Path | Purpose |
|---|---|
| `src/AnitaDarin.pluto` | Launcher; uses its file name to locate the matching library and data folders |
| `src/lib/AnitaDarin/core/` | Loader, profiles, translations, logging, filesystem, checks, and module management |
| `src/lib/AnitaDarin/features/` | Feature implementation and registry |
| `src/lib/AnitaDarin/modules/` | Built-in modules, including `VehicleManager` |
| `src/lib/AnitaDarin/natives/` | Game native wrappers, grouped by namespace |
| `src/lib/AnitaDarin/parsers/` | Parsers for colours, JSON, Pluto source, and Stand command names |
| `src/lib/AnitaDarin/ui/stand/` | Stand menu, settings, profiles, command box, and module debugging |
| `src/store/AnitaDarin/` | Default data and the built-in menu pack |
| `examples/` | Guided examples for core APIs, features, modules, menus, and packs |
| `tests/` | Tests against Stand API stubs |
| `updater/` | Release-manifest generator for the updater (the engine is `core/updater`) and its docs |

## Development and tests

Install Pluto 0.13.2 (`pluto` and `plutoc` available on `PATH`), then run:

```text
python tests/run.py
```

The runner checks Pluto syntax, validates native names when the local natives dump is available, and runs the
Pluto and Python tests. To run only tests whose filename contains a word, pass it after the script, for example
`python tests/run.py json`. See [tests/README.md](tests/README.md) and [examples/README.md](examples/README.md).
