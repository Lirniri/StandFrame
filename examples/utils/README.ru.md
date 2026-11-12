# Утилиты

[English](README.md) | **Русский**

Что построено на нативах, в `Atdar.util.game`: то, что несколько нативов делают вместе. Главное здесь Graceland.

Папки повторяют код: `players/user/` это `Atdar.util.game.players.user` (локальный игрок: Graceland работает только на нём,
берёт его id и его пед), `entity/` это `Atdar.util.game.entity`, `tools/` это `Atdar.util.game.tools`.

| Файл | Что показывает |
|---|---|
| `players/user/01_graceland.pluto` | `Atdar.util.game.players.user.graceland`: `enable`, `disable`, `is_enabled` и все настройки |
| `players/user/02_graceland_feature.pluto` | Graceland как переключатель-фича в меню |
| `players/user/03_helpers.pluto` | Из чего собран Graceland: стик в мире, защита от падения, восстановление брони и выносливости |
| `players/user/04_landing_roll.pluto` | `landing_roll`: держит игроку направление перед землёй, чтобы игра сделала перекат; кирпичики, из которых он собран (`natives.input.ACTION`, `press_next_frame`, `ped.is_plain_falling`, `entity.get_horizontal_speed`) |
| `entity/01_ped.pluto` | `entity.ped`: выход из ragdoll с сохранением скорости, включённые флаги педа (любого) |
| `entity/02_vehicle.pluto` | `entity.vehicle`: ремонт транспорта |
| `tools/01_states.pluto` | `Atdar.util.game.tools.states`: опрашивает все нативы `is_` / `has_` / `can_` и показывает, что изменилось |
| `tools/02_fall_lab.pluto` | `Atdar.util.game.tools.fall_lab`: лаборатория управления падением без ragdoll: `arm()` / `arm_loop()`, которые сами ловят падение (или каждое падение подряд) (покадровая запись со сводкой по окнам времени и изменения флагов педа в воздухе), флаги педа до и после момента, способы управления для проб, помощь с перекатом (клавиша вперёд перед землёй) |

## Graceland: падение с любой высоты

```pluto
local graceland = Atdar.util.game.players.user.graceland

graceland.enable()
if graceland.is_enabled() then ... end
graceland.disable()
```

Игрок падает и не умирает, а падением можно управлять стиком. Устроено так (выяснено опытом в игре):

1. После `ragdoll_distance` метров падения (по умолчанию 8) игра переводит игрока в ragdoll.
2. Пока он в ragdoll, `GIVE_PLAYER_RAGDOLL_CONTROL` даёт управлять им стиком.
3. Ragdoll, ударившийся о землю на скорости падения, убивает. Поэтому за `landing_time` секунд до земли (0,5) по текущей
   скорости ragdoll заканчивается: игрок встаёт в воздухе, сохраняет скорость, поворачивается так, как задано в
   `facing` (по умолчанию по камере), и приземляется на ноги без урона.
4. После касания защита держится ещё 0,6 с: игра решает про приземление чуть позже касания.
5. Ragdoll, ударившийся о стену в воздухе, заканчивается так же (`wall_protection`), и остаток падения идёт без ragdoll,
   то есть без управления.

| Настройка | По умолчанию | Что делает |
|---|---|---|
| `set_steering(toggle)` | `true` | Выключено: в падении ragdoll не начинается вообще, смерти нет, управления нет |
| `set_ragdoll_distance(метры)` | `8` | После какого падения начинается ragdoll (от 5 примерно) |
| `set_safe_landing(toggle)` | `true` | Выключено: ragdoll приземляется как есть, и долгое падение убивает |
| `set_landing_time(секунды)` | `0.5` | За сколько до земли ragdoll заканчивается: 27 м при 55 м/с, 6 м при 12 м/с |
| `set_wall_protection(toggle)` | `true` | Ragdoll, влетевший в стену (выше 3 м от земли), заканчивается там: остаток падения без ragdoll и без урона |
| `set_facing(режим)` | `"camera"` | Куда смотрит игрок, когда ragdoll заканчивается: `"camera"` (куда смотрит камера), `"start"` (как он смотрел в начале падения), `"none"` (как оставил ragdoll, как попало) |
| `set_flag_protection(toggle)` | `false` | Попытка: в падении используются ещё и флаги педа из игры (удары не вызывают ragdoll, `NEVER_RAGDOLL` при выключенном управлении, стена по `PED_HIT_WALL_LAST_FRAME`, земля по `IS_STANDING`). Управления не даёт |
| `set_stuck_ragdoll(мс)` | `1500` | Ragdoll, лежащий столько после приземления, заканчивается; `0` - никогда |
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

## `Atdar.util.game.tools.states`

Опрашивает нативы про игрока и показывает разницу между двумя моментами. `info()`, `snapshot(имя?)`,
`diff(первый?, второй?)`, `watch()`, `unwatch()`. Спрашиваются только нативы без параметров или с одним описателем.
Удобно искать, что меняет пункт меню другого скрипта: снимок, включить, снимок, `diff`.
