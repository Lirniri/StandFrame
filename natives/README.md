# Старые нативы (справка)

Копия `src/lib/AnitaDarin/natives` до перехода на классы: функции, которые принимают handle
первым аргументом (`Atdar.natives.entity.ped.is_dead(handle)`).

Скрипт эти файлы не загружает, и `build.py` их в Stand не копирует: он берёт только `src`.
Папка нужна, чтобы подсмотреть, как было, или перенести что-то, что ещё не переехало в классы.

Сейчас в `src` вместо них классы:

| Было | Стало |
|---|---|
| `natives.entity.*(handle)` | `natives.entity` — класс `Entity` |
| `natives.entity.ped.*(handle)` | `natives.ped` — класс `Ped`, компоненты `ped.vehicle`, `weapon`, `task`, `parachute`, `flags` |
| `natives.entity.vehicle.*(handle)` | `natives.vehicle` — класс `Vehicle` |
| `natives.entity.object.*(handle)` | `natives.object` — класс `Object` |
| `natives.entity.pickup` | `natives.pickup` — модуль |
| `natives.player.*(player_id)`, `natives.player.user.*` | `natives.player` — класс `Player`, компоненты `camera`, `movement`, `wanted_level`, `mission`, `weapon` |
| `natives.visual.hud.blip.*(blip)`, `hud.waypoint.get_blip()`, `world.map.waypoint.get_coords()` | `natives.blip` — класс `Blip`, `Blip.waypoint()` |
| `natives.streaming.<тип>.asset.request(name, ...)` | `new natives.streaming.<тип>.asset(name):request()` — классы над `StreamingAsset` |
| `hud.thefeed.begin.post()` + `["end"].post_*` → id, `thefeed.remove(id)` | `hud.thefeed.post_ticker(text)` / `post_message(text, opts)` → `FeedPost`, `post:remove()` |
