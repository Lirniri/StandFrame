# Урок 1. Точка входа и архитектура ядра

Stand запускает один файл — лаунчер. Всё остальное (библиотека, модули, фичи, меню) подтягивается из него по
цепочке. В этом уроке проходим эту цепочку от первой строки до готового меню и разбираем загрузчик
[core/loader.pluto](../../src/lib/AnitaDarin/core/loader.pluto), через который в движке загружается каждый файл.

## Где что лежит

После `python build.py sync` проект оказывается в папке Stand `Lua Scripts`:

| Папка проекта | Куда попадает | Что это |
|---|---|---|
| `src/AnitaDarin.pluto` | `Lua Scripts/AnitaDarin.pluto` | лаунчер: единственный файл, который запускает Stand |
| `src/lib/AnitaDarin/` | `Lua Scripts/lib/AnitaDarin/` | код движка: `core`, `features`, `parsers`, `ui`, `utils`, `natives`, `modules` |
| `src/store/AnitaDarin/` | `Lua Scripts/store/AnitaDarin/` | данные: языки, пакеты меню, профили, логи |

Пути к этим папкам собраны в одном месте
([core/filesystem/paths.pluto](../../src/lib/AnitaDarin/core/filesystem/paths.pluto)):

```pluto
local paths = {
    scripts = filesystem.scripts_dir(),
    lib = $"{filesystem.scripts_dir()}lib\\{Atdar.name}\\",
    store = $"{filesystem.store_dir()}{Atdar.name}\\",
    resources = $"{filesystem.resources_dir()}{Atdar.name}\\",
}
```

В коде они доступны как `Atdar.filesystem.paths`. Все пути строятся от `Atdar.name`, и это важно для
следующего раздела.

## Лаунчер

Файл целиком ([src/AnitaDarin.pluto](../../src/AnitaDarin.pluto)):

```pluto
pluto_use "0.13.2"


_G.Atdar = {
    ui = {},
    -- Taken from this file's name, so a renamed script finds its lib/store/resources folders of the same name
    name = SCRIPT_FILENAME:match("^(.+)%.[^%.]+$") or SCRIPT_FILENAME,
    debug = false, -- will be set from the active profile once profile.pluto loads
}


local ok, err = xpcall(function()
    require(Atdar.name .. "/bootstrap")
end, function(e) return debug.traceback(e) end)

if not ok then util.toast(err) end
```

Здесь три решения:

1. **`pluto_use "0.13.2"`** включает синтаксис Pluto нужной версии для всего скрипта.
2. **Одна глобальная таблица `Atdar`.** Всё, что движок отдаёт наружу, лежит в ней: `Atdar.loader`,
   `Atdar.modules`, `Atdar.features`, `Atdar.profile` и так далее. Других глобальных имён движок не создаёт.
3. **Имя берётся из имени файла.** `SCRIPT_FILENAME` — имя лаунчера, которое даёт Stand. Если переименовать
   скрипт в `MyMenu.pluto`, он будет искать `lib/MyMenu/` и `store/MyMenu/`. Поэтому в коде движка нигде не
   написано `"AnitaDarin"` строкой — только `Atdar.name`.

`xpcall` с `debug.traceback` ловит ошибку старта и показывает её вместе со стеком вызовов. Без него Stand
показал бы только последнюю строку.

## Bootstrap: порядок запуска

Лаунчер передаёт управление [bootstrap.pluto](../../src/lib/AnitaDarin/bootstrap.pluto). Порядок строк в нём —
это порядок зависимостей: каждая часть может пользоваться только тем, что загружено выше.

```pluto
-- The loader comes first (it needs no natives), so the whole start is timed, the game's natives included
Atdar.loader = require($"{Atdar.name}/core/loader")
local started = Atdar.loader.now()

Atdar.loader.measure("natives-3407a (util.require_natives)", util.require_natives, "3407a")

Atdar.globals = Atdar.loader.load("globals")
```

| Шаг | Что появляется в `Atdar` | Зачем именно здесь |
|---|---|---|
| 1 | `loader` | единственный `require` напрямую: загрузчик загружает всё остальное |
| 2 | нативы игры (`util.require_natives`) | замеряются загрузчиком, как любой файл |
| 3 | `globals` | обход ошибок Pluto для классов, нужен `Feature` и `Module` |
| 4 | `util`, `filesystem`, `lang`, `color`, `menu`, `memory`, `util.game` | библиотеки; `lang` после `filesystem`, потому что читает языковые файлы |
| 5 | `profile` | настройки; нужен логгеру и меню |
| 6 | `user_code`, `user_script` | свой код пользователя для Call Function |
| 7 | `natives`, `parsers` | ленивые фасады (`loader.auto`), файлы грузятся при первом обращении |
| 8 | `modules` | менеджер модулей: загружает `lib/.../modules/` и запускает их |
| 9 | `file_watch` | остановка скрипта при изменении его файлов (режим разработки) |
| 10 | `features` | реестр фич: сами фичи загрузит меню |
| 11 | `ui.menu` | корень меню Stand: загружает меню и раздел настроек |
| 12 | автопроверка обновлений | `core/update_manager` |

Модули запускаются раньше фич и меню (шаг 8 перед 10 и 11), чтобы те могли на них опираться:

```pluto
-- Modules: internal parts the script starts by itself, in dependency order (core/module).
-- Before features and the menu, so those can use them
Atdar.modules = Atdar.loader.load("core/module_manager")
Atdar.modules.load_dir($"{Atdar.filesystem.paths.lib}modules\\")
Atdar.modules.start()
```

## Lua vs Pluto: `require` против `Atdar.loader.load`

В обычном Lua файл подключают через `require`:

```lua
local Logger = require("AnitaDarin/core/logger")
```

Если в файле ошибка, `require` бросает её дальше, и падает весь скрипт. В StandFrame все файлы, кроме самого
загрузчика, подключаются так:

```pluto
local Logger = Atdar.loader.load("core/logger")
```

Что делает `load` поверх `require` ([core/loader.pluto](../../src/lib/AnitaDarin/core/loader.pluto)):

```pluto
function module.load(path: string): table

    local hit = cache[path]

    -- Still the one require has: a file forgotten there (reload, package.loaded[name] = nil) is loaded again
    if hit ~= nil and package.loaded[cache_names[path]] == hit then
        return hit
    end

    local name = $"{Atdar.name}/{path}"
    local ok, result = timed_require(path, name)

    if not ok then
        log:error($"failed to load '{path}' (from {caller()})\n{result}")
        return {}
    end

    loaded_names[name] = true

    -- An empty file makes require return true instead of a table
    if type(result) ~= "table" then
        log:warn($"'{path}' did not return a table")
        return {}
    end

    cache[path] = result
    cache_names[path] = name

    return result
end
```

- **Путь короче.** `Atdar.name` подставляется сам, поэтому переименованный скрипт находит свои файлы.
- **Ошибка не роняет скрипт.** Сломанный файл даёт пустую таблицу и запись в логе с указанием, кто его просил
  (`caller()` идёт по стеку мимо кадров самого загрузчика). Один битый файл не забирает с собой целый раздел.
- **Загрузка замеряется.** `timed_require` записывает время каждого файла, прочитанного с диска.
- **Повторный вызов дешёвый.** Уже загруженный файл возвращается из `cache` за пару обращений к таблице, поэтому
  `Atdar.loader.load(...)` можно звать и внутри функций.

## Ленивые фасады: `loader.auto`

Нативов и парсеров много, и грузить их все на старте незачем. `auto` делает таблицу, поля которой загружаются
из файлов при первом обращении:

```pluto
function module.auto(tbl: table, base: string): table

    -- Fields already known to have no file: not checked on disk again
    local missing = {}

    auto_bases[tbl] = base
    return setmetatable(tbl, {
        __index = function(t, key)
            if type(key) ~= "string" or missing[key] then
                return nil
            end
            local path = $"{base}/{key}"
            local file = path:gsub("/", "\\")
            if not filesystem.exists($"{LIB_DIR}{file}.pluto") then
                missing[key] = true
                return nil
            end
            local sub = module.load(path)
            rawset(t, key, sub)
            return sub
        end,
    })
end
```

Метаметод `__index` срабатывает только тогда, когда поля в таблице нет. Он проверяет, есть ли файл
`<base>/<поле>.pluto`, загружает его и кладёт в таблицу через `rawset` — второе обращение уже не доходит до
`__index`. Поле без файла остаётся `nil`, так что опечатка в имени не прячется.

В bootstrap это две строки:

```pluto
Atdar.natives = Atdar.loader.auto({}, "natives")
Atdar.parsers = Atdar.loader.auto({}, "parsers")
```

`Atdar.natives.entity.vehicle` загрузит сначала `natives/entity.pluto`, а тот сам возвращает `auto`-таблицу для
`natives/entity/`. Так же устроен [parsers/proglang.pluto](../../src/lib/AnitaDarin/parsers/proglang.pluto):

```pluto
local module = {}

return Atdar.loader.auto(module, "parsers/proglang")
```

## Замер времени старта

`measure` запускает функцию и записывает, сколько она заняла — всего и «своего», без вложенных загрузок:

```pluto
function module.measure(what: string, fn, ...)

    local frame = { nested = 0 }
    table.insert(loading, frame)
    local started = module.now()
    local results = table.pack(pcall(fn, ...))
    local total = module.now() - started
    table.remove(loading)
    local parent = loading[#loading]

    if parent then
        parent.nested += total
    end

    local own = total - frame.nested
    ...
```

`loading` — стек загрузок, которые идут сейчас. Файл, загрузивший другие, вычитает их время из своего, поэтому
в отчёте видно, какой файл медленный сам по себе. Отчёт (`loader.report`) пишется в лог, если в профиле включён
Load Timing («Замер загрузки») — это последние строки bootstrap.

## Перезагрузка без перезапуска

Две функции загрузчика нужны для горячей перезагрузки кода:

- `loader.reload(tbl, base)` забывает файлы из `lib/<скрипт>/<base>/` в кеше `require`, и они читаются с диска
  заново при следующем обращении. Работает для `auto`-таблиц, например `Atdar.natives`.
- `loader.keep(name)` отдаёт таблицу, которая переживает такую перезагрузку, — для состояния, которое нельзя
  потерять:

  ```pluto
  function module.keep(name: string): table
      kept[name] ??= {}
      return kept[name]
  end
  ```

Важная оговорка из комментария к `reload`: новый код получает тот, кто спрашивает таблицу каждый раз
(`Atdar.natives.entity.vehicle` внутри функции). Таблица, сохранённая в локальную переменную до перезагрузки,
остаётся старой.

## Общая схема

```text
Stand
  └─ AnitaDarin.pluto            launcher: _G.Atdar, pluto_use
       └─ bootstrap.pluto        the start order
            ├─ core/loader       loads every other file, times it
            ├─ utils/*           Atdar.util, filesystem, lang, color, menu, memory
            ├─ core/profile      settings (store/<script>/profiles)
            ├─ natives, parsers  lazy facades (loader.auto)
            ├─ core/module_manager ── modules/*.pluto     started by the script itself
            ├─ features/registry ── features of the menu  switched by the user
            └─ ui/stand/root ── menu packs (store/<script>/menu) + the settings section
```

Кто кого запускает:

- **Модули** запускает сам скрипт, у них нет пункта меню (урок 2).
- **Фичи** включает пользователь через пункт меню (урок 3).
- **Меню** строится из пакета в `store/<скрипт>/menu/`; файлы меню только описывают пункты, а вызовы `menu.*`
  Stand делает один слой — `ui/stand/core` (урок 3).

## Попробуй сам

1. Включите Load Timing («Замер загрузки») в профиле скрипта, перезапустите его и найдите в логе Stand строки `load times:`. Какой
   файл занял больше всего «своего» времени?

2. Создайте `src/lib/AnitaDarin/utils/hello.pluto`, который возвращает `{ greet = |name| -> $"Hello, {name}" }`,
   и вызовите `Atdar.loader.load("utils/hello").greet("you")`. Затем сделайте в файле синтаксическую ошибку. Что
   вернёт `load` и что появится в логе?

3. Объясните по коду `loader.auto`, что вернёт `Atdar.parsers.nothing_here` и сколько раз для него будет
   проверен диск при десяти обращениях.

4. Найдите в [bootstrap.pluto](../../src/lib/AnitaDarin/bootstrap.pluto), почему `game` загружается не в
   `Atdar.game`, а в `Atdar.util.game`.

Дальше: [Урок 2. Модули и жизненный цикл](02-modules-and-lifecycle.md).
