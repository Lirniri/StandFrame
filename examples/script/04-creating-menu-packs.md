# Урок 4. Создание собственных Menu Packs

**Пакет меню** — папка со своим меню, своими фичами и своими переводами. Движок StandFrame сам пунктов игрока
не содержит: всё, что видит пользователь, кроме раздела настроек, приходит из пакета. Пользователь выбирает
пакет в «Настройки > Загрузить меню», и при загрузке другого меню прежний пакет выгружается целиком, без
следов. В этом уроке разбираем, как это устроено, и собираем свой пакет.

Файлы движка:

- [ui/logic/stand/menu_packs.pluto](../../src/lib/AnitaDarin/ui/logic/stand/menu_packs.pluto) — пакеты как
  файлы: поиск, запуск файлов фич, копирование в ядро;
- [ui/logic/stand/menu_loader.pluto](../../src/lib/AnitaDarin/ui/logic/stand/menu_loader.pluto) — загрузка и
  выгрузка меню;
- [ui/stand/core/menu_builder.pluto](../../src/lib/AnitaDarin/ui/stand/core/menu_builder.pluto) — построение
  пунктов из файлов меню;
- [ui/stand/root.pluto](../../src/lib/AnitaDarin/ui/stand/root.pluto) — корень меню скрипта.

## Из чего состоит пакет

Пакеты лежат в `store/<скрипт>/menu/`. В проекте их два: основной
[AnitaDarin](../../src/store/AnitaDarin/menu/AnitaDarin) и маленький
[Example](../../src/store/AnitaDarin/menu/Example). Учебный пакет — [pack/ExamplePack](pack/ExamplePack):

```text
ExamplePack/
├── info.json                  the pack's name (required), author, version
├── features/                  every .pluto here is run when the pack loads
│   └── self/
│       ├── heal.pluto
│       └── no_wanted.pluto
├── menu/
│   └── stand/
│       ├── main.pluto         the menu is built from here
│       ├── self.pluto
│       └── settings.pluto
└── language/
    ├── en-us.json
    └── ru-ru.json
```

Что обязательно, решают две функции. Папка считается пакетом, если в ней есть `info.json` со строкой `name`:

```pluto
local info = read_json($"{path}\\info.json")

if type(info) == "table" and type(info.name) == "string" then
    info.dir = $"{path}\\"

    -- The pack's id, e.g. for the profile's auto_copy_menu
    info.folder = path:match("([^\\/]+)$")
    table.insert(packs, info)
end
```

А загрузить пакет можно, если у него есть `menu/stand/main.pluto`:

```pluto
function module.find_loadable_packs(packs_dir: string): table
    local packs = {}
    for _, info in ipairs(module.find_packs(packs_dir)) do
        if filesystem.exists($"{module.layout_dir(info.dir)}main.pluto") then
            info.feature_files = module.find_feature_files($"{info.dir}features\\")
            table.insert(packs, info)
        end
    end
    return packs
end
```

Итого минимум — `info.json` и `menu/stand/main.pluto`. Папки `features/` и `language/` необязательны.

## Lua vs StandFrame: один файл против пакета

Обычный Lua-скрипт для Stand — один файл, где логика, пункты, имена и команды перемешаны, а убрать «часть меню»
нельзя, не остановив скрипт:

```lua
local self_list = menu.list(menu.my_root(), "Self", { "self" })

menu.action(self_list, "Heal", { "heal" }, "", function()
    ENTITY.SET_ENTITY_HEALTH(PLAYER.PLAYER_PED_ID(), 200, 0, 0)
end)
```

В пакете то же самое разложено по трём местам, и каждое можно менять отдельно:

| Что | Где в пакете | Кто загружает |
|---|---|---|
| логика | `features/self/heal.pluto` | `menu_packs.load_feature_files` |
| пункт меню | `menu/stand/self.pluto` | `menu_builder.build_menu` |
| имя и подсказка | `language/ru-ru.json` | `i18n.add_source` |

## Как пакет загружается

Вся загрузка — одна функция `load_menu` в
[menu_loader.pluto](../../src/lib/AnitaDarin/ui/logic/stand/menu_loader.pluto). Порядок шагов в ней не случаен:

```pluto
hooks.hide_notice()
unload_current()

-- Before features and items, so both can already use the menu's strings
local strings = i18n.add_source(language_dir)
local ids_before = features.ids()
local settings_mark = hooks.mark_settings()
local loaded = packs.load_feature_files(feature_files)
if loaded < #feature_files then
    log:warn($"ran {loaded} of {#feature_files} feature file(s)")
end

-- Their custom names apply as the items are made
commands.begin_menu(menu_dir)
local built, err = pcall(hooks.build_menu, layout_dir)
commands.end_menu()
if not built then
    log:error($"menu build failed: {err}")
end

local feature_ids = {}
for id in pairs(features.ids()) do
    if not ids_before[id] then
        table.insert(feature_ids, id)
    end
end
current = { kind = kind, pack = pack, feature_ids = feature_ids, settings_mark = settings_mark, strings = strings }
```

1. **Выгрузить прежнее меню** (`unload_current`).
2. **Подключить переводы** пакета. Раньше фич и пунктов, чтобы те уже могли брать строки.
3. **Запомнить, что было**: набор id фич (`ids_before`) и отметку раздела настроек.
4. **Запустить файлы фич.** Каждый `.pluto` из `features/` выполняется и сам регистрирует фичу.
5. **Построить пункты** из `menu/stand/main.pluto`. Между `begin_menu` и `end_menu` все созданные команды
   считаются командами пакета.
6. **Записать, что добавил пакет**: новые id фич — это разница между «стало» и «было».

Запись `current` и есть ответ на вопрос «что убрать при выгрузке».

### Ошибка в одном файле не роняет пакет

Файлы фич запускаются по одному, каждый через `loadfile` и `pcall`:

```pluto
for _, path in ipairs(files) do
    -- Timed (loader.report): compiling and running the file, with the lib files it loads
    local ok, err = Atdar.loader.measure(path, function()
        local chunk, load_err = loadfile(path)
        if not chunk then
            return false, load_err
        end
        return pcall(chunk)
    end)

    if ok then
        loaded += 1
    else
        log:error($"feature file failed: {path}\n{err}")
    end
end
```

Сломанный файл или занятый id пропускает только этот файл. Но пункт для пропущенной фичи `features.get` не
найдёт и бросит ошибку, поэтому для необязательных фич в файле меню проверяют `Atdar.features.has(id)`.

## Изоляция: что принадлежит пакету

| Ресурс | Как отделён | Как убирается при выгрузке |
|---|---|---|
| фичи | id, появившиеся во время загрузки (`feature_ids`) | `features.remove(id)`: сначала выключает фичу |
| пункты меню | свой `MenuNode` под корнем (`menu_node` в `root.pluto`) | `clear_menu()`: галочки выключаются, пункты удаляются |
| переводы | отдельный источник строк (`strings`) | `i18n.remove_source(strings)` |
| команды | созданы между `begin_menu` и `end_menu` | уходят вместе с пунктами |
| раздел настроек | отметка `settings_mark` | `restore_settings(mark)` |

Сама выгрузка:

```pluto
local function unload_current(): void
    if not current then
        return
    end
    -- Settings first: the menu may have hosted them in one of its own lists (settings.set_parent),
    -- and clearing that list would leave the settings section pointing at deleted items
    hooks.remove_settings()
    -- Then items: switching their toggles off disables features the normal way, through Stand
    hooks.clear_menu()
    for _, id in ipairs(current.feature_ids) do
        features.remove(id)
    end
    hooks.restore_settings(current.settings_mark)
    i18n.remove_source(current.strings)
    current = nil
end
```

Порядок здесь тоже важен: сначала настройки, потом пункты (их галочки выключают фичи обычным путём, через
Stand), потом сами фичи, и в конце строки.

### Команды пакета

У команд скрипта и команд загруженного меню разные префикс и разделитель, поэтому одинаковое базовое имя в
обоих не столкнётся. Пользователь может дать команде своё имя и дополнительные слова; для пакета они хранятся в
его же папке, по файлу на команду: `commands/<имя>.json` вида `{ "name": "god", "words": ["gm", "immortal"] }`.
Подробно про команды — урок 5.

### Имена: договорённости

Движок не добавляет имя пакета к id и ключам сам, поэтому уникальность — на авторе:

- **id фич** уникальны среди всех загруженных. Принято начинать с имени пакета: `examplepack.self.heal`.
- **Ключи переводов** тоже начинают с имени пакета: строки пакета ищутся раньше строк скрипта и могут их
  перекрыть.

## Встроенное меню и копия в ядро

Меню, загруженное вручную, не получает сохранённые состояния пунктов из профиля Stand. Причина сказана в
комментарии `load_menu`:

```pluto
-- Stand applies the active profile only to items created during the script's main body,
-- so a menu loaded later by hand starts without the profile's states
```

Решение — «встроенное меню»: пакет копируется внутрь скрипта (`lib/<скрипт>/ui/stand/menu_from_store/`) и
строится на старте, в основном теле скрипта. Ключ профиля `auto_copy_menu` называет папку пакета, который
копируется при каждом запуске; по умолчанию это `"AnitaDarin"`. Копия обновляется, только если пакет в `store`
изменился. Что именно скопировано, записано в `.copied.json`, чтобы потом убрать ровно это.

Конец [root.pluto](../../src/lib/AnitaDarin/ui/stand/root.pluto) показывает всю логику старта:

```pluto
-- Built here, in the script's main body, the auto-copied menu's items get the states saved in Stand's profile
loader.auto_copy()

if menu_loader.has_builtin() then
    loader.load_builtin()
else
    -- The root says so itself (show_notice): in the log only, no notification on top of it
    log:info("built-in menu not found, a menu can be loaded from store")
    show_notice()
    module.settings = settings.build(module.root)
end
```

## Пошагово: свой пакет

**1. Папка и `info.json`.** Создайте `src/store/AnitaDarin/menu/MyPack/info.json`:

```json
{
    "id": "MyPack",
    "name": "MyPack",
    "author": "You",
    "version": "1.0.0"
}
```

**2. Фича** — `features/self/heal.pluto` (из [pack/ExamplePack](pack/ExamplePack/features/self/heal.pluto), с
вашим id):

```pluto
local Feature = Atdar.loader.load("features/feature")

return Atdar.features.add(new Feature({
    id = "mypack.self.heal",
    kind = "action",

    on_trigger = function(self)
        Atdar.natives.entity.set_health(Atdar.natives.player.get_ped_id())   -- no value: the maximum
    end,
}))
```

**3. Переводы** — `language/en-us.json` и `language/ru-ru.json` с одинаковыми ключами. Английский файл
нужен в первую очередь: английский текст — это «личность» метки Stand, остальные языки — её переводы. Без
английской строки пункт покажет запасной текст из кода, а если его нет — сам ключ.

```json
{
    "mypack": {
        "self": {
            "menu_name": "Игрок",
            "heal": {
                "menu_name": "Вылечить",
                "help": "Восстанавливает здоровье до максимума"
            }
        }
    }
}
```

**4. Файл меню** — `menu/stand/self.pluto`:

```pluto
local features = Atdar.features
local lang = Atdar.lang

return {
    build = function(node, ctx)
        local self_menu = node:list(lang.translate("mypack.self.menu_name"), { "mpself" })

        self_menu:add_feature(features.get("mypack.self.heal"),
            lang.translate("mypack.self.heal.menu_name"), { "mpheal" },
            lang.translate("mypack.self.heal.help"))
    end,
}
```

**5. Главный файл** — `menu/stand/main.pluto`. С него строится меню; остальные файлы подключаются через
`ctx.load` в нужном порядке:

```pluto
return {
    build = function(node, ctx)
        node:divider("MyPack")
        ctx.load("self").build(node, ctx)
    end,
}
```

**6. Запуск.** `python build.py sync`, перезапустить скрипт, затем «Настройки > Загрузить меню > MyPack».

Раздел настроек скрипта можно поместить в свой список пакета — так делает
[pack/ExamplePack/menu/stand/settings.pluto](pack/ExamplePack/menu/stand/settings.pluto).

## Попробуй сам

1. Скопируйте [pack/ExamplePack](pack/ExamplePack) в `src/store/AnitaDarin/menu/`, выполните
   `python build.py sync` и загрузите пакет. Затем загрузите другое меню и убедитесь, что пунктов и команд
   `ExamplePack` не осталось.

2. Сделайте в одном файле фичи синтаксическую ошибку и загрузите пакет. Что написано в логе? Что произошло с
   меню? Исправьте файл меню так, чтобы пакет строился и без этой фичи (`Atdar.features.has`).

3. Добавьте в свой пакет фичу `kind = "toggle"`, её пункт и строки на двух языках. Переключите язык Stand и
   проверьте, что имя пункта сменилось.

4. Удалите `menu/stand/main.pluto` из пакета. Появится ли пакет в списке «Загрузить меню»? Найдите функцию,
   которая это решает.

5. Проследите по `load_menu` и `unload_current`, что случится с фичей пакета, которая была включена в момент
   загрузки другого меню. В какой строке она выключается?

Подробнее про учебный пакет: [pack/README.ru.md](pack/README.ru.md).

Дальше: [Урок 5. Данные, локализация и команды](05-profiles-i18n-and-commands.md).
Назад: [Урок 3. Фичи и построение меню Stand](03-features-and-stand-ui.md).
