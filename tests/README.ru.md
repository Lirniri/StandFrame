# Тесты

[English](README.md) | **Русский**

Проверяют код скрипта вне игры, на заглушках API Stand. Нужен установленный Pluto (`pluto` и `plutoc`).

```
python tests/run.py          все проверки
python tests/run.py json     только тесты, в имени которых есть "json"
python tests/run.py -v       показать вывод и у прошедших тестов
```

Что проверяется:

1. **syntax** — `plutoc` разбирает каждый `.pluto` в `src`, `examples` и `tests` (со строкой `pluto_use`, как в лаунчере).
2. **natives** — каждый вызов `ПРОСТРАНСТВО.НАТИВ(...)` в `src` есть в дампе нативов
   `experiments/natives-3407a/init.lua`. Дамп не хранится в git; если его нет, шаг пропускается.
3. **tests** — каждый `tests/test_*.pluto` запускается отдельным процессом `pluto`.

| Тест | Что проверяет |
|---|---|
| `test_loader` | `loader.load` переживает сломанные файлы; `loader.auto` достаёт каждый файл `natives` |
| `test_natives` | нативы функциями: `entity`, `ped` и его части, `vehicle`, `player`, `hud.blip`; таблицы `hud_color` и `feed_picture` |
| `test_feature` | проверку опций Feature, порядок хуков, выключение при ошибке, повторные нажатия |
| `test_module_manager` | зависимости, остановку по цепочке, повторный запуск, тик, перезагрузку с диска |
| `test_modules_menu` | меню модулей: видимость в режиме отладки, действия, перевод |
| `test_script_menu` | раздел скрипта: раскладку, выбор языка, профили, заглушки, переименование |
| `test_menu_startup` | запуск как в bootstrap: копирование пака в ядро, загрузку встроенного меню |
| `test_menu_utils` | `utils/menu`: выбор цвета, спойлер; `utils/color`: hex, Stand, игра |
| `test_installer` | переименование скрипта с открытым лог-файлом, занятое имя, занятая папка |
| `test_logger` | логгер: файл на каждый день `<скрипт>_<дата>.log` в `store/<скрипт>/logs`, новый файл в новый день, срок хранения, очистка, сломанный файл |
| `test_notify` | куда уходят уведомления: Stand, лента игры, только лог; правило для ошибок |
| `test_build.py` | `build.py`: установку под найденным именем, сохранение профилей и логов, очистку |
| `test_json_file` | JsonFile: безопасную запись, испорченные файлы, `.bak`; профили поверх него |
| `test_commands` | имена команд с префиксом профиля и переименование на лету |
| `test_i18n` | строки из языковых файлов через метки Stand, слои источников |
| `test_i18n_keys.py` | каждый ключ, написанный в коде (`lang.translate`, `i18n.label`/`text`, `label`/`text` из scope), есть в английских файлах |
| `test_streaming` | загрузку ассетов каждого типа (и `texture_dict`, `model`), `request(false)`, таймауты |
| `test_examples` | примеры работают как написаны: модули, фичи, пакет, `basics`, `menu/helpers`; все функции, которые вызывают примеры нативов, существуют |
| `test_check` | `core/check`: `expecter` для аргументов функций и `validator` для опций; ошибки `Module` и `Feature` указывают на строку, где написаны опции, и через `extends` тоже |
| `test_parsers` | `parsers/`: hex-цвет (`color`), строгий JSON (`json`); Pluto в `proglang.pluto`: аргументы (`args`), слова имени (`name`), типы из исходника (`source`), пути (`path`); имена команд Stand (`stand.command_box`); фасады |
| `test_updater` / `test_updater_manifest.py` | обновлялка из `updater/` на фейковом GitHub и генератор манифеста |

## Как написать тест

```lua
local stand = require("stand")   -- заглушка Stand: util, filesystem, menu, lang
stand.boot()                     -- Atdar с загрузчиком, как в лаунчере

local thing = Atdar.loader.load("core/...")
stand.equal(thing.value(), 5, "что проверяем")
stand.check(stand.find_log("текст"), "что-то записано в лог")

stand.finish()                   -- итог и код выхода
```

Полезное из `stand.pluto`:
- `stand.click(item, option)` — нажать пункт меню, как пользователь;
- `stand.frame(n)` — прогнать n кадров (тики модулей и `toggle_loop`);
- `stand.clock` и `stand.on_yield` — время для `util.yield`;
- `stand.tmpdir(name)` — пустая папка в `tests/.tmp`;
- `stand.store` — куда смотрит `filesystem.store_dir()`; для тестов, которые пишут файлы, ставьте `stand.tmpdir(...)`.

Нативы игры (`PLAYER`, `ENTITY`, ...) тест подделывает сам — примеры в `test_streaming.pluto`.
Заглушка повторяет поведение Stand только в тех местах, которые нужны тестам. Поэтому тесты не заменяют проверку в игре: они ловят ошибки логики до неё.
