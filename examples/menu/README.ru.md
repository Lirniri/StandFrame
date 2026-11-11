# Примеры меню

[English](README.md) | **Русский**

Меню пакета — это файлы `menu/stand/*.pluto` в папке пакета. Каждый возвращает таблицу с
`build(node, ctx)`:

- `node` — `MenuNode`, место в меню, куда добавлять пункты;
- `ctx.load("имя")` — другой файл меню из той же папки (загружается один раз за построение).

Всё начинается с `main.pluto`: он вызывает остальные файлы.

```lua
-- menu/stand/main.pluto
return {
    build = function(node, ctx)
        node:divider("ExamplePack")
        ctx.load("items").build(node, ctx)
        ctx.load("features").build(node, ctx)
        ctx.load("settings").build(node, ctx)
    end,
}
```

| Файл | Что показывает |
|---|---|
| `items.pluto` | Все виды пунктов `MenuNode`: разделитель, текст, ссылка, кнопка, галочка, ползунки, выбор, поле, цвет, подсписок |
| `features.pluto` | Фичи в меню через `add_feature`, проверка `features.has`, ползунки для настроек фичи |
| `settings.pluto` | Раздел настроек скрипта внутри своего списка и свои пункты в нём |
| `modules_debug.pluto` | Отладка модулей в своём меню: `modules_menu.list_in` и `module_in` |
| `helpers.pluto` | Готовые помощники: кнопка с подтверждением, спойлер, подменю из таблицы |

## Пункты `MenuNode`

| Метод | Пункт |
|---|---|
| `divider(name)` | Разделитель |
| `readonly(name, value)` | «Имя: значение» |
| `readonly_name(name)` | Строка текста |
| `hyperlink(name, link, help)` | Ссылка |
| `list(name, commands, help, on_back, on_open)` | Подсписок, возвращает `MenuNode` |
| `action(name, on_click, commands, help)` | Кнопка |
| `toggle(name, on_change(on), commands, help, default)` | Галочка |
| `slider(name, min, max, default, step, on_change(value), commands, help)` | Числовой ползунок |
| `text_slider(name, options, on_click(index, name), commands, help)` | Выбор стрелками |
| `list_action(name, options, on_select(index, name), commands, help)` | Выбор из списка |
| `text_input(name, commands, on_change(value), help, default)` | Поле ввода (команды обязательны) |
| `color(name, default, on_change(colour), commands, help, transparency)` | Цвет |
| `add_feature(feature, name, commands, help)` | Пункт фичи по её виду |

## Готовые помощники

| Что | Как | Для чего |
|---|---|---|
| Кнопка с подтверждением | `confirm.action(node, name, again_name, on_confirm, on_first, help)` | Необратимое: действует только по второму нажатию в течение 5 секунд. Возвращает пункт и `cancel()` |
| Спойлер | `Atdar.menu.spoiler(node.handle, name, value, hidden_text, help)` | Значение скрыто до нажатия |
| Подменю из таблицы | `builder.build_items(node, items, where)` | Те же пункты, записанные данными. Ошибка в таблице — предупреждение в логе, пункт пропускается |

`confirm` — это `Atdar.menu.confirm`, `builder` — `Atdar.menu.builder`.

## `Atdar.menu`: всё для меню в одном месте

Пакету не нужно знать, где в `lib` лежит каждая часть меню скрипта: они берутся из `Atdar.menu` и загружаются
при первом обращении.

| Что | Для чего |
|---|---|
| `Atdar.menu.Node` | `MenuNode`: `new Atdar.menu.Node(ref)` оборачивает ссылку Stand |
| `Atdar.menu.builder` | `builder.build_items(node, items)` — подменю из таблицы |
| `Atdar.menu.confirm` | `confirm.action(...)` — кнопка с подтверждением |
| `Atdar.menu.settings` | Раздел настроек скрипта: `set_parent`, `set_divider`, `set_name`, `add` |
| `Atdar.menu.commands` | Имена команд с префиксом профиля: `names`, `track` |
| `Atdar.menu.arguments` | Поля для аргументов функции по их типам |
| `Atdar.menu.modules` | `list_in(node)`, `module_in(node, name)` — список модулей в своём меню |
| `Atdar.menu.clicks` | `is_user_action(click_type)` — нажал пользователь или Stand сам вызвал обработчик |
| `Atdar.menu.spoiler`, `Atdar.menu.color` | Пункты, которых нет в Stand готовыми |

**Команды.** `commands` — базовые имена команд без префикса: `{ "heal" }` станет `atdarheal`.
Пользователь может переименовать их в «Настройки > Командная строка».

**Названия.** Обычный текст или метка из `Atdar.lang.translate("ключ")`. Метка переводится в языке
Stand и сама меняется при смене языка.
