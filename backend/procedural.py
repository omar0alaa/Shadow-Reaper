"""Seeded procedural generation for arenas, waves, and weapon drops."""
from __future__ import annotations

import math
import random
from typing import Dict, List

from .game_data import (
    ENEMY_TYPES,
    MINIBOSS,
    RARITY_TABLES,
    WEAPON_CLASSES,
    WEAPONS,
    get_boss_for_wave,
)


def make_seed() -> int:
    return random.randint(1, 2**31 - 1)


def generate_arena(seed: int) -> Dict:
    """Generate prop layout for arena. Deterministic per seed."""
    rng = random.Random(seed)
    radius = 32 + rng.randint(0, 6)
    props: List[Dict] = []

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
    """Wave composition rules — same as before:
       - waves 1..4: normal escalation
       - wave % 5 == 0 and wave % 10 != 0: normal + miniboss
       - wave % 10 == 0: real boss only
    """
    rng = random.Random(seed * 1000 + wave)

    if wave % 10 == 0:
        boss = get_boss_for_wave(wave)
        return {
            "wave": wave,
            "is_boss_wave": True,
            "is_miniboss_wave": False,
            "enemies": [],
            "boss": boss,
        }

    base_count = 3 + wave + rng.randint(0, 2)
    base_count = min(base_count, 22)

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
    }
    if is_mini:
        mini = dict(MINIBOSS)
        mini["hp"] = int(mini["hp"] * (1 + 0.15 * (wave // 5 - 1)))
        mini["damage"] = int(mini["damage"] * (1 + 0.10 * (wave // 5 - 1)))
        mini["type"] = "miniboss"
        payload["miniboss"] = mini
    return payload


def _pick_rarity(wave: int, rng: random.Random) -> str:
    chosen = RARITY_TABLES[0][1]
    for w_threshold, weights in RARITY_TABLES:
        if wave >= w_threshold:
            chosen = weights
    total = sum(w for _, w in chosen)
    pick = rng.uniform(0, total)
    cum = 0.0
    for r, w in chosen:
        cum += w
        if pick <= cum:
            return r
    return chosen[-1][0]


def pick_weapon_drop(wave: int, player_class: str, rng_seed: int = 0) -> str:
    """Drop a weapon of the player's chosen class with rarity scaled by wave."""
    if player_class not in WEAPON_CLASSES:
        player_class = "sword"
    rng = random.Random(rng_seed * 1000 + wave * 7 + hash(player_class) % 991)
    rarity = _pick_rarity(wave, rng)
    wid = f"{player_class}_{rarity}"
    if wid not in WEAPONS:
        wid = f"{player_class}_uncommon"
    return wid
