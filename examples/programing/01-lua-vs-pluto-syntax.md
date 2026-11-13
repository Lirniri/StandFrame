# Урок 1. Pluto против обычного Lua на примерах движка

StandFrame написан на **Pluto** — диалекте Lua 5.4, который встроен в Stand. Любой код на Lua 5.4 остаётся
рабочим кодом на Pluto, но поверх него Pluto добавляет синтаксис, из-за которого файлы движка выглядят иначе,
чем привычный Lua. В этом уроке разбираем эти отличия на настоящих фрагментах из
[core/loader.pluto](../../src/lib/AnitaDarin/core/loader.pluto) и
[core/i18n.pluto](../../src/lib/AnitaDarin/core/i18n.pluto).

Версию языка задаёт первая строка лаунчера [src/AnitaDarin.pluto](../../src/AnitaDarin.pluto):

```pluto
pluto_use "0.13.2"
```

Она включает ключевые слова Pluto (`class`, `new`, `switch`, `continue` ...) для всех файлов скрипта. Тесты
(`tests/run.py`) подставляют ту же строку, когда проверяют синтаксис.

## Сводная таблица

| Что | Lua 5.4 | Pluto 0.13.x | Где в движке |
|---|---|---|---|
| Подстановка в строку | `"a " .. x .. " b"` | `$"a {x} b"` | везде |
| Составное присваивание | `n = n + 1`, `s = s .. "x"` | `n += 1`, `s ..= "x"` | `loader.measure`, `loader.report` |
| Значение по условию | `cond and a or b` | `cond ? a : b` | `i18n.watch_path`, `file.read` |
| Значение по умолчанию | `x = x or {}` | `x ??= {}`, `a ?? b` | `loader.keep`, `Feature.__construct` |
| Поле у возможного `nil` | `t and t.f or nil` | `t?.f` | `i18n.base_dir` |
| Не равно, отрицание | `~=`, `not x` | ещё и `!=`, `!x` | `Feature.tick` (`if !self.enabled`) |
| Типы в сигнатуре | нет (только комментарии) | `f(a: string, b: ?int): bool` | везде |
| Аргумент по умолчанию | `if b == nil then b = 5 end` | `f(a, b: int = 5)` | `loader.report`, `file.read` |
| Короткая функция | `function(a, b) return a < b end` | `\|a, b\| -> a < b` | `loader.report`, `i18n.scope` |
| Пропуск итерации | `goto continue` | `continue` | `bootstrap.pluto`, `path.resolve` |
| Обход таблицы | `for k, v in pairs(t) do` | ещё и `for k, v in t do` | `bootstrap.pluto`, `file_watch` |
| Классы | метатаблицы вручную | `class`, `new`, `extends` | урок 2 |
| Начало строки | `s:sub(1, #p) == p` | `s:startswith(p)` | урок 3 |
| Закрытие ресурса | `local h <close> = ...` | то же самое (это уже Lua 5.4) | `file.read` |

В Pluto есть ещё `switch`/`case`, `enum` и оператор `in` (`"a" in { "a", "b" }`). Они работают, но в движке
StandFrame не используются, поэтому в уроке их нет.

## Как читать разборы

Каждый пример идёт в три шага: **как писали бы на обычном Lua → как написано в StandFrame → что это даёт**.
Сразу честно про «быстрее»: почти весь новый синтаксис компилируется в тот же байткод, что и длинная запись на
Lua. Выигрыш в основном в читаемости и в том, что негде ошибиться. Там, где есть настоящая разница в скорости,
это сказано отдельно.

## 1. Строковая интерполяция: `$"{var}"`

`loader.load` собирает имя файла для `require` и строку лога.

Обычный Lua:

```lua
local name = Atdar.name .. "/" .. path
log:error("failed to load '" .. path .. "' (from " .. caller() .. ")\n" .. result)
```

StandFrame ([core/loader.pluto](../../src/lib/AnitaDarin/core/loader.pluto), `module.load`):

```pluto
local name = $"{Atdar.name}/{path}"
...
log:error($"failed to load '{path}' (from {caller()})\n{result}")
```

**Что это даёт.** Строка читается как готовый текст, а не как цепочка `..`. В фигурных скобках может стоять
любое выражение, в том числе вызов (`{caller()}`) и арифметика (`{#sorted}`). По скорости это та же конкатенация.

Две ловушки, на которые проект уже наступал:

- Кавычка `"` **вне** фигурных скобок закрывает строку. Внутри текста пишите одинарные: `$"module '{name}'"`.
- Сложное выражение с кавычками и скобками лучше сначала положить в локальную переменную, а в строку
  подставить её.

## 2. Составные операторы: `+=`, `..=`

`loader.measure` считает, сколько времени ушло на вложенные загрузки, а `loader.report` дописывает итог.

Обычный Lua:

```lua
parent.nested = parent.nested + total
summary = summary .. ", the whole start " .. ms(total_ms) .. " ms"
forgotten = forgotten + 1
```

StandFrame ([core/loader.pluto](../../src/lib/AnitaDarin/core/loader.pluto)):

```pluto
parent.nested += total
...
summary ..= $", the whole start {ms(total_ms)} ms"
...
forgotten += 1
```

**Что это даёт.** Имя слева пишется один раз. В длинной записи легко опечататься во втором имени
(`parent.nested = parents.nested + total`) и получить ошибку только во время работы. Правило проекта
([CLAUDE.md](../../CLAUDE.md)): в `.pluto` всегда `count += 1`.

## 3. Тернарный оператор: `cond ? a : b`

`i18n.watch_path` выбирает разделитель для уведомления.

Обычный Lua:

```lua
log:notify(table.concat(parts, newline and "\n" or " | "), "stand")
```

StandFrame ([core/i18n.pluto](../../src/lib/AnitaDarin/core/i18n.pluto), `module.watch_path`):

```pluto
log:notify(table.concat(parts, newline ? "\n" : " | "), "stand")
```

**Что это даёт.** Идиома `a and b or c` ломается, когда `b` равно `false` или `nil`: тогда всегда выходит `c`.
Тернарный оператор этой ошибки не имеет.

Правило проекта: `?:` годится для выбора между **значениями** (`binary ? "rb" : "r"`). Выбор между **вызовами**
пишется через `if` и ранний `return`, чтобы было видно, что и когда выполняется.

## 4. Значение по умолчанию: `??` и `??=`

`loader.keep` отдаёт таблицу, которая переживает перезагрузку файла.

Обычный Lua:

```lua
function module.keep(name)
    if kept[name] == nil then
        kept[name] = {}
    end
    return kept[name]
end
```

StandFrame ([core/loader.pluto](../../src/lib/AnitaDarin/core/loader.pluto), `module.keep`):

```pluto
function module.keep(name: string): table
    kept[name] ??= {}
    return kept[name]
end
```

`??` — то же самое как выражение. Так `Feature` берёт хук из опций, а если его нет — свой метод
([features/feature.pluto](../../src/lib/AnitaDarin/features/feature.pluto), `__construct`):

```pluto
self.on_tick = opts.on_tick ?? self.on_tick
```

**Что это даёт.** `??` смотрит только на `nil`. Привычное `x or y` подменяет ещё и `false`:

```pluto
print(false ?? "x")  -- false
print(false or "x")  -- x
```

Для настройки со значением `false` запись через `or` молча вернёт значение по умолчанию. `??` — нет.

## 5. Безопасная навигация: `?.`

`i18n.base_dir` отдаёт папку первого источника строк, а источников может ещё не быть.

Обычный Lua:

```lua
local first = sources[1]
return first and first.dir or nil
```

StandFrame ([core/i18n.pluto](../../src/lib/AnitaDarin/core/i18n.pluto), `module.base_dir`):

```pluto
function module.base_dir(): ?string
    local first = sources[1]
    return first?.dir
end
```

**Что это даёт.** Если слева `nil`, всё выражение даёт `nil` без ошибки «attempt to index a nil value». Так же
написано `parent?.scope_prefix` в [ui/stand/core/menu_node.pluto](../../src/lib/AnitaDarin/ui/stand/core/menu_node.pluto).

## 6. Типы в сигнатуре

Обычный Lua (тип виден только из комментария):

```lua
-- key: string, fallback: string or nil; returns a number
function module.label(key, fallback)
```

StandFrame ([core/i18n.pluto](../../src/lib/AnitaDarin/core/i18n.pluto)):

```pluto
function module.label(key: string, fallback: ?string = nil): int
...
local function key_in(source: table, key: string): ?string
...
function module.report(total_ms: ?number, limit: int = 15): void
```

Как это читать:

- `key: string` — тип аргумента;
- `?string` — строка или `nil`;
- `int|string` — один из нескольких типов;
- `limit: int = 15` — значение по умолчанию, если аргумент не передан;
- `): int`, `): ?string`, `): void` — что функция возвращает.

**Важно: типы проверяет компилятор, а не работающая программа.** Если компилятор видит несовпадение, он выдаёт
предупреждение. Во время работы функция с `a: string` спокойно примет число:

```pluto
local function f(a: string): string
    return $"{a}!"
end
print(pcall(f, 12))  -- true  12!
```

Поэтому там, где неверный аргумент должен быть именно ошибкой, движок проверяет его сам через
[core/check.pluto](../../src/lib/AnitaDarin/core/check.pluto) — об этом урок 2.

Ловушки с типами, найденные в проекте:

- `function` в подсказке типа **внутри класса** (`__construct(target: int|function)`) ломает компиляцию всего
  файла. Такую подсказку не пишут.
- `= nil` по умолчанию, за которым идут другие значения по умолчанию, сдвигает их. Вместо `= nil` пишут `?тип`.

## 7. Короткие функции и `continue`

Сортировка самых медленных файлов в `loader.report`.

Обычный Lua:

```lua
table.sort(sorted, function(a, b) return a.own > b.own end)
```

StandFrame ([core/loader.pluto](../../src/lib/AnitaDarin/core/loader.pluto)):

```pluto
table.sort(sorted, |a, b| -> a.own > b.own)
```

Так же `i18n.scope` возвращает сразу две функции — `label` и `text` для одной части строк:

```pluto
function module.scope(part: string)
    return |key, fallback| -> module.label($"{part}.{key}", fallback),
        |key, fallback| -> module.text($"{part}.{key}", fallback)
end
```

`continue` пропускает остаток итерации. В [bootstrap.pluto](../../src/lib/AnitaDarin/bootstrap.pluto) видны
сразу и он, и обход таблицы без `pairs`:

```pluto
for _, name in UTILS do
    -- Not Atdar.game: it is in utils/util/game
    if name == "game" then
        Atdar.util[name] = Atdar.loader.load($"utils/util/{name}")
        continue
    end
    Atdar[name] = Atdar.loader.load($"utils/{name}")
end
```

В Lua 5.4 для этого нужен `goto continue` и метка в конце цикла.

## 8. Атрибут `<close>`

`<close>` — не изобретение Pluto: он есть в Lua 5.4, и Pluto его наследует. Но старый код (Lua 5.1, LuaJIT) его
не знает, поэтому сравнение полезно.

Старый способ:

```lua
local handle = io.open(path, "r")
if handle == nil then
    return nil
end
local ok, content = pcall(handle.read, handle, "*a")
handle:close()
```

StandFrame ([core/filesystem/file.pluto](../../src/lib/AnitaDarin/core/filesystem/file.pluto), `module.read`):

```pluto
local handle <close> = io.open(path, binary ? "rb" : "r")
if handle == nil then
    return nil
end

-- A read that fails (a file locked half way, a disk error): <close> still closes the handle
local ok, content = pcall(handle.read, handle, "a")
```

**Что это даёт.** Переменная с `<close>` закрывается сама при выходе из блока — при обычном `return`, раннем
`return` и при ошибке. Забыть `handle:close()` на одной из веток нельзя.

Там же видно, где `<close>` **не** подходит. `module.write` закрывает файл явно, потому что ему нужен результат
закрытия: переполненный диск сообщает об ошибке именно в `close`. А логгер держит файл открытым весь день, и
блока, из которого можно «выйти», у него нет.

## Попробуй сам

1. Перепишите на Pluto, используя `$"..."`, `+=`, `??=`, `?.`, `?:` и типы:

   ```lua
   local counts = {}

   local function count_word(word, settings)
       if counts[word] == nil then
           counts[word] = 0
       end
       counts[word] = counts[word] + 1
       local sep = settings and settings.separator or nil
       return word .. (sep ~= nil and sep or ": ") .. counts[word]
   end
   ```

2. Найдите в [core/loader.pluto](../../src/lib/AnitaDarin/core/loader.pluto) функцию `module.now` и объясните,
   зачем в ней три ветки. Подсказка: комментарий над функцией.

3. Проверьте сами разницу `??` и `or`: что вернёт `settings.enabled ?? true` и `settings.enabled or true`, когда
   `settings.enabled == false`? Какая запись подходит для настройки «включено по умолчанию»?

4. Объясните, почему в `file.write` нельзя просто заменить явное закрытие на `<close>`.

Дальше: [Урок 2. ООП и система типов](02-oop-classes-and-types.md).
