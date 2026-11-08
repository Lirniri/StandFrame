# Menu examples

**English** | [Русский](README.ru.md)

A pack's menu is the `menu/stand/*.pluto` files in the pack's folder. Each returns a table with `build(node, ctx)`:

- `node` is a `MenuNode`, the place in the menu to add items to;
- `ctx.load("name")` is another menu file from the same folder (loaded once per build).

It all starts at `main.pluto`, which calls the other files.

```lua
-- menu/stand/main.pluto
return {
    build = function(node, ctx)
        node:divider("ExamplePack")
        ctx.load("items").build(node, ctx)
        ctx.load("features").build(node, ctx)
        ctx.load("settings").build(node, ctx)
    end,
}
```

| File | What it shows |
|---|---|
| `items.pluto` | Every kind of `MenuNode` item: divider, text, link, button, checkbox, sliders, choice, input, colour, sublist |
| `features.pluto` | Features in the menu with `add_feature`, checking with `features.has`, sliders for a feature's settings |
| `settings.pluto` | The script's settings section inside a list of your own, with your own items in it |
| `modules_debug.pluto` | Module debugging in your own menu: `modules_menu.list_in` and `module_in` |
| `helpers.pluto` | Ready-made helpers: a button with confirmation, a spoiler, a submenu from a table |

## `MenuNode` items

| Method | Item |
|---|---|
| `divider(name)` | Divider |
| `readonly(name, value)` | "Name: value" |
| `readonly_name(name)` | A line of text |
| `hyperlink(name, link, help)` | Link |
| `list(name, commands, help, on_back, on_open)` | Sublist, returns a `MenuNode` |
| `action(name, on_click, commands, help)` | Button |
| `toggle(name, on_change(on), commands, help, default)` | Checkbox |
| `slider(name, min, max, default, step, on_change(value), commands, help)` | Number slider |
| `text_slider(name, options, on_click(index, name), commands, help)` | Choice with arrows |
| `list_action(name, options, on_select(index, name), commands, help)` | Choice from a list |
| `text_input(name, commands, on_change(value), help, default)` | Text input (commands are required) |
| `color(name, default, on_change(colour), commands, help, transparency)` | Colour |
| `add_feature(feature, name, commands, help)` | A feature's item, by its kind |

## Ready-made helpers

| What | How | What for |
|---|---|---|
| Button with confirmation | `confirm.action(node, name, again_name, on_confirm, on_first, help)` | Things that can't be undone: acts only on a second click within 5 seconds. Returns the item and `cancel()` |
| Spoiler | `Atdar.menu.spoiler(node.handle, name, value, hidden_text, help)` | A value hidden until clicked |
| Submenu from a table | `builder.build_items(node, items, where)` | The same items, written as data. A mistake in the table is a warning in the log, and that item is skipped |

`confirm` is `ui/stand/confirm` and `builder` is `ui/stand/menu_builder`; get both through `Atdar.loader.load`.

**Commands.** `commands` are base command names without the prefix: `{ "heal" }` becomes `atdarheal`. The user can
rename them in Settings > Command Box.

**Names.** Plain text or a label from `Atdar.lang.translate("key")`. A label is translated into Stand's language and
changes by itself when the language changes.
