# Примеры AnitaDarin

[English](README.md) | **Русский**

Как пользоваться скриптом изнутри: писать модули, фичи и пакеты меню, строить меню, вести лог,
показывать уведомления, читать профиль, переводы и JSON, вызывать нативы.

Комментарии в коде на английском, как во всём проекте. Объяснения — в README каждой папки.

| Папка | Что внутри |
|---|---|
| [basics/](basics/README.ru.md) | Основа, которая нужна везде: лог и уведомления, профиль, переводы, JSON-файлы, нативы, проверки, парсеры и цвета |
| [modules/](modules/README.ru.md) | Модули: внутренние части скрипта, которые он запускает сам (без пункта в меню) |
| [features/](features/README.ru.md) | Фичи: то, что пользователь включает, выключает или нажимает в меню |
| [menu/](menu/README.ru.md) | Файлы меню: пункты `MenuNode`, фичи в меню, раздел настроек, отладка модулей в своём меню, готовые помощники |
| [pack/](pack/README.ru.md) | Полный пакет меню `ExamplePack`: info.json, фичи, меню, переводы — копируется и загружается целиком |

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
| Парсеры | `Atdar.parsers.<вид>` | `Atdar.parsers.proglang.pluto.args.parse("5, true")` |
| Модули | `Atdar.modules` | `Atdar.modules.get("VehicleManager")` |
| Фичи | `Atdar.features` | `Atdar.features.get("self.godmode")` |
| Цвета | `Atdar.color` | `Atdar.color.from_hex("FF8000")` |
| Проверки аргументов | `core/check` | `check.expecter("мой/файл")` |
| Отладка режима | `Atdar.debug` | `if Atdar.debug then ... end` |

## Как проверить пример в игре

1. Положите файл туда, куда говорит README его папки (`src/lib/AnitaDarin/modules/`, папка пакета и т.д.).
2. `python build.py sync` — копирует проект в Stand (`%APPDATA%/Stand/Lua Scripts`).
3. Перезапустите скрипт в Stand, а модуль можно просто «Перезагрузить» в «Настройки > Отладка > Модули».

Синтаксис примеров проверяет `python tests/run.py` вместе с остальным кодом.
