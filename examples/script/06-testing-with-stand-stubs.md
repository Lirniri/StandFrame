# Урок 6. Тестирование скриптов на стабах Stand API

Скрипт для Stand обычно проверяют так: запустить GTA V, загрузить скрипт, понажимать пункты. Это долго, и
ошибку в редкой ветке так не поймать. В StandFrame код движка запускается **вне игры**: обычным интерпретатором
`pluto` на подделке API Stand. Полный прогон занимает секунды и не требует игры.

Файлы:

- [tests/run.py](../../tests/run.py) — раннер: три вида проверок;
- [tests/stand.pluto](../../tests/stand.pluto) — заглушка Stand API и помощники тестов;
- `tests/test_*.pluto` — сами тесты, каждый отдельным процессом.

Нужен установленный Pluto: программы `pluto` и `plutoc`.

```text
python tests/run.py          everything
python tests/run.py json     only tests whose name contains "json" (syntax and natives still run)
python tests/run.py -v       also print the output of passing tests
```

## Что проверяет раннер

### 1. Синтаксис

`plutoc -p` разбирает каждый `.pluto` в `src`, `examples`, `tests` и `updater`:

```python
for path in files:
    probe.write_text(PLUTO_USE + path.read_text(encoding="utf-8"), encoding="utf-8")
    result = subprocess.run([plutoc, "-p", "-o", str(TMP / "syntax.out"), str(probe)],
                            capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        # Line numbers in the message are one off: the pluto_use line comes first
        failures.append(f"{path.relative_to(ROOT)}\n{result.stderr.strip()}")
```

К каждому файлу спереди приклеивается строка `pluto_use "0.13.2"` — та же, что в лаунчере. Без неё `class`,
`new` и `switch` не были бы ключевыми словами, и проверка шла бы по другим правилам, чем в игре. Из-за этой
строки номера строк в сообщении сдвинуты на одну.

Этот шаг проверяет и примеры из `examples/`: пример с опечаткой не доживёт до коммита.

### 2. Нативы

Каждый вызов вида `ПРОСТРАНСТВО.НАТИВ(...)` в `src` должен существовать в дампе нативов игры
(`experiments/natives-3407a/init.lua`):

```python
for namespace, name in re.findall(r"\b([A-Z_]{3,})\.([A-Z0-9_]+)\s*\(", code):
    if namespace not in natives:
        continue
    calls += 1
    if name not in natives[namespace]:
        hint = f", it's in {', '.join(where[name])}" if name in where else ""
        failures.append(f"{path.relative_to(ROOT)}:{number}: {namespace}.{name} doesn't exist{hint}")
```

Опечатка в имени натива в игре даёт ошибку только тогда, когда выполнится именно эта строка. Здесь она ловится
сразу, и раннер подсказывает, если натив с таким именем есть в другом пространстве. Дамп не хранится в git;
без него шаг пропускается.

### 3. Тесты

```python
for path in paths:
    if name_filter and name_filter not in path.stem:
        continue
    runner = pluto if path.suffix == ".pluto" else sys.executable
    # cwd = tests, so require("stand") finds tests/stand.pluto
    result = subprocess.run([runner, str(path)], cwd=TESTS, capture_output=True,
                            text=True, encoding="utf-8", errors="replace")
```

- **Каждый тест — отдельный процесс.** Глобальная `Atdar`, реестры модулей и фич, поддельное меню начинаются с
  чистого листа. Тесты не могут испортить друг друга, и порядок запуска не важен.
- **Тесты бывают на Pluto и на Python.** `test_*.pluto` запускают код скрипта, `test_*.py` проверяют
  Python-инструменты (`build.py`) и правила проекта.
- **Тест прошёл**, если процесс завершился с кодом 0 и напечатал строку итога
  `test_имя: N passed, M failed`. Тест, упавший с ошибкой до итога, считается `crashed`.

Предупреждения Pluto о типах раннер из вывода убирает: это не провалы.

## Заглушка Stand API

Код движка обращается к глобальным таблицам Stand: `util`, `menu`, `filesystem`, `lang`. В обычном `pluto` их
нет. [tests/stand.pluto](../../tests/stand.pluto) создаёт их сам — ровно в том объёме, который нужен тестам.

```pluto
_G.util = {
    log = |line| -> table.insert(stand.logs, line),
    toast = |line| -> table.insert(stand.toasts, line),
    require_natives = || -> nil,
    current_time_millis = || -> stand.clock,
    yield = function(ms)
        stand.clock += ms or stand.FRAME_MS
        if stand.on_yield then
            stand.on_yield()
        end
    end,
    create_tick_handler = |fn| -> table.insert(tick_handlers, fn),
    on_stop = |fn| -> table.insert(stop_handlers, fn),
    is_session_started = || -> stand.online,
    -- Runs the thread right away, to its end
    create_thread = |fn| -> fn(),
    ...
}
```

Три идеи, на которых держится вся заглушка:

1. **Подделка записывает, а не делает.** `util.log` складывает строки в `stand.logs`, `util.toast` — в
   `stand.toasts`. Тест потом спрашивает: «была ли такая строка?»
2. **Время поддельное.** `util.current_time_millis()` возвращает `stand.clock`, а `util.yield(ms)` просто
   двигает эти часы вперёд. Код, который «ждёт пять секунд», в тесте завершается мгновенно.
3. **Кадр — это функция.** `util.create_tick_handler` только запоминает обработчик. Кадр наступает, когда тест
   вызывает `stand.frame()`:

   ```pluto
   -- One game frame: tick handlers, then the toggle_loops that are on
   function stand.frame(count: int = 1): void
       for _ = 1, count do
           for i = #tick_handlers, 1, -1 do
               if tick_handlers[i]() == false then
                   table.remove(tick_handlers, i)
               end
           end
           ...
           tick_loops(stand.root)
       end
   end
   ```

Файловая система — настоящая: `filesystem.*` работает с реальным диском, но тесты пишут в `tests/.tmp/`,
а не в проект.

### Старт скрипта в тесте

```pluto
-- Creates Atdar with its loader and globals, like the launcher and the top of bootstrap.pluto
function stand.boot(): table
    -- log_dir: the logger's files go to tests/.tmp, not into the project's src/store
    _G.Atdar = { ui = {}, name = "AnitaDarin", debug = false, log_dir = stand.tmpdir("logs") }
    Atdar.loader = require("AnitaDarin/core/loader")
    Atdar.globals = Atdar.loader.load("globals")
    return Atdar
end
```

`boot` делает то же, что лаунчер и первые строки bootstrap, и не больше. Остальное тест подключает сам —
только то, что проверяет: `Atdar.modules = Atdar.loader.load("core/module_manager")` и так далее. Поэтому тест
парсеров не грузит меню, а тест логгера не грузит модули.

### Помощники

| Что | Зачем |
|---|---|
| `stand.check(cond, name)` | условие истинно |
| `stand.equal(actual, expected, name)` | значения равны; при провале печатает оба |
| `stand.finish()` | итог и код выхода; последняя строка каждого теста |
| `stand.frame(n)` | прогнать `n` кадров: тики и включённые `toggle_loop` |
| `stand.clock`, `stand.on_yield` | поддельное время и что происходит при `util.yield` |
| `stand.click(item, option)` | нажать пункт меню, как пользователь |
| `stand.child(parent, text)`, `stand.find_item(parent, text)` | найти пункт по имени |
| `stand.name_of(item)`, `stand.by_command(name)` | имя пункта; пункт по команде |
| `stand.hover`, `stand.leave`, `stand.back` | навести, уйти, выйти из списка |
| `stand.stop()` | остановка скрипта: запускает обработчики `util.on_stop` |
| `stand.logs`, `stand.toasts`, `stand.find_log(text)`, `stand.clear_logs()` | что записано в лог и показано |
| `stand.tmpdir(name)` | пустая папка `tests/.tmp/<name>/` |
| `stand.write_file`, `stand.read_file` | файлы для теста |
| `stand.language` | язык, который «показывает Stand» |
| `stand.store` | куда смотрит `filesystem.store_dir()` |

## Lua vs Pluto: тест без фреймворка

В мире Lua для тестов обычно берут стороннюю библиотеку с `describe` и `it`. Здесь её нет: тест — обычный
файл, который выполняется сверху вниз, а весь «фреймворк» — две функции на счётчиках:

```pluto
function stand.equal(actual, expected, name: string): bool
    if actual == expected then
        passed += 1
        return true
    end
    failed += 1
    print($"  FAIL  {name}: expected {tostring(expected)}, got {tostring(actual)}")
    return false
end
```

Синтаксис Pluto делает такие тесты короткими. Проверка «конструктор должен упасть с таким текстом» — одна
строка на случай благодаря лямбде `|| -> ...` ([tests/test_feature.pluto](../../tests/test_feature.pluto)):

```pluto
local function fails(opts: table, text: string, name: string): void
    local ok, err = pcall(|| -> new Feature(opts))
    stand.check(not ok and tostring(err):find(text, 1, true), name)
end
fails({ id = "t.loop", kind = "loop" }, "requires on_tick", "loop needs on_tick")
fails({ id = "t.opt", kind = "toggle", on_tik = || -> nil }, "options: unknown 'on_tik'", "a typo in an option")
```

На обычном Lua каждый `pcall` потребовал бы `function() return Feature.new(opts) end`.

## Как писать свои тесты

Каркас любого теста:

```pluto
local stand = require("stand")
stand.boot()

local thing = Atdar.loader.load("core/...")
stand.equal(thing.value(), 5, "what is checked")

stand.finish()
```

Файл называется `tests/test_<имя>.pluto` — раннер находит его сам.

### Unit-тест: парсер

Чистая функция «текст → значение» проверяется проще всего
([tests/test_parsers.pluto](../../tests/test_parsers.pluto)):

```pluto
local stand = require("stand")
stand.boot()
Atdar.parsers = Atdar.loader.auto({}, "parsers")
local parsers = Atdar.parsers

local pluto = parsers.proglang.pluto

local args, count = pluto.args.parse('adder, 5, true, nil, "x, y"')
stand.check(count == 5 and args[1] == "adder" and args[2] == 5 and args[3] == true and args[4] == nil
    and args[5] == "x, y", "args.parse: a bare word, number, true, nil, a quoted text with a comma")

_G.FAKE = { add = |a, b| -> a + b }
args, count = pluto.args.parse("FAKE.add(2, 3), math.max(1, 7)")
stand.check(count == 2 and args[1] == 5 and args[2] == 7, "args.parse: calls are made, commas inside don't split")
```

Обратите внимание на `_G.FAKE`: парсеру нужно глобальное имя, и тест создаёт его сам. Так же подделываются
нативы игры (`PLAYER`, `ENTITY` ...): заглушка их не содержит, каждый тест делает нужные сам. Примеры — в
`tests/test_streaming.pluto`.

### Тест фичи вместе с меню

Фича проверяется через свой пункт: тест «нажимает» его, как пользователь
([tests/test_feature.pluto](../../tests/test_feature.pluto)):

```pluto
local Feature = Atdar.loader.load("features/feature")
local MenuNode = Atdar.loader.load("ui/stand/core/menu_node")
local node = new MenuNode(stand.root)

local events = {}
local function record(name) return function() table.insert(events, name) end end
local toggle = new Feature({ id = "t.toggle", kind = "toggle",
    on_save_state = record("save"), on_enable = record("enable"),
    on_disable = record("disable"), on_load_state = record("load") })
local toggle_ref = node:add_feature(toggle, "Toggle").ref
stand.click(toggle_ref)
stand.click(toggle_ref)
stand.equal(table.concat(events, ","), "save,enable,disable,load", "save, enable ... disable, load")
```

Приём с `events`: хуки записывают свои имена в список, а тест сравнивает весь порядок одной строкой. Это
интеграционный тест: в нём участвуют `Feature`, `MenuNode` и поддельное меню Stand.

Для фичи вида `loop` нужны кадры: включить галочку через `stand.click`, затем `stand.frame(3)` и проверить,
сколько раз сработал `on_tick`.

### Тест модуля с файлами

Модули загружаются из файлов, поэтому тест пишет их во временную папку
([tests/test_module_manager.pluto](../../tests/test_module_manager.pluto)):

```pluto
Atdar.modules = Atdar.loader.load("core/module_manager")
local Module = Atdar.loader.load("core/module")
local modules = Atdar.modules

local dir = stand.tmpdir("module_manager")
...
_G.EVENTS = {}
_G.TICKS = {}
-- c needs b needs a; d stands alone; e needs a module that doesn't exist
stand.write_file($"{dir}a.pluto", module_file("a", "", 1))
stand.write_file($"{dir}b.pluto", module_file("b", "'a'", 1))
...
stand.equal(modules.load_dir(dir), 5, "all five files ran")
modules.start()
```

Сгенерированные модули пишут события в глобальный `EVENTS`, и тест проверяет порядок запуска и остановки.
Перезагрузка проверяется так же: тест переписывает файл и вызывает `reload_module`.

### Тест на время

Поддельные часы позволяют проверить секундные интервалы без ожидания. Так тест логгера убеждается, что строка
попадает на диск через секунду ([tests/test_logger.pluto](../../tests/test_logger.pluto)):

```pluto
log:info("within a second")
stand.clock += 1000
stand.frame()
stand.check(on_disk():find("within a second", 1, true), "an info line is on disk a second later")
```

Если код зависит от `os.date` или `os.time`, тест подменяет их своими функциями и возвращает обратно в конце —
в том же файле так сделан «поддельный календарь» для смены дня.

### Тест на правило проекта

Тест не обязан запускать код. [tests/test_menu_layer.py](../../tests/test_menu_layer.py) читает исходники и
проверяет архитектурное правило из урока 3: API меню Stand вызывается только в `ui/stand/core`. Нарушение
ловится так же, как сломанная функция.

## Чего тесты не заменяют

Заглушка повторяет поведение Stand только там, где это нужно тестам. Она не знает, как игра ответит на натив,
и может расходиться с настоящим Stand в мелочах. Тесты ловят ошибки логики **до** игры; проверку в игре они
не отменяют.

Практический порядок работы:

1. изменить код;
2. `python tests/run.py` (или `python tests/run.py имя` для одного теста);
3. `python build.py sync` и проверка в игре.

## Попробуй сам

1. Запустите `python tests/run.py parsers -v` и прочитайте вывод. Затем временно сломайте
   [parsers/color.pluto](../../src/lib/AnitaDarin/parsers/color.pluto) (например, уберите деление на 255) и
   запустите снова. Какая проверка упала и что она напечатала?

2. Напишите `tests/test_my_parser.pluto` для `Atdar.parsers.stand.command_box.sanitize`: обычное имя, имя с
   пробелами и знаками, пустая строка. Подсказка: посмотрите, как его проверяет `test_parsers.pluto`.

3. Напишите тест для своей фичи `kind = "loop"`: создайте `MenuNode` на `stand.root`, добавьте фичу, включите
   её через `stand.click`, прогоните `stand.frame(5)` и проверьте счётчик тиков. Затем заставьте `on_tick`
   бросить ошибку и проверьте, что после неё счётчик больше не растёт.

4. Напишите тест для модуля с `on_tick`, который срабатывает раз в 2 секунды: двигайте `stand.clock` и
   вызывайте `stand.frame()`. Сколько кадров нужно, чтобы хук сработал дважды?

5. Добавьте в свой тест проверку лога: вызовите `log:warn("careful")` и найдите строку через
   `stand.find_log`. Что лежит в `stand.toasts`?

6. Сделайте в любом примере из `examples/script/` синтаксическую ошибку и запустите раннер. На каком шаге она
   поймана и почему номер строки в сообщении отличается на единицу?

Полный список тестов и что каждый проверяет: [tests/README.ru.md](../../tests/README.ru.md).

Назад: [Урок 5. Данные, локализация и команды](05-profiles-i18n-and-commands.md).
