# Урок 2. ООП и система типов

В Lua нет классов: объект — это таблица, а «класс» собирают вручную из метатаблиц. Pluto добавляет настоящие
`class`, `new`, `extends` и `private`. В этом уроке сравниваем оба способа, а потом разбираем, как на классах
построены два главных типа движка — `Feature` и `Module` — и как
[core/check.pluto](../../src/lib/AnitaDarin/core/check.pluto) проверяет то, что им передают.

## Lua vs Pluto: один и тот же класс

Обычный Lua — класс на метатаблицах:

```lua
local Logger = {}
Logger.__index = Logger

function Logger.new(source)
    local self = setmetatable({}, Logger)
    self.source = source
    return self
end

function Logger:info(msg)
    self:write("INFO", msg, false)
end

local log = Logger.new("Loader")
```

Pluto — так написан настоящий логгер ([core/logger.pluto](../../src/lib/AnitaDarin/core/logger.pluto)):

```pluto
local class Logger

    -- source: what's logging, e.g. "MenuBuilder"; nil logs with the script name only
    function __construct(source: ?string = nil)
        self.source = source
    end

    function info(msg: string): void
        self:write("INFO", msg, false)
    end

end

local log = new Logger("Loader")
```

Что изменилось:

| | Lua 5.4 | Pluto |
|---|---|---|
| Объявление | таблица + `Logger.__index = Logger` | `class Logger ... end` |
| Конструктор | своя функция `new` с `setmetatable` | `__construct`, вызывается через `new Logger(...)` |
| Методы | `function Logger:info(msg)` | `function info(msg)` внутри класса, `self` есть сам |
| Наследование | `setmetatable(Child, { __index = Parent })` | `class Child extends Parent` |
| Вызов родителя | `Parent.method(self, ...)` | `parent:method(...)` |
| Закрытые методы | договорённость (`_name`) | `private function name()` |
| Проверка типа | сравнение метатаблиц | `obj instanceof Class` |

Под капотом класс Pluto — та же таблица с `__index`, поэтому объекты остаются обычными таблицами: их можно
обойти через `pairs`, у них есть `getmetatable`. Родитель класса лежит в поле `__parent` — этим пользуется
`Module.functions_of`, о нём ниже.

### Что умеет `private`

Закрытый метод виден только изнутри класса. Снаружи его просто нет:

```pluto
local class Animal
    private function hidden(): string
        return "secret"
    end
    function reveal(): string
        return self:hidden()
    end
end

local a = new Animal()
print(a:reveal())  -- secret
a:hidden()         -- error: attempt to call a nil value (method 'hidden')
```

В Pluto есть ещё модификаторы полей (`public`, `private`, `static`). Движок StandFrame ими не пользуется: поля
задаются в `__construct`, а закрытыми делаются только методы (`private function call_hook` в `Feature` и
`Module`).

## Наследование: модуль как класс

Так устроен настоящий модуль
([modules/VehicleManager/VehicleManager.pluto](../../src/lib/AnitaDarin/modules/VehicleManager/VehicleManager.pluto),
здесь сокращённо):

```pluto
local class VehicleManager extends Module

    function __construct(ped: int = 0)
        parent:__construct({
            name = "VehicleManager",
            skip_first_tick = true,
            debug = { hide = { "_free_name", "_unorder", "_trim" } }
        })
        -- State lives in fields; set defaults here
        self.ped_id = ped
        self.vehicles = {}
    end

    function on_start()
        self.current_vehicle = 0
        ...
    end
end
```

- `extends Module` — методы `Module` (`start`, `stop`, `tick`, `fail` ...) достаются наследнику;
- `parent:__construct({ ... })` — сначала отрабатывает конструктор родителя, он проверит опции;
- `on_start`, `on_stop`, `on_tick` — наследник переопределяет только эти хуки.

## Как устроен `Feature`

Файл: [features/feature.pluto](../../src/lib/AnitaDarin/features/feature.pluto).

### Почему `Feature = class`, а не `local class Feature`

```pluto
-- Declared first and assigned explicitly so methods can reference Feature
local Feature
...
Feature = class

    function __construct(opts: table)
```

В Pluto 0.13.2 методы `local class X` не видят имя `X` внутри себя: обращение даёт
«attempt to index a nil value (global 'X')». А `Feature` нужно ссылаться на себя — он сравнивает метод
экземпляра с собственным (`self[name] ~= Feature[name]`). Поэтому переменная объявляется заранее, а класс
присваивается выражением `class ... end`. В списке изменений 0.13.3 это отмечено как исправленное
(«Fixed local classes not being able to reference themselves»), но проект целится в 0.13.2 и держит этот приём.
Точно так же объявлены `Module`, `MenuItem` и `MenuNode`.

### Конструктор: три защиты и хуки

```pluto
function __construct(opts: table)
    class_utils.fix_index(self)
    class_utils.construct.check_sealed(self, Feature, SEALED, $"Feature '{opts.id}'")
    validate_opts(self, opts)

    self.id = opts.id
    self.kind = opts.kind
    ...
    self.on_tick = opts.on_tick ?? self.on_tick
    self.on_enable = opts.on_enable ?? self.on_enable
```

Обе вспомогательные функции лежат в [globals.pluto](../../src/lib/AnitaDarin/globals.pluto):

1. **`fix_index`** обходит ошибку Pluto: если экземпляр родителя создан раньше, чем объявлен наследник,
   `extends` копирует в наследника чужой `__index`, и его объекты берут методы прямо у родителя. Функция
   возвращает `__index` на место. В 0.13.3 это тоже числится исправленным («Fixed 'extends' after 'new' not
   working as expected»).
2. **`check_sealed`** запрещает переопределять «запечатанные» методы. Список — в начале файла:

   ```pluto
   -- Lifecycle methods hold the re-entry guards; subclasses override on_* hooks instead
   local SEALED = { 
       "save_state",
       "load_state",
       "tick",
       "enable",
       "disable",
       "trigger",
       "is_enabled"
   }
   ```

   В Pluto нет `final`, поэтому проверка сделана руками: метод экземпляра сравнивается с методом базового
   класса, и при несовпадении конструктор бросает ошибку `must not override tick()`.
3. **`validate_opts`** проверяет таблицу опций (разбор ниже).

Хук можно задать двумя способами, и оба работают благодаря строке `opts.on_tick ?? self.on_tick`:

- функцией в опциях: `new Feature({ id = ..., kind = "loop", on_tick = function(self) ... end })`;
- переопределением метода в наследнике: `local class X extends Feature` с `function on_tick()`.

### Шаблонный метод

Публичные методы запечатаны и держат всю защиту, а хуки `on_*` по умолчанию пустые:

```pluto
function enable(): void
    if self.enabled then
        return
    end
    self:call_hook("save_state")
    self.enabled = true
    self:call_hook("on_enable")
end
function on_enable(): void
    -- body
end
```

Вызов хука идёт через закрытый метод, который ловит ошибки:

```pluto
private function call_hook(name: string): bool

    if name ~= "on_tick" then -- on_tick runs every frame, would flood the log

        local overridden = self[name] ~= Feature[name]

        log:debug($"{self.id}: {name} ({overridden ? "overridden" : "default"})")
    end

    local ok, err = pcall(self[name], self)
    if not ok then
        self:fail(name, err)
    end

    return ok
end
```

Сравнение `self[name] ~= Feature[name]` — способ узнать, переопределён ли метод: если у экземпляра он тот же,
что у базового класса, значит, это пустая заготовка. Тем же приёмом `Module.has_tick` решает, нужно ли тикать
модуль вообще ([core/module.pluto](../../src/lib/AnitaDarin/core/module.pluto)):

```pluto
-- The manager skips modules that don't tick, so they cost nothing per frame
function has_tick(): bool
    return self.on_tick ~= Module.on_tick
end
```

## Как устроен `Module`

Файл: [core/module.pluto](../../src/lib/AnitaDarin/core/module.pluto). Схема та же, что у `Feature`:
`SEALED`, `HOOKS`, `OPTIONS`, `validate_opts`, закрытый `call_hook`. Отличия:

- у модуля есть **статус**: `registered → running → stopped`, либо `failed` с причиной в `self.error`;
- у модуля есть **зависимости** `deps`. Конструктор копирует список, чтобы экземпляры не делили одну таблицу:

  ```pluto
  -- Own copy: a table shared between instances would change for all of them
  self.deps = {}
  for _, dep in ipairs(opts.deps or {}) do
      table.insert(self.deps, dep)
  end
  ```

- у каждого модуля свой логгер: `self.log = new Logger(opts.name)`.

### Рефлексия: какие функции есть у модуля

`Module.functions_of` находит методы, которые добавил наследник, чтобы показать их в меню отладки. Для этого он
идёт по цепочке классов через поле `__parent`:

```pluto
local cls = getmetatable(instance)
...
while type(cls) == "table" and cls ~= Module do
    for name, value in pairs(cls) do
        if type(name) == "string" and type(value) == "function" and not found[name]
            and kind_of(name) == kind and not CLASS_FUNCTIONS[name]
            and not NOT_CALLABLE[name] and rawget(Module, name) == nil then
            ...
            local info = debug.getinfo(value, "u")
            local params = {}
            for i = 2, info.nparams do
                table.insert(params, debug.getlocal(value, i))
            end
            table.insert(list, { name = name, params = params, vararg = info.isvararg })
        end
    end
    cls = rawget(cls, "__parent")
end
```

Это возможно именно потому, что класс Pluto — обычная таблица: методы перебираются через `pairs`, а имена
параметров читаются через `debug.getinfo` и `debug.getlocal` (начиная со второго: первый — `self`).

## Система типов и `core/check`

Из урока 1: подсказки типов (`opts: table`, `): bool`) проверяет компилятор и только предупреждает. Во время
работы в функцию можно передать что угодно. Для библиотеки, которой пользуются чужие файлы, этого мало, поэтому
в движке есть [core/check.pluto](../../src/lib/AnitaDarin/core/check.pluto) с двумя инструментами.

### `expecter` — проверка аргументов функции

Обычный Lua:

```lua
function module.parse(input)
    assert(type(input) == "string", "input must be a string")
```

`assert` покажет строку внутри `parse`, а не того, кто передал плохое значение. В StandFrame:

```pluto
function module.expecter(label: string): function
    return function(fn_name: string, what: string, value, kind: string): void
        if type(value) ~= kind then
            -- 1 - here, 2 - the function checked, 3 - its caller
            error($"[{label}] {fn_name}: {what} must be a {kind}, got {type(value)}", 3)
        end
    end
end
```

Второй аргумент `error` — уровень стека. `3` направляет ошибку на вызывающего. Использование
([parsers/proglang/pluto/args.pluto](../../src/lib/AnitaDarin/parsers/proglang/pluto/args.pluto)):

```pluto
local expect = Atdar.loader.load("core/check").expecter("parsers/proglang/pluto/args")

function module.parse(input: string, resolve: ?function)
    expect("parse", "input", input, "string")
```

Ошибка получится такой: `caller.pluto:12: [parsers/proglang/pluto/args] parse: input must be a string, got nil`.

### `validator` — проверка таблицы опций

`validator(label)` возвращает таблицу с четырьмя проверками: `kind`, `non_empty`, `known` и `fail`. Это третий
способ сделать объект — не метатаблицы и не `class`, а таблица функций-замыканий, которые помнят `label`.
Поэтому они вызываются через точку, без `self`:

```pluto
local function validate_opts(instance: table, opts: table): void
    check.validator("[Feature]").non_empty("id", opts.id)

    local v = check.validator($"[Feature '{opts.id}']")

    for key, value in pairs(opts) do
        v.known("options", key, OPTIONS)
        if HOOKS[key] then
            v.kind(key, value, "function")
        end
    end

    v.known("kind", opts.kind, KINDS)

    local hook = KINDS[opts.kind].requires

    if hook and opts[hook] == nil and instance[hook] == Feature[hook] then
        v.fail($"kind '{opts.kind}' requires {hook}")
    end
end
```

Что здесь проверяется:

- опечатка в имени опции — ошибка, а не тихо проигнорированная настройка (`v.known("options", key, OPTIONS)`);
- хук обязан быть функцией;
- `kind` — один из известных (`loop`, `toggle`, `action`);
- виду `loop` нужен `on_tick`, виду `action` — `on_trigger`, причём хук может прийти из опций **или** из
  наследника (то же сравнение с `Feature[hook]`).

`v.fail` сам ищет в стеке первую строку вне `core/check` и вне файла, создавшего валидатор, поэтому ошибка
указывает на `new Feature({ ... })` в файле пользователя. Работающий пример — в
[script/basics/06_check.pluto](../script/basics/06_check.pluto).

## Попробуй сам

1. Перепишите класс на метатаблицах в `class` Pluto с типами в сигнатурах и закрытым методом `_clamp`:

   ```lua
   local Counter = {}
   Counter.__index = Counter

   function Counter.new(limit)
       return setmetatable({ value = 0, limit = limit or 10 }, Counter)
   end

   function Counter:_clamp()
       if self.value > self.limit then self.value = self.limit end
   end

   function Counter:add(n)
       self.value = self.value + n
       self:_clamp()
       return self.value
   end
   ```

2. Сделайте наследника `local class Timer extends Module` с `parent:__construct({ name = "Timer" })` и хуком
   `on_start`, который пишет в `self.log:info(...)`. Сверьтесь с
   [script/modules/02_class.pluto](../script/modules/02_class.pluto).

3. В наследнике из задания 2 объявите метод `tick()` и создайте экземпляр. Какую ошибку вы получите и какая
   строка `Module.__construct` её бросает?

4. Напишите функцию `make_garage(opts)` с `check.validator`: `name` — непустая строка, `slots` — число,
   неизвестные опции запрещены. Проверьте, на какую строку указывает ошибка.

Дальше: [Урок 3. Стандартная библиотека Pluto и парсеры](03-pluto-stdlib-and-parsers.md).
Назад: [Урок 1. Pluto против обычного Lua](01-lua-vs-pluto-syntax.md).
