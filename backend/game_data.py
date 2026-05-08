"""Static game data: weapon classes, rarities, upgrades, enemies."""
from __future__ import annotations


# ---------------------------------------------------------------------------
# Weapon classes (= "playstyle classes" the player picks at run start).
# ---------------------------------------------------------------------------

WEAPON_CLASSES = ["sword", "dagger", "bow", "scythe"]

CLASS_DISPLAY = {
    "sword":  {"name": "Sword",  "tagline": "Balanced melee — heavy waves on epic+", "color": "#a0b0d0"},
    "dagger": {"name": "Dagger", "tagline": "Fast dual-wield — Bleed on rare+",       "color": "#b48cff"},
    "bow":    {"name": "Bow",    "tagline": "Ranged kiter — Arrow Storm on epic+",   "color": "#9bff9b"},
    "scythe": {"name": "Scythe", "tagline": "Wide AoE — Lifesteal on rare+",          "color": "#ff6060"},
}

RARITIES = ["common", "uncommon", "rare", "epic", "legendary"]
RARITY_RANK = {r: i for i, r in enumerate(RARITIES)}

_RARITY_MULT = {
    "common":    {"dmg": 1.00, "spd": 1.00},
    "uncommon":  {"dmg": 1.65, "spd": 1.08},
    "rare":      {"dmg": 2.40, "spd": 1.16},
    "epic":      {"dmg": 3.40, "spd": 1.24},
    "legendary": {"dmg": 4.60, "spd": 1.32},
}

_CLASS_BASE = {
    "sword": {
        "type": "melee_balanced",
        "damage": 14, "speed": 1.10, "range": 2.8, "combo": 3,
        "color": "#a0b0d0",
    },
    "dagger": {
        "type": "dual_fast",
        "damage": 10, "speed": 1.40, "range": 2.2, "combo": 4,
        "color": "#b48cff",
    },
    "bow": {
        "type": "ranged",
        "damage": 20, "speed": 1.00, "range": 30.0, "combo": 1,
        "color": "#9bff9b",
    },
    "scythe": {
        "type": "melee_aoe",
        "damage": 24, "speed": 0.85, "range": 3.6, "combo": 3,
        "color": "#ff6060",
    },
}

_NAMES = {
    "sword":  ["Rusted Sword", "Iron Edge",     "Steel Sabre",  "Moonveil",       "Worldbreaker"],
    "dagger": ["Cutpurse Knife","Twin Daggers", "Shadowfang",   "Voidsting",      "Death's Whisper"],
    "bow":    ["Hunter's Bow", "Yew Longbow",   "Spirit Bow",   "Phantom Bow",    "Soulrender"],
    "scythe": ["Reaper's Sickle","Bone Scythe", "Soulreaper",   "Dread Scythe",   "Reaper's Scythe"],
}

_DESCS = {
    "sword":  [
        "A rusted blade. Reliable.",
        "Honed iron. Dependable damage.",
        "A noble's edge. Sharp and quick.",
        "Moonlit steel — heavy strikes release crescent waves; dash leaves a slash.",
        "A blade said to split worlds. All sword traits, amplified.",
    ],
    "dagger": [
        "A pickpocket's knife.",
        "Twin balanced daggers — fast strikes.",
        "Twin fangs that drink blood — applies Bleed.",
        "Voidforged daggers — Bleed scales with hits; Blade Flurry gains extra hits.",
        "Whisper-quick. Devastating in a flurry. Heavy Bleed stacks.",
    ],
    "bow": [
        "A simple hunter's bow.",
        "A stout yew bow — sturdy shots.",
        "Bound to spirits. Arrows pierce.",
        "Ghostly arrows pierce all foes; Blade Flurry becomes Arrow Storm.",
        "Arrows here harvest souls. Pierce + auto-ricochet.",
    ],
    "scythe": [
        "A small sickle. Wide but weak.",
        "Carved bone curve. Steady arcs.",
        "Drinks lifeforce on hit (5% lifesteal).",
        "A reaper's tool. 10% lifesteal innate.",
        "Death incarnate. 15% lifesteal + Reaper Time kill-explosions.",
    ],
}


def _modifies_for(cls: str, rarity: str) -> dict:
    """Cumulative trait list per class+rarity. Higher rarity inherits lower."""
    rank = RARITY_RANK[rarity]
    m: dict = {}
    if cls == "sword":
        if rank >= 3:
            m["heavy_wave"] = True
            m["dash_slash"] = True
        if rank >= 4:
            m["wave_pierce"] = True
    elif cls == "dagger":
        if rank >= 2:
            m["bleed"] = True
        if rank >= 3:
            m["blade_flurry_extra_hits"] = 6
        if rank >= 4:
            m["bleed_strong"] = True
    elif cls == "bow":
        m["ranged"] = True
        if rank >= 2:
            m["pierce"] = True
        if rank >= 3:
            m["blade_flurry_arrow_storm"] = True
        if rank >= 4:
            m["auto_ricochet"] = 1
    elif cls == "scythe":
        if rank >= 2:
            m["lifesteal"] = 0.05
        if rank >= 3:
            m["lifesteal"] = 0.10
        if rank >= 4:
            m["lifesteal"] = 0.15
            m["ult_kill_explosions"] = True
    return m


def _build_weapons() -> dict:
    out: dict = {}
    for cls, base in _CLASS_BASE.items():
        for i, rarity in enumerate(RARITIES):
            wid = f"{cls}_{rarity}"
            mult = _RARITY_MULT[rarity]
            out[wid] = {
                "id": wid,
                "name": _NAMES[cls][i],
                "rarity": rarity,
                "class": cls,
                "type": base["type"],
                "damage": round(base["damage"] * mult["dmg"], 1),
                "speed": round(base["speed"] * mult["spd"], 2),
                "range": base["range"],
                "combo": base["combo"],
                "color": base["color"],
                "description": _DESCS[cls][i],
                "modifies": _modifies_for(cls, rarity),
            }
    return out


WEAPONS = _build_weapons()


def starting_weapon_for(cls: str) -> str:
    if cls not in WEAPON_CLASSES:
        cls = "sword"
    return f"{cls}_common"


# ---------------------------------------------------------------------------
# Boss drop rarity table — wave-scaled. Class is decided by the player.
# ---------------------------------------------------------------------------

# (wave_threshold, [(rarity, weight), ...]) — pick the table whose threshold
# is the highest <= current wave.
RARITY_TABLES = [
    (10, [("uncommon", 70), ("rare", 25), ("epic", 5)]),
    (20, [("uncommon", 30), ("rare", 50), ("epic", 18), ("legendary", 2)]),
    (30, [("uncommon", 10), ("rare", 35), ("epic", 40), ("legendary", 15)]),
    (40, [("rare", 25), ("epic", 50), ("legendary", 25)]),
]


# ---------------------------------------------------------------------------
# Upgrades — each declares a `scope` list of weapon classes it applies to,
# or "any" for universal.
# ---------------------------------------------------------------------------

UPGRADES = [
    # ---- common (universal) ----
    {"id": "crit_chance",    "name": "Sharpened Edge",    "rarity": "common", "scope": "any",
     "desc": "+15% Crit Chance",      "stat": "crit_chance",    "value": 0.15},
    {"id": "crit_damage",    "name": "Killer Instinct",   "rarity": "common", "scope": "any",
     "desc": "+30% Crit Damage",      "stat": "crit_damage",    "value": 0.30},
    {"id": "max_health",     "name": "Toughened Hide",    "rarity": "common", "scope": "any",
     "desc": "+25 Max Health",        "stat": "max_health",     "value": 25},
    {"id": "lifesteal",      "name": "Vampiric Edge",     "rarity": "common", "scope": "any",
     "desc": "+8% Lifesteal",         "stat": "lifesteal",      "value": 0.08},
    {"id": "move_speed",     "name": "Swift Boots",       "rarity": "common", "scope": "any",
     "desc": "+15% Move Speed",       "stat": "move_speed",     "value": 0.15},
    {"id": "stamina_regen",  "name": "Iron Lungs",        "rarity": "common", "scope": "any",
     "desc": "+50% Stamina Regen",    "stat": "stamina_regen",  "value": 0.5},

    # ---- common (combo / melee) ----
    {"id": "combo_damage",   "name": "Flow State",        "rarity": "common", "scope": ["sword", "dagger", "scythe"],
     "desc": "+2.5% damage per combo hit",  "stat": "combo_damage",   "value": 0.025},
    {"id": "backstab_dmg",   "name": "Shadow Strike",     "rarity": "common", "scope": "any",
     "desc": "+50% Backstab Damage",  "stat": "backstab_mult",  "value": 0.5},

    # ---- rare ----
    {"id": "dash_charges",   "name": "Phantom Step",      "rarity": "rare",   "scope": "any",
     "desc": "+1 Dash Charge",        "stat": "dash_charges",   "value": 1},
    {"id": "chain_lightning","name": "Stormbound",        "rarity": "rare",   "scope": "any",
     "desc": "Hits chain lightning to 2 enemies", "stat": "chain_lightning", "value": 1},
    {"id": "smoke_damage",   "name": "Toxic Cloud",       "rarity": "rare",   "scope": "any",
     "desc": "Smoke Bomb damages enemies",         "stat": "smoke_damage", "value": 1},
    {"id": "poison_dash",    "name": "Venom Trail",       "rarity": "rare",   "scope": "any",
     "desc": "Dash leaves a poison trail",         "stat": "poison_dash", "value": 1},
    {"id": "ricochet",       "name": "Ricochet",          "rarity": "rare",   "scope": ["bow"],
     "desc": "Arrows bounce to 1 extra target",    "stat": "ricochet",    "value": 1},
    {"id": "ult_duration",   "name": "Eternal Reaper",    "rarity": "rare",   "scope": "any",
     "desc": "Ultimate +2s duration",     "stat": "ult_duration",   "value": 2},
    {"id": "energy_gain",    "name": "Soul Harvester",    "rarity": "rare",   "scope": "any",
     "desc": "+50% Energy gain on kill",  "stat": "energy_gain",    "value": 0.5},

    # ---- epic ----
    {"id": "explode_kills",  "name": "Soul Detonation",   "rarity": "epic",   "scope": "any",
     "desc": "Kills explode for 25% of victim HP",  "stat": "explode_kills", "value": 0.25},
    {"id": "execute",        "name": "Reaper's Mark",     "rarity": "epic",   "scope": "any",
     "desc": "Execute enemies below 18% HP",        "stat": "execute_thresh","value": 0.18},
    {"id": "extra_combo",    "name": "Endless Blade",     "rarity": "epic",   "scope": ["sword", "dagger", "scythe"],
     "desc": "+1 hit to base combo",     "stat": "extra_combo_hits", "value": 1},
    {"id": "iframes_long",   "name": "Wraithform",        "rarity": "epic",   "scope": "any",
     "desc": "Dash i-frames +0.3s",       "stat": "iframe_bonus",   "value": 0.3},
    {"id": "double_dmg_ult", "name": "Death Incarnate",   "rarity": "epic",   "scope": "any",
     "desc": "Ultimate doubles all damage", "stat": "ult_dmg_mult",  "value": 1.0},
    {"id": "multishot",      "name": "Multishot",         "rarity": "epic",   "scope": ["bow"],
     "desc": "Bow fires 2 extra arrows",  "stat": "multishot",      "value": 2},
]


# ---------------------------------------------------------------------------
# Enemies (unchanged structure; difficulty mults applied client-side).
# ---------------------------------------------------------------------------

ENEMY_TYPES = {
    "bandit": {
        "name": "Bandit",
        "color": "#c33232",
        "hp": 50, "damage": 8, "speed": 4.0,
        "behavior": "melee", "scale": 1.0,
    },
    "archer": {
        "name": "Archer Rogue",
        "color": "#3aa55c",
        "hp": 40, "damage": 12, "speed": 3.4,
        "behavior": "ranged", "scale": 1.0,
    },
    "knight": {
        "name": "Heavy Knight",
        "color": "#9aa0a6",
        "hp": 140, "damage": 22, "speed": 2.4,
        "behavior": "heavy", "scale": 1.35,
    },
    "assassin": {
        "name": "Elite Assassin",
        "color": "#a45cff",
        "hp": 70, "damage": 16, "speed": 5.5,
        "behavior": "teleport", "scale": 1.0,
    },
    "necromancer": {
        "name": "Necromancer",
        "color": "#5cd1e0",
        "hp": 90, "damage": 10, "speed": 2.6,
        "behavior": "summoner", "scale": 1.1,
    },
    "skeleton": {
        "name": "Skeleton",
        "color": "#dcdcdc",
        "hp": 22, "damage": 6, "speed": 4.4,
        "behavior": "melee", "scale": 0.85,
    },
}

MINIBOSS = {
    "name": "Dread Champion",
    "color": "#ff8c1a",
    "hp": 600, "damage": 28, "speed": 3.8,
    "behavior": "miniboss", "scale": 1.9,
}

BOSSES = {
    10: {"name": "The Ashen Lord",   "color": "#ff2a2a", "hp": 1500, "damage": 30, "speed": 3.0,
         "behavior": "boss", "scale": 2.6, "phases": 3},
    20: {"name": "The Hollow King",  "color": "#ff5500", "hp": 2400, "damage": 38, "speed": 3.2,
         "behavior": "boss", "scale": 2.8, "phases": 3},
    30: {"name": "Death's Vanguard", "color": "#aa00ff", "hp": 3600, "damage": 48, "speed": 3.5,
         "behavior": "boss", "scale": 3.0, "phases": 3},
}


def get_boss_for_wave(wave: int) -> dict:
    """Return boss spec for any 10*N wave (looping the catalogue past 30)."""
    if wave % 10 != 0:
        return None
    keys = sorted(BOSSES.keys())
    idx = ((wave // 10) - 1) % len(keys)
    base = dict(BOSSES[keys[idx]])
    loops = (wave // 10 - 1) // len(keys)
    base["hp"] = int(base["hp"] * (1 + 0.4 * loops))
    base["damage"] = int(base["damage"] * (1 + 0.2 * loops))
    return base


DEFAULT_SETTINGS = {
    "master_volume": 0.7,
    "sfx_volume": 0.8,
    "music_volume": 0.5,
    "mouse_sensitivity": 0.0025,
    "invert_y": False,
}