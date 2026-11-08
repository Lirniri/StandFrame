# AnitaDarin

**English** | [Русский](README.ru.md)

A script for [Stand](https://stand.sh) (GTA V) written in Pluto: a menu built from pluggable packs, modules with their
own debugging right in the menu, profiles, translations, and a command box with commands of your own.

## Features

- **Menu packs.** The built-in menu or any pack from `store/<script>/menu/`, with its own features, menu and
  translations. A pack can be copied into the core, and then it loads on every start.
- **Modules.** Internal parts of the script with dependencies, start and stop. Debug has a list for each module:
  status, reload from disk, calling any function with arguments, loops, variable values.
- **Profiles**, like Stand's: several sets of settings, saving, autosave, reset.
- **Translations.** Stand's language or one of your own; create a translation into a new language right from the menu,
  see its progress, reload it without restarting.
- **Command box.** Custom prefixes, renaming any command, extra words, and user commands: a name that runs a chain of
  other commands.
- **Notifications** in Stand or in the game's feed: colours, a picture, emoji by type.
- **Log**, one file per day, with the load time of every file measured.

## Installation

You need Python 3. The script is copied to Stand's Lua Scripts folder (`%APPDATA%/Stand/Lua Scripts`):

```
python build.py sync       copy the project to Stand
python build.py watch      copy after every change in src
python build.py rebuild    clean and copy again (gets rid of deleted files)
python build.py status     show what is installed
```

Profiles, settings, logs and your commands (`store/<script>/config.json`, `profiles/`, `logs/`, `commands/`) are left
alone by copying and cleaning. The script can be renamed right in the menu; `build.py` finds it under the new name.

## Layout

| Folder | What's inside |
|---|---|
| `src/AnitaDarin.pluto` | Launcher: the script's name from the file name, then `lib/<script>/bootstrap` |
| `src/lib/AnitaDarin/core/` | The foundation: loader, log, profiles, translations, modules, checks (`check`), files |
| `src/lib/AnitaDarin/natives/` | Game natives as functions, by section: `Atdar.natives.entity.vehicle.repair(handle)` |
| `src/lib/AnitaDarin/parsers/` | Reading text: arguments, colours, JSON, Stand command names |
| `src/lib/AnitaDarin/ui/stand/` | The menu: the script's section, profiles, module debugging, the command box |
| `src/lib/AnitaDarin/modules/` | Modules, such as `VehicleManager` |
| `src/store/AnitaDarin/` | Data: translations (`base/language`), menu packs (`menu/`) |
| `examples/` | Step-by-step examples of everything, with explanations: [examples/README.md](examples/README.md) |
| `tests/` | Tests that run outside the game: [tests/README.md](tests/README.md) |
| `updater/` | The updater, not connected to the script yet: [updater/README.md](updater/README.md) |

## Development

```
python tests/run.py        syntax, natives and every test against the Stand stubs
```

Requires [Pluto](https://pluto-lang.org) to be installed. The `experiment` branch is for work in progress, `main` is
for what has been tested.
