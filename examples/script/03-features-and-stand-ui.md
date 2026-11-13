# Урок 3. Фичи и построение меню Stand

**Фича** — то, что пользователь включает, выключает или нажимает в меню: бессмертие, лечение, бесконечная
выносливость. В отличие от модуля, её запускает не скрипт, а пункт меню. При этом сама фича о меню ничего не
знает: пункт для неё создаёт файл меню. Такое разделение и есть главная идея этого урока.

Файлы:

- [features/feature.pluto](../../src/lib/AnitaDarin/features/feature.pluto) — класс `Feature`;
- [features/registry.pluto](../../src/lib/AnitaDarin/features/registry.pluto) — реестр `Atdar.features`;
- [ui/stand/core/menu_node.pluto](../../src/lib/AnitaDarin/ui/stand/core/menu_node.pluto) — `MenuNode`, один
  способ делать пункты меню;
- [ui/stand/core/menu_item.pluto](../../src/lib/AnitaDarin/ui/stand/core/menu_item.pluto) — `MenuItem`, готовый
  пункт, который можно менять.

## Три вида фич

| `kind` | Пункт в меню | Обязательный хук | Пример |
|---|---|---|---|
| `action` | кнопка | `on_trigger` | [features/01_action.pluto](features/01_action.pluto) |
| `toggle` | галочка | — | [features/02_toggle.pluto](features/02_toggle.pluto) |
| `loop` | галочка с циклом | `on_tick` | [features/03_loop.pluto](features/03_loop.pluto) |

Таблица видов лежит в самом `Feature`, и по ней же проверяются опции:

```pluto
-- Valid kinds and the hook each can't work without (from opts or a subclass override)
local KINDS = {
    loop = { requires = "on_tick" },
    toggle = {},
    action = { requires = "on_trigger" },
}
```

`loop` без `on_tick` или `action` без `on_trigger` — ошибка при создании, а не молчаливо неработающий пункт.

### Действие

```pluto
local Feature = Atdar.loader.load("features/feature")

return Atdar.features.add(new Feature({
    -- The id the menu finds it by: Atdar.features.get("example.heal"). Unique, "section.name" by habit
    id = "example.heal",
    kind = "action",

    on_trigger = function(self)
        local entity = Atdar.natives.entity
        entity.set_health(Atdar.natives.player.get_ped_id())   -- no value: the maximum
    end,
}))
```

`on_trigger` может ждать (`util.yield`). Повторное нажатие, пока действие ещё идёт, игнорируется — за это
отвечает запечатанный метод `trigger`:

```pluto
function trigger()
    if self.triggered then
        return -- still running from the previous click
    end
    
    self.triggered = true
    self:call_hook("on_trigger")
    self.triggered = false
end
```

### Переключатель и возврат состояния

```pluto
return Atdar.features.add(new Feature({
    id = "example.no_wanted",
    kind = "toggle",

    on_save_state = function(self)
        self.saved_max = Atdar.natives.player.wanted_level.get_max()
    end,

    on_enable = function(self)
        Atdar.natives.player.wanted_level.set_max_wanted_level(0)
    end,

    on_load_state = function(self)
        Atdar.natives.player.wanted_level.set_max_wanted_level(self.saved_max or 5)
    end,
}))
```

Порядок хуков задают `enable` и `disable`:

```pluto
function enable(): void
    if self.enabled then
        return
    end
    self:call_hook("save_state")
    self.enabled = true
    self:call_hook("on_enable")
end
...
function disable(): void

    -- Switching off also clears a failure, so switching on again tries anew
    self.error = nil
    if !self.enabled then
        return
    end
    self.enabled = false
    self:call_hook("on_disable")
    self:call_hook("load_state")
end
```

Включение: `on_save_state` → `on_enable`. Выключение: `on_disable` → `on_load_state`. Запомните состояние игры
до включения и верните его после выключения — тогда фича не оставляет следов.

### Цикл

```pluto
return Atdar.features.add(new Feature({
    id = "example.infinite_stamina",
    kind = "loop",

    on_tick = function(self)
        Atdar.natives.player.movement.reset_sprint_stamina(Atdar.natives.player.get_id())
    end,
}))
```

`on_tick` выполняется каждый кадр, пока галочка стоит. Это для того, что игра сбрасывает сама. Метод `tick`
при первом кадре включает фичу (со всем сохранением состояния), а после ошибки не запускает хук заново:

```pluto
function tick()

    -- Failed and not switched off yet: don't start again on the next frame
    if self.error then
        return
    end
    if !self.enabled then
        self:enable()
    end
    self:call_hook("on_tick")
end
```

### Ошибка в хуке выключает фичу

Сломанный `on_tick` иначе падал бы и показывал уведомление каждый кадр. Вместо этого:

```pluto
private function fail(name: string, err): void

    -- A failure in the cleanup itself is only logged: disabling again from here would loop
    local cleanup = name == "on_disable" or name == "load_state"

    if cleanup or not self.enabled then
        log:error($"{self.id}: {name} failed\n{err}")
        return
    end

    log:error($"{self.id}: {name} failed, switched off\n{err}")

    -- on_disable and load_state undo what the feature did before it broke
    self:disable()

    -- After disable(), which clears it
    self.error = $"{name}: {err}"
    if self.failure_handler then
        pcall(self.failure_handler)
    end
end
```

Ошибка показывается один раз, фича выключается с возвратом состояния, а `failure_handler` (его ставит меню)
снимает галочку.

## Реестр фич

Файл фичи, как и файл модуля, регистрирует себя сам: `return Atdar.features.add(...)`. Реестр маленький
([features/registry.pluto](../../src/lib/AnitaDarin/features/registry.pluto)):

```pluto
function module.add(feature: table): table
    local id = feature.id
    if features[id] then
        error($"[Registry] feature '{id}' is already registered")
    end
    features[id] = feature
    return feature
end
```

Ещё в нём `get(id)` (ошибка для неизвестного id), `has(id)`, `remove(id)` (сначала выключает фичу) и `ids()`.
И одна важная страховка — остановленный скрипт не оставляет эффектов:

```pluto
-- A stopped script leaves no effect behind: every feature still on is switched off (its on_disable undoes it).
-- Registered once, the registry is loaded once
util.on_stop(function()
    for _, feature in pairs(features) do
        pcall(feature.disable, feature)
    end
end)
```

## Lua vs Pluto: сырой Stand API против `MenuNode`

На API Stand напрямую галочка с циклом пишется так:

```lua
menu.toggle_loop(menu.my_root(), "Infinite Stamina", { "infstamina" }, "", function()
    PLAYER.RESET_PLAYER_STAMINA(PLAYER.PLAYER_ID())
end, function()
    -- switched off
end)
```

Логика, пункт меню, имя и команда слеплены в одно. В StandFrame фича живёт в своём файле (выше), а меню
подключает её одной строкой ([menu/features.pluto](menu/features.pluto)):

```pluto
self_menu:add_feature(features.get("example.infinite_stamina"), "Infinite Stamina", { "infstamina" })
```

`add_feature` сам выбирает пункт Stand по виду фичи:

```pluto
local ITEM_FOR_KIND = {

    loop = function(handle, feature: table, name: string|int, commands: table, help: string|int)
        return menu.toggle_loop(handle, name, commands, help,
            function() feature:tick() end,
            function() feature:disable() end)
    end,

    toggle = function(handle, feature: table, name: string|int, commands: table, help: string|int)
        return menu.toggle(handle, name, commands, help, function(on)
            if on then
                feature:enable()
            else
                feature:disable()
            end
        end)
    end,

    action = function(handle, feature: table, name: string|int, commands: table, help: string|int)
        return menu.action(handle, name, commands, help,
            function() feature:trigger() end)
    end,

}
```

Сразу под таблицей стоит проверка: если в `Feature.KINDS` добавят вид без пункта меню, файл не загрузится с
понятной ошибкой, а не сломается позже на первой такой фиче.

## `MenuNode`: один слой над меню Stand

Правило проекта: функции `menu.*` Stand вызывает только код в `ui/stand/core`. Файлы меню работают с
`MenuNode` — обёрткой списка, которая делает пункты и **помнит** их. Память нужна, чтобы при перестройке или
выгрузке меню переименовать команды, выключить галочки и удалить пункты.

### Пункты

Каждый метод принимает таблицу опций и возвращает `MenuItem` ([menu/options.pluto](menu/options.pluto)):

```pluto
local list = node:list({ name = "Options", commands = { "options" }, help = "Items made with a table of options" })

list:action({ name = "Say Hello", commands = { "optionshello" }, help = "Shows a notification",
    on_click = function()
        log:notify("hello")
    end })

list:toggle({ name = "A Switch", default = true, on_change = function(on)
    log:info($"switched {on ? 'on' : 'off'}")
end })

list:slider({ name = "Volume", min = 0, max = 100, default = 50, step = 5, on_change = function(value)
    log:info($"volume {value}")
end })
```

Методы-пункты: `list`, `divider`, `readonly`, `readonly_name`, `hyperlink`, `action`, `toggle`, `list_action`,
`text_input`, `slider`, `click_slider`, `color`, `text_slider`, `spoiler`, `confirm` и `add_feature`.

Общие опции (из шапки `menu_node.pluto`):

| Опция | Что делает |
|---|---|
| `name`, `help` | текст или метка Stand |
| `key` | вместо `name` и `help`: строки `<scope>.<key>.name` и `<scope>.<key>.help` из языковых файлов |
| `commands` | базовые имена команд; префикс из профиля добавляется сам |
| `user_only` | обработчик срабатывает только на действия пользователя |
| `warning` | функция, дающая текст: Stand спросит подтверждение перед обработчиком |
| `profile` | пункт показывает и записывает значение профиля |
| `caption`, `help_from`, `shown_when`, `value_from` | функции, за которыми пункт следит |

Старая позиционная форма (`node:action(name, on_click, commands, help)`) тоже работает — ею пользуются пакеты
меню.

`node:scope("profile")` возвращает тот же узел, у которого все `key` лежат под префиксом. Сделано это одной
строкой через метатаблицу:

```pluto
function scope(prefix: string): table
    return setmetatable({ scope_prefix = prefix }, { __index = self })
end
```

### Как создаётся пункт: `make`

Все пункты проходят через один метод:

```pluto
function make(kind: string, opts: table, create): table

    local item = new MenuItem(nil, self, kind)
    local name, help = texts_of(self, opts)
    local commands = opts.commands or {}
    ...
    local handler = handler_for(item, opts[HANDLER_OF[kind]], opts)

    if opts.full_commands then
        item.ref = create(self.handle, name, commands, help, handler)
        self:keep(item, name, {})
    else
        item.ref = create(self.handle, name, Commands.names(commands), help, handler)
        self:keep(item, name, opts.track == false and {} or commands)
    end
    ...
    bind_live(item, opts)

    return item
end
```

1. `texts_of` достаёт имя и подсказку: из `name`/`help` или из строк по `key`;
2. `handler_for` оборачивает обработчик пользователя;
3. `create` — единственное место, где вызывается `menu.*` для этого вида пункта;
4. `keep` запоминает пункт в `self.children` и его команды;
5. `bind_live` подключает «живые» части (`caption`, `shown_when` ...).

### Обёртка обработчика

Stand вызывает обработчик пункта не только по клику: ещё когда восстанавливает профиль и когда значение
меняют из кода. `handler_for` отсекает лишнее:

```pluto
return function(...)

    if item.muted > 0 then
        return
    end

    local count = select("#", ...)
    local click_type = count > 0 and select(count, ...) or nil

    if opts.user_only and not clicks.is_user_action(click_type) then
        return
    end
    ...
    return fn(...)
end
```

`item.muted` поднимает `MenuItem.set_value`: значение, показанное из кода, — не действие пользователя.

```pluto
function methods.set_value(self, value, run_handler: bool = false): bool

    if run_handler then
        return (pcall(menu.set_value, self.ref, value))
    end

    self.muted += 1
    local ok = pcall(menu.set_value, self.ref, value)
    self.muted -= 1

    return ok
end
```

### `MenuItem`: менять пункт после создания

```pluto
local status = node:readonly({ key = "status" })
status:set_value("running")
node:toggle({ key = "debug", on_change = fn }):shown_when(|| -> Atdar.debug)
```

Методы: `valid`, `set_name`, `get_name`, `set_help`, `set_value`, `get_value`, `remove` и «живые» `caption`,
`help_from`, `shown_when`, `value_from`. Каждое изменение идёт через `pcall` и возвращает, получилось ли, поэтому
код с пунктом в руках не падает, если Stand его уже удалил. Примеры: [menu/changing.pluto](menu/changing.pluto).

### Списки, которые строятся при открытии

```pluto
list:list({ name = "Files", fill = function(files_list)
    for _, file in ipairs(files) do
        files_list:action({ name = file, on_click = function()
            log:info($"open {file}")
        end })
    end
end })
```

С опцией `fill` пункты списка создаются, когда его открывают, и удаляются при выходе. Пока в список никто не
смотрит, в меню Stand от него один пункт. Для части списка, которую надо пересобрать, есть
`node:section(fill)` — он возвращает `{ rebuild() }`. Примеры: [menu/dynamic.pluto](menu/dynamic.pluto).

### Удаление и галочки

Удалить галочку `toggle_loop`, пока она включена, нельзя: Stand продолжит её тикать и упадёт с
«CommandRef is not valid». Поэтому узел сначала выключает галочки фич и ждёт пару кадров:

```pluto
function stop_toggles(): void

    local stopped = self:switch_off_toggles()

    if stopped then
        for _ = 1, STOP_TICKS do
            util.yield()
        end
    end
end
```

`clear()` и `delete()` вызывают это сами. Вот зачем `add_feature` складывает пункты фич в `self.toggles`.

## Меню таблицей: `menu_builder`

Файл меню пакета возвращает таблицу с `build(node, ctx)`; главный файл — `main.pluto`
([ui/stand/core/menu_builder.pluto](../../src/lib/AnitaDarin/ui/stand/core/menu_builder.pluto)):

```pluto
function module.build_menu(node: table, dir: string): bool
    local cache = {}
    local ctx = { dir = dir }
    function ctx.load(name: string): ?table
        if cache[name] == nil then
            cache[name] = load_menu_file($"{dir}{name}.pluto") or false
        end
        return cache[name] or nil
    end

    local main = ctx.load("main")
    if not main or type(main.build) ~= "function" then
        log:warn($"{dir}main.pluto must return a table with build(node, ctx)")
        return false
    end
    local ok, err = pcall(main.build, node, ctx)
    ...
end
```

`ctx.load("имя")` подключает соседний файл меню той же папки. Подменю можно описать и таблицей — через
`build_items`:

```pluto
-- { list = "Name", items = {...} }, { feature = "id", name = "Label" }, { divider = "Text" },
-- { readonly = "Name", value = "..." }, { toggle = "Name", on_change = fn }, { slider = "Name", min = 0, max = 10, on_change = fn }...
function module.build_items(node: table, items: table, where: string = "menu"): void
```

Из файла меню она доступна как `Atdar.menu.builder.build_items` ([menu/helpers.pluto](menu/helpers.pluto)).
Каждый элемент проверяется: ровно один тип, все обязательные поля на месте, неизвестные поля — предупреждение
в логе. Опечатка в описании меню не пропадает молча. Про пакеты меню целиком — урок 4.

## Отладчик модулей

Список «Настройки > Отладка > Модули» ([ui/stand/modules/list.pluto](../../src/lib/AnitaDarin/ui/stand/modules/list.pluto))
показывает каждый модуль: статус, зависимости, ошибку, кнопки Start / Restart / Stop / Reload и список функций
модуля, которые можно вызвать руками с аргументами. В настройках скрипта он виден только в режиме отладки.

Откуда он знает функции? Из `Module.functions_of`: методы, которые добавил наследник `Module`, с именами
параметров. Типы параметров и возвращаемого значения читаются из исходника (урок 3 раздела `programing`).
Опция `debug` модуля настраивает показ: подсказки к функциям, группы, скрытые имена
([modules/06_debug_display.pluto](modules/06_debug_display.pluto)).

Тот же список можно вставить в своё меню ([menu/modules_debug.pluto](menu/modules_debug.pluto)):

```pluto
local modules_menu = Atdar.menu.modules

return {
    build = function(node, ctx)
        local dev = node:list("Developer")

        -- The whole Modules list: every module, Refresh, Stop All, Reload Changed, Reload All
        modules_menu.list_in(dev)

        -- One module's list: status, Start / Restart / Stop / Reload, its functions with loops.
        -- nil (and a warning in the log) when there's no such module
        local vehicle_menu = node:list("Vehicle")
        modules_menu.module_in(vehicle_menu, "VehicleManager")
    end,
}
```

Его пункты создаются только пока список открыт — тот самый `fill`.

## Попробуй сам

1. Напишите фичу `kind = "toggle"` с `on_save_state` / `on_load_state`, которая что-нибудь меняет в игре и
   возвращает как было. Проверьте, что после выключения состояние прежнее.

2. Создайте фичу `kind = "loop"` без `on_tick`. Какую ошибку вы получите? Найдите строку `validate_opts`,
   которая её бросает.

3. Добавьте в `on_tick` своей loop-фичи `error("boom")`, включите её в меню. Сколько раз появилась ошибка и что
   стало с галочкой? Проследите путь по коду: `call_hook` → `fail` → `failure_handler`.

4. В файле меню сделайте `toggle` и `readonly`, который показывает его состояние через `value_from`.
   Подсказка: [menu/changing.pluto](menu/changing.pluto).

5. Опишите то же подменю дважды: вызовами `node:list(...)`, `node:action(...)` и таблицей для `build_items`.
   Сделайте в таблице опечатку в имени поля и посмотрите в лог.

Больше примеров: [features/README.ru.md](features/README.ru.md) и [menu/README.ru.md](menu/README.ru.md).

Назад: [Урок 2. Модули и жизненный цикл](02-modules-and-lifecycle.md).
