# Module examples

**English** | [Русский](README.ru.md)

A module is an internal part of the script that the script starts by itself at startup. A module has no menu item.
What the user switches on and off in the menu is a `Feature`, not a module (see [features/](../features/)).

| File | What it shows |
|---|---|
| `01_basic.pluto` | The simplest module: a table of options, `on_start` / `on_stop` |
| `02_class.pluto` | A module class: its own state and a function for other modules |
| `03_tick.pluto` | `on_tick` every frame, reacting only to changes; `skip_first_tick` for game natives that aren't ready during startup |
| `04_deps.pluto` | Depending on another module (`deps`) and calling its function through `self:get` |
| `05_menu_functions.pluto` | A module's functions in the debug menu, return types, internal `_functions`, files in the module's folder |
| `06_debug_display.pluto` | Setting up how a module looks in the debug menu: descriptions, default arguments, groups, hiding |
| `07_translations/` | A module's translations: its own `language` folder, `self:text` and `self:label` |

## Running them

1. Copy the files you want to `src/lib/AnitaDarin/modules/`. Each module is best in its own folder:
   `modules/Counter/Counter.pluto`. `04_deps.pluto` needs `02_class.pluto` alongside it.
2. `python build.py sync` copies the project to Stand.
3. Restart the script in Stand. Modules from the `modules` folder load and start at startup.

## The module debug menu

Settings > Debug > Modules, visible in debug mode (the "Debug Mode" checkbox is in the same place).

- **For each module:** status, "Start" / "Restart" / "Stop" / "Reload".
- **"Disable Function Categories"** (each module has its own): the module's functions as one list, without "Getters"
  and the others, and the base functions as a section. It's kept after "Reload".
- **Base Functions** (a list; with categories disabled, a section): `on_start()` and `on_stop()` as buttons; `on_tick()`
  as a list for running the loop by hand (with init, loop only, for a while) and its status.
- **Module functions:** for each function of the class, a list with a field for each parameter (if it has any), "Call",
  "Call When Opened", "Call When Hovered", "Loop", "Loop With Interval" and "Stop". A call's result arrives as a
  notification, loops draw theirs on screen, tables can be expanded.
- **Arguments:** each parameter is a divider with its name and a field named by the type written in the code:
  `int` is "Number", `float` is "Float Number", `string` is "Text", `bool` is "Boolean", `vector3` is "3D Vector"
  (`1, 2, 3`), `table` is "Table", `function` is "Function" (the path of one), `userdata` is "Userdata". No type, or a
  type like `int|string`, is "Argument *". What goes in a field is written as in Lua: `5, true, "text"`,
  `v3.new(1, 2, 3)`, calls and natives (`entities.get_user_vehicle_as_handle()`). A word without quotes is text.
  A field starts with the default written in the code (`speed: float = 1.5`), or else with `0` for a number, `false`
  for a boolean and `0, 0, 0` for a vector; the others, and a parameter written as `?type`, start empty. A field
  cleared by hand is not given. A function with `...` has "Arguments" at the end for the rest.
- **A changed file.** After an edit: `build.py sync`, open "Modules", and the module shows "· file changed". "Reload"
  (or "Reload Changed") reads the code again without restarting the script.

To embed this menu in your own pack: [menu/modules_debug.pluto](../menu/modules_debug.pluto).

## Setting up the display: the `debug` option

A module can say how it looks in the debug menu. That's the `debug` option, in `parent:__construct({ ... })` or in
`new Module({ ... })`. Everything in it is optional.

```lua
parent:__construct({
    name = "VehicleManager",
    debug = {
        functions = {
            add_vehicle = {
                help = "Remembers the vehicle",                    -- the function's description
                params = { handle = "the vehicle's handle" },      -- hints for its parameters
                args = "entities.get_user_vehicle_as_handle()",    -- prefilled in "Arguments"
            },
        },
        groups = {                                                 -- dividers of your own
            { name = "Getting", functions = { "get_handle", "get_handles" } },
            { name = "Actions", functions = { "create", "delete_all" } },
        },
        hide = { "explode_all", "current_vehicle" },               -- not shown
        categories = {                                             -- your own words for lists
            { key = "getters", words = { "find" } },               -- find_car goes to "Getters" too
            { key = "shop", name = "Shop", words = { "buy", "sell" } },  -- a list of your own
        },
    },
})
```

| Part | What it does |
|---|---|
| `functions.<name>.help` | The function's description, in its list's tooltip |
| `functions.<name>.params` | What each parameter means. Shown in the tooltip of the list and of the parameter's field |
| `functions.<name>.live` | `true`: while the function's list is open, it's called 4 times a second and "Variable" shows the current value; `false`: only when called. Without it, functions with the words `get`, `is`, `has`, `can` are called by themselves |
| `functions.<name>.args` | Text in the fields until something else is typed: the arguments in one line, as in a call, the first for the first parameter and so on. Lua expressions |
| `groups` | Dividers with your own names. Functions go under them in the given order, `_` / `__` ones too. The rest stay under "Functions", "Internal Functions" and "Private Functions" |
| `hide` | Names of functions and variables (module fields) that won't be in the menu |
| `categories` | Words for lists by name (see below): add words to an existing list by its `key`, or make your own list with `name` |

- **Errors right away.** A wrong type or a typo in `debug` (say, `helps` instead of `help`) is an error when the module
  is created, not a setting quietly ignored.
- **The `debug` field.** The setup is kept in `self.debug` and isn't shown in "Variables".
- **Hidden doesn't mean gone.** A hidden function stays in the code and other modules call it as usual; it's just not
  in the menu.

## Lists by a word in the name

Functions sort themselves into lists under "Functions" by a word in their name:

| Word | List | `key` |
|---|---|---|
| `add` | "Add" | `add` |
| `get` | "Getters" | `getters` |
| `set` | "Setters" | `setters` |
| `is`, `has`, `can` | "Checks" | `checks` |
| `load` | "Loading" | `loading` |
| `save` | "Saving" | `saving` |
| `remove` | "Remove": take it out of a list, the thing itself stays | `remove` |
| `delete` | "Delete": destroy it for good | `delete` |

- **A word** is a part of the name between `_`, or starting with a capital letter: `get_handle` and `getHandle` go to
  "Getters", `budget` doesn't.
- **If several lists match**, the function goes to the first in this order.
- **What's left out.** Functions from `groups`, `_` functions and `__` functions don't go into these lists. Empty lists
  aren't shown.

Your own words and lists:

```lua
-- For one module: the debug.categories option (see above)

-- For all modules: in any file that loads before the menu is opened
local modules_menu = Atdar.menu.modules
modules_menu.add_category("getters", { "find", "fetch" })        -- more words for "Getters"
modules_menu.add_category("checks", { "has", "can" })            -- and for "Checks"
modules_menu.add_category("shop", { "buy", "sell" }, "Shop")     -- a new list at the end
```

`add_category(key, words, name)`: if there's no list with that `key`, it's created (named `name`, otherwise the `key`
itself); if there is one, the words are added to it, and `name`, when given, changes its name.

## A module's translations

A module's strings live in its own folder, not in the script's shared language files:

```
modules/VehicleManager/
├── VehicleManager.pluto
└── language/
    ├── en-us.json      { "wreck": "Vehicle %s can't be driven" }
    └── ru-ru.json      { "wreck": "На машине %s нельзя ехать" }
```

```lua
self.log:warn(self:text("wreck", "Vehicle %s can't be driven"):format(handle))   -- text
node:action(self:label("park", "Park"), ...)                                     -- a label for a menu item
```

- **The keys are its own.** A module's `wreck` doesn't clash with the script's strings or another module's `wreck`.
- **English fallback.** The second argument shows while there's no file or key. A module without a folder (made in
  code) just keeps it.
- **The language** is the script's. The files are read on the first `self:text` / `self:label`, and "Reload" reads them
  again.
- **Staying safe.** A module's `language` folder is in `lib` (the copy Stand runs): `build.py sync` copies it along with
  the module.

## Rules

- `name` is unique among all modules. A repeated name is an error when the file loads.
- Override only the hooks `on_start`, `on_stop`, `on_tick`. Don't touch the `start`, `stop`, `tick` methods.
- Set `skip_first_tick = true` when `on_tick` needs game natives that may not be ready during startup. The first tick
  after each start or restart is then skipped; the module resumes ticking on the following frame.
- An error in a hook doesn't bring the script down: the module gets the "error" status, and the error's text is in its
  tooltip in the "Modules" menu.
- Don't call `notify` in `on_tick` without a check: the notification would appear 60 times a second.
- Get another module with `self:get(name)` inside hooks, not at the top of the file.
- Write return types on functions (`function get(): int`): the menu shows them.
- Name helper functions with `_`: in the menu they're kept apart, at the bottom under "Internal Functions". With `__`,
  even lower, under "Private Functions". `__construct` and metamethods (`__index`, `__tostring`...) aren't shown.
- Don't name functions like `Module`'s methods: `get`, `start`, `stop`, `tick`, `fail`, `folder`, `json_file`,
  `is_running`, `has_tick`. Such a function would override the method and wouldn't be in the menu.
- Inside `$"..."` use single quotes: `$"module '{self.name}'"`. A double quote ends the string.
- Don't name a local variable after a function's parameter: it shadows the parameter, which then becomes `nil`.
