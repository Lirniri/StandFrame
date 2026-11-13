# Примеры StandFrame

[English](README.md) | **Русский**

Как пользоваться скриптом изнутри: писать модули, фичи и пакеты меню, строить меню, вести лог,
показывать уведомления, читать профиль, переводы и JSON, вызывать нативы.

Комментарии в коде на английском, как во всём проекте. Объяснения — в README каждой папки.

| Папка | Что внутри |
|---|---|
| [basics/](script/basics/README.ru.md) | Основа, которая нужна везде: лог и уведомления, профиль, переводы, JSON-файлы, нативы, проверки, парсеры и цвета |
| [modules/](script/modules/README.ru.md) | Модули: внутренние части скрипта, которые он запускает сам (без пункта в меню) |
| [features/](script/features/README.ru.md) | Фичи: то, что пользователь включает, выключает или нажимает в меню |
| [menu/](script/menu/README.ru.md) | Файлы меню: пункты `MenuNode`, фичи в меню, раздел настроек, отладка модулей в своём меню, готовые помощники |
| [pack/](script/pack/README.ru.md) | Полный пакет меню `ExamplePack`: info.json, фичи, меню, переводы — копируется и загружается целиком |
| [utils/](script/utils/README.ru.md) | Что построено на нативах в `Atdar.util.game`: Graceland (падение с любой высоты, управление стиком), функции игрока (`auto_heal`, `levitate`, `freecam` ...), мир (часы, облака, timecycle), помощники игры, `tools.states` |

## Уроки

Пошаговые уроки с разбором настоящего кода движка. В каждом — краткая теория, сравнение с обычным Lua,
фрагменты из StandFrame с путями к файлам и задания «Попробуй сам». Уроки написаны на русском.

### Язык Pluto в сравнении с Lua 5.4 — [programing/](programing/)

| Урок | О чём |
|---|---|
| [1. Pluto против обычного Lua](programing/01-lua-vs-pluto-syntax.md) | Таблица отличий; `$"..."`, типы в сигнатурах, `??`, `?.`, `+=`, `?:`, `<close>` на коде `core/loader` и `core/i18n` |
| [2. ООП и система типов](programing/02-oop-classes-and-types.md) | Метатаблицы против `class`; устройство `Feature` и `Module`; проверки `core/check` |
| [3. Стандартная библиотека Pluto и парсеры](programing/03-pluto-stdlib-and-parsers.md) | `pluto:json`, `pluto:crypto`, `io.listdir`, `startswith`; парсеры `json`, `color`, `source`; как работает Call Function |

### Движок StandFrame — [script/](script/)

| Урок | О чём |
|---|---|
| [1. Точка входа и архитектура ядра](script/01-engine-architecture-and-entry.md) | Лаунчер, порядок запуска в bootstrap, загрузчик `core/loader`, общая схема |
| [2. Модули и жизненный цикл](script/02-modules-and-lifecycle.md) | Модуль таблицей и классом, зависимости, статусы, тики, горячая перезагрузка, `file_watch` |
| [3. Фичи и построение меню Stand](script/03-features-and-stand-ui.md) | Три вида фич, реестр, `MenuNode` и `MenuItem`, `menu_builder`, отладчик модулей |
| [4. Создание собственных Menu Packs](script/04-creating-menu-packs.md) | Устройство пакета, загрузка и выгрузка, изоляция ресурсов, свой пакет по шагам |
| [5. Данные, локализация и команды](script/05-profiles-i18n-and-commands.md) | `JsonFile`, профили с автосохранением, переводы и ленивая загрузка языков, лог, команды Stand |
| [6. Тестирование на стабах Stand API](script/06-testing-with-stand-stubs.md) | Раннер `tests/run.py`, заглушка `tests/stand.pluto`, как писать свои тесты |

С чего начать: если Pluto вам в новинку — с уроков `programing/`; если язык знаком — сразу с `script/`.
Готовые файлы-примеры, на которые ссылаются уроки, лежат в папках из таблицы выше.

## Что где лежит в `Atdar`

| Что | Где | Пример |
|---|---|---|
| Загрузка файлов `lib` | `Atdar.loader.load("путь")` | `local Module = Atdar.loader.load("core/module")` |
| Лог и уведомления | `core/logger` | `local log = new Logger("Имя")`, `log:notify("...")` |
| Уведомление как есть | `Atdar.util.toast(text, opts)` | `Atdar.util.toast("Готово", { target = "game" })` |
| Профиль (настройки) | `Atdar.profile` | `Atdar.profile.get("notify")` |
| Переводы | `Atdar.lang` | `Atdar.lang.translate("menu.self.menu_name")` |
| Пути | `Atdar.filesystem.paths` | `paths.store`, `paths.lib`, `paths.resources` |
| JSON-файл | `Atdar.filesystem.json.File` | `new File(path):read()` / `:write(t)` |
| Нативы | `Atdar.natives.<раздел>` | `Atdar.natives.entity.vehicle.delete(handle)` |
| Память игры | `Atdar.natives.memory` | `Atdar.natives.memory.pointers.get("roll_check")` |
| Свой код для Call Function | `Atdar.user_script` | `Atdar.user_script.hello("you")` |
| Парсеры | `Atdar.parsers.<вид>` | `Atdar.parsers.proglang.pluto.args.parse("5, true")` |
| Модули | `Atdar.modules` | `Atdar.modules.get("VehicleManager")` |
| Фичи | `Atdar.features` | `Atdar.features.get("self.godmode")` |
| Игрок и мир | `Atdar.util.game` | `Atdar.util.game.players.user.auto_heal.enable()` |
| Цвета | `Atdar.color` | `Atdar.color.from_hex("FF8000")` |
| Проверки аргументов | `core/check` | `check.expecter("мой/файл")` |
| Отладка режима | `Atdar.debug` | `if Atdar.debug then ... end` |

## Как проверить пример в игре

1. Положите файл туда, куда говорит README его папки (`src/lib/AnitaDarin/modules/`, папка пакета и т.д.).
2. `python build.py sync` — копирует проект в Stand (`%APPDATA%/Stand/Lua Scripts`).
3. Перезапустите скрипт в Stand, а модуль можно просто «Перезагрузить» в «Настройки > Отладка > Модули».

`python tests/run.py` проверяет синтаксис всех примеров. Кроме того, `test_examples` запускает на заглушках Stand
примеры модулей, фич, пакета и помощников меню, а также `basics/06_check` и `basics/07_parsers_and_colors`.
В примерах нативов проверяются имена обёрток, но вызовы игры не запускаются; остальные примеры `basics` проверяются
только на синтаксис.
