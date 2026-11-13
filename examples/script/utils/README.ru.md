# Утилиты

[English](README.md) | **Русский**

Что построено на нативах, в `Atdar.util.game`: то, что несколько нативов делают вместе. Главное здесь Graceland.

Папки повторяют код: `players/user/` это `Atdar.util.game.players.user` (локальный игрок: Graceland работает только на нём,
берёт его id и его пед), `entity/` это `Atdar.util.game.entity`, `world/` это `Atdar.util.game.world`, `tools/` это `Atdar.util.game.tools`, `data/` это `Atdar.util.game.data`.

| Файл | Что показывает |
|---|---|
| `players/user/01_graceland.pluto` | `Atdar.util.game.players.user.graceland`: `enable`, `disable`, `is_enabled` и все настройки |
| `players/user/02_graceland_feature.pluto` | Graceland как переключатель-фича в меню |
| `players/user/03_helpers.pluto` | Из чего собран Graceland: стик в мире, защита от падения, восстановление брони и выносливости |
| `players/user/04_landing_roll.pluto` | `landing_roll`: держит игроку направление перед землёй, чтобы игра сделала перекат; кирпичики, из которых он собран (`natives.input.ACTION`, `press_next_frame`, `ped.is_plain_falling`, `entity.get_horizontal_speed`) |
| `players/user/05_player_functions.pluto` | Функции игрока, собранные на тикере (`auto_heal`, `levitate`, `freecam`, `damage`, `air_swim` ...): `enable`, `disable`, `is_enabled`, числа для настройки, `outfit` и свой цикл через `ticker.make` |
| `players/user/06_patches_and_physics.pluto` | Функции по мотивам Stand-OSS: байтовые патчи кода игры с реестром (`preserve_walk_style`, `no_hair_scale`, `wheel_on_wheels`, `natives.memory.patch.register/apply`), `rewind`, `super_drive`, `super_handbrake`, `no_stunt_jumps`, `floppy_mode`, `gravity_gun` |
| `entity/01_ped.pluto` | `entity.ped`: выход из ragdoll с сохранением скорости, включённые флаги педа (любого), запуск и остановка анимации |
| `entity/02_vehicle.pluto` | `entity.vehicle`: ремонт транспорта, переворот на колёса |
| `world/01_world.pluto` | `Atdar.util.game.world`: часы, timecycle, облака, дальность прорисовки, затемнение, пешеходы |
| `tools/01_states.pluto` | `Atdar.util.game.tools.states`: опрашивает все нативы `is_` / `has_` / `can_` и показывает, что изменилось |
| `tools/02_fall_lab.pluto` | `Atdar.util.game.tools.fall_lab`: лаборатория управления падением без ragdoll: `arm()` / `arm_loop()`, которые сами ловят падение (или каждое падение подряд) и следят за флагами и активными задачами педа в воздухе (при желании каждый кадр) (покадровая запись со сводкой по окнам времени и изменения флагов педа в воздухе), флаги педа до и после момента, способы управления для проб, помощь с перекатом (клавиша вперёд перед землёй) |
| `vehicle/01_handling.pluto` | `Atdar.util.game.vehicle.handling`: числа управляемости транспорта по имени (`get`, `set`, `scale`, `set_bits`), держатели и путь назад (`reset`, `reset_model`, `reset_all`) |
| `vehicle/02_current_vehicle.pluto` | Изменения, которые держатся, пока игрок за рулём: `drift_mode`, `lessen_burnouts`, `heli_stabilisation`, `gravity`, `drive_on_water`, `forge_model`, помощник `on_current.create` и `natives.memory.holds` |
| `tools/03_task_list.pluto` | `Atdar.util.game.tools.task_list`: что делает пед, по памяти игры (деревья задач и список интеллекта, названия из `natives.memory.task_types`), вывод в лог, задачи над головами педов вокруг |
| `data/01_data_tables.pluto` | `Atdar.util.game.data`: компоненты оружия и транспорт по DLC (генерируются в `tools/`) и `Atdar.parsers.varint` |

## Graceland: падение с любой высоты

```pluto
local graceland = Atdar.util.game.players.user.graceland

graceland.enable()
if graceland.is_enabled() then ... end
graceland.disable()
```

Игрок падает и не умирает, а падением можно управлять стиком. Устроено так (выяснено опытом в игре):

1. После `ragdoll_distance` метров падения (по умолчанию 12) игра переводит игрока в ragdoll.
2. Пока он в ragdoll, `GIVE_PLAYER_RAGDOLL_CONTROL` даёт управлять им стиком.
3. Ragdoll, ударившийся о землю на скорости падения, убивает. Поэтому за `landing_time` секунд до земли (0,5) по текущей
   скорости ragdoll заканчивается: игрок встаёт в воздухе, сохраняет скорость, поворачивается так, как задано в
   `facing` (по умолчанию по камере), и приземляется на ноги без урона.
4. После касания защита держится ещё 0,6 с: игра решает про приземление чуть позже касания.
5. Ragdoll, ударившийся о стену в воздухе, заканчивается так же (`wall_protection`), и остаток падения идёт без ragdoll,
   то есть без управления.

#### Ragdoll

| Настройка | По умолчанию | Что делает |
|---|---|---|
| `set_steering(toggle)` | `true` | Начинается ли в падении ragdoll после дистанции, и им управляет стик (при включённом `set_air_control`). Выключено: ragdoll в падении нет совсем, смерти тоже; стик тогда управляет обычным падением через память |
| `set_ragdoll_distance(метры)` | `12` | После какого падения начинается ragdoll (не меньше 5, меньшее значение поднимается) |
| `set_safe_landing(toggle)` | `true` | Выключено: ragdoll приземляется как есть, и долгое падение убивает |
| `set_landing_time(секунды)` | `0.5` | За сколько до земли ragdoll заканчивается: 27 м при 55 м/с, 6 м при 12 м/с (не меньше 0,1) |
| `set_wall_protection(toggle)` | `true` | Ragdoll, влетевший в стену (выше 3 м от земли), заканчивается там: остаток падения без ragdoll и без урона |
| `set_facing(режим)` | `"camera"` | Куда смотрит игрок, когда ragdoll заканчивается: `"camera"` (куда смотрит камера), `"start"` (как он смотрел в начале падения), `"none"` (как оставил ragdoll, как попало) |
| `set_stuck_ragdoll(мс)` | `1500` | Ragdoll, лежащий столько после приземления, заканчивается; `0` - никогда |

#### Без ragdoll

| Настройка | По умолчанию | Что делает |
|---|---|---|
| `set_air_control(toggle)` | `true` | Управляет ли стик падением: при включённом `set_steering` управляет ragdoll (управление ragdoll), при выключенном обычным падением без ragdoll (флаги задачи падения игры, как графейсленд Stand; память читается по смещениям сборки игры). Выключено: управления нет совсем |
| `set_beast_fall(toggle)` | `true` | Ставит флаг `BEAST_FALL` задачи падения в управляемом падении. В игре анимации «руки в стороны» от него нет (найдено пробой), значит, это не бит той анимации: `Atdar.util.game.players.user.air_control.probe_bits()` перебирает биты флагов по одному, чтобы найти её. Выключено: только управление и гашение скорости. Работает при включённом `set_air_control`, переключается и посреди падения |
| `set_flag_protection(toggle)` | `false` | Попытка: в падении используются ещё и флаги педа из игры (удары не вызывают ragdoll, `NEVER_RAGDOLL` при выключенном управлении, стена по `PED_HIT_WALL_LAST_FRAME`). Управления не даёт |

#### Общие

| Настройка | По умолчанию | Что делает |
|---|---|---|
| `set_debug(toggle)` | `false` | По строке на событие падения в debug-лог |

Все они вызываются и из Call Function (`Atdar.util.game.players.user.graceland.set_ragdoll_distance`).

### Строка debug-лога

```
fall rag=1 can=1 cache=0 fall=1 air=1 h=250 v=22.3 F1 L0 J1 A1 hp=328 vel=5.8,2.4,-21.5 stick=-1.0,0.0 dir=-0.3,1.0
```

`rag` — ragdoll, `can` — что игра говорит про `CAN_PED_RAGDOLL`, `cache` — что выставил graceland, `fall` — падает,
`air` — в воздухе, `h` — высота над землёй, `v` — скорость, `F L J A` — флаги игры (чистое падение, приземление, прыжок,
в воздухе), `hp` — здоровье, `vel` — скорость вектором, `stick` — левый стик, `dir` — стик в мировых координатах
(сравнивайте с `vel`: управление работает, если `vel` идёт туда, куда смотрит `dir`). Первое слово — событие: `fall`
(раз в секунду), `AIR` и `LAND` (оторвался от земли или достиг её), `TOUCH` (скорость скакнула, касание),
`RAGDOLL STARTED`, `ragdoll ended`.

### Полезно знать

- Graceland от Stand нельзя включить, пока игрок в ragdoll: выключайте его перед проверкой этого.
- Прыжок с 8 до примерно 12 м заканчивается ragdoll, который прерывается у самой земли: так задумано (`landing_time`).
- Анимация прыжка зверя здесь не получается через `SET_BEAST_JUMP_THIS_FRAME`: в игре она не появилась.
- `disable()` в воздухе не снимает защиту сразу: падение остаётся защищённым до земли, потом всё возвращается (остановка
  скрипта снимает сразу). `is_enabled()` возвращает `false` с момента вызова.
- Модуль прогнан на заглушках игры (симуляция, смерть в ней взята из того, что видели в игре): с настройками по умолчанию
  выживают все высоты от 3 до 250 м и 30, 60 и 240 кадров в секунду. Это не сама игра: один очень длинный кадр (0,5 с и
  больше) у земли всё ещё может убить.

## Функции игрока

Каждый файл в `players/user/`, кроме Graceland, это одна функция локального игрока, названная по функции Stand, которой она
следует (`auto_heal`, `airwalk`, `auto_boost`, `damage`, `drunk_mode`, `exit_stop`, `freecam`, `infinite_ammo`,
`invisibility`, `levitate`, `move_freedom`, `no_collision`, `no_reload`, `auto_cancel_anim`, `air_swim`, `dont_jack_me`,
`leave_engine_running`, `no_roll_cooldown`). Те, что что-то делают каждый кадр, собраны через `ticker.make(name, tick,
release)` и имеют общие `enable()`, `disable()` и `is_enabled()`: ошибка в `tick` выключает функцию, а `release` возвращает
всё, что она изменила (в том числе когда скрипт остановлен). `ticker.config_flag(name, flag)` то же для конфиг-флага педа,
который держится включённым. `no_roll_cooldown` правит код игры, поэтому ему нужен указатель `combat_roll_patch` (см.
[basics/10_memory.pluto](../basics/10_memory.pluto)); без него `enable()` вернёт `false` и ничего не изменит.

`outfit` хранит одежду педа в `store/<script>/user/outfits/<имя>.json`. В `world/` каждый файл это одна вещь мира; `clock`
единственный, кто не цикл (`set`, `lock`, `unlock`, `set_speed`).

### По мотивам Stand-OSS: патчи, перемотка, физика

Устроены как Graceland: настройки `set_*` работают до и после `enable()`, `enable()` / `disable()` / `is_enabled()`,
`set_debug()`, всё возвращается при `disable()` и при остановке скрипта. **Ничего из этого не проверено в игре**:
паттерны, смещения и байты скопированы из Stand-OSS.

| Модуль | Что делает |
|---|---|
| `preserve_walk_style`, `no_hair_scale`, `wheel_on_wheels` | По патчу кода игры, сделаны через `patch_toggle` из реестра `natives.memory.patch` (паттерн, место, байты, байты, которые должны там быть до этого). `enable()` даёт `false` и ничего не пишет, если паттерн не найден или там другой код; `disable()` возвращает старые байты |
| `rewind` | Каждый кадр записывается; удерживаемая клавиша (`set_action`) возвращает их с последнего, 2x через 5 с, 3x через 10 с, камера следует за ними (скриптовая камера, в конце возвращается игре). `set_max_frames`, `set_speed_times`, `set_restore_camera`, `is_playing`, `get_frame_count`, `clear` |
| `super_drive` | Толчок транспорта, которым управляет игрок, пока удерживается клавиша: `set_force`, `set_use_camera`, `set_action` |
| `super_handbrake` | Клавиша ручного тормоза останавливает транспорт: `set_strength` (1 - остановка, меньше - часть скорости), `set_action` |
| `no_stunt_jumps` | Каждый кадр отменяет трюковые прыжки на карте |
| `floppy_mode` | Игрок - тряпичная кукла, которую толкает стик: `set_speed`, `set_sprint_multiplier`; не вместе с graceland |
| `gravity_gun` | Прицелиться, чтобы схватить предмет, колесо мыши двигает его, атака бросает: `set_force`, `set_collision`, `set_contrived_physics`, `set_distance` |

`airwalk` уже был. В `natives.memory.task` теперь весь макет aiTask (`TREE`, `get_chain`, `get_all`, `get_info_list`,
`get_state`), а в `natives.memory.task_types` номера 531 задачи игры (генерируются `tools/gen_task_types.py`);
`tools.task_list` - отладочный просмотр над ними.

Таблицы в `data/` и `task_types` генерируются скриптами из `tools/` по копии Stand-OSS; `tools/i18n_sync.py` показывает
состояние файлов переводов и заполняет их (`python tools/i18n_sync.py`, справка в самом скрипте).

## `Atdar.util.game.tools.states`

Опрашивает нативы про игрока и показывает разницу между двумя моментами. `info()`, `snapshot(имя?)`,
`diff(первый?, второй?)`, `watch()`, `unwatch()`. Спрашиваются только нативы без параметров или с одним описателем.
Удобно искать, что меняет пункт меню другого скрипта: снимок, включить, снимок, `diff`.

### Управляемость и текущий транспорт

`Atdar.util.game.vehicle` хранит числа управляемости транспорта и изменения, которые держатся, пока игрок за рулём.
Устроено как Graceland (`set_*`, `enable()` / `disable()` / `is_enabled()`, `set_debug()`, всё возвращается при `disable()`
и при остановке скрипта). **Ничего из этого не проверено в игре**: макет CHandlingData и смещения скопированы из Stand-OSS
(в `natives.memory.handling` и `vehicle` они лежат таблицами, `offsets`, их можно менять, не трогая код).

| Модуль | Что делает |
|---|---|
| `handling` | `get` / `set` / `set_many` / `scale` / `set_bits` поля по имени (`mass`, `drive_bias_front`, `boat.keel_sphere_size` ...), `reset` / `reset_model` / `reset_all`; держатели разделяют двух пользователей одного поля |
| `on_current` | Помощник, на котором собрано остальное: `create(name, { only / except виды, change, undo, frame })` даёт `enable`, `disable`, `refresh`, `store[model]`; делается, пока игрок за рулём подходящего транспорта, отменяется, когда он выходит или пересаживается |
| `drift_mode` | Дрифт-настройка и флаги Stand, с пресетами (`stand`, `loose`, `grippy`), `set_value` для каждого числа, биты `FLAG`; сцепление следует за скоростью |
| `lessen_burnouts` | `low_speed_traction_loss_mult` уменьшен |
| `heli_stabilisation` | Без автостабилизации вертолёта (подъёмная сила носа, стабилизация тангажа / крена / рыскания, ветер) |
| `gravity` | Гравитация транспорта в долях от обычной через `entities.set_gravity_multiplier` Stand |
| `drive_on_water` | Невидимый блок под поверхностью; одиночная игра, подводные камни версии Stand сохранены и перечислены в файле |
| `forge_model` | Информация о модели транспорта получает другой хеш; рискованно, одиночная игра, возвращается по указателю |

Одни данные управляемости принадлежат всему транспорту с одним именем управляемости, поэтому изменение достаётся всем,
пока его не вернут: каждый пользователь поля это *держатель*, побеждает последний, а когда он отпускает, возвращается
значение предыдущего или исходное. `natives.memory.holds` - то же для изменения кода игры (первый держатель делает, последний
отпускающий отменяет). В меню: Транспорт > Управляемость.
