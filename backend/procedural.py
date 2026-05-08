"""Seeded procedural generation for arenas and waves."""
from __future__ import annotations

import math
import random
from typing import Dict, List

from .game_data import ENEMY_TYPES, MINIBOSS, get_boss_for_wave, BOSS_WEAPON_TABLE


def make_seed() -> int:
    return random.randint(1, 2**31 - 1)


def generate_arena(seed: int) -> Dict:
    """Generate prop layout for arena. Deterministic per seed."""
    rng = random.Random(seed)
    radius = 32 + rng.randint(0, 6)
    props: List[Dict] = []

    # Pillars in a rough ring inside the arena
    n_pillars = rng.randint(6, 10)
    for i in range(n_pillars):
        angle = (2 * math.pi * i / n_pillars) + rng.uniform(-0.2, 0.2)
        dist = radius * 0.55 + rng.uniform(-2, 2)
        props.append({
            "type": "pillar",
            "x": math.cos(angle) * dist,
            "z": math.sin(angle) * dist,
            "rot": rng.uniform(0, math.pi * 2),
            "scale": 1.0 + rng.uniform(-0.15, 0.25),
        })

    # Ruined wall fragments, scattered
    for _ in range(rng.randint(8, 14)):
        a = rng.uniform(0, math.pi * 2)
        d = rng.uniform(6, radius * 0.85)
        props.append({
            "type": "wall",
            "x": math.cos(a) * d,
            "z": math.sin(a) * d,
            "rot": rng.uniform(0, math.pi * 2),
            "scale": rng.uniform(0.7, 1.4),
        })

    # Braziers (light sources)
    for i in range(6):
        angle = (2 * math.pi * i / 6) + rng.uniform(-0.1, 0.1)
        dist = radius * 0.7
        props.append({
            "type": "brazier",
            "x": math.cos(angle) * dist,
            "z": math.sin(angle) * dist,
            "rot": 0,
            "scale": 1.0,
        })

    # A couple of statues in the center area
    for _ in range(rng.randint(1, 3)):
        a = rng.uniform(0, math.pi * 2)
        d = rng.uniform(2, radius * 0.35)
        props.append({
            "type": "statue",
            "x": math.cos(a) * d,
            "z": math.sin(a) * d,
            "rot": rng.uniform(0, math.pi * 2),
            "scale": 1.0 + rng.uniform(-0.1, 0.2),
        })

    # Spawn points on outer ring
    spawns: List[Dict] = []
    for i in range(12):
        angle = 2 * math.pi * i / 12
        spawns.append({
            "x": math.cos(angle) * (radius * 0.85),
            "z": math.sin(angle) * (radius * 0.85),
        })

    return {
        "seed": seed,
        "radius": radius,
        "props": props,
        "spawns": spawns,
        "ambient_color": "#1a1428",
        "fog_color": "#241830",
        "fog_density": 0.010,
    }


def generate_wave(wave: int, seed: int = 0) -> Dict:
    """Wave composition rules:
       - waves 1..4: normal escalation
       - wave % 5 == 0 and wave % 10 != 0: normal enemies + miniboss
       - wave % 10 == 0: real boss only
    """
    rng = random.Random(seed * 1000 + wave)

    if wave % 10 == 0:
        boss = get_boss_for_wave(wave)
        weapon_table = BOSS_WEAPON_TABLE.get(
            wave, BOSS_WEAPON_TABLE[max(BOSS_WEAPON_TABLE.keys())]
        )
        return {
            "wave": wave,
            "is_boss_wave": True,
            "is_miniboss_wave": False,
            "enemies": [],
            "boss": boss,
            "weapon_drop_table": weapon_table,
        }

    # Number of normal enemies grows with wave
    base_count = 3 + wave + rng.randint(0, 2)
    base_count = min(base_count, 22)

    # Available enemy pool grows with wave
    pool = ["bandit", "archer"]
    if wave >= 3:
        pool.append("knight")
    if wave >= 4:
        pool.append("assassin")
    if wave >= 6:
        pool.append("necromancer")

    enemies: List[Dict] = []
    for _ in range(base_count):
        t = rng.choice(pool)
        spec = dict(ENEMY_TYPES[t])
        # Scale stats with wave
        spec["hp"] = int(spec["hp"] * (1 + 0.10 * (wave - 1)))
        spec["damage"] = int(spec["damage"] * (1 + 0.06 * (wave - 1)))
        spec["type"] = t
        enemies.append(spec)

    is_mini = (wave % 5 == 0)
    payload = {
        "wave": wave,
        "is_boss_wave": False,
        "is_miniboss_wave": is_mini,
        "enemies": enemies,
        "boss": None,
        "weapon_drop_table": None,
    }
    if is_mini:
        mini = dict(MINIBOSS)
        mini["hp"] = int(mini["hp"] * (1 + 0.15 * (wave // 5 - 1)))
        mini["damage"] = int(mini["damage"] * (1 + 0.10 * (wave // 5 - 1)))
        mini["type"] = "miniboss"
        payload["miniboss"] = mini
    return payload


def pick_weapon_drop(wave: int, rng_seed: int = 0) -> str:
    table = BOSS_WEAPON_TABLE.get(wave)
    if not table:
        keys = sorted(BOSS_WEAPON_TABLE.keys())
        table = BOSS_WEAPON_TABLE[keys[-1]]
    rng = random.Random(rng_seed + wave)
    total = sum(w for _, w in table)
    pick = rng.uniform(0, total)
    cum = 0
    for wid, weight in table:
        cum += weight
        if pick <= cum:
            return wid
    return table[0][0]
