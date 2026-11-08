# Автообновление

[English](README.md) | **Русский**

Обновлялка скрипта. Пока лежит отдельно: скрипт её не загружает. Растёт вместе с проектом и будет подключена позже.

| Файл | Что делает |
|---|---|
| [updater.pluto](updater.pluto) | Обновлялка для Stand: сверяет установленные файлы с релизом, скачивает изменённые, удаляет убранные |
| [manifest.py](manifest.py) | Делает `manifest.json`: все файлы `src` из git с их sha256 — это и есть релиз |

## Как это работает

1. Перед отправкой в `main` запускается `python updater/manifest.py` (`--version 0.1.0`, чтобы задать версию).
   `--check` скажет, отстаёт ли манифест от `src`.
2. `updater.check()` скачивает `updater/manifest.json` из `main` и сравнивает каждый файл с установленным по хешу.
   Текст сравнивается без `\r`, так что копия с `\r\n` не считается изменённой.
3. `updater.apply(plan)` скачивает изменённые файлы, сверяет каждый с хешем из манифеста и, только если все
   сошлись, записывает их: сначала рядом (`.update`), потом поверх. Ошибка на любом шаге — ничего не меняется.

Скрипт с другим именем обновляется под своим: `lib/AnitaDarin/...` из репозитория пишется в `lib/<имя>/...`.
Пути вне папок скрипта манифест записать не может.

## Что не трогается

- Данные пользователя в `store/<имя>/`: `config.json`, папки `profiles`, `logs`, `commands` (и у паков меню).
  Создаются, только если их нет.
- Файлы, которых обновлялка не ставила: меню, скопированное в ядро, свои паки, свои модули.
  Удаляются только файлы, которые были в прошлом установленном релизе (`store/<имя>/updater/installed.json`)
  и пропали из нового. После установки через `build.py` первое обновление ничего не удаляет.

## Пример

```lua
local updater = require("updater")
util.create_thread(function()
    local plan, err = updater.check({ name = Atdar.name })
    if plan == nil then
        util.toast(err)
        return
    end
    if updater.is_up_to_date(plan) then
        return
    end
    local ok, apply_err = updater.apply(plan, |done, total| -> util.draw_debug_text($"{done}/{total}"))
    if ok then
        util.restart_script()
    end
end)
```

Тесты: [tests/test_updater.pluto](../tests/test_updater.pluto) (фейковый GitHub) и
[tests/test_updater_manifest.py](../tests/test_updater_manifest.py).
