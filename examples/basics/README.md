# Basics

**English** | [Русский](README.ru.md)

What any file of the script needs: a module, a feature or a menu.

| File | What it shows |
|---|---|
| `01_log_and_notify.pluto` | `Logger`: debug / info / notify / warn / error; `Atdar.util.toast` with a notification style |
| `02_profile.pluto` | Profile: `get`, `default`, `set`, `on_change` |
| `03_language.pluto` | Translations: `translate` for menu items, `text` for text filled with `format` |
| `04_json.pluto` | JSON file: safe `read` and `write`, where to keep your data |
| `05_natives.pluto` | Natives through `Atdar.natives`, and spawning a vehicle with model loading |
| `06_check.pluto` | `core/check`: `expecter` for function arguments, `validator` for options |
| `07_parsers_and_colors.pluto` | `Atdar.parsers`: arguments, names, Stand commands, JSON; `Atdar.color`: hex, Stand, game |
| `08_natives_more.pluto` | Pointers and handles, players, the session, control over an entity, map blips |
| `09_natives_all.pluto` | Where a native's wrapper is (`CAM.GET_GAMEPLAY_CAM_FOV` -> `camera.gameplay.get_fov`), finding it by its short name, pointer parameters |

These files show the calls rather than a working feature of their own: paste the lines you need into your module,
feature or menu file.

## In short

- **Log.** `local log = new Logger("Name")` at the top of a file. `notify`, `warn` and `error` show on screen, `debug`
  and `info` only go to the log (`debug` only in debug mode).
- **What lines look like.** In the log always `[AnitaDarin | Name | INFO] text`. On screen, outside debug mode, it's
  shorter: `[AnitaDarin] Information: text`.
- **Your own data** belongs in `store/AnitaDarin/`: `build.py` doesn't overwrite it. The `lib` folder is a copy of the
  code, and `build.py rebuild` clears it.
- **Natives.** The handle comes first, then everything else. Call what waits (loading a model) in a thread
  (`util.create_thread`), a menu action or a tick, not in the main body of a file.
- **Pluto strings.** Inside `$"..."` use single quotes: `$"model '{name}'"`. A call with quotes or a `{ ... }` table
  inside `{...}` won't parse: put the value in a local first.
- **Checks.** A wrong type is the caller's mistake, and `expect` points at the caller's line. Text that can't be read
  isn't an error: the parser returns `nil`.
