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
| `options.pluto` | Items made with a table of options: `user_only`, `warning`, handlers by name |
| `changing.pluto` | Changing an item after it's made (`MenuItem`): value, name, help, visibility, live captions |
| `dynamic.pluto` | Items from data that changes: a list filled when opened, a part of a list made again, removing an item |
| `refs.pluto` | Items for code that has only a Stand ref: `Atdar.menu.action(ref, { ... })`, `Atdar.menu.item`, `Atdar.menu.refs` |

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

## A table of options and `MenuItem`

Every item method also takes one table of options, and every method gives back a `MenuItem`:

```lua
local status = list:readonly({ name = "Status", value = "Stopped" })
list:toggle({ name = "Running", commands = { "running" }, on_change = function(on)
    status:set_value(on ? "Running" : "Stopped")
end })
```

| Option | What it does |
|---|---|
| `name`, `help` | Text or a label from `Atdar.lang.translate` |
| `key` | In place of `name` and `help`: the strings `<key>.name` and `<key>.help`. `node:scope("part")` puts the node's keys under `part.` |
| `commands` | Base command names, the prefix is added |
| `on_click`, `on_change`, `on_select` | The handler, by the kind of item |
| `user_only` | The handler runs only for the user's own clicks, not when Stand restores a profile |
| `warning` | A function giving a text: Stand asks with it before the handler runs; `nil` means it doesn't ask |
| `track = false` | The commands aren't renamed with the prefix settings |
| `caption`, `help_from`, `shown_when`, `value_from` | The name, help, visibility or value follow a function |
| `fill` (for `list`) | The list's items are made when it's opened and removed on back |

| `MenuItem` method | What it does |
|---|---|
| `set_name`, `set_help`, `set_visible`, `set_options` | Changes the item |
| `set_value(value, run_handler)`, `get_value()` | The value; set from code, it doesn't run the item's handler unless `run_handler` is true |
| `on_focus(fn)`, `on_blur(fn)`, `on_view_tick(fn)` | The cursor came onto the item, left it; every tick while it's on screen |
| `caption(fn)`, `help_from(fn)`, `shown_when(fn)`, `value_from(fn)` | Set again when the language or the profile changes and on `Atdar.menu.live.refresh()` |
| `remove()` | Takes the item out of the menu and out of its node |

A list (`MenuNode`) has these methods too, plus `section(fill)`: the end of a list made again by `part.rebuild()`.
Every change is safe on an item that's gone already.

## Ready-made helpers

| What | How | What for |
|---|---|---|
| Button with confirmation | `confirm.action(node, name, again_name, on_confirm, on_first, help)` | Things that can't be undone: acts only on a second click within 5 seconds. Returns the item and `cancel()` |
| Spoiler | `Atdar.menu.spoiler(node.handle, name, value, hidden_text, help)` | A value hidden until clicked |
| Submenu from a table | `builder.build_items(node, items, where)` | The same items, written as data. A mistake in the table is a warning in the log, and that item is skipped |

`confirm` is `Atdar.menu.confirm` and `builder` is `Atdar.menu.builder`.

## `Atdar.menu`: everything for a menu in one place

A pack needn't know where each part of the script's menu lives in `lib`: they come from `Atdar.menu` and load
the first time they're asked for.

| What | What for |
|---|---|
| `Atdar.menu.Node` | `MenuNode`: `new Atdar.menu.Node(ref)` wraps a Stand ref |
| `Atdar.menu.builder` | `builder.build_items(node, items)` - a submenu from a table |
| `Atdar.menu.confirm` | `confirm.action(...)` - a button with confirmation |
| `Atdar.menu.settings` | The script's settings section: `set_parent`, `set_divider`, `set_name`, `add` |
| `Atdar.menu.commands` | Command names with the profile's prefix: `names`, `track` |
| `Atdar.menu.arguments` | Fields for a function's arguments, by their types |
| `Atdar.menu.modules` | `list_in(node)`, `module_in(node, name)` - the Modules list in your own menu |
| `Atdar.menu.clicks` | `is_user_action(click_type)` - whether the user clicked or Stand called the handler itself |
| `Atdar.menu.spoiler`, `Atdar.menu.color` | Items Stand doesn't have ready-made |
| `Atdar.menu.Item`, `Atdar.menu.live` | `MenuItem`; `live.refresh()` sets the live captions again |
| `Atdar.menu.<kind>(ref, { ... })` | An item in a Stand ref or a node, gives back the `MenuItem`: `list`, `action`, `toggle`, `slider`... |
| `Atdar.menu.node(ref)`, `Atdar.menu.root()` | The node of a ref (one per ref), of the script's root list |
| `Atdar.menu.item(ref)` | A `MenuItem` for a ref Stand gave |
| `Atdar.menu.refs` | Stand's command refs: `by_command`, `is_valid`, `name_of`, `trigger`, `focus` |

**Commands.** `commands` are base command names without the prefix: `{ "heal" }` becomes `atdarheal`. The user can
rename them in Settings > Command Box.

**Names.** Plain text or a label from `Atdar.lang.translate("key")`. A label is translated into Stand's language and
changes by itself when the language changes.
