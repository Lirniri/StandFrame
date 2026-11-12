# Utils

**English** | [Русский](README.ru.md)

Things built on natives, in `Atdar.util.game`: what several natives do together. Graceland is the main one.

The folders follow the code: `players/user/` is `Atdar.util.game.players.user` (the local player: Graceland works on
him only, it takes his id and his ped), `entity/` is `Atdar.util.game.entity`, `tools/` is `Atdar.util.game.tools`.

| File | What it shows |
|---|---|
| `players/user/01_graceland.pluto` | `Atdar.util.game.players.user.graceland`: `enable`, `disable`, `is_enabled` and every setting |
| `players/user/02_graceland_feature.pluto` | Graceland as a toggle feature in a menu |
| `players/user/03_helpers.pluto` | What Graceland is made of: the stick in the world, fall protection, restoring armor and stamina |
| `players/user/04_landing_roll.pluto` | `landing_roll`: holds a direction for the player before the ground so the game rolls him; the pieces it is built on (`natives.input.ACTION`, `press_next_frame`, `ped.is_plain_falling`, `entity.get_horizontal_speed`) |
| `entity/01_ped.pluto` | `entity.ped`: ending a ragdoll with the speed kept, a ped's flags that are on (any ped) |
| `entity/02_vehicle.pluto` | `entity.vehicle`: repairing a vehicle |
| `tools/01_states.pluto` | `Atdar.util.game.tools.states`: asks every `is_` / `has_` / `can_` native and shows what changed |
| `tools/02_fall_lab.pluto` | `Atdar.util.game.tools.fall_lab`: a laboratory for steering a fall without a ragdoll: `arm()` / `arm_loop()` that catch a fall (or every fall in a row) by themselves (a frame-by-frame record with a summary by windows of time, and the changes in the ped's flags in the air), the ped's flags before and after a moment, the ways to steer to try, the roll assist (the forward key pressed before the ground) |

## Graceland: a fall from any height

```pluto
local graceland = Atdar.util.game.players.user.graceland

graceland.enable()
if graceland.is_enabled() then ... end
graceland.disable()
```

The player falls without dying and steers the fall with the stick. It works like this (found by trying in the game):

1. After `ragdoll_distance` metres of a fall (8 by default) the game ragdolls the player.
2. While he is ragdolling, `GIVE_PLAYER_RAGDOLL_CONTROL` lets the stick steer the ragdoll.
3. A ragdoll hitting the ground at fall speed kills. So `landing_time` seconds before the ground (0.5), at the speed it
   has, the ragdoll is ended: the player stands up in the air, keeps his speed, faces where `facing` says (the camera
   by default) and lands on his feet without damage.
4. After the touch the protection stays 0.6 s more: the game decides about the landing a moment later.
5. A ragdoll that hits a wall in the air is ended the same way (`wall_protection`), and the rest of the fall goes without
   a ragdoll, so without steering.

| Setting | Default | What it does |
|---|---|---|
| `set_steering(toggle)` | `true` | Off: the ragdoll never starts in a fall, no death, no steering |
| `set_ragdoll_distance(metres)` | `8` | The fall after which the ragdoll starts (from about 5) |
| `set_safe_landing(toggle)` | `true` | Off: the ragdoll lands as it is, and a long fall kills |
| `set_landing_time(seconds)` | `0.5` | How long before the ground the ragdoll is ended: 27 m at 55 m/s, 6 m at 12 m/s |
| `set_wall_protection(toggle)` | `true` | A ragdoll that flies into a wall (above 3 m from the ground) is ended there: the player falls the rest without a ragdoll and without damage |
| `set_facing(mode)` | `"camera"` | Where the player faces when the ragdoll is ended: `"camera"` (where the camera looks), `"start"` (the way he faced when the fall began), `"none"` (any way the ragdoll left him) |
| `set_flag_protection(toggle)` | `false` | A try: also uses the game's ped flags in a fall (impacts don't ragdoll the player, `NEVER_RAGDOLL` with steering off, the wall seen by `PED_HIT_WALL_LAST_FRAME`, the ground by `IS_STANDING`). Gives no steering |
| `set_stuck_ragdoll(ms)` | `1500` | A ragdoll that lies still this long after a landing is ended; `0` - never |
| `set_debug(toggle)` | `false` | One line per fall event in the debug log |

All of them can be called from Call Function (`Atdar.util.game.players.user.graceland.set_ragdoll_distance`).

### The debug line

```
fall rag=1 can=1 cache=0 fall=1 air=1 h=250 v=22.3 F1 L0 J1 A1 hp=328 vel=5.8,2.4,-21.5 stick=-1.0,0.0 dir=-0.3,1.0
```

`rag` ragdoll, `can` what the game says about `CAN_PED_RAGDOLL`, `cache` what graceland set, `fall` falling, `air` in
the air, `h` height above the ground, `v` speed, `F L J A` the game's flags (pure fall, landing, jumping, in the air),
`hp` health, `vel` velocity, `stick` the left stick, `dir` the stick in the world (compare it with `vel`: steering works
if `vel` goes where `dir` points). The first word is the event: `fall` (every second), `AIR` and `LAND` (left or
reached the ground), `TOUCH` (the speed jumped, a touch), `RAGDOLL STARTED`, `ragdoll ended`.

### Good to know

- Stand's own Graceland can't be switched on while the player is ragdolling: turn it off before testing this one.
- A jump from 8 to about 12 m ends in a ragdoll that is ended close to the ground: that is by design (`landing_time`).
- The Beast jump animation doesn't come from `SET_BEAST_JUMP_THIS_FRAME` here: it didn't show in the game.

## `Atdar.util.game.tools.states`

Asks the natives about the player and shows the difference between two moments. `info()`, `snapshot(name?)`,
`diff(first?, second?)`, `watch()`, `unwatch()`. Only natives with no parameters or with one handle are asked.
Useful to find what a menu option of another script changes: snapshot, switch it on, snapshot, `diff`.
