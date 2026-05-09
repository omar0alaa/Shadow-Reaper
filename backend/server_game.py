"""Server-authoritative game runner.

A `ServerGame` is created when a party host clicks "Start Run". It owns the
canonical state and runs a tick loop in a background thread. All clients
receive periodic `state` snapshots and send `input` messages. There is no
"host has special powers" anymore — every player is equal.
"""
from __future__ import annotations

import json
import math
import random
import threading
import time
from typing import Dict, List, Optional

from . import procedural
from .game_data import (
    UPGRADES, WEAPONS, RARITY_TABLES, WEAPON_CLASSES,
)
from .server_entities import ServerPlayer, ServerEnemy, ServerProjectile, ServerLoot


TICK_HZ = 30
SNAPSHOT_HZ = 15           # broadcast cadence
WAVE_CLEAR_DELAY = 2.0     # seconds before upgrade screen / next wave
RARITY_WEIGHTS = {'common': 70, 'rare': 25, 'epic': 5}


class ServerGame:
    """Authoritative simulation for one party."""

    def __init__(self, code: str, members: List[dict],
                 seed: int, difficulty: str, broadcast_fn, send_to_fn,
                 on_run_ended_fn=None):
        self.code = code
        self.seed = int(seed)
        self.difficulty = difficulty if difficulty in ('easy', 'normal', 'hard') else 'normal'
        self.broadcast_fn = broadcast_fn      # (msg) -> None
        self.send_to_fn = send_to_fn          # (pid, msg) -> None
        self.on_run_ended_fn = on_run_ended_fn  # () -> None, called when all players die
        self.party_size = max(1, len(members))

        # Build arena layout (props + radius + colliders)
        self.arena = procedural.generate_arena(self.seed)
        self.arena_radius = float(self.arena['radius'])
        self.colliders = []
        for p in self.arena['props']:
            r = 0
            if p['type'] == 'pillar':  r = 0.7
            elif p['type'] == 'wall':  r = 0.6 * float(p.get('scale', 1.0))
            elif p['type'] == 'brazier': r = 0.7
            elif p['type'] == 'statue': r = 0.9
            if r > 0:
                self.colliders.append({'x': float(p['x']), 'z': float(p['z']), 'r': r})

        # Spawn players in a small ring at center
        self.players: Dict[str, ServerPlayer] = {}
        n = max(1, len(members))
        for i, m in enumerate(members):
            sp = ServerPlayer(m['pid'], m.get('name', 'Player'), m.get('class', 'sword'))
            ang = (i / n) * math.pi * 2
            sp.x = math.cos(ang) * 2.0
            sp.z = math.sin(ang) * 2.0
            sp.facing = ang
            sp.spawn_x = sp.x
            sp.spawn_z = sp.z
            self.players[sp.pid] = sp

        # World state
        self.enemies: Dict[str, ServerEnemy] = {}
        self.projectiles: List[ServerProjectile] = []
        self.loot: Dict[str, ServerLoot] = {}
        self.wave = 0
        self.wave_active = False
        self.wave_data = None
        self.intermission = False
        self.intermission_timer = 0.0
        self.run_ended = False
        self.run_summary: Optional[dict] = None
        # During intermission only survivors got upgrade screen — track who
        # acknowledged so we can resume next wave.
        self._upgrade_pending_pids: set = set()

        # ID counters
        self._eid_counter = 1
        self._lid_counter = 1
        self._prid_counter = 1

        # Tick scheduling
        self._dt = 1.0 / TICK_HZ
        self._snap_interval = 1.0 / SNAPSHOT_HZ
        self._snap_accum = 0.0
        self._stop_evt = threading.Event()
        self._thread: Optional[threading.Thread] = None

        # Difficulty multipliers for mob stats
        self._diff_hp_mult = {'easy': 0.7, 'normal': 1.0, 'hard': 1.5}.get(self.difficulty, 1.0)
        self._diff_dmg_mult = {'easy': 0.7, 'normal': 1.0, 'hard': 1.4}.get(self.difficulty, 1.0)

    # ------------------------------ lifecycle -------------------------------

    def start(self):
        """Begin wave 1 and start the tick thread."""
        self._begin_wave(1)
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop_evt.set()

    def _run(self):
        last = time.monotonic()
        while not self._stop_evt.is_set() and not self.run_ended:
            now = time.monotonic()
            dt = now - last
            if dt < self._dt:
                time.sleep(self._dt - dt)
                continue
            last = now
            try:
                self.step(self._dt)
            except Exception as e:
                print(f"[ServerGame {self.code}] tick error:", e)

    # ------------------------------ broadcasting ----------------------------

    def broadcast(self, msg: dict):
        try:
            self.broadcast_fn(msg)
        except Exception:
            pass

    def send_to(self, pid: str, msg: dict):
        try:
            self.send_to_fn(pid, msg)
        except Exception:
            pass

    # ------------------------------ player I/O ------------------------------

    def add_player(self, pid: str, name: str, cls: str):
        if pid in self.players: return
        sp = ServerPlayer(pid, name, cls)
        # Spawn near the centre, offset based on current party size so they
        # don't pile on top of an existing player.
        n = max(1, len(self.players) + 1)
        ang = ((len(self.players)) / n) * math.pi * 2
        sp.x = math.cos(ang) * 2.0
        sp.z = math.sin(ang) * 2.0
        sp.facing = ang
        sp.spawn_x = sp.x
        sp.spawn_z = sp.z
        self.players[sp.pid] = sp

    def remove_player(self, pid: str):
        self.players.pop(pid, None)
        # If everyone left, end run.
        if not self.players:
            self.run_ended = True

    def host_abandon(self):
        """Host requested the run end. Same flow as everyone-dying, but tagged."""
        self._end_run(reason='host_abandoned')

    def on_input(self, pid: str, msg: dict):
        sp = self.players.get(pid)
        if not sp: return
        sp.apply_input(msg, time.monotonic())

    def on_upgrade_pick(self, pid: str, upgrade_id: str):
        sp = self.players.get(pid)
        if not sp or sp.pid not in self._upgrade_pending_pids:
            return
        # Find the upgrade in the global pool
        up = next((u for u in UPGRADES if u['id'] == upgrade_id), None)
        if up is None: return
        sp.apply_upgrade(up)
        self._upgrade_pending_pids.discard(pid)
        self.broadcast({'type': 'upgrade_picked', 'pid': pid, 'upgrade': up})
        # If everyone has resolved, fire next wave.
        if not self._upgrade_pending_pids and self.intermission:
            self._next_wave()

    def on_weapon_pick(self, pid: str, equip: bool, weapon_id: str):
        sp = self.players.get(pid)
        if not sp: return
        if equip and weapon_id in WEAPONS:
            sp.equip(weapon_id)
            self.broadcast({'type': 'player_equipped', 'pid': pid, 'weapon': weapon_id})

    # ------------------------------ collision -------------------------------

    def resolve_collision(self, x: float, z: float, r: float = 0.4):
        # Arena bounds
        d = math.hypot(x, z)
        max_d = self.arena_radius - 0.5
        if d > max_d:
            a = math.atan2(z, x)
            x = math.cos(a) * max_d
            z = math.sin(a) * max_d
        # Props
        for c in self.colliders:
            dx = x - c['x']; dz = z - c['z']
            d = math.hypot(dx, dz)
            min_d = c['r'] + r
            if d < min_d and d > 1e-3:
                n = min_d / d
                x = c['x'] + dx * n
                z = c['z'] + dz * n
        return x, z

    # ------------------------------ targeting -------------------------------

    def nearest_living_player(self, x: float, z: float) -> Optional[ServerPlayer]:
        now = time.monotonic()
        best = None
        best_d = float('inf')
        for sp in self.players.values():
            if not sp.alive: continue
            # stealth: enemies lose target while smoke is up
            if sp.stealth_until > 0:
                continue
            d = math.hypot(sp.x - x, sp.z - z)
            if d < best_d:
                best_d = d; best = sp
        # If everyone is stealthed, pick nearest alive anyway after stealth ends
        if best is None:
            for sp in self.players.values():
                if not sp.alive: continue
                d = math.hypot(sp.x - x, sp.z - z)
                if d < best_d:
                    best_d = d; best = sp
        return best

    # ------------------------------ wave logic ------------------------------

    def _begin_wave(self, n: int):
        self.wave = n
        wd = procedural.generate_wave(n, self.seed)
        self.wave_data = wd
        self.wave_active = True
        self.intermission = False
        self.intermission_timer = 0
        self._upgrade_pending_pids.clear()

        spawn_pts = self.arena['spawns']
        used: set = set()
        def pick_spawn():
            for _ in range(30):
                i = random.randint(0, len(spawn_pts) - 1)
                if i not in used:
                    used.add(i); return spawn_pts[i]
            return spawn_pts[random.randint(0, len(spawn_pts) - 1)]

        # Party-size scaling
        party_mult = 1 + 0.35 * (self.party_size - 1)
        dmg_mult   = 1 + 0.20 * (self.party_size - 1)

        def scaled(spec):
            out = dict(spec)
            out['hp']     = float(spec.get('hp', 50))     * party_mult * self._diff_hp_mult
            out['damage'] = float(spec.get('damage', 8))  * dmg_mult   * self._diff_dmg_mult
            return out

        if wd.get('is_boss_wave') and wd.get('boss'):
            sp = pick_spawn()
            spec = scaled(wd['boss'])
            eid = f'e{self._eid_counter}'; self._eid_counter += 1
            self.enemies[eid] = ServerEnemy(eid, 'boss', spec, sp['x'], sp['z'])
        else:
            for ent in wd.get('enemies', []):
                sp = pick_spawn()
                spec = scaled(ent)
                t = ent.get('type', 'bandit')
                eid = f'e{self._eid_counter}'; self._eid_counter += 1
                self.enemies[eid] = ServerEnemy(eid, t, spec, sp['x'], sp['z'])
            if wd.get('is_miniboss_wave') and wd.get('miniboss'):
                sp = pick_spawn()
                spec = scaled(wd['miniboss'])
                eid = f'e{self._eid_counter}'; self._eid_counter += 1
                self.enemies[eid] = ServerEnemy(eid, 'miniboss', spec, sp['x'], sp['z'])

        self.broadcast({
            'type': 'wave_start',
            'wave': n,
            'is_boss_wave': bool(wd.get('is_boss_wave')),
            'is_miniboss_wave': bool(wd.get('is_miniboss_wave')),
            'enemy_count': len(self.enemies),
        })

    def _on_wave_clear(self):
        self.wave_active = False
        self.intermission = True
        self.intermission_timer = WAVE_CLEAR_DELAY

        # Per-player loot (boss / miniboss / common)
        # We've already dropped per-mob in on_enemy_killed; nothing to do here.

        # Determine survivors for the upgrade pick
        survivors = [sp for sp in self.players.values() if sp.alive]
        # Find host position for revives (use the first survivor, else center)
        rev_x = survivors[0].x if survivors else 0.0
        rev_z = survivors[0].z if survivors else 0.0
        # Revive any dead players
        for sp in self.players.values():
            if not sp.alive:
                sp.revive(rev_x, rev_z)
                self.broadcast({'type': 'player_revived', 'pid': sp.pid})

        # Survivors get an upgrade screen
        self._upgrade_pending_pids = {sp.pid for sp in survivors}
        for sp in survivors:
            cards = self._roll_upgrades(sp.cls, self.wave)
            self.send_to(sp.pid, {
                'type': 'upgrade_offer',
                'cards': cards,
                'wave': self.wave,
            })

        self.broadcast({
            'type': 'wave_cleared',
            'wave': self.wave,
            'survivors': [sp.pid for sp in survivors],
        })

    def _next_wave(self):
        # Triggered when all survivors picked OR intermission timeout.
        n = self.wave + 1
        self._begin_wave(n)

    def _roll_upgrades(self, cls: str, wave: int) -> List[dict]:
        # Filter pool by scope (any | [classes])
        pool = []
        for u in UPGRADES:
            scope = u.get('scope')
            if not scope or scope == 'any':
                pool.append(u)
            elif isinstance(scope, list) and cls in scope:
                pool.append(u)
        # Bias rarity by wave
        weights = dict(RARITY_WEIGHTS)
        if wave >= 5:  weights['rare']   += 10; weights['common'] -= 10
        if wave >= 10: weights['epic']   += 8;  weights['common'] -= 8
        if wave >= 20: weights['epic']   += 14; weights['rare']   += 6; weights['common'] -= 20
        grouped = {'common': [], 'rare': [], 'epic': []}
        for u in pool:
            r = u.get('rarity', 'common')
            grouped.setdefault(r, []).append(u)
        draws = []
        used = set()
        for _ in range(3):
            tot = sum(weights.values())
            roll = random.uniform(0, tot)
            bucket = 'common'
            cum = weights['common']
            if roll <= cum: bucket = 'common'
            else:
                cum += weights['rare']
                if roll <= cum: bucket = 'rare'
                else: bucket = 'epic'
            lst = grouped.get(bucket) or pool
            pick = None
            for _t in range(8):
                c = lst[random.randint(0, len(lst) - 1)]
                if c['id'] not in used:
                    pick = c; break
            if pick is None:
                pick = lst[random.randint(0, len(lst) - 1)]
            used.add(pick['id'])
            draws.append(pick)
        return draws

    # ------------------------------ tick step -------------------------------

    def step(self, dt: float):
        if self.run_ended:
            return

        # 1) Player updates (movement, attacks, skills)
        for sp in list(self.players.values()):
            sp.step(dt, self)

        # If anyone is in Reaper Time, enemies + their projectiles tick slow.
        ult_active = any(getattr(sp, 'ult_active', False) for sp in self.players.values())
        enemy_dt = dt * 0.4 if ult_active else dt

        # 2) Enemy updates (only if any wave is active)
        if self.enemies:
            for e in list(self.enemies.values()):
                e.step(enemy_dt, self)

        # 3) Projectile updates — only enemy projectiles get slowed.
        for p in list(self.projectiles):
            p_dt = enemy_dt if (p.owner_eid is not None) else dt
            p.step(p_dt, self)
        self.projectiles = [p for p in self.projectiles if not p.dead]

        # 4) Loot pickups (player walks over)
        for lid in list(self.loot.keys()):
            l = self.loot[lid]
            if l.dead: continue
            for sp in self.players.values():
                if not sp.alive: continue
                if l.owner_pid and l.owner_pid != sp.pid:
                    continue
                if math.hypot(sp.x - l.x, sp.z - l.z) < 1.6:
                    self._on_pickup(sp, l)
                    break
        self.loot = {k: v for k, v in self.loot.items() if not v.dead}

        # 5) Bookkeeping: remove dead enemies after a small grace, check wave clear.
        # Dead enemies are popped immediately on death — see on_enemy_killed.
        if self.wave_active and not self.enemies:
            self._on_wave_clear()

        # 6) Intermission timer (auto-start next wave if survivors take too long).
        if self.intermission:
            self.intermission_timer -= dt
            # Hard cap: 30s after wave clear, force the next wave even if some
            # players never picked an upgrade.
            if self.intermission_timer < -30:
                self._upgrade_pending_pids.clear()
                self._next_wave()

        # 7) State broadcast at SNAPSHOT_HZ
        self._snap_accum += dt
        if self._snap_accum >= self._snap_interval:
            self._snap_accum = 0
            self._broadcast_state()

    # ------------------------------ damage routing --------------------------

    def apply_damage_to_enemy(self, e: ServerEnemy, amount: float,
                              source_pid: Optional[str], info: dict):
        if not e.alive: return
        e.take_damage(amount, info, self)
        # Crit modifies amount for FX; emit hit event
        self.broadcast({
            'type': 'fx_hit',
            'eid': e.eid,
            'x': round(e.x, 2), 'z': round(e.z, 2),
            'dmg': int(round(amount)),
            'crit': bool(info.get('crit')),
            'pid': source_pid,
        })
        # Bleed application from weapons that bleed
        w = info.get('weapon') or {}
        mods = w.get('modifies') or {}
        if mods.get('bleed'):
            stacks = 0.7 if mods.get('bleed_strong') else 0.4
            e.bleed = max(e.bleed, 3.0)
            e.bleed_dps = max(getattr(e, 'bleed_dps', 0), amount * stacks)
        # Lifesteal + combo on the source player
        if source_pid:
            sp = self.players.get(source_pid)
            if sp:
                sp.combo_count = sp.combo_count + 1
                sp.combo_timer = 1.5
                ls = sp.stats.get('lifesteal', 0) + (mods.get('lifesteal') or 0)
                if ls > 0:
                    sp.heal(amount * ls, self)
                # Chain lightning — only triggers on the *initial* hit, not on
                # damage that itself came from lightning/explosion (otherwise
                # two enemies would ping-pong damage forever).
                if (sp.stats.get('chain_lightning', 0) > 0
                        and info.get('source') not in ('lightning', 'explosion')):
                    self._chain_lightning(e, amount * 0.5, 2, sp.pid)
        # Enemy died?
        if not e.alive:
            self.on_enemy_killed(e, source_pid)

    def _chain_lightning(self, source_enemy, dmg, hops, source_pid):
        reach = 6.0
        visited = {source_enemy.eid}
        cur = source_enemy
        for _ in range(hops):
            cands = [(eid, en) for eid, en in self.enemies.items()
                     if en.alive and eid not in visited
                     and math.hypot(en.x - cur.x, en.z - cur.z) < reach]
            if not cands: break
            cands.sort(key=lambda kv: math.hypot(kv[1].x - cur.x, kv[1].z - cur.z))
            target = cands[0][1]
            self.broadcast({'type': 'fx_lightning',
                            'a': {'x': cur.x, 'z': cur.z},
                            'b': {'x': target.x, 'z': target.z}})
            self.apply_damage_to_enemy(target, dmg, source_pid,
                                       {'crit': False, 'backstab': False, 'heavy': False,
                                        'source': 'lightning'})
            visited.add(target.eid)
            cur = target

    def on_enemy_killed(self, e: ServerEnemy, source_pid: Optional[str]):
        self.broadcast({'type': 'enemy_die', 'eid': e.eid,
                        'x': round(e.x, 2), 'z': round(e.z, 2),
                        'color': e.color})
        # Energy gain on kill for the source
        if source_pid:
            sp = self.players.get(source_pid)
            if sp:
                gain = 8 * sp.stats.get('energy_gain', 1.0)
                sp.energy = min(sp.max_energy, sp.energy + gain)
                # Explode on kill
                if sp.stats.get('explode_kills', 0) > 0:
                    r = 4.5
                    dmg = max(15, e.max_health * sp.stats['explode_kills'])
                    self.broadcast({'type': 'fx_explode', 'x': e.x, 'z': e.z})
                    for eid2, e2 in list(self.enemies.items()):
                        if e2 is e or not e2.alive: continue
                        if math.hypot(e2.x - e.x, e2.z - e.z) < r:
                            self.apply_damage_to_enemy(e2, dmg, source_pid,
                                {'crit': False, 'backstab': False, 'heavy': False,
                                 'source': 'explosion'})

        # Drop per-player loot (one set per party member)
        self._drop_loot_for_party(e)

        # Pop from world
        self.enemies.pop(e.eid, None)

    def _drop_loot_for_party(self, e: ServerEnemy):
        members = list(self.players.values())
        if not members: return
        for i, m in enumerate(members):
            ang = (i / max(1, len(members))) * math.pi * 2
            ox = math.cos(ang) * 0.9
            oz = math.sin(ang) * 0.9
            if e.is_boss:
                # Class-targeted weapon drop
                wid = procedural.pick_weapon_drop(self.wave, m.cls, self.seed + i)
                self._spawn_loot(m.pid, 'weapon', 1, e.x + ox, e.z + oz, weapon_id=wid)
                self._spawn_loot(m.pid, 'health', 70, e.x + ox * 1.4, e.z + oz * 1.4)
                self._spawn_loot(m.pid, 'shard',  60, e.x - ox, e.z - oz)
            elif e.is_miniboss:
                self._spawn_loot(m.pid, 'health', 40, e.x + ox, e.z + oz)
                self._spawn_loot(m.pid, 'shard',  25, e.x - ox * 0.8, e.z - oz * 0.8)
                self._spawn_loot(m.pid, 'gold',   50, e.x, e.z)
            else:
                r = random.random()
                if r < 0.18:
                    self._spawn_loot(m.pid, 'health', 18, e.x + ox, e.z + oz)
                elif r < 0.30:
                    self._spawn_loot(m.pid, 'shard',  8,  e.x + ox, e.z + oz)

    def _spawn_loot(self, owner_pid, kind, value, x, z, weapon_id=None):
        lid = f'l{self._lid_counter}'; self._lid_counter += 1
        loot = ServerLoot(lid, kind, value, x, z, weapon_id=weapon_id, owner_pid=owner_pid)
        self.loot[lid] = loot
        self.send_to(owner_pid, {
            'type': 'loot_spawn',
            'id': lid, 'kind': kind, 'value': value,
            'x': x, 'z': z, 'weaponId': weapon_id,
        })

    def _on_pickup(self, sp: ServerPlayer, l: ServerLoot):
        l.dead = True
        if l.kind == 'health':
            sp.heal(l.value, self)
        elif l.kind == 'shard':
            sp.energy = min(sp.max_energy, sp.energy + l.value)
        elif l.kind == 'gold':
            sp.energy = min(sp.max_energy, sp.energy + 4)
        elif l.kind == 'weapon' and l.weapon_id:
            # Offer weapon swap to the picker; client decides keep/equip.
            self.send_to(sp.pid, {
                'type': 'weapon_offer',
                'weapon_id': l.weapon_id,
                'weapon': WEAPONS.get(l.weapon_id),
            })
        self.send_to(sp.pid, {'type': 'loot_pickup', 'id': l.lid, 'kind': l.kind})

    # ------------------------------ player death ----------------------------

    def on_player_died(self, sp: ServerPlayer):
        self.broadcast({'type': 'player_died', 'pid': sp.pid})
        # All dead?
        if not any(p.alive for p in self.players.values()):
            self._end_run()

    def _end_run(self, reason: str = 'all_dead'):
        if self.run_ended: return
        self.run_ended = True
        self.run_summary = {
            'waves_cleared': max(0, self.wave - 1),
            'enemies_killed': 0,    # we don't track per-player kill counts on server
            'damage_dealt': 0,
        }
        self.broadcast({'type': 'run_ended', 'reason': reason,
                        'summary': self.run_summary})
        # Notify the party layer so it can reset and invite players to restart.
        if self.on_run_ended_fn:
            try:
                self.on_run_ended_fn()
            except Exception:
                pass

    # ------------------------------ projectile spawn ------------------------

    def spawn_player_projectile(self, sp: ServerPlayer, *, kind='arrow',
                                speed=36, life=2.5, dmg=20, size=0.18,
                                yaw_offset=0, direction=None,
                                pierce=False, ricochet=0):
        if direction is None:
            ang = sp.yaw + yaw_offset
            dx = math.sin(ang); dz = math.cos(ang)
        else:
            dx, dz = direction
        # Origin slightly in front of player
        ox = sp.x + dx * 0.6
        oz = sp.z + dz * 0.6
        prid = f'p{self._prid_counter}'; self._prid_counter += 1
        proj = ServerProjectile(
            prid, owner_pid=sp.pid, owner_eid=None,
            x=ox, z=oz, dx=dx, dz=dz,
            speed=speed, life=life, damage=dmg,
            kind=kind, color=sp.weapon.get('color', '#9bff9b'),
            size=size, pierce=pierce, ricochet=ricochet,
            weapon_ref=sp.weapon,
        )
        self.projectiles.append(proj)
        self.broadcast({
            'type': 'fx_projectile_spawn',
            'id': prid, 'pid': sp.pid,
            'x': ox, 'z': oz, 'dx': dx, 'dz': dz,
            'speed': speed, 'life': life,
            'kind': kind, 'color': proj.color, 'size': size,
        })

    def spawn_mob_arrow(self, e: ServerEnemy, target: ServerPlayer):
        dx = target.x - e.x; dz = target.z - e.z
        d = math.hypot(dx, dz) or 1
        dx, dz = dx / d, dz / d
        # small spread
        spread = (random.random() - 0.5) * 0.08
        c, s = math.cos(spread), math.sin(spread)
        dx2 = dx * c - dz * s
        dz2 = dx * s + dz * c
        ox = e.x; oz = e.z
        prid = f'p{self._prid_counter}'; self._prid_counter += 1
        proj = ServerProjectile(
            prid, owner_pid=None, owner_eid=e.eid,
            x=ox, z=oz, dx=dx2, dz=dz2,
            speed=22, life=2.2, damage=e.damage,
            kind='arrow', color='#aaff80', size=0.16,
        )
        self.projectiles.append(proj)
        self.broadcast({
            'type': 'fx_projectile_spawn',
            'id': prid, 'eid': e.eid,
            'x': ox, 'z': oz, 'dx': dx2, 'dz': dz2,
            'speed': 22, 'life': 2.2,
            'kind': 'arrow', 'color': '#aaff80', 'size': 0.16,
        })

    # ------------------------------ state snapshot --------------------------

    def _broadcast_state(self):
        msg = {
            'type': 'state',
            'wave': self.wave,
            'wave_active': self.wave_active,
            'players': [sp.to_state() for sp in self.players.values()],
            'enemies': [e.to_state() for e in self.enemies.values() if e.alive],
            'projectiles': [p.to_state() for p in self.projectiles if not p.dead],
            'loot': [l.to_state() for l in self.loot.values()],
        }
        self.broadcast(msg)
