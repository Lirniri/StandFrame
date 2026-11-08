# Feature examples

**English** | [Русский](README.ru.md)

A feature is what the user switches on and off or clicks in the menu. Unlike a module, it's started by a menu item, not
by the script. A feature doesn't create its item: a menu file does, with
`node:add_feature(Atdar.features.get("id"), "Name")` (see [menu/](../menu/)).

| File | Kind | Menu item | What it shows |
|---|---|---|---|
| `01_action.pluto` | `action` | button | `on_trigger` on a click |
| `02_toggle.pluto` | `toggle` | checkbox | `on_enable` / `on_disable`, and restoring the old state with `on_save_state` / `on_load_state` |
| `03_loop.pluto` | `loop` | looping checkbox | `on_tick` every frame while it's on |
| `04_class.pluto` | `action` | button | a feature class with its own settings for menu sliders |

## Where to put them

- **In a menu pack:** `store/AnitaDarin/menu/<Pack>/features/<section>/name.pluto`. All files in a pack's `features`
  folder load when the pack loads. Example: [pack/](../pack/).
- **In the built-in menu:** `src/lib/AnitaDarin/features/<section>/name.pluto`.

## Rules

- `id` is unique: `Atdar.features.get(id)` finds a feature by it. The convention is `section.name`.
- The matching hook is required: a `loop` without `on_tick` or an `action` without `on_trigger` is an error at load time.
- An error in a hook turns the feature off, its menu checkbox clears by itself, and the error shows once.
- Clicking an `action` again while the previous click is still running (`util.yield`) is ignored.
- Save the game's state from before switching on in `on_save_state`, and restore it in `on_load_state`.
