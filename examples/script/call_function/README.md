# Call Function examples

**English** | [Русский](README.ru.md)

Calling the script's functions by hand from Stand's menu: Debug > Call Function, and the Function Call list of a module
in Settings > Debug > Modules. Both are visible in debug mode.

| File | What it shows |
|---|---|
| `01_by_hand.pluto` | A code file of your own and calling it in Call A Function: the Function Name's rules, a field per typed parameter, strict checks, the results |
| `02_arguments.pluto` | Arguments in detail: a vector, a call inside an argument, `#1` and `#1(>1)` in the brackets, the commands `asstr`, `asint`, `allasstr()`, `astext`, `allastext()`; runs as a script and logs what the fields give |
| `03_module_functions.pluto` | A module with functions of every kind of parameter, in the Modules list and in Call Function: the Call field, Add |

## Running them

1. `01_by_hand.pluto` is a code file for `Atdar.user_script`. Copy it to `store/AnitaDarin/core/call_function/demo.pluto`,
   or write it in Debug > Files Editor > User Code (Create File `demo`, then Add Line for each line). Its functions are
   then `Atdar.user_script.demo.add` and the rest.
2. `02_arguments.pluto` is a plain script like [basics/07](../basics/07_parsers_and_colors.pluto): paste its lines into a
   module's `on_start` and read the log. It only reads and changes nothing in the game.
3. `03_module_functions.pluto` is a module: copy it to `src/lib/AnitaDarin/modules/` together with its manifest
   `03_module_functions.info.json`, as the files of [modules/](../modules/README.md). Then `python build.py sync` and
   restart the script.

## 1. Call A Function: the Function Name

Debug > Call Function > Call A Function. Type a name in **Function Name**; what happens depends on how it ends:

| You type | What happens |
|---|---|
| `Atdar.user_script.demo.add(5)` | The function is called. A function is called **only** when it is written with brackets |
| `Atdar.user_script.demo.add` | Not called, only read: the **Parameters (2)** list shows each parameter with its type and default (or "No default value"), and **Returns:** the return type |
| `Atdar.user_script.demo.total` | A variable: its value is on the **Variable** line |
| `Atdar.user_script.demo{}` | A table is opened in the **Value** list only with `{}` at the end: its tables are lists, its functions can be called, its values can be typed over |
| `Atdar.user_script.demo` | Without `{}` the table is only looked at: its functions can't be called and its values can't be typed over |
| `toast()` | A short name: the last part of the path (`util.toast`). With Use Short Names on, a name of `user/call_function/short_names.json` (`{"ped": "PLAYER.PLAYER_PED_ID"}`) is looked at first, then the script's functions, then Stand's |
| `VehicleManager:get()` | A colon calls the function as a method of the module |

Writing `{}` after a function or brackets after a table is told: "is a function: {} is not needed", "is a table: brackets
are only for functions". Pick Function, under the Function Name, takes a name from a list (your short names, the
registry, a module's functions): a function picked is written with its brackets.

A function whose parameters carry types gets a field per parameter. With `function add(amount: int, note: ?string = "x"): int`
the **Arguments** list under the Function Name has two fields, one per parameter, and the arguments written in the
brackets go to them: `add(5, more)` fills Number with `5` and Text with `more`. What's typed in a field is read as
Lua: `5`, `true`, `v3.new(1, 2, 3)`, calls. A Text field is the exception: its text is taken as it is, without quotes.

| Parameter in the code | Field | Starts with |
|---|---|---|
| `int` | Number | the default of the code, else `0` |
| `float`, `number` | Float Number | the default of the code, else `0` |
| `bool` | Boolean | the default of the code, else `false` |
| `string` | Text | the default of the code, else empty |
| `vector3` | 3D Vector | the default of the code, else `0, 0, 0` |
| `table` | Table | the default of the code, else empty |
| `?type` | as the type says | the default of the code, else empty: not given |
| no type, `int\|string` | Argument * | empty: not given |

The checks are strict, so a mistake is told before the function runs:

- **Boolean:** only `true` or `false` (or a call). A word like `yes`, a number or a text in quotes is "true or false is needed".
- **Number:** a whole number or a call that gives one: `five`, `"5"` and `2.5` are "a whole number is needed". A Float Number
  takes `2.5`; `five` is "a number is needed".
- **Required:** a parameter written without `?` and with no default (a Text, a Table) must be given: "the argument is required".
- **Too many:** more arguments in the brackets than the function has parameters is "(amount, note) takes 2 argument(s), got 3".
- **Brackets and quotes** that aren't closed are told too, and so is a name written as a call that is nothing (`asstrr(#1)`):
  "'asstrr' is not known: it is no function, command or short name". An empty field is not given, and its default in the code applies.

The results:

- **Variable: ...** is what the function gave. A notice says "name: done" (or "name: empty (nil)", "name: error: ..." and so on).
- **Value (N)** is there when it gave a table: the entries as lists and fields.
- **Table Depth** is how many levels of nested tables open in the Value list; deeper ones are a `{...}` line. Keep it small on big
  tables (`Atdar{}` makes a great many items).
- **Copy Result** and **Log Result** put the whole result in the clipboard or the log.

Other fields of the same list: **Call After Typing Function** calls as soon as the name is typed, **Call** calls (with a
number of milliseconds picked it is "Call After"), **Loop** and **Loop With Interval** call again and again.

## 2. Arguments in detail

`02_arguments.pluto` calls the same code as the fields do and logs what comes out; the notes below are what to try in the menu.

**Vectors.** A `vector3` parameter is a list named "3D Vector: 1, 2, 3" with the whole vector (**Expression**), then **x**,
**y** and **z** fields. The whole vector can be three numbers, `v3.new(1, 2, 3)` or a call that gives a vector:

```
Atdar.natives.entity.get_coords(user_ped())
```

Then the list shows "Expression: get_coords(...)" with the fields of the call's own arguments, and a "Values: ..." line with the
vector it gives. An axis can be a call too (`1, 2, math.floor(3.7)`): it stays as written, the Values line shows what it gives.

**Calls inside arguments.** A field takes a call, not only a value: `entities.get_user_vehicle_as_handle()` in a Number field.
A call is always written with its brackets, `user_ped()`: a word without them is text. A call of a function whose
parameters are known (`Atdar.natives.entity.get_coords(user_ped())`) becomes a list of its own, with a field per argument.

**`#N` in the brackets.** The brackets of the Function Name (and the Call field below) say what the call is made of:

| Brackets | Meaning |
|---|---|
| `shout(#1, #2)` | The fields 1 and 2, in this order. This is what the Function Name shows by itself while you type in the fields. Typed in the brackets as `shout(hi, true)`, the arguments go to the fields and the brackets become `#1, #2` |
| `is_between(#3, #1, #2)` | The same fields in another order |
| `util.toast(tostring(#1))` | A call with the value of the field 1 as its argument |
| `util.toast(#1(>1))` | The field 1 holds a call (`user_ped()` for example), and `>1` says its argument 1 is filled |
| `add(#3)` | There is no field 3: "#3: there is no such argument (the function has 2)" |

Taking `#1` out of the brackets clears the field 1; arguments typed in the brackets (`add(5)`) go to the fields.

**The commands**, written in the brackets only (they are not functions of the script):

| Command | What it does |
|---|---|
| `asstr(#1, #2)` | Each argument as text; the function is called with the texts: `util.toast(asstr(#1))` with `user_ped()` in the field toasts the handle as text |
| `asint(#1)` | Each argument as a whole number; one that can't be is told: "abc can't be made a whole number" |
| `allasstr()` | Every parameter of the function as text, without writing `#N`, with a notice of them, then the function is called |
| `allasint()` | The same with whole numbers; what isn't a number goes as it is |
| `astext(#1)` | Calls nothing: a notice with the function's name and each parameter with what is in its field |
| `allastext()` | The same for every parameter, without `#N` |

The notice of the last four reads `util.toast(text = hi, bitflags = nil): void`: each parameter, what is typed in its field
(and what a call there gives, `text = user_ped(): 123`), then the return type. They go to Stand's notifications with Notice
In Stand on.

## 3. A module's functions

`03_module_functions.pluto` is the module `ExampleShop`. Settings > Debug > Modules > ExampleShop > Function Call lists its
functions (the `set_` ones under Setters, unless "Disable Function Categories" is on). Each function is a list with
**Arguments**, then **Call** and the rest of the settings.

| Function | Its field |
|---|---|
| `set_speed(speed: float = 1.5)` | Float Number, starts with `1.5` |
| `set_open(on: bool)` | Boolean |
| `set_caption(text: string)` | Text |
| `move_to(position: vector3)` | 3D Vector: whole, x, y, z |
| `sum(values: table)` | Table: `1, 2, 3` in the field, or an expression that gives a table |
| `tag(name: string, note: ?string = "none")` | Text and an optional Text |
| `count()` | none: no Arguments list, Call calls it |

A function that has parameters also has the **Call Template** field above Arguments: its name with the brackets, with the same
rules as the Function Name of Call A Function (the brackets, `#1(>1)`, the commands). Typing in it fills the fields, typing in the
fields writes it. The arguments in the brackets are cut at the commas, one per parameter, so a table or a vector is one
argument: `sum({1, 2, 3})` fills the Table field, `move_to(v3.new(1, 2, 3))` the 3D Vector, `tag(shop)` the Text.

The same function in Call Function:

- Type `ExampleShop:sum({1, 2, 3})` in Call A Function > Function Name (the colon: the module is the owner of the method). The
  module's id has no dot on purpose: a name with a dot couldn't be told from a path of tables.
- Or put it in the list: Debug > Call Function > Functions > **Add** `ExampleShop:sum`. The function appears as "1: sum(values): number"
  with its own fields, Call Template and Call; one that takes nothing, `ExampleShop:count`, is a button. **Clear** takes one out
  by its number, **Save Functions** keeps the list for the next start (the paths only, not what's typed in the fields).

## Rules

- A function is called only with brackets, a table is opened only with `{}`: that's what the Function Name and the Call field both follow.
- Write types on the parameters (`amount: int`): without them the field is "Argument *" and nothing is checked.
- Don't name a module's field like the Module's own (`enabled`, `label`, `text`, `name`...): `ExampleShop` keeps its state in `open` and `caption`.
- Keep a module's id one word when it will be typed in a path.
