"""Groups the natives of init.lua into the natives/ folder next to it, in the style of
src/lib/AnitaDarin/natives: one module per topic, functions named without the entity
prefix, typed signatures, sections State / Get / Set / Actions.

The hand-written files are read from src/lib/AnitaDarin/natives and kept as they are;
a native one of them already calls is not generated again. The result is written to
natives/ here, so a run always starts from the hand-written copy.

    python generate_natives.py            # writes the files
    python generate_natives.py --dry-run  # only prints what would go where
"""

import os
import re
import sys
from collections import defaultdict, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
INIT = os.path.join(HERE, "init.lua")
OUT = os.path.join(HERE, "natives")
SRC = os.path.normpath(os.path.join(HERE, "..", "..", "src", "lib", "AnitaDarin", "natives"))

SECTIONS = ["State", "Get", "Set", "Actions"]

# ─── Where each native goes ──────────────────────────────────────────────────
# namespace -> (default file, [(regex on the native name, file), ...]); first match wins

ROUTES = {
    "SYSTEM": ("system", []),
    "APP": ("app", []),
    "AUDIO": ("audio", [
        (r"PHONE|RINGTONE|MOBILE", "audio/phone"),
        (r"RADIO|DJ_", "audio/radio"),
        (r"MUSIC|END_CREDITS|TENNIS", "audio/music"),
        (r"SPEECH|CONVERSATION|CONV_PED|VOICE|VOCALIZATION|SPEAKING|PAIN|WALLA|ANIMAL_MOOD|TREVOR_RAGE|PLAYER_ANGRY|PED_GENDER|IS_DRUNK|PED_RACE", "audio/speech"),
        (r"VEHICLE|VEH_|HORN|SIREN|STALL_WARNING|DRAG_RACE|FANBELT|EXHAUST|BOOST_ACTIVE|DOOR_AUDIO", "audio/vehicle"),
        (r"SOUND|STREAM", "audio/sound"),
    ]),
    "BRAIN": ("script", []),
    "CAM": ("camera", [
        (r"SPLINE", "camera"),
        (r"GAMEPLAY|FOLLOW_PED|FOLLOW_VEHICLE|FOLLOW_CAM|THIRD_PERSON|FIRST_PERSON|AIM_CAM|IN_VEHICLE_CAM|VEHICLE_CAM|BONNET|TABLE_GAMES|STUNT", "camera/gameplay"),
        (r"CINEMATIC|IDLE_CAM", "camera/cinematic"),
        (r"SCREEN_FADE|SCREEN_FADED|SCREEN_FADING|WIDESCREEN", "camera/screen"),
    ]),
    "CLOCK": ("world/time", []),
    "CUTSCENE": ("cutscene", []),
    "DATAFILE": ("datafile", []),
    "DECORATOR": ("entity/decorator", []),
    "DLC": ("dlc", []),
    "ENTITY": ("entity", [
        (r"SET_PED_AS_NO_LONGER_NEEDED", "entity/ped"),
        (r"SET_VEHICLE_AS_NO_LONGER_NEEDED", "entity/vehicle"),
        (r"SET_OBJECT_AS_NO_LONGER_NEEDED", "entity/object"),
    ]),
    "EVENT": ("world/event", []),
    "FILES": ("files", []),
    "FIRE": ("world/fire", [
        (r"EXPLOSION", "world/explosion"),
    ]),
    "GRAPHICS": ("visual/graphics", [
        (r"REQUEST_NAMED_PTFX_ASSET|HAS_NAMED_PTFX_ASSET_LOADED|REMOVE_NAMED_PTFX_ASSET|USE_PARTICLE_FX_ASSET|SET_PARTICLE_FX_ASSET_OLD_TO_NEW|RESET_PARTICLE_FX_ASSET_OLD_TO_NEW", "streaming/ptfx/asset"),
        (r"PTFX|PARTICLE_FX|PARTICLE", "streaming/ptfx"),
        (r"STREAMED_TEXTURE_DICT", "streaming/texture_dict/asset"),
        (r"CHECKPOINT", "visual/checkpoint"),
        (r"DECAL", "visual/decal"),
        (r"MARKER", "visual/marker"),
        (r"SCALEFORM", "visual/scaleform"),
        (r"LIGHT|LIGHTS|SHADOW", "visual/light"),
        (r"DRAW_", "visual/draw"),
        (r"TIMECYCLE|TIME_CYCLE", "visual/timecycle"),
    ]),
    "HUD": ("visual/hud", [
        (r"BLIP", "visual/hud/blip"),
        (r"MINIMAP|RADAR|BIGMAP", "visual/hud/minimap"),
        (r"CASH|MONEY|BANK|WALLET", "visual/hud/money"),
        (r"THEFEED|FEED", "visual/hud/thefeed"),
        (r"WANTED|(^|_)STARS?(_|$)", "visual/hud/wanted_level"),
        (r"WAYPOINT|GPS", "visual/hud/waypoint"),
        (r"HUD_COLOUR|HUD_COLOR", "visual/color/hud"),
        (r"FRONTEND|PAUSE_MENU|PAUSEMENU", "visual/hud/frontend"),
        (r"TEXT|FONT|LABEL|GXT|STRING|SUBTITLE|HELP_|PRINT|LITERAL|SUBSTRING|ADD_TEXT_COMPONENT|BEGIN_|END_", "visual/hud/text"),
    ]),
    "INTERIOR": ("world/interior", []),
    "ITEMSET": ("itemset", []),
    "LOADINGSCREEN": ("network/lobby", []),
    "LOCALIZATION": ("localization", []),
    "MISC": ("misc", [
        (r"WEATHER|RAIN|SNOW|WIND|CLOUD|OVERRIDE_SNOW|LIGHTNING", "world/weather"),
        (r"EXPLOSION", "world/explosion"),
    ]),
    "MOBILE": ("phone", []),
    "MONEY": ("network/money", []),
    "NETSHOPPING": ("network/shopping", []),
    "NETWORK": ("network", [
        (r"TRANSITION", "network/session/transition"),
        (r"SESSION|MATCHMAKING|INVITE|HOST|JOIN|LEAVE|BAIL|KICK", "network/session"),
        (r"HAS_CONTROL|REQUEST_CONTROL|CONTROL_OF", "network/control"),
        (r"CLAN|CREW", "network/clan"),
        (r"VOICE|TALKING|CHAT|LOUDNESS|MUTE", "network/voice"),
        (r"ROS_|SC_|SOCIAL_CLUB|SOCIALCLUB|PRIVILEGE", "network/social_club"),
        (r"NET_TO_|_TO_NET$|NETWORK_ID|NET_ID|REGISTER_ENTITY|GET_ENTITY_IS_NETWORKED|NETWORK_GET_ENTITY|NETWORK_GET_NETWORK", "network/entity"),
    ]),
    "OBJECT": ("entity/object", [
        (r"PICKUP", "entity/pickup"),
        (r"DOOR", "entity/object/door"),
    ]),
    "PAD": ("input", []),
    "PATHFIND": ("world/path", []),
    "PED": ("entity/ped", [
        (r"REQUEST_ACTION_MODE_ASSET|HAS_ACTION_MODE_ASSET_LOADED|REMOVE_ACTION_MODE_ASSET", "streaming/action_mode/asset"),
        (r"REQUEST_STEALTH_MODE_ASSET|HAS_STEALTH_MODE_ASSET_LOADED|REMOVE_STEALTH_MODE_ASSET", "streaming/stealth_mode/asset"),
        (r"PARACHUTE", "entity/ped/parachute"),
        (r"CONFIG_FLAG|RESET_FLAG", "entity/ped/flags"),
        (r"WEAPON|AMMO|FIRING|SHOOT", "entity/ped/weapon"),
        (r"VEHICLE|SEAT", "entity/ped/vehicle"),
        (r"RAGDOLL", "entity/ped/ragdoll"),
        (r"COMPONENT|PROP|HEAD_BLEND|HEAD_OVERLAY|HAIR|EYE|FACE|VARIATION|DECORATION|TATTOO|HELMET|PALETTE|MICRO_MORPH|OUTFIT|TEXTURE", "entity/ped/appearance"),
        (r"COMBAT|TARGET", "entity/ped/combat"),
        (r"GROUP", "entity/ped/group"),
        (r"RELATIONSHIP", "entity/ped/relationship"),
    ]),
    "PHYSICS": ("physics", []),
    "PLAYER": ("player", [
        (r"WANTED|POLICE|(^|_)COPS?(_|$)|DISPATCH|(^|_)STARS?(_|$)", "player/wanted_level"),
        (r"SPECIAL_ABILITY", "player/special_ability"),
        (r"SWITCH", "player/switch"),
        (r"WEAPON|FIRING|AMMO|TARGET|LOCKON|MELEE", "player/weapon"),
        (r"SPRINT|STAMINA|SWIM|JUMP|RUN_|MOVEMENT|CLIMB|WALK|DIVE|PARACHUTE|SPEED|STEALTH|CHASE", "player/movement"),
        (r"CAM|CAMERA|VIEW", "player/camera"),
        (r"MISSION|SPAWN", "player/mission"),
    ]),
    "RECORDING": ("replay", []),
    "REPLAY": ("replay", []),
    "SAVEMIGRATION": ("network/save_migration", []),
    "SCRIPT": ("script", []),
    "SECURITY": ("script", []),
    "SHAPETEST": ("physics/shape_test", []),
    "SOCIALCLUB": ("network/social_club", []),
    "STATS": ("stats", []),
    "STREAMING": ("streaming", [
        (r"^REQUEST_MODEL$|^HAS_MODEL_LOADED$|^SET_MODEL_AS_NO_LONGER_NEEDED$|^REQUEST_MENU_PED_MODEL$", "streaming/model/asset"),
        (r"MODEL", "streaming/model"),
        (r"ANIM_DICT|ANIM_SET|CLIP_SET", "streaming/anim"),
        (r"IPL", "streaming/ipl"),
    ]),
    "TASK": ("entity/ped/task", []),
    "VEHICLE": ("entity/vehicle", [
        (r"^REQUEST_VEHICLE_ASSET$|^HAS_VEHICLE_ASSET_LOADED$|^REMOVE_VEHICLE_ASSET$", "streaming/vehicle/asset"),
        (r"^IS_VEHICLE_MODEL$|^IS_THIS_MODEL_", "entity/vehicle"),
        (r"HELI|HELICOPTER", "entity/vehicle/heli"),
        (r"PLANE|LANDING_GEAR", "entity/vehicle/plane"),
        (r"BOAT|ANCHOR", "entity/vehicle/boat"),
        (r"TRAIN", "entity/vehicle/train"),
        (r"MOD_|_MOD$|MODS|LIVERY|COLOUR|COLOR|TINT|NEON|EXTRA|NUMBER_PLATE|PLATE|XENON|TYRE_SMOKE|KIT", "entity/vehicle/mods"),
        (r"DOOR|WINDOW|ROOF|CONVERTIBLE|BOMB_BAY", "entity/vehicle/doors"),
        (r"WHEEL|TYRE|TIRE", "entity/vehicle/wheels"),
    ]),
    "WATER": ("world/water", []),
    "WEAPON": ("weapon", [
        (r"PED|AMMO_IN_CLIP|CLIP", "entity/ped/weapon"),
    ]),
    "ZONE": ("world/location", []),
}

# Tokens taken out of a native's name in a file ("GET_ENTITY_HEALTH" in entity -> get_health).
# The first token is the file's subject: the fallback strips only that one
STRIP = {
    "entity": ["ENTITY"],
    "entity/ped": ["PED"],
    "entity/ped/flags": ["PED", "FLAG"],
    "entity/ped/parachute": ["PED", "PARACHUTE"],
    "entity/ped/task": ["TASK", "PED", "TASKS"],
    "entity/ped/vehicle": ["PED", "VEHICLE"],
    "entity/ped/weapon": ["PED", "WEAPON"],
    "entity/ped/ragdoll": ["PED", "RAGDOLL"],
    "entity/ped/appearance": ["PED"],
    "entity/ped/combat": ["PED", "COMBAT"],
    "entity/ped/group": ["PED"],
    "entity/ped/relationship": ["PED", "RELATIONSHIP"],
    "entity/vehicle": ["VEHICLE", "VEH"],
    "entity/vehicle/heli": ["HELI", "VEHICLE"],
    "entity/vehicle/plane": ["PLANE", "VEHICLE"],
    "entity/vehicle/boat": ["BOAT", "VEHICLE"],
    "entity/vehicle/train": ["TRAIN", "VEHICLE"],
    "entity/vehicle/mods": ["VEHICLE"],
    "entity/vehicle/doors": ["VEHICLE"],
    "entity/vehicle/wheels": ["VEHICLE"],
    "entity/object": ["OBJECT"],
    "entity/object/door": ["DOOR", "OBJECT"],
    "entity/pickup": ["PICKUP"],
    "entity/decorator": ["DECOR"],
    "player": ["PLAYER"],
    "player/wanted_level": ["PLAYER"],
    "player/switch": ["PLAYER", "SWITCH"],
    "player/weapon": ["PLAYER"],
    "player/movement": ["PLAYER"],
    "player/camera": ["PLAYER"],
    "player/mission": ["PLAYER"],
    "player/special_ability": ["PLAYER", "SPECIAL", "ABILITY"],
    "visual/hud": ["HUD"],
    "visual/hud/blip": ["BLIP"],
    "visual/hud/minimap": ["MINIMAP", "RADAR"],
    "visual/hud/money": ["HUD"],
    "visual/hud/thefeed": ["THEFEED"],
    "visual/hud/wanted_level": ["HUD"],
    "visual/hud/waypoint": ["WAYPOINT"],
    "visual/hud/text": ["TEXT"],
    "visual/hud/frontend": ["FRONTEND"],
    "visual/color/hud": ["HUD"],
    "visual/graphics": [],
    "visual/decal": ["DECAL"],
    "visual/marker": ["MARKER"],
    "visual/checkpoint": ["CHECKPOINT"],
    "visual/scaleform": ["SCALEFORM"],
    "visual/light": [],
    "visual/draw": [],
    "visual/timecycle": ["TIMECYCLE"],
    "camera": ["CAM", "CAMERA"],
    "camera/gameplay": ["CAM", "GAMEPLAY", "CAMERA"],
    "camera/cinematic": ["CAM", "CINEMATIC", "CAMERA"],
    "camera/screen": ["SCREEN"],
    "network": ["NETWORK"],
    "network/session": ["NETWORK", "SESSION"],
    "network/session/transition": ["NETWORK", "TRANSITION"],
    "network/control": ["NETWORK", "CONTROL"],
    "network/clan": ["NETWORK", "CLAN"],
    "network/voice": ["NETWORK", "VOICE"],
    "network/social_club": ["SC", "NETWORK"],
    "network/entity": ["NETWORK"],
    "network/shopping": ["NET", "GAMESERVER"],
    "network/money": ["NETWORK"],
    "network/lobby": ["LOBBY"],
    "network/save_migration": ["SAVEMIGRATION", "MP"],
    "streaming": ["STREAMING"],
    "streaming/model": ["MODEL"],
    "streaming/model/asset": ["MODEL"],
    "streaming/ptfx": ["PTFX", "PARTICLE_FX"],
    "streaming/ptfx/asset": ["PTFX", "NAMED", "ASSET", "PARTICLE_FX"],
    "streaming/texture_dict/asset": ["STREAMED", "TEXTURE", "DICT"],
    "streaming/vehicle/asset": ["VEHICLE", "ASSET"],
    "streaming/action_mode/asset": ["ACTION", "MODE", "ASSET"],
    "streaming/stealth_mode/asset": ["STEALTH", "MODE", "ASSET"],
    "streaming/anim": [],
    "streaming/ipl": ["IPL"],
    "audio": ["AUDIO"],
    "audio/phone": ["PHONE", "MOBILE"],
    "audio/radio": ["RADIO"],
    "audio/music": ["MUSIC"],
    "audio/speech": [],
    "audio/vehicle": ["VEHICLE", "VEH"],
    "audio/sound": ["SOUND"],
    "world/fire": ["FIRE"],
    "world/time": ["CLOCK"],
    "world/water": ["WATER"],
    "world/weather": ["WEATHER"],
    "world/interior": ["INTERIOR"],
    "world/path": [],
    "world/location": ["ZONE"],
    "world/explosion": ["EXPLOSION"],
    "world/event": [],
    "weapon": ["WEAPON"],
    "input": ["CONTROL"],
    "phone": ["MOBILE", "PHONE"],
    "stats": ["STAT"],
    "script": ["SCRIPT"],
    "system": [],
    "app": ["APP"],
    "cutscene": ["CUTSCENE"],
    "datafile": ["DATAFILE"],
    "dlc": ["DLC"],
    "physics": [],
    "physics/shape_test": ["SHAPE", "TEST"],
    "replay": ["REPLAY"],
    "itemset": ["ITEMSET"],
    "localization": ["LOCALIZATION"],
    "files": [],
    "misc": [],
}

# First line of a new file
HEADERS = {
    "system": "-- Script runtime helpers of the game (timers, math, thread priority)",
    "app": "-- The app data store (APP natives)",
    "audio/radio": "-- Radio stations and tracks",
    "audio/music": "-- Scripted music and music events",
    "audio/speech": "-- Ped speech, conversations and voices",
    "audio/vehicle": "-- Vehicle sounds: horns, sirens, engine audio",
    "audio/sound": "-- Sounds and audio streams by id",
    "camera/gameplay": "-- The gameplay camera (follow ped / vehicle, first person, aim)",
    "camera/cinematic": "-- The cinematic camera and cinematic shots",
    "camera/screen": "-- Screen fades and widescreen borders",
    "cutscene": "-- Cutscenes (CUTSCENE natives)",
    "dlc": "-- Installed DLC packs and cloud content checks (DLC natives)",
    "player/special_ability": "-- The player's special ability (its charge, activation)",
    "datafile": "-- Data files and dictionaries (DATAFILE natives: UGC, cloud saves)",
    "entity/decorator": "-- Decorators: named values scripts attach to entities",
    "world/event": "-- Shocking events and decision makers (EVENT natives)",
    "files": "-- Shop ped apparel and tattoo DLC items (FILES natives)",
    "visual/decal": "-- Decals on surfaces",
    "visual/marker": "-- 3D markers drawn in the world",
    "visual/checkpoint": "-- Race checkpoints",
    "visual/scaleform": "-- Scaleform movies",
    "visual/light": "-- Lights and shadows drawn by scripts",
    "visual/draw": "-- 2D / 3D drawing (lines, rects, sprites, polys)",
    "visual/timecycle": "-- Timecycle modifiers (screen effects)",
    "visual/hud/frontend": "-- The pause menu (frontend)",
    "itemset": "-- Item sets (ITEMSET natives)",
    "network/lobby": "-- Auto multiplayer lobby flags (LOADINGSCREEN natives)",
    "localization": "-- System language (LOCALIZATION natives)",
    "misc": "-- Everything the game puts under MISC: flags, time scale, stack sizes, activity feed, ...",
    "world/explosion": "-- Explosions",
    "phone": "-- The mobile phone object and its camera (MOBILE natives)",
    "network/money": "-- Multiplayer cash: earn / spend natives (MONEY)",
    "network/clan": "-- Crews (clans)",
    "network/voice": "-- Voice chat",
    "network/entity": "-- Network ids of entities (net id <-> handle)",
    "entity/object/door": "-- Door objects and the door system",
    "entity/ped/ragdoll": "-- Ragdoll state of peds",
    "entity/ped/appearance": "-- Ped components, props, head blend and other looks",
    "entity/ped/combat": "-- Combat attributes and targets of peds",
    "entity/ped/group": "-- Ped groups",
    "entity/ped/relationship": "-- Relationship groups of peds",
    "physics": "-- Ropes and other physics (PHYSICS natives)",
    "physics/shape_test": "-- Shape tests (raycasts)",
    "replay": "-- Rockstar Editor recording and replay (RECORDING, REPLAY natives)",
    "script": "-- Scripts and threads (SCRIPT, BRAIN, SECURITY natives)",
    "network/save_migration": "-- Save migration between accounts (SAVEMIGRATION natives)",
    "stats": "-- Player stats (STATS natives)",
    "streaming/anim": "-- Animation dictionaries, anim sets and clip sets",
    "streaming/ipl": "-- IPLs (map placements)",
    "entity/vehicle/heli": "-- Helicopters",
    "entity/vehicle/plane": "-- Planes",
    "entity/vehicle/boat": "-- Boats",
    "entity/vehicle/train": "-- Trains",
    "entity/vehicle/mods": "-- Vehicle mods, liveries, colours, plates",
    "entity/vehicle/doors": "-- Doors, windows and roofs of vehicles",
    "entity/vehicle/wheels": "-- Wheels and tyres",
}

TYPES = {
    "void": "void", "int": "int", "float": "float", "string": "string",
    "BOOL (bool)": "bool", "Any (int)": "any", "Vector3 (vector3)": "vector3",
}

PREPOSITIONS = {"OF", "TO", "FROM", "FOR", "WITH", "AT", "BY", "THE", "A", "AN", "THIS", "AND"}
POSSESSIVE = {"OF", "THE", "A", "AN", "THIS", "OR", "AND"}  # dropped next to a stripped token: HAS_CONTROL_OF_ENTITY -> has_entity
BARE = {"GET", "SET", "IS", "HAS", "DOES", "CAN", "ARE", "WAS", "HAVE"}
RESERVED = {
    "end", "function", "local", "nil", "true", "false", "and", "or", "not", "then", "until", "do", "if", "else",
    "elseif", "for", "while", "return", "break", "goto", "in", "repeat", "class", "new", "switch", "case",
    "default", "continue", "enum", "export", "parent", "let", "const", "module",
}

# ─── Parsing init.lua ────────────────────────────────────────────────────────

NATIVE_RE = re.compile(r"^\t(_?[A-Z_0-9]+)=--\[\[([^\]]+)\]\] function\((.*?)\)return native_invoker")
PARAM_RE = re.compile(r"--\[\[([^\]]+)\]\] ([A-Za-z0-9_]+)")


def parse_init():
    natives = []
    ns = None
    comments = []
    with open(INIT, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            m = re.match(r"^([A-Z_0-9]+)=\{$", line)
            if m:
                ns = m.group(1)
                comments = []
                continue
            if line.startswith("\t-- "):
                comments.append(line[4:].rstrip())
                continue
            if line == "\t--":
                comments.append("")
                continue
            m = NATIVE_RE.match(line)
            if m:
                name, ret, params = m.groups()
                plist = PARAM_RE.findall(params)
                natives.append({
                    "ns": ns, "name": name, "ret": ret,
                    "params": [(t, n) for t, n in plist],
                    "comments": comments,
                })
                comments = []
                continue
            if line.strip() and not line.startswith("\t--"):
                comments = []
    return natives


# ─── Naming ──────────────────────────────────────────────────────────────────

def pluto_type(t):
    if t in TYPES:
        return TYPES[t]
    if t.endswith("(pointer)"):
        return "int"
    if t.endswith("(int)"):
        return "int"
    return "any"


def snake(name):
    s = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s)
    return s.lower()


def param_name(t, n, used):
    n = snake(n)
    if t == "Player (int)" and n == "player":
        n = "player_id"
    if n in RESERVED:
        n += "_"
    base, i = n, 2
    while n in used:
        n = f"{base}{i}"
        i += 1
    used.add(n)
    return n


def strip_tokens(native, tokens):
    parts = native.lstrip("_").split("_")
    out = []
    removed_prev = False
    for p in parts:
        if p in tokens:
            removed_prev = True
            if out and out[-1] in POSSESSIVE:
                out.pop()
            continue
        if p in POSSESSIVE and removed_prev:
            continue
        if p in PREPOSITIONS and out and out[-1] in PREPOSITIONS:
            out.pop()
        removed_prev = False
        out.append(p)
    while out and out[-1] in PREPOSITIONS:
        out.pop()
    return out


def func_name(native, file, taken):
    tokens = STRIP.get(file, [])
    candidates = [strip_tokens(native, set(tokens))]
    if tokens:
        candidates.append(strip_tokens(native, {tokens[0]}))
    candidates.append(native.lstrip("_").split("_"))
    for parts in candidates:
        if not parts or (len(parts) == 1 and parts[0] in BARE) or parts[0][0].isdigit():
            continue
        name = "_".join(parts).lower()
        if name in RESERVED:
            name += "_"
        if name not in taken:
            return name
    name = native.lstrip("_").lower()
    base, i = name, 2
    while name in taken:
        name = f"{base}_{i}"
        i += 1
    return name


def section_of(name):
    first = name.split("_")[0]
    if first in ("is", "does", "has", "can", "are", "was", "have", "would", "were"):
        return "State"
    if first == "get":
        return "Get"
    if first == "set":
        return "Set"
    return "Actions"


JUNK = re.compile(r"http|nullsub|hard-?coded|example|^see |see [A-Z_]{4,}|::|0x[0-9A-F]|\bp\d\b|DurtyFree|;|=|\{|\}|\bint\b|\bfloat\b|^NOTE|^Note:|returns? (true|false|0|1)|\bBOOL\b|^\w+: |^Outputs?\b", re.I)


def comment_of(native):
    for line in native["comments"]:
        line = line.strip()
        if not line:
            continue
        # a first line that doesn't read as a sentence is the tail of something longer, drop it
        if len(line) < 15 or len(line) > 120 or line.endswith(":") or JUNK.search(line):
            return None
        if not line[0].isupper() or len(line.split()) < 3:
            return None
        return line.rstrip(".")
    return None


# ─── Rendering ───────────────────────────────────────────────────────────────

def render(native, fname):
    used = set()
    params = [(param_name(t, n, used), pluto_type(t)) for t, n in native["params"]]
    ret = pluto_type(native["ret"])
    args = ", ".join(f"{n}: {t}" for n, t in params)
    call_args = ", ".join(n for n, _ in params)
    call = f"{native['ns']}.{native['name']}({call_args})"
    body = call if ret == "void" else f"return {call}"

    lines = []
    comment = comment_of(native)
    if comment:
        lines.append(f"-- {comment}")
    for (t, _), (pname, _) in zip(native["params"], params):
        if "pointer" in t:
            lines.append(f"-- @param {pname} Pointer: pass memory.alloc(size) and read the result back")
    if "pointer" in native["ret"]:
        lines.append("-- @return A pointer, read it with memory.read_*")
    head = f"function module.{fname}({args}): {ret}"
    if len(head) <= 110:
        lines.append(head)
        lines.append(f"    {body}")
    else:
        lines.append(f"function module.{fname}(")
        row = "   "
        for i, (n, t) in enumerate(params):
            piece = f" {n}: {t}" + ("," if i < len(params) - 1 else "")
            if len(row) + len(piece) > 100:
                lines.append(row)
                row = "   "
            row += piece
        lines.append(row)
        lines.append(f"): {ret}")
        lines.append("    -- body function:")
        lines.append(f"    {body}")
    lines.append("end")
    return "\n".join(lines)


# ─── Existing files ──────────────────────────────────────────────────────────

CALL_RE = re.compile(r"\b([A-Z][A-Z_0-9]+)\.(_?[A-Z][A-Z_0-9]+)\(")
FUNC_RE = re.compile(r"^function module\.([A-Za-z_][A-Za-z0-9_]*)")
SECTION_RE = re.compile(r"^-- (State|Get|Set|Actions)$")
NESTED_RE = re.compile(r"^-- (State|Get|Set|Actions) ?>")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def existing_files():
    out = {}
    for root, _, files in os.walk(SRC):
        for fn in files:
            if fn.endswith(".pluto"):
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, SRC).replace("\\", "/")[:-6]
                out[rel] = read(full)
    return out


def wrapped_natives(files):
    done = set()
    for text in files.values():
        for ns, name in CALL_RE.findall(text):
            done.add((ns, name))
    return done


def split_file(text):
    """header, {section: [lines]}, footer. Sections not found are absent."""
    lines = text.split("\n")
    footer_at = len(lines)
    for i in range(len(lines) - 1, -1, -1):
        if lines[i].startswith("return "):
            footer_at = i
            break
    body = lines[:footer_at]
    footer = lines[footer_at:]
    sections = OrderedDict()
    header = []
    current = None
    for line in body:
        m = SECTION_RE.match(line)
        if m:
            current = m.group(1)
            sections[current] = []
            continue
        if current is None:
            header.append(line)
        else:
            sections[current].append(line)
    return header, sections, footer


def is_stub(text):
    return text.strip() in ("local module = {}\n-- body\nreturn module", "local module = {}\n-- body\nreturn module\n") \
        or re.sub(r"\s+", " ", text.strip()) == "local module = {} -- body return module"


def insert_into_section(lines, chunk):
    """Puts chunk after the hand-written functions of a section, before a nested '-- X>Y' header."""
    at = len(lines)
    for i, line in enumerate(lines):
        if NESTED_RE.match(line):
            at = i
            break
    while at > 0 and lines[at - 1].strip() == "":
        at -= 1
    before = lines[:at]
    after = lines[at:]
    out = before[:]
    if before and any(l.strip() for l in before):
        out.append("")
    out.extend(chunk)
    if after:
        out.append("")
        out.extend(after)
    else:
        out.append("")
    return out


def build_file(rel, text, generated, has_children):
    """generated: {section: [function text]}. Returns the new file text."""
    if text is None or is_stub(text):
        header = [HEADERS[rel]] if rel in HEADERS else []
        if header:
            header.append("")
        header.append("local module = {}")
        header.append("")
        sections = OrderedDict()
        footer = None
    else:
        header, sections, footer = split_file(text)
        if header and header[-1].strip() != "":
            header.append("")

    taken = set(FUNC_RE.match(l).group(1) for l in text.split("\n") if FUNC_RE.match(l)) if text else set()

    out = header[:]
    all_sections = list(sections.keys())
    for s in SECTIONS:
        if s not in all_sections and generated.get(s):
            all_sections.append(s)
    order = [s for s in SECTIONS if s in all_sections] + [s for s in all_sections if s not in SECTIONS]
    for s in order:
        lines = sections.get(s, [])
        chunk = []
        for fn in generated.get(s, []):
            chunk.extend(fn.split("\n"))
            chunk.append("")
        if chunk:
            chunk.pop()
            lines = insert_into_section(lines, chunk)
        out.append(f"-- {s}")
        out.append("")
        while lines and lines[0].strip() == "":
            lines.pop(0)
        while lines and lines[-1].strip() == "":
            lines.pop()
        out.extend(lines)
        out.append("")

    if footer is None:
        footer = [f'return Atdar.loader.auto(module, "natives/{rel}")' if has_children else "return module"]
    elif has_children and footer[0].strip() == "return module":
        footer = [f'return Atdar.loader.auto(module, "natives/{rel}")'] + footer[1:]
    out.extend(footer)
    result = "\n".join(out)
    result = re.sub(r"\n{3,}", "\n\n", result)
    if not result.endswith("\n"):
        result += "\n"
    return result, taken


# ─── Main ────────────────────────────────────────────────────────────────────

def route(native):
    default, rules = ROUTES[native["ns"]]
    for rx, file in rules:
        if re.search(rx, native["name"]):
            return file
    return default


def main():
    dry = "--dry-run" in sys.argv
    natives = parse_init()
    files = existing_files()
    done = wrapped_natives(files)

    per_file = defaultdict(list)
    skipped = 0
    for n in natives:
        if (n["ns"], n["name"]) in done:
            skipped += 1
            continue
        per_file[route(n)].append(n)

    all_files = set(files) | set(per_file)
    children = {rel for rel in all_files if any(o.startswith(rel + "/") for o in all_files)}

    print(f"{len(natives)} natives, {skipped} already wrapped by hand, {len(per_file)} files")
    new_files = sorted(f for f in per_file if f not in files)
    print(f"new files ({len(new_files)}): {', '.join(new_files)}")
    missing_header = [f for f in new_files if f not in HEADERS]
    if missing_header:
        print(f"WARNING new files without a header line: {missing_header}")

    for rel in sorted(all_files):
        text = files.get(rel)
        items = per_file.get(rel, [])
        taken = set(FUNC_RE.match(l).group(1) for l in text.split("\n") if FUNC_RE.match(l)) if text else set()
        generated = defaultdict(list)
        names = []
        for n in items:
            fname = func_name(n["name"], rel, taken)
            taken.add(fname)
            names.append(fname)
            generated[section_of(fname)].append(render(n, fname))
        counts = " ".join(f"{s}={len(generated[s])}" for s in SECTIONS if generated[s])
        print(f"{rel:36} +{len(items):4}  {counts}")
        if dry:
            if items:
                sample = ", ".join(names[:6])
                print(f"{'':36}       e.g. {sample}")
            continue
        content, _ = build_file(rel, text, generated, rel in children)
        if not items and text is not None:
            content = text if not (rel in children) else content
        path = os.path.join(OUT, *rel.split("/")) + ".pluto"
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)


if __name__ == "__main__":
    main()
