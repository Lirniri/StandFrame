# Примеры меню

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

**Команды.** `commands` — базовые имена команд без префикса: `{ "heal" }` станет `atdarheal`.
Пользователь может переименовать их в «Настройки > Командная строка».

**Названия.** Обычный текст или метка из `Atdar.lang.translate("ключ")`. Метка переводится в языке
Stand и сама меняется при смене языка.
