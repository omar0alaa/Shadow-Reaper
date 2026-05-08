"""Static game data: weapons, upgrades, enemy archetypes."""
from __future__ import annotations


WEAPONS = {
    "rusted_dagger": {
        "id": "rusted_dagger",
        "name": "Rusted Dagger",
        "rarity": "common",
        "type": "melee_fast",
        "damage": 18,
        "speed": 1.4,
        "range": 2.2,
        "combo": 3,
        "description": "Pitted blade. Fast 3-hit combo.",
        "color": "#8a8a8a",
        "modifies": {},
    },
    "shadowfang": {
        "id": "shadowfang",
        "name": "Shadowfang Daggers",
        "rarity": "epic",
        "type": "dual_fast",
        "damage": 14,
        "speed": 1.9,
        "range": 2.0,
        "combo": 5,
        "description": "Twin fangs that drink blood. Applies Bleed.",
        "color": "#a45cff",
        "modifies": {"bleed": True, "blade_flurry_extra_hits": 6},
    },
    "moonveil": {
        "id": "moonveil",
        "name": "Moonveil Sword",
        "rarity": "epic",
        "type": "melee_heavy",
        "damage": 36,
        "speed": 0.85,
        "range": 3.2,
        "combo": 3,
        "description": "Heavy strikes release crescent waves on heavy attack.",
        "color": "#7fdaff",
        "modifies": {"heavy_wave": True, "dash_slash": True},
    },
    "phantom_bow": {
        "id": "phantom_bow",
        "name": "Phantom Bow",
        "rarity": "epic",
        "type": "ranged",
        "damage": 28,
        "speed": 1.0,
        "range": 30.0,
        "combo": 1,
        "description": "Ghostly arrows pierce through foes.",
        "color": "#9bff9b",
        "modifies": {"ranged": True, "blade_flurry_arrow_storm": True},
    },
    "reapers_scythe": {
        "id": "reapers_scythe",
        "name": "Reaper's Scythe",
        "rarity": "legendary",
        "type": "melee_aoe",
        "damage": 42,
        "speed": 1.0,
        "range": 3.6,
        "combo": 3,
        "description": "Wide arcs steal life. Reaper Time becomes apocalyptic.",
        "color": "#ff4040",
        "modifies": {"lifesteal": 0.15, "ult_kill_explosions": True},
    },
}

# Weighted weapon drop tables for real-boss waves (every 10th)
BOSS_WEAPON_TABLE = {
    10: [("shadowfang", 40), ("moonveil", 40), ("phantom_bow", 20)],
    20: [("shadowfang", 25), ("moonveil", 25), ("phantom_bow", 25), ("reapers_scythe", 25)],
    30: [("reapers_scythe", 50), ("shadowfang", 17), ("moonveil", 17), ("phantom_bow", 16)],
}


UPGRADES = [
    # ---- common ----
    {"id": "crit_chance",    "name": "Sharpened Edge",    "rarity": "common", "desc": "+15% Crit Chance",          "stat": "crit_chance",    "value": 0.15},
    {"id": "crit_damage",    "name": "Killer Instinct",   "rarity": "common", "desc": "+30% Crit Damage",          "stat": "crit_damage",    "value": 0.30},
    {"id": "max_health",     "name": "Toughened Hide",    "rarity": "common", "desc": "+25 Max Health",            "stat": "max_health",     "value": 25},
    {"id": "lifesteal",      "name": "Vampiric Edge",     "rarity": "common", "desc": "+10% Lifesteal",            "stat": "lifesteal",      "value": 0.10},
    {"id": "move_speed",     "name": "Swift Boots",       "rarity": "common", "desc": "+15% Move Speed",           "stat": "move_speed",     "value": 0.15},
    {"id": "stamina_regen",  "name": "Iron Lungs",        "rarity": "common", "desc": "+50% Stamina Regen",        "stat": "stamina_regen",  "value": 0.5},
    {"id": "combo_damage",   "name": "Flow State",        "rarity": "common", "desc": "+20% Combo Damage / hit",   "stat": "combo_damage",   "value": 0.20},
    {"id": "backstab_dmg",   "name": "Shadow Strike",     "rarity": "common", "desc": "+50% Backstab Damage",      "stat": "backstab_mult",  "value": 0.5},
    # ---- rare ----
    {"id": "dash_charges",   "name": "Phantom Step",      "rarity": "rare",   "desc": "+1 Dash Charge",            "stat": "dash_charges",   "value": 1},
    {"id": "chain_lightning","name": "Stormbound",        "rarity": "rare",   "desc": "Hits chain lightning to 2 enemies", "stat": "chain_lightning", "value": 1},
    {"id": "smoke_damage",   "name": "Toxic Cloud",       "rarity": "rare",   "desc": "Smoke Bomb damages enemies",         "stat": "smoke_damage", "value": 1},
    {"id": "poison_dash",    "name": "Venom Trail",       "rarity": "rare",   "desc": "Dash leaves a poison trail",         "stat": "poison_dash", "value": 1},
    {"id": "ricochet",       "name": "Ricochet",          "rarity": "rare",   "desc": "Arrows bounce to 1 extra target",    "stat": "ricochet",    "value": 1},
    {"id": "ult_duration",   "name": "Eternal Reaper",    "rarity": "rare",   "desc": "Ultimate +2s duration",     "stat": "ult_duration",   "value": 2},
    {"id": "energy_gain",    "name": "Soul Harvester",    "rarity": "rare",   "desc": "+50% Energy gain on kill",  "stat": "energy_gain",    "value": 0.5},
    # ---- epic ----
    {"id": "explode_kills",  "name": "Soul Detonation",   "rarity": "epic",   "desc": "Killed enemies explode (10% HP dmg)", "stat": "explode_kills", "value": 0.10},
    {"id": "execute",        "name": "Reaper's Mark",     "rarity": "epic",   "desc": "Execute enemies below 15% HP",        "stat": "execute_thresh","value": 0.15},
    {"id": "extra_combo",    "name": "Endless Blade",     "rarity": "epic",   "desc": "+1 hit to base combo",       "stat": "extra_combo_hits","value": 1},
    {"id": "iframes_long",   "name": "Wraithform",        "rarity": "epic",   "desc": "Dash i-frames +0.3s",        "stat": "iframe_bonus",   "value": 0.3},
    {"id": "double_dmg_ult", "name": "Death Incarnate",   "rarity": "epic",   "desc": "Ultimate doubles all damage", "stat": "ult_dmg_mult",  "value": 1.0},
]


ENEMY_TYPES = {
    "bandit": {
        "name": "Bandit",
        "color": "#c33232",
        "hp": 50,
        "damage": 8,
        "speed": 4.0,
        "behavior": "melee",
        "scale": 1.0,
    },
    "archer": {
        "name": "Archer Rogue",
        "color": "#3aa55c",
        "hp": 40,
        "damage": 12,
        "speed": 3.4,
        "behavior": "ranged",
        "scale": 1.0,
    },
    "knight": {
        "name": "Heavy Knight",
        "color": "#9aa0a6",
        "hp": 140,
        "damage": 22,
        "speed": 2.4,
        "behavior": "heavy",
        "scale": 1.35,
    },
    "assassin": {
        "name": "Elite Assassin",
        "color": "#a45cff",
        "hp": 70,
        "damage": 16,
        "speed": 5.5,
        "behavior": "teleport",
        "scale": 1.0,
    },
    "necromancer": {
        "name": "Necromancer",
        "color": "#5cd1e0",
        "hp": 90,
        "damage": 10,
        "speed": 2.6,
        "behavior": "summoner",
        "scale": 1.1,
    },
    "skeleton": {
        "name": "Skeleton",
        "color": "#dcdcdc",
        "hp": 22,
        "damage": 6,
        "speed": 4.4,
        "behavior": "melee",
        "scale": 0.85,
    },
}


MINIBOSS = {
    "name": "Dread Champion",
    "color": "#ff8c1a",
    "hp": 600,
    "damage": 28,
    "speed": 3.8,
    "behavior": "miniboss",
    "scale": 1.9,
}

BOSSES = {
    10: {
        "name": "The Ashen Lord",
        "color": "#ff2a2a",
        "hp": 1500,
        "damage": 30,
        "speed": 3.0,
        "behavior": "boss",
        "scale": 2.6,
        "phases": 3,
    },
    20: {
        "name": "The Hollow King",
        "color": "#ff5500",
        "hp": 2400,
        "damage": 38,
        "speed": 3.2,
        "behavior": "boss",
        "scale": 2.8,
        "phases": 3,
    },
    30: {
        "name": "Death's Vanguard",
        "color": "#aa00ff",
        "hp": 3600,
        "damage": 48,
        "speed": 3.5,
        "behavior": "boss",
        "scale": 3.0,
        "phases": 3,
    },
}


def get_boss_for_wave(wave: int) -> dict:
    """Return boss spec for any 10*N wave (looping the catalogue past 30)."""
    if wave % 10 != 0:
        return None
    keys = sorted(BOSSES.keys())
    # cycle bosses past wave 30
    idx = ((wave // 10) - 1) % len(keys)
    base = dict(BOSSES[keys[idx]])
    # scale tougher each loop
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
