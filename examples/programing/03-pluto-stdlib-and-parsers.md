# Урок 3. Стандартная библиотека Pluto и парсеры

Стандартная библиотека Lua 5.4 маленькая: в ней нет JSON, хешей, обхода папок и даже проверки «строка
начинается с». В чистом Lua всё это пишут сами или подключают сторонние файлы. Pluto приносит это из коробки,
и реализовано оно на C. В уроке смотрим, что движок берёт готовым, что всё равно пишет сам и почему, а в конце
собираем из парсеров механизм **Call Function**.

## Lua vs Pluto: что есть из коробки

| Задача | Чистый Lua 5.4 | Pluto 0.13.x | Где в движке |
|---|---|---|---|
| JSON | сторонняя библиотека на Lua | `require "pluto:json"` | `parsers/json`, `core/filesystem/json/file` |
| SHA-256 | сторонняя библиотека | `require "pluto:crypto"` | `core/updater` |
| Список файлов папки | нет (нужен `lfs` или `io.popen("dir")`) | `io.listdir(dir, recursive)` | `core/module_manager`, `core/file_watch` |
| Файл, папка, существует | попытка `io.open` | `io.isfile`, `io.isdir`, `io.exists` | `core/file_watch` |
| Время записи и размер | нет | `io.writetime`, `io.filesize` | `core/file_watch`, `core/module_manager` |
| Начало и конец строки | `s:sub(1, #p) == p` | `s:startswith(p)`, `s:endswith(p)` | `core/loader`, `core/i18n`, `core/updater` |
| Массив ли таблица | цикл `pairs` со счётчиком | `table.isarray(t)` | `core/filesystem/json/file` |
| Точное время | `os.clock()` (на Windows — миллисекунды) | `os.nanos()` | `core/loader` |

Модули с префиксом `pluto:` подключаются через `require`, остальное добавлено прямо в `io`, `string`, `table`
и `os`.

Оговорка про Stand: файлы движок чаще читает через API самого Stand (`filesystem.exists`,
`filesystem.list_files`, `filesystem.scripts_dir`), а функции `io.*` из Pluto берёт там, где у Stand аналога нет.
Некоторые вызовы обёрнуты в `pcall` (`pcall(io.writetime, path)`), чтобы их сбой не ронял скрипт.

### Пример: одна строка вместо библиотеки

Обычный Lua — чтобы найти все `.pluto` в папке с подпапками, нужна рекурсия и проверка каждого элемента:

```lua
local function collect(dir, out)
    for _, path in ipairs(list_files(dir)) do      -- from a library
        if is_dir(path) then
            collect(path .. "\\", out)
        elseif path:sub(-6) == ".pluto" then
            table.insert(out, path)
        end
    end
end
```

StandFrame ([core/module_manager.pluto](../../src/lib/AnitaDarin/core/module_manager.pluto)):

```pluto
-- Adds the .pluto files under dir and its subfolders to out; one recursive listing instead of a look at every entry
local function collect_pluto_files(dir: string, out: table): void
    for _, path in io.listdir(dir, true) do
        if path:endswith(".pluto") and io.isfile(path) then
            table.insert(out, path)
        end
    end
end
```

Второй аргумент `true` делает обход рекурсивным. В списке есть и папки, поэтому остаётся проверка `io.isfile`.

### Пример: хеш файла для обновления

Обновление сравнивает установленные файлы с манифестом релиза по SHA-256
([core/updater.pluto](../../src/lib/AnitaDarin/core/updater.pluto)):

```pluto
local crypto = require "pluto:crypto"
...
function module.hash(path: string, content: string): string
    local extension = path:match("%.([^./]+)$")
    -- Looked for first: gsub copies the whole text even when it has no \r to take out
    if (extension == nil or not BINARY[extension:lower()]) and content:find("\r", 1, true) then
        content = content:gsub("\r\n", "\n")
    end
    return crypto.sha256(content)
end
```

Сам хеш — один вызов. Вся остальная логика функции — про то, чтобы один и тот же текстовый файл с `\r\n` и с
`\n` давал одинаковый хеш.

### Пример: время загрузки файла

`os.clock()` на Windows считает целыми миллисекундами, а один файл грузится быстрее. Загрузчик берёт
`os.nanos()` из Pluto, а если его нет — отступает к тому, что есть
([core/loader.pluto](../../src/lib/AnitaDarin/core/loader.pluto)):

```pluto
function module.now(): number
    if os.nanos then
        return os.nanos() / 1000000
    end
    if os.clock then
        return os.clock() * 1000
    end
    return util.current_time_millis()
end
```

## Когда готового мало: `parsers/json`

Файл: [parsers/json.pluto](../../src/lib/AnitaDarin/parsers/json.pluto).

`pluto:json` быстрый, но снисходительный: на оборванном тексте он не бросает ошибку, а возвращает то, что успел
разобрать.

```pluto
local json = require "pluto:json"
json.decode('{"a":1,"b":')   -- { a = 1 }: the cut-off key is silently gone
```

Для файла настроек это опасно: профиль, обрезанный при сбое записи, загрузился бы без половины ключей. Поэтому
движок оборачивает декодер строгой проверкой: текст должен быть одним целым объектом или массивом, иначе `nil`.

```pluto
function module.decode(text: string): ?table

    local from = text:find("%S")

    if from == nil then
        return nil
    end

    local to = text:match(".*()%S")
    local first, last = text:byte(from), text:byte(to)

    if not ((first == OPEN_BRACE and last == CLOSE_BRACE) or (first == OPEN_BRACKET and last == CLOSE_BRACKET)) then
        return nil
    end

    if not is_balanced(text) then
        return nil
    end

    local data = json.decode(text)
    ...
```

Три приёма, которые стоит запомнить:

1. **`text:byte(i)` вместо `text:sub(i, i)`.** `sub` создаёт новую строку на каждый символ, `byte` возвращает
   число. Коды собраны в константы в начале файла (`QUOTE = 34`, `OPEN_BRACE = 123` ...), и символы
   сравниваются как числа.
2. **Позиция вместо копии.** `text:find("%S")` даёт место первого непробельного символа, а `()` в шаблоне
   `".*()%S"` — место последнего. Файл не копируется, чтобы обрезать пробелы по краям.
3. **Прыжки по важным символам.** `is_balanced` не идёт по тексту посимвольно: `text:find` сразу находит
   следующую скобку или кавычку, а внутри строки — только кавычку или обратную косую черту.

Запись JSON тоже идёт через `pluto:json`, но с надстройкой
([core/filesystem/json/file.pluto](../../src/lib/AnitaDarin/core/filesystem/json/file.pluto)): каждому объекту
добавляется ключ `__order`, и `json.encode` пишет ключи в этом порядке. Одни и те же данные всегда дают один и
тот же файл. Там же `table.isarray(value)` решает, писать таблицу массивом или объектом.

## `parsers/color`: цвет из текста

Файл: [parsers/color.pluto](../../src/lib/AnitaDarin/parsers/color.pluto). `"FF8000"` или `"#ff800080"`
превращается в цвет Stand `{ r, g, b, a }` с числами от 0.0 до 1.0.

```pluto
function module.hex(text: string): ?table

    local digits = text:gsub("^#", "")
    
    if not (#digits == 6 or #digits == 8) or digits:find("[^%x]") then
        return nil
    end

    local number = tonumber(digits, 16)
    local alpha = 1.0

    -- RRGGBBAA: the alpha is the lowest byte, the colour the three above it
    if #digits == 8 then
        alpha = (number & 0xFF) / 255
        number = number >> 8
    end

    return {
        r = ((number >> 16) & 0xFF) / 255,
        g = ((number >> 8) & 0xFF) / 255,
        b = (number & 0xFF) / 255,
        a = alpha,
    }
end
```

Здесь всё — обычный Lua 5.4: `tonumber(digits, 16)` читает шестнадцатеричное число, а побитовые `>>` и `&`
достают байты. Вместо четырёх вырезаний подстроки и четырёх `tonumber` — одно число и сдвиги. Плохой текст —
не ошибка, а `nil`: парсер для того и нужен, чтобы читать то, что написал человек.

## `parsers/proglang/pluto/source`: типы из исходника

Файл: [parsers/proglang/pluto/source.pluto](../../src/lib/AnitaDarin/parsers/proglang/pluto/source.pluto).

Из урока 1: подсказки типов живут только в исходнике. После компиляции у функции остаются имена параметров
(`debug.getlocal`), но типов и значений по умолчанию нет. А меню отладки хочет показать
`repair(vehicle: int): bool`. Решение — прочитать их из файла:

1. `debug.getinfo(fn, "S")` говорит, в каком файле и на какой строке объявлена функция (`source`,
   `linedefined`);
2. `lines_of(path)` отдаёт текст файла и массив смещений его строк. Для файла модуля берётся текст, из которого
   был загружен работающий код, чтобы номера строк совпадали даже после правки файла;
3. `header_of(fn)` склеивает до шести строк от `linedefined` и вырезает заголовок шаблоном:

   ```pluto
   local before, inside, rest = joined:match("^(.-)function[^(]*(%b())(.*)")
   ```

   `%b()` — стандартный шаблон Lua «от скобки до парной скобки», он сам справляется с вложенными скобками.

Дальше три публичные функции разбирают части заголовка:

```pluto
local source = Atdar.parsers.proglang.pluto.source

source.return_type(Atdar.natives.entity.vehicle.repair)   -- "bool"
source.param_types(Atdar.natives.entity.vehicle.repair)   -- { vehicle = "int" }
source.param_defaults(fn)   -- "function f(a: int = 5)" -> { a = "5" }
```

Разобранный заголовок кешируется по функции в таблице со слабыми ключами
(`setmetatable({}, { __mode = "k" })`): когда функция исчезает (модуль перезагружен), запись уходит вместе с ней.

Нативы Stand (`util.require_natives`) написаны на обычном Lua, и типы у них стоят в комментариях. Парсер читает
и их:

```lua
PLAYER_PED_ID=--[[Ped (int)]] function()...      -- returns "int"
WAIT=--[[void]] function(--[[int]] ms)...         -- returns "void", ms is "int"
```

## Как из этого собран Call Function

**Call Function** («Настройки > Отладка») вызывает любую функцию скрипта по имени, набранному текстом, например
`VehicleManager:get(1234)` или `PLAYER.PLAYER_PED_ID()`. В обычном Lua для этого есть `load`: он компилирует
строку в функцию. Но, как сказано в комментарии [args.pluto](../../src/lib/AnitaDarin/parsers/proglang/pluto/args.pluto),
«Stand's Lua has no load», поэтому движок читает выражения сам. Цепочка такая:

**1. Имя → значение** — [parsers/proglang/pluto/path.pluto](../../src/lib/AnitaDarin/parsers/proglang/pluto/path.pluto).

```pluto
local path = Atdar.parsers.proglang.pluto.path
path.resolve("game.repair_vehicle")      -- true, the function
path.resolve("VehicleManager:get")        -- true, the method, its module (the self to call it with)
path.resolve("PLAYER.PLAYER_PED_ID()")    -- true, the native (the brackets are cut: see split)
```

Первое слово ищется среди глобальных имён Stand (`util`, `PLAYER`, `entities`), затем в `Atdar`; имя модуля
может стоять первым. С двоеточием функция — метод, и `resolve` третьим значением возвращает владельца, которого
надо передать как `self`.

**2. Функция → сигнатура** — [ui/logic/stand/arguments.pluto](../../src/lib/AnitaDarin/ui/logic/stand/arguments.pluto).

```pluto
function module.signature_of(fn, skip_self: ?bool): table

    local info = debug.getinfo(fn, "u")
    local names = {}

    for i = 1, info.nparams do
        local name = debug.getlocal(fn, i)
        if not (i == 1 and skip_self and name == "self") then
            table.insert(names, name)
        end
    end

    return module.signature(names, source_parser.param_types(fn), info.isvararg, source_parser.param_defaults(fn))
end
```

Имена параметров даёт работающий код (`debug`), типы и значения по умолчанию — исходник (`source`). По
сигнатуре меню строит по полю ввода на каждый параметр нужного вида.

**3. Текст аргументов → значения** — [parsers/proglang/pluto/args.pluto](../../src/lib/AnitaDarin/parsers/proglang/pluto/args.pluto).

```pluto
local args = Atdar.parsers.proglang.pluto.args
args.parse('adder, 5, PLAYER.PLAYER_PED_ID()')  -- { "adder", 5, 1234 }, 3
args.split('f(1, 2), "a, b"')                   -- { "f(1, 2)", '"a, b"' }
args.call_of('game.set(5, true)')               -- "game.set", { "5", "true" }
```

`parse` — маленький интерпретатор выражений: числа, `true`/`false`/`nil`, строки в кавычках, имена с `.поле`,
`:метод(...)` и вызовами `(...)`. Слово, которое ничего не называет, остаётся текстом: `adder` → `"adder"`.
Вместе со значениями возвращается их **количество**, потому что среди аргументов может быть `nil`, а оператор
`#` на таблице с `nil` ненадёжен.

**4. Вызов** — системный модуль
[modules/systems/CallFunction/CallFunction.pluto](../../src/lib/AnitaDarin/modules/systems/CallFunction/CallFunction.pluto).

```pluto
-- Runs a function with the arguments (the owner first when it's a method), the results packed
local function run(fn, owner, args: table, count: int): table
    if owner == nil then
        return table.pack(pcall(fn, table.unpack(args, 1, count)))
    end

    return table.pack(pcall(fn, owner, table.unpack(args, 1, count)))
end
```

`table.unpack(args, 1, count)` передаёт ровно `count` аргументов вместе с `nil`. `pcall` ловит ошибку вызванной
функции, а `table.pack` сохраняет все результаты и их число в поле `n`. Результат потом показывают списки
значений ([ui/logic/stand/results.pluto](../../src/lib/AnitaDarin/ui/logic/stand/results.pluto)).

Сами парсеры доступны как `Atdar.parsers.<вид>` и грузятся при первом обращении: в
[bootstrap.pluto](../../src/lib/AnitaDarin/bootstrap.pluto) это одна строка
`Atdar.parsers = Atdar.loader.auto({}, "parsers")`.

## Попробуй сам

1. Напишите функцию `count_by_extension(dir: string): table` на `io.listdir(dir, true)`, `io.isfile` и
   `path:match("%.([^./\\]+)$")`: сколько в папке файлов каждого расширения.

2. Проверьте строгий декодер: что вернёт `Atdar.parsers.json.decode` для `'{"a": 1}'`, `'{"a": 1, "b":'`,
   `'  [1, 2]  '` и `'{bad}'`? Для каждого случая найдите в
   [parsers/json.pluto](../../src/lib/AnitaDarin/parsers/json.pluto) строку, которая даёт этот ответ.

3. Допишите к `parsers/color` обратную функцию в своём файле: цвет `{ r, g, b, a }` → текст `"RRGGBBAA"` через
   `string.format("%02X", ...)`. Сравните с готовой `Atdar.color.to_hex`.

4. Объявите функцию `local function go(speed: float = 1.5, loud: bool = false): void` и вызовите для неё
   `return_type`, `param_types` и `param_defaults`. Что изменится, если записать её в одну строку как лямбду
   `|speed| -> ...`? Подсказка: комментарий над `header_of`.

5. Пройдите цепочку Call Function руками: `path.resolve("util.toast")`, затем
   `args.parse('"hello", 5')`, затем `pcall(fn, table.unpack(args, 1, count))`. Работающий пример парсеров — в
   [script/basics/07_parsers_and_colors.pluto](../script/basics/07_parsers_and_colors.pluto).

Назад: [Урок 2. ООП и система типов](02-oop-classes-and-types.md).
