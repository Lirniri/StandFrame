# Menu pack example

**English** | [Русский](README.ru.md)

A menu pack is a menu of the script's own, with its own features and translations. The user picks a pack in
Settings > Load Menu; when another menu is loaded, the pack is unloaded as a whole.

## Structure

```
ExamplePack/
├── info.json                  the pack's name (required), author, version
├── features/                  the pack's features: every .pluto here loads with the pack
│   └── self/
│       ├── heal.pluto         action: a button
│       └── no_wanted.pluto    toggle: a checkbox
├── menu/
│   └── stand/
│       ├── main.pluto         the menu is built from here: it calls the other files with ctx.load
│       ├── self.pluto         the features' items
│       └── settings.pluto     the script's settings section inside a list of its own
└── language/
    ├── en-us.json             the pack's translations: keys for Atdar.lang.translate
    └── ru-ru.json
```

For what each part does, see [features/](../features/) and [menu/](../menu/).

## Trying it

1. Copy the `ExamplePack` folder to `src/store/AnitaDarin/menu/`, next to the `AnitaDarin` pack.
2. `python build.py sync`, then restart the script in Stand.
3. Settings > Load Menu > ExamplePack.

It also works without `build.py`: put the folder straight into `%APPDATA%/Stand/Lua Scripts/store/AnitaDarin/menu/`
and pick the pack in the menu.

## Worth noting

- **Feature `id`s** are unique among all loaded features. The convention is to start with the pack's name:
  `examplepack.self.heal`.
- **Translation keys** had better start with the pack's name too, so they don't clash with the script's strings.
- **The pack's commands** (`{ "epheal" }`) get the script's prefix. The user can rename them; the names are saved in
  `commands.json` in the pack's folder.
- **An error in one file** doesn't bring the pack down: a feature file with an error is skipped, and the error goes to
  the log. `features.get` won't find a skipped feature, so check `Atdar.features.has(id)` for optional ones.
