# Урок 5. Данные, локализация и команды

В этом уроке — всё, что скрипт хранит и показывает: JSON-файлы, профиль настроек, переводы, лог и имена команд
для командной строки Stand. У этих частей общий фундамент: класс `JsonFile`, через который проходит каждый
JSON-файл скрипта.

Файлы:

- [core/filesystem/json/file.pluto](../../src/lib/AnitaDarin/core/filesystem/json/file.pluto) — `JsonFile`;
- [core/profile.pluto](../../src/lib/AnitaDarin/core/profile.pluto) — профиль `Atdar.profile`;
- [core/i18n.pluto](../../src/lib/AnitaDarin/core/i18n.pluto) — переводы;
- [core/logger.pluto](../../src/lib/AnitaDarin/core/logger.pluto) — лог и уведомления;
- [ui/logic/stand/commands.pluto](../../src/lib/AnitaDarin/ui/logic/stand/commands.pluto) — имена команд.

## JSON-файлы: `JsonFile`

### Lua vs Pluto

Наивная запись настроек на обычном Lua:

```lua
local file = io.open(path, "w")
file:write(json.encode(data))   -- json: a third-party library
file:close()
```

Здесь три проблемы. Если скрипт остановится посреди записи, файл останется обрезанным. Если в данных окажется
то, что нельзя закодировать, старый файл уже стёрт. А порядок ключей в файле каждый раз разный, потому что
таблица Lua его не хранит. В StandFrame ([basics/04_json.pluto](basics/04_json.pluto)):

```pluto
local paths = Atdar.filesystem.paths
local JsonFile = Atdar.filesystem.json.File

-- Data of your own goes to store/AnitaDarin/: build.py never overwrites or removes it there
local file = new JsonFile($"{paths.store}garage\\vehicles.json")

local data = file:read() or { vehicles = {} }    -- nil when there's no file yet
table.insert(data.vehicles, { name = "adder", x = 1.0, y = 2.0, z = 3.0 })
if not file:write(data) then
    util.log("couldn't write the file")
end
```

### Что делает `write`

Из шапки [file.pluto](../../src/lib/AnitaDarin/core/filesystem/json/file.pluto), по шагам:

1. **Сначала кодирует, потом трогает файл.** Ошибка кодирования (NaN, функция, таблица внутри себя) оставляет
   старый файл как был:

   ```pluto
   local ok, text = pcall(function()
       return json.encode(ordered(data, rank, {}), pretty ? "pretty" : nil)
   end)
   if not ok then
       log:error($"{self.path} not written, the data can't be stored as JSON: {text}")
       return false
   end
   ```

2. **Пишет в `<путь>.tmp`.** Основной файл пока не тронут.
3. **Старый файл становится `<путь>.bak`**, затем `.tmp` занимает его место. Код не полагается на то, что
   `os.rename` заменит существующий файл: на Windows он может отказаться.
4. **Испорченный старый файл уходит в `<путь>.broken`**, а не в `.bak`, чтобы не вытеснить хороший бэкап.
5. **Ключи пишутся в постоянном порядке**: сначала заданные в `key_order`, остальные по имени. Одни и те же
   данные всегда дают один и тот же файл.

`read()` симметричен: испорченный или отсутствующий файл читается из `.bak`. Чтение никогда не меняет файлы,
поэтому опечатка в языковом файле пакета не заставит его исчезнуть.

Декодирование идёт через строгий `parsers/json` (урок 3 раздела `programing`): обрезанный файл — это не файл, а
`nil`.

## Профиль: `Atdar.profile`

Профиль — настройки самого скрипта: `store/<скрипт>/profiles/<имя>.json`. Какой профиль активен, записано в
`store/<скрипт>/config.json`. Состояния пунктов меню хранит сам Stand в своих профилях; профиль скрипта держит
только то, чего у Stand нет.

### Значения по умолчанию живут в коде

```pluto
local DEFAULTS = {
    ...
    log_name = "short",         -- name in log and toast lines: "short" | "display"
    debug = false,              -- show debug-level log lines
    stop_on_change = false,     -- stop the script when its files change on disk (core/file_watch)
    load_timing = false,        -- log how long each file takes to load, and the report at start (core/loader)
    log_keep_days = 7,          -- days of log files kept in store/<script>/logs (today counts); 0 = all
    ...
    language = "auto",          -- language file code ("ru-ru") the script shows; "auto" = Stand's language
    notify = "game",           -- where notifications show: "stand" | "game" (the game's feed) | "none" (log only)
    ...
}
```

Таблица `DEFAULTS` — и список допустимых ключей, и их начальные значения. Отсутствующий файл профиля создаётся
из неё, поэтому профили не нужно хранить в git. При загрузке недостающие ключи дописываются:

```pluto
values = {}
for key, default in pairs(DEFAULTS) do
    if data[key] == nil then
        values[key] = default
        changed = true
    else
        values[key] = data[key]
    end
end
```

Новая настройка появляется у всех пользователей сама: достаточно добавить строку в `DEFAULTS`.

### Чтение, запись, слежение

```pluto
local profile = Atdar.profile

local where = profile.get("notify")              -- "stand" | "game" | "none"
local default_where = profile.default("notify")  -- what a new profile has

-- Writing: saved when the profile autosaves, otherwise with Save
profile.set("notify_flash", false)

-- Following changes, also when another profile is loaded
profile.on_change(function(key: string, value)
    if key == "debug" then
        util.log($"debug mode is now {tostring(value)}")
    end
end)
```

`set` показывает всю модель сохранения:

```pluto
function module.set(key: string, value): void
    if DEFAULTS[key] == nil then
        log:warn($"unknown profile key '{key}'")
        return
    end
    if values[key] == value then
        return
    end
    values[key] = value
    dirty = true
    if config.autosave[active] then
        module.save()
    end
    for _, listener in ipairs(listeners) do
        listener(key, value)
    end
end
```

- неизвестный ключ — предупреждение, значение не пишется;
- то же значение — ничего не происходит, слушатели не вызываются;
- изменение действует сразу, но в файл попадает только при `save()` — как в профилях самого Stand;
- **автосохранение** включается для каждого профиля отдельно (`set_autosave`), и тогда каждое изменение пишется
  сразу;
- слушатели `on_change` узнают о каждом изменении. Так `Atdar.debug` следует за ключом `debug`.

Остальные функции: `save`, `save_to(name)`, `switch(name)`, `create(name)`, `reset(name)`, `delete(name)`,
`list()`, `active_name()`, `is_dirty()`.

### Как меняют значения по умолчанию

Если просто поменять значение в `DEFAULTS`, старые профили сохранят прежнее: оно уже записано в их файл. Для
этого есть `OLD_DEFAULTS`:

```pluto
local OLD_DEFAULTS = {
    -- 2026-11-08: user commands were prefixed atdar_ for a day; now they're named exactly as typed
    { command_box_user_prefix = "atdar", command_box_user_separator = "_" },
}
DEFAULTS.defaults_version = #OLD_DEFAULTS
```

Профиль, у которого все значения из записи остались старыми, получает новые — он их не выбирал, это было
значение скрипта. Ключ `defaults_version` в профиле помнит, сколько таких замен уже применено, так что выбор,
сделанный позже, не затирается. Для переименованных ключей рядом лежит таблица `RENAMED_KEYS`.

## Переводы: `core/i18n`

### Идея: метки Stand

У Stand есть своя система меток: пункт меню получает число-метку, а Stand показывает её текст на своём текущем
языке. Движок кладёт свои строки в эту систему, и из этого следуют два свойства:

- Stand сам переключает язык пунктов, когда пользователь меняет язык;
- в профилях Stand пункты записаны по английскому тексту, на каком бы языке их ни показывали.

Английский текст — «личность» метки, остальные языки — её переводы.

### Файлы и ключи

Строки лежат в `<папка>/<язык>.json`, ключи вложены и записываются через точку:

```json
{ "menu": { "garage": { "menu_name": "Garage", "saved": "Saved %d vehicle(s)" } } }
```

Источников несколько: строки скрипта (`store/<скрипт>/core/language/`), строки загруженного меню, строки
каждого модуля. Ищутся они с последнего добавленного, поэтому строки меню перекрывают строки скрипта:

```pluto
-- @return The string at key in language, newest source first
local function find(code: string, key: string): ?string
    for i = #sources, 1, -1 do
        local source = sources[i]
        local flat = flat_of(source, code)
        local own_key = key_in(source, key)
        local text = flat and own_key and flat[own_key]

        if text ~= nil then
            return text
        end
    end

    return nil
end
```

### Ленивая загрузка языков

В папке может быть десяток переводов, а нужны на старте два: английский и тот, что показывается. Поэтому файл
языка читается и декодируется при первом обращении к нему:

```pluto
source.files = files
source.flat = {}
source.languages = setmetatable({}, {
    __index = function(languages, code)

        local path = files[code]
        if path == nil then
            return nil
        end

        local strings = new JsonFile(path):read() or {}

        rawset(languages, code, strings)

        return strings
    end,
})
```

Это тот же приём, что в `loader.auto` (урок 1): `__index` срабатывает, когда поля ещё нет, читает файл и кладёт
результат через `rawset`. `source.files` при этом известен сразу — это просто список файлов папки, без чтения.

Второй уровень лени — `flat_of`: вложенные строки превращаются в плоскую таблицу
`"menu.self.godmode" → текст`, тоже при первом обращении. После этого ключ находится одним индексированием, а
не разбором строки на части при каждом вызове.

Список языков для меню выбора показывает имя каждого языка (`language_name`), не декодируя файл: имя
вырезается шаблоном прямо из текста.

### Что вызывать

```pluto
local lang = Atdar.lang

-- For menu items
local name_label = lang.translate("menu.garage.menu_name")
-- With a fallback, for a key that may be missing
local help_label = lang.translate("menu.garage.help", "Your saved vehicles")

-- For notifications and other text built from parts
local saved = lang.text("menu.garage.saved", "Saved %d vehicle(s)"):format(3)
```

- `translate` (в `i18n` это `label`) возвращает **метку Stand** — для имён и подсказок пунктов;
- `text` возвращает **готовую строку** на текущем языке — для уведомлений и всего, что собирается через
  `format`. Такой текст сам за языком не следит: его надо получить заново.

Внутри движка вместо длинных ключей используют `i18n.scope`:

```pluto
local label, text = i18n.scope("modules")
label("name")   -- i18n.label("modules.name")
```

У модуля свои строки в своей папке: `self:text("key", "English")` и `self:label(...)`
([modules/07_translations](modules/07_translations)).

Язык скрипта можно выбрать независимо от Stand (ключ профиля `language`). Есть ограничение Stand: в английский
язык он переводы не принимает, поэтому при английском Stand скрипт следует за ним.

## Лог: `core/logger`

```pluto
local Logger = Atdar.loader.load("core/logger")

-- The name is the source in the log: "[AnitaDarin | Garage | INFO] ..."
local log = new Logger("Garage")

log:debug("only with Debug Mode on, only in the log")
log:info("in the log, nothing on screen")
log:notify("in the log and on screen")
log:warn("something is off, the script goes on")
log:error("something failed")
```

| Метод | В лог | На экран |
|---|---|---|
| `debug` | только в режиме отладки | нет |
| `info` | да | нет |
| `notify`, `success` | да | да |
| `warn`, `error` | да | да |

Каждая строка идёт в лог Stand (`util.log`) и в собственный файл скрипта, по одному на день:
`store/<скрипт>/logs/<скрипт>_<дата>.log`. Файлы старше `log_keep_days` удаляются.

Запись на диск устроена так, чтобы не тормозить игру и не терять важное:

```pluto
local function write_to_file(level: string, line: string): void
    local handle = today_file()
    handle:write(os.date("[%H:%M:%S] "), line, "\n")
    unflushed = true
    if level == "WARN" or level == "ERROR" or info_at_once() then
        flush_file()
    end
end
```

Предупреждение и ошибка попадают на диск сразу: то, что останется в файле после сбоя, должно их содержать.
Остальные строки ждут в буфере и сбрасываются раз в секунду. Если файл не открывается (диск полон, файл занят),
логгер один раз предупреждает и дальше пишет только в лог Stand.

Куда показывать уведомление, решает ключ профиля `notify`: `"stand"`, `"game"` (лента игры) или `"none"`.
Ошибки по умолчанию идут в Stand независимо от него (`notify_errors_in_stand`). Примеры:
[basics/01_log_and_notify.pluto](basics/01_log_and_notify.pluto).

Совет: строка `log:debug($"...")` собирается до того, как логгер проверит режим отладки. В коде, который
выполняется каждый кадр, оборачивайте такой вызов в `if Atdar.debug then`.

## Команды для командной строки Stand

У каждого пункта Stand есть команды — имена, по которым его вызывают из командной строки. В файлах меню пишут
только **базовые** имена:

```pluto
list:action({ name = "Say Hello", commands = { "optionshello" }, ... })
```

Полное имя строит [commands.pluto](../../src/lib/AnitaDarin/ui/logic/stand/commands.pluto):

```pluto
-- who: "script" or "menu", whose prefix and separator
local function full_name(clean: string, who: string): string
    local own = config[who] or config.script

    if not config.use_prefix or own.prefix == "" then
        return clean
    end

    if own.at_end then
        return $"{clean}{own.separator}{own.prefix}"
    end

    return $"{own.prefix}{own.separator}{clean}"
end
```

Владельцев команд три, у каждого свои префикс, разделитель и место префикса:

| Владелец | Чьи команды | Ключи профиля |
|---|---|---|
| `script` | самого скрипта (Base Commands) | `command_box_base_prefix`, `command_box_base_separator`, `command_box_base_prefix_at_end` |
| `menu` | загруженного меню (Found Commands) | `command_box_found_*` |
| `user` | свои команды пользователя (User Commands) | `command_box_user_*` |

Разные настройки у скрипта и меню нужны, чтобы одинаковое базовое имя в обоих не столкнулось.

Что ещё делает этот слой:

- **Чистит имена.** Stand принимает в команде только `a-z`, `0-9` и `_`. `"God Mode!"` становится `"godmode"`
  ([parsers/stand/command_box.pluto](../../src/lib/AnitaDarin/parsers/stand/command_box.pluto)).
- **Переименовывает на лету.** Каждый пункт с командами запоминается (`Commands.track`), и при смене префикса
  или разделителя все команды переименовываются сразу, без перестройки меню.
- **Хранит свои имена пользователя.** Пользователь может заменить базовое имя и добавить слова; они лежат по
  файлу на команду, `commands/<база>.json`:

  ```json
  { "name": "god", "words": ["gm", "immortal"] }
  ```

  С префиксом `atdar` пункт `godmode` получит команды `atdargod`, `atdargm` и `atdarimmortal`. Для команд меню
  папка `commands/` лежит в папке пакета, для команд скрипта — в `store/<скрипт>/commands/`.

Опции пункта, которые этим управляют: `track = false` (не переименовывать и не показывать среди найденных
команд) и `full_commands = true` (имена уже полные, префикс не добавлять).

## Попробуй сам

1. Запишите через `JsonFile` таблицу с ключами в разном порядке дважды и сравните файлы. Затем передайте третьим
   аргументом конструктора `{ "name", "type" }` и посмотрите, как изменился порядок.

2. Запишите файл, затем руками испортите его (удалите закрывающую скобку) и вызовите `read()`. Что вернулось и
   что появилось в логе? Запишите новые данные и посмотрите, какие файлы теперь лежат рядом.

3. Добавьте в `DEFAULTS` свой ключ, прочитайте его через `Atdar.profile.get` и подпишитесь на изменения через
   `on_change`. Что вернёт `set` для ключа, которого в `DEFAULTS` нет?

4. Добавьте строку в `en-us.json` и `ru-ru.json` своего пакета, покажите её пунктом через `lang.translate` и
   уведомлением через `lang.text(...):format(...)`. Смените язык Stand: что обновилось само, а что нет?

5. Создайте логгер и вызовите все шесть методов. Какие строки появились в файле сразу, а какие через секунду?
   Проверьте это настройкой `log_info_at_once`.

6. Дайте пункту команду `{ "My Command!" }`. Какое полное имя он получит при настройках по умолчанию? Найдите в
   коде две функции, которые к этому приводят.

Примеры по каждой теме: [basics/README.ru.md](basics/README.ru.md).

Дальше: [Урок 6. Тестирование на стабах Stand API](06-testing-with-stand-stubs.md).
Назад: [Урок 4. Создание собственных Menu Packs](04-creating-menu-packs.md).
