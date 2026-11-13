# Урок 2. Модули и жизненный цикл

**Модуль** — внутренняя часть скрипта, которую запускает сам скрипт, а не пользователь: у модуля нет пункта
меню. Модуль может зависеть от других модулей, тикать каждый кадр и перезагружаться из файла без перезапуска
скрипта. То, что пользователь включает и выключает в меню, — это фича (урок 3).

Два файла, о которых этот урок:

- [core/module.pluto](../../src/lib/AnitaDarin/core/module.pluto) — класс `Module`: один модуль и его хуки;
- [core/module_manager.pluto](../../src/lib/AnitaDarin/core/module_manager.pluto) — менеджер `Atdar.modules`:
  порядок запуска, тики, остановка, перезагрузка.

## Два способа написать модуль

**Таблицей опций** — для модуля, которому хватает хуков
([modules/01_basic.pluto](modules/01_basic.pluto)):

```pluto
local Module = Atdar.loader.load("core/module")

return Atdar.modules.add(new Module({
    name = "example.basic",

    -- Once, when the script starts (after the modules in deps)
    on_start = function(self)
        -- self.log: a logger tagged with the module's name
        self.log:notify($"'{self.name}' started")
    end,

    -- Once, when the script stops or the module is stopped from the Modules menu
    on_stop = function(self)
        self.log:notify($"'{self.name}' stopped")
    end,
}))
```

**Классом** — для модуля со своим состоянием и функциями ([modules/04_deps.pluto](modules/04_deps.pluto)):

```pluto
local class Reporter extends Module
    function __construct()
        parent:__construct({
            name = "example.reporter",
            deps = { "example.clock" },
        })
        self.next_report = 0
    end

    function on_start()
        self.next_report = util.current_time_millis() + INTERVAL_MS
    end
    ...
end

return Atdar.modules.add(new Reporter())
```

Опции модуля: `name` (у модуля из файла это `id` его манифеста, можно не писать), `deps`, хуки `on_start` / `on_stop` / `on_tick`,
`skip_first_tick` и `debug` (как модуль показан в меню отладки). Неизвестная опция — ошибка при создании:
конструктор проверяет таблицу через `core/check`.

### Lua vs Pluto

В обычном Lua такой «сервис» обычно пишут как таблицу с функциями и вручную следят, чтобы никто не заменил
служебные методы:

```lua
local Reporter = setmetatable({}, { __index = Module })
Reporter.__index = Reporter

function Reporter.new()
    local self = Module.new({ name = "example.reporter", deps = { "example.clock" } })
    return setmetatable(self, Reporter)
end

function Reporter:on_start()
    self.next_report = util.current_time_millis() + INTERVAL_MS
end
```

В Pluto это `class ... extends Module` и `parent:__construct(...)`. А от замены служебных методов защищает сам
конструктор `Module`: `start`, `stop`, `tick`, `fail`, `is_running` и `has_tick` «запечатаны», и наследник,
который их переопределил, получит ошибку `must not override tick()`. Переопределяются только хуки `on_*`.

## Регистрация: манифест и ленивая загрузка

Менеджер ищет модули по манифестам: `info.json` в папке модуля или `<имя>.info.json` рядом с одиночным файлом
(поля и раскладки описаны в [modules/README.ru.md](modules/README.ru.md)). `load_dir` только читает манифесты:
код модулей при этом не исполняется. Для каждого манифеста создаётся заготовка, `Module` с данными из манифеста
и `loaded = false`:

```pluto
local stand_in = new Module({ name = id })

stand_in.loaded = false
stand_in:_apply_manifest(manifest)
```

Файл модуля запускается при первом старте модуля и заканчивается строкой `return Atdar.modules.add(...)`.
Пока файл выполняется, менеджер помнит его манифест (`loading`), и `add` ставит настоящий модуль на место заготовки:

```pluto
if manifest ~= nil then
    mod:_apply_manifest(manifest)
    mod.system = is_system_manifest(manifest)
end

if current ~= nil then
    replace(current, mod)
    return mod
end
```

Менеджер хранит модуль по имени (`by_name`), порядок регистрации (`order`), файл точки входа (`files`) и манифест
(`manifests`): последние два нужны для перезагрузки.

Сломанный манифест (битый JSON, неверное поле, нет файла точки входа, занятый `id`) не мешает остальным: ошибка
пишется в лог, модуль пропускается. Файл, который упал при запуске, оставляет заготовку в статусе `failed`
с причиной в `mod.error`.

## Статусы

У модуля четыре статуса, они хранятся в `mod.status`:

```text
registered ──start()──> running ──stop()──> stopped
     │                     │
     └──── fail(reason) ───┴──> failed      (reason in mod.error)
```

`failed` — тупик до явной команды: такой модуль не запускается и не тикает. `start_module(name)` даёт ему ещё
одну попытку, сбрасывая статус в `registered`.

## Запуск по зависимостям

`deps = { "example.clock" }` значит «запусти меня после `example.clock`». Порядок файлов в папке роли не
играет: менеджер сначала запускает зависимости, рекурсивно.

```pluto
local function start_one(mod: table, chain: table): bool
    if mod.status == "running" then
        return true
    end

    if mod.status == "failed" then
        return false
    end

    for i, name in ipairs(chain) do
        if name == mod.name then
            ...
            log:error($"dependency cycle: {table.concat(cycle, ' -> ')}")
            return false
        end
    end

    table.insert(chain, mod.name)
    for _, dep in ipairs(mod.deps) do

        local dep_mod = by_name[dep]

        if not dep_mod then
            mod:fail($"needs module '{dep}', which isn't registered")
        elseif not start_one(dep_mod, chain) then
            mod:fail($"needs module '{dep}', which didn't start")
        end

        if mod.status == "failed" then
            table.remove(chain)
            return false
        end
    end
    table.remove(chain)

    if not mod:start() then
        return false
    end
    table.insert(started, mod)
    return true
end
```

Что здесь происходит:

- `chain` — имена модулей, которые запускаются прямо сейчас. Имя, встреченное второй раз, означает цикл
  зависимостей (`a -> b -> a`); он пишется в лог целиком.
- Нет зависимости или она не запустилась — модуль помечается `failed` с понятной причиной. Остальные модули
  при этом запускаются.
- Успешно запущенный модуль попадает в `started`. Это **порядок запуска**, и он важен дальше.

Сам `Module.start` вызывает хук `on_start` через `call_hook`, который ловит ошибку:

```pluto
function start(): bool
    ...
    self.error = nil
    self._skip_tick = self.skip_first_tick
    self._ticks = self:has_tick()

    if not self:call_hook("on_start") then
        return false
    end

    self.status = "running"
    self.log:debug("started")

    return true
end
```

## Тики

Модуль с хуком `on_tick` вызывается каждый кадр. На все модули один обработчик Stand, он создаётся при первом
запуске:

```pluto
util.create_tick_handler(function()
    for _, mod in ipairs(started) do
        -- Fields, not is_running() and has_tick(): this runs for every module every frame
        if mod.status == "running" and mod._ticks then
            mod:tick()
        end
    end
    return true
end)
```

Три детали:

1. **Модуль без `on_tick` ничего не стоит.** `has_tick()` сравнивает хук с пустой заготовкой базового класса
   (`self.on_tick ~= Module.on_tick`), результат запоминается в `_ticks` при запуске.
2. **`skip_first_tick = true`** пропускает первый тик после каждого запуска. Stand выполняет первый тик сразу,
   пока скрипт ещё стартует, а нативы игры могут быть ещё не готовы.
3. **Ошибка в тике останавливает модуль, а не повторяется каждый кадр:**

   ```pluto
   if not self:call_hook("on_tick") then
       -- Cleanup, so a module that broke mid-tick doesn't leave its effects behind
       pcall(self.on_stop, self)
   end
   ```

   `call_hook` помечает модуль `failed`, а `on_stop` убирает за ним то, что он успел сделать.

Правило для своего `on_tick`: он должен быть дешёвым. Если работа нужна раз в несколько секунд, сравнивайте
время и выходите сразу, как `Reporter` из примера:

```pluto
function on_tick()
    local now = util.current_time_millis()
    if now < self.next_report then
        return
    end
    self.next_report = now + INTERVAL_MS
    ...
end
```

## Остановка и индекс `dependents`

При остановке скрипта модули останавливаются в **обратном** порядке запуска: модуль запускался после своих
зависимостей, значит, должен остановиться раньше них.

```pluto
function module.stop(): void
    for i = #started, 1, -1 do
        started[i]:stop()
    end
    started = {}
end
```

Сложнее остановить **один** модуль: сначала нужно остановить всех, кому он нужен. Чтобы не перебирать каждый
раз все модули, менеджер держит обратный индекс — «кто от кого зависит»:

```pluto
-- Dep name -> set of the modules that need it directly: { [dep] = { [module name] = true } }.
-- Kept up to date by add/unregister/register_at, so dependents_of doesn't scan every module
local dependents = {}

-- Adds the module to the dependents index
local function index_deps(mod: table): void
    for _, dep in ipairs(mod.deps) do
        dependents[dep] ??= {}
        dependents[dep][mod.name] = true
    end
end
```

`dependents_of(name)` идёт по этому индексу вглубь и собирает всех зависимых, прямых и через другие модули.
Дальше `stop_module` проходит порядок запуска с конца:

```pluto
function module.stop_module(name: string): void

    local to_stop = dependents_of(name)
    to_stop[module.get(name).name] = true

    -- Backwards: a module started after its deps, so it stops before them
    for i = #started, 1, -1 do
        local mod = started[i]
        if to_stop[mod.name] then
            mod:stop()
            table.remove(started, i)
        end
    end
end
```

## Горячая перезагрузка

«Перезагрузить» в «Настройки > Отладка > Модули» выполняет файл модуля заново, и новый код начинает работать
без перезапуска скрипта. Это `reload_module`:

```pluto
function module.reload_module(name: string): bool

    local old = module.get(name)
    local path = files[name]
    ...
    -- Dependents that were running, to start them again once the module is back
    local restart = {}
    for dep_name in pairs(dependents_of(name)) do
        if by_name[dep_name]:is_running() then
            table.insert(restart, dep_name)
        end
    end

    module.stop_module(name)
    local index = unregister(old)

    local ok = run_file(path)
    local fresh = by_name[name]
    local reloaded = ok and fresh ~= nil
    if not reloaded then
        ...
        log:warn($"'{name}' not reloaded, the old version is back")
        register_at(old, index, path)
    else
        -- The file registered it at the end; move it back to where it was
        unregister(fresh)
        register_at(fresh, index, path)
        log:info($"'{name}' reloaded from {path}")
    end

    local running = module.start_module(name)

    for _, dep_name in ipairs(restart) do
        module.start_module(dep_name)
    end
    
    return reloaded and running
end
```

По шагам:

1. запомнить зависимые модули, которые работали;
2. остановить модуль (и зависимых — через `stop_module`), убрать его из реестра;
3. выполнить файл заново: он сам зарегистрирует новый экземпляр;
4. если новый код не загрузился — вернуть старый модуль на его место. Скрипт не остаётся без модуля из-за
   опечатки;
5. запустить модуль и поднять обратно зависимых.

Ограничение, сказанное в комментарии над функцией: перечитывается только файл самого модуля. Файлы библиотеки,
которые он подключает, остаются прежними — их кеширует `require`.

### Как не потерять состояние

Перезагрузка создаёт новый экземпляр, и поля старого пропадают. Чтобы передать данные следующему экземпляру,
есть пара функций:

```pluto
-- Keeps data for the module's next instance: its on_stop hands over what Reload (a new instance from its
-- file) should keep. Lives as long as the script runs; a new start of the script begins without any
function module.hand_over(name: string, data: table): void
    handed[name] = data
end

-- What the module's last instance handed over, taken once (its __construct)
function module.take_over(name: string): ?table

    local data = handed[name]

    handed[name] = nil
    return data
end
```

Старый экземпляр в `on_stop` вызывает `Atdar.modules.hand_over(self.name, { ... })`, новый в конструкторе
забирает данные через `take_over`.

### Изменился ли файл

Кнопка «Перезагрузить изменённые» спрашивает `file_changed(name)`: отличается ли файл от текста, из которого
загружен работающий код. Сначала сравнивается штамп файла (время записи и размер), и только если он другой,
файл читается и сравнивается текст. Файл, записанный заново с тем же текстом (сборка, синхронизация),
изменённым не считается.

`load_new()` подхватывает файлы, появившиеся в папке модулей после старта, и запускает модули из них.

## `core/file_watch`: остановка при изменении файлов

[core/file_watch.pluto](../../src/lib/AnitaDarin/core/file_watch.pluto) — не перезагрузка, а её
противоположность: при настройке профиля Stop After Changes («Завершать после изменений») скрипт **останавливается**, когда его файлы
изменились на диске. Это режим разработки: `build.py` скопировал новую версию — скрипт остановился, его
запускают заново вручную.

Как он устроен:

- раз в секунду (`CHECK_MS`) сравнивает штампы известных файлов: время записи и размер;
- раз в пять секунд (`RESCAN_MS`) перечитывает папку целиком, чтобы заметить новые файлы;
- останавливает скрипт только после двух секунд тишины (`QUIET_MS`). Сборка копирует много файлов, и остановка
  на первом из них запустила бы скрипт на наполовину скопированной версии.

```pluto
-- Still changing: wait, and compare with the files as they are now
if changed ~= nil then
    snapshot = current
    pending = pending or changed
    last_change = now
    return false
end

if pending == nil or now - last_change < QUIET_MS then
    return false
end

stop_for(pending)
```

Итого у разработчика два инструмента: «Перезагрузить» для одного модуля и Stop After Changes для всего скрипта.

## Попробуй сам

1. Скопируйте [modules/01_basic.pluto](modules/01_basic.pluto) в `src/lib/AnitaDarin/modules/`, выполните
   `python build.py sync` и перезапустите скрипт. Найдите модуль в «Настройки > Отладка > Модули» (нужен режим
   отладки в профиле).

2. Сделайте два модуля с `deps` друг на друга (`a` нужен `b`, `b` нужен `a`). Что будет в логе и в каком статусе
   окажутся оба? Найдите строку `start_one`, которая это решает.

3. Добавьте модулю `on_tick`, который каждые 2 секунды пишет `self.log:info(...)`. Затем добавьте в него
   `error("boom")` и посмотрите, сколько раз ошибка появится в логе и каким станет статус модуля.

4. Поменяйте текст сообщения в файле модуля в папке Stand и нажмите «Перезагрузить». Затем сломайте синтаксис
   файла и нажмите ещё раз. Какая версия модуля работает после неудачной перезагрузки?

5. Сделайте модуль-счётчик с полем `self.count`, который переживает «Перезагрузить»: `on_stop` отдаёт значение
   через `Atdar.modules.hand_over`, конструктор забирает через `take_over`.

Больше примеров с пояснениями — в [modules/README.ru.md](modules/README.ru.md).

Дальше: [Урок 3. Фичи и построение меню Stand](03-features-and-stand-ui.md).
Назад: [Урок 1. Точка входа и архитектура ядра](01-engine-architecture-and-entry.md).
