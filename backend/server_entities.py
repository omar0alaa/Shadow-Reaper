"""Server-side entities for authoritative multiplayer.

The server is the source of truth. Clients send input + attack triggers and
receive state snapshots. All mob AI, hit detection, projectile motion and
damage resolution happen here.
"""
from __future__ import annotations

import math
import random
from typing import Optional, Set, Dict, Any, List

from .game_data import WEAPONS


# --------------------------------------------------------------------------
# Player
# --------------------------------------------------------------------------

class ServerPlayer:
    def __init__(self, pid: str, name: str, cls: str):
        self.pid = pid
        self.name = name
        self.cls = cls if cls in ('sword', 'dagger', 'bow', 'scythe') else 'sword'
        self.weapon_id = f"{self.cls}_common"
        self.weapon = dict(WEAPONS.get(self.weapon_id, {}))
        # Position
        self.x = 0.0
        self.z = 0.0
        self.facing = 0.0
        self.yaw = 0.0
        # Movement intent
        self.move_x = 0.0
        self.move_z = 0.0
        self.sprinting = False
        # Stats
        self.max_health = 120.0
        self.health = 120.0
        self.max_stamina = 100.0
        self.stamina = 100.0
        self.max_energy = 100.0
        self.energy = 0.0
        self.alive = True
        self.invuln = 0.0
        # Combat
        self.attack_timer = 0.0
        self.cur_swing_dur = 0.0
        self.combo_count = 0
        self.combo_timer = 0.0
        self.swing_kind = 0          # 0 idle, 1 light, 2 heavy, 3 r-skill spin
        self.pending_pulse = None
        # Skills (basic server-side support)
        self.dash_active = False
        self.dash_time = 0.0
        self.dash_dx = 0.0
        self.dash_dz = 0.0
        self.cd_q = 0.0  # dash cooldown
        self.cd_e = 0.0  # smoke
        self.cd_r = 0.0  # flurry
        self.r_active = False
        self.r_time = 0.0
        self.r_tick = 0.0
        self.stealth_until = 0.0
        self.stealth_first_strike = False
        # Stats (upgrades modify)
        self.stats = {
            'crit_chance': 0.10, 'crit_damage': 1.5,
            'lifesteal': 0.0, 'move_speed': 1.0, 'stamina_regen': 1.0,
            'combo_damage': 0.0, 'backstab_mult': 1.0,
            'dash_charges': 1, 'iframe_bonus': 0.0,
            'energy_gain': 1.0,
            'chain_lightning': 0, 'smoke_damage': 0, 'poison_dash': 0,
            'ricochet': 0, 'multishot': 0,
            'ult_duration': 0, 'explode_kills': 0, 'execute_thresh': 0,
            'extra_combo_hits': 0, 'ult_dmg_mult': 0,
        }
        self.upgrades: List[Dict] = []
        self.weapons_found = [self.weapon_id]
        # Pending input flags consumed each tick
        self.input_lmb = False
        self.input_rmb = False
        self.input_q = False
        self.input_e = False
        self.input_r = False
        self.input_f = False
        # last activity for AFK detection
        self.last_seen = 0.0

    # --------------------------- input ---------------------------

    def apply_input(self, msg: dict, now: float):
        self.last_seen = now
        w = bool(msg.get('w'))
        s = bool(msg.get('s'))
        a = bool(msg.get('a'))
        d = bool(msg.get('d'))
        self.sprinting = bool(msg.get('shift', False))
        if 'yaw' in msg:
            try:
                self.yaw = float(msg['yaw'])
            except (TypeError, ValueError):
                pass
        # WASD relative to camera yaw — match client's mapping exactly:
        #   W = forward, S = back, A = +right (client-quirk), D = -right
        fx = math.sin(self.yaw)
        fz = math.cos(self.yaw)
        rx = math.sin(self.yaw + math.pi / 2)
        rz = math.cos(self.yaw + math.pi / 2)
        mx = mz = 0.0
        if w: mx += fx; mz += fz
        if s: mx -= fx; mz -= fz
        if a: mx += rx; mz += rz
        if d: mx -= rx; mz -= rz
        L = math.hypot(mx, mz)
        if L > 0:
            mx /= L; mz /= L
        self.move_x = mx
        self.move_z = mz
        if msg.get('lmb_just'): self.input_lmb = True
        if msg.get('rmb_just'): self.input_rmb = True
        if msg.get('q_just'):   self.input_q = True
        if msg.get('e_just'):   self.input_e = True
        if msg.get('r_just'):   self.input_r = True
        if msg.get('f_just'):   self.input_f = True

    # --------------------------- step ----------------------------

    def step(self, dt: float, game) -> None:
        if not self.alive:
            return
        # Stamina regen / drain
        moving = (abs(self.move_x) > 0.01 or abs(self.move_z) > 0.01)
        if self.sprinting and moving and self.stamina > 5:
            self.stamina = max(0, self.stamina - 30 * dt)
            if self.stamina <= 0:
                self.sprinting = False
        else:
            self.stamina = min(
                self.max_stamina,
                self.stamina + 22 * dt * self.stats.get('stamina_regen', 1.0),
            )

        # Cooldowns
        for k in ('cd_q', 'cd_e', 'cd_r'):
            if getattr(self, k) > 0:
                setattr(self, k, max(0, getattr(self, k) - dt))
        if self.invuln > 0:
            self.invuln = max(0, self.invuln - dt)
        if self.combo_timer > 0:
            self.combo_timer -= dt
            if self.combo_timer <= 0:
                self.combo_count = 0
        if self.stealth_until > 0:
            self.stealth_until = max(0, self.stealth_until - dt)

        # Skill triggers
        if self.input_q:
            self.input_q = False
            self._try_dash(game)
        if self.input_e:
            self.input_e = False
            self._try_smoke(game)
        if self.input_r:
            self.input_r = False
            self._try_flurry(game)
        if self.input_f:
            self.input_f = False
            # Ult is a no-op server-side for now (flag could be added)

        # Movement (dash overrides)
        if self.dash_active:
            self.x += self.dash_dx * dt
            self.z += self.dash_dz * dt
            self.dash_time -= dt
            if self.dash_time <= 0:
                self.dash_active = False
        else:
            sp = (8.0 if self.sprinting else 5.0) * self.stats.get('move_speed', 1.0)
            self.x += self.move_x * sp * dt
            self.z += self.move_z * sp * dt
        self.x, self.z = game.resolve_collision(self.x, self.z, 0.45)

        # Facing
        if moving and not self.dash_active:
            self.facing = math.atan2(self.move_x, self.move_z)
        if self.attack_timer > 0:
            self.facing = self.yaw

        # R-skill (Blade Flurry) tick
        if self.r_active:
            self.facing += dt * 12          # spin visible via state
            self.r_tick += dt
            self.r_time -= dt
            if self.r_tick >= 0.12:
                self.r_tick = 0
                self._flurry_tick(game)
            if self.r_time <= 0:
                self.r_active = False
                self.swing_kind = 0

        # Attack timers
        if self.attack_timer > 0:
            self.attack_timer -= dt
            if self.attack_timer <= 0:
                self.swing_kind = 0

        # Pending attack triggers
        if self.input_lmb:
            self.input_lmb = False
            if self.attack_timer <= 0:
                self._light_attack(game)
        if self.input_rmb:
            self.input_rmb = False
            if self.attack_timer <= 0:
                self._heavy_attack(game)

        # Pulse hit window
        if self.pending_pulse is not None:
            self.pending_pulse['t'] += dt
            t = self.pending_pulse['t']
            if t >= self.pending_pulse['s'] and t <= self.pending_pulse['e']:
                self._tick_pulse(game)
            if t >= self.pending_pulse['e']:
                self.pending_pulse = None

    # --------------------------- attacks -------------------------

    def _is_ranged(self) -> bool:
        return self.weapon.get('type') == 'ranged'

    def _light_attack(self, game):
        if self._is_ranged():
            return self._fire_arrow(game, charged=False)
        speed = float(self.weapon.get('speed', 1.0)) or 1.0
        dur = 0.34 / speed
        self.attack_timer = dur
        self.cur_swing_dur = dur
        self.swing_kind = 1
        self.pending_pulse = {'t': 0.0, 's': dur * 0.45, 'e': dur * 0.85,
                              'heavy': False, 'applied': set()}

    def _heavy_attack(self, game):
        if self._is_ranged():
            return self._fire_arrow(game, charged=True)
        speed = float(self.weapon.get('speed', 1.0)) or 1.0
        dur = 0.55 / speed
        self.attack_timer = dur
        self.cur_swing_dur = dur
        self.swing_kind = 2
        self.pending_pulse = {'t': 0.0, 's': dur * 0.55, 'e': dur * 0.9,
                              'heavy': True, 'applied': set()}
        # Moonveil-style heavy wave projectile
        if self.weapon.get('modifies', {}).get('heavy_wave'):
            game.spawn_player_projectile(self, kind='wave',
                                         speed=22, life=1.4,
                                         dmg=self.weapon.get('damage', 30) * 1.4,
                                         size=0.55)

    def _fire_arrow(self, game, charged: bool):
        if self.stamina < 5:
            return
        self.stamina = max(0, self.stamina - 4)
        dur = 0.45 if charged else 0.22
        self.attack_timer = dur
        self.cur_swing_dur = dur
        self.swing_kind = 1
        dmg = self.weapon.get('damage', 20) * (1.8 if charged else 1.0)
        # Multishot fan
        extra = int(self.stats.get('multishot', 0) or 0)
        total = 1 + extra
        fan = 0.10
        for i in range(total):
            offset = (i - (total - 1) / 2.0) * fan
            game.spawn_player_projectile(
                self, kind='arrow',
                speed=36, life=2.5, dmg=dmg, size=0.18,
                yaw_offset=offset,
                pierce=charged or bool(self.weapon.get('modifies', {}).get('pierce')),
                ricochet=int(self.stats.get('ricochet', 0) or 0)
                       + int(self.weapon.get('modifies', {}).get('auto_ricochet', 0) or 0),
            )

    def _tick_pulse(self, game):
        w = self.weapon
        rng = float(w.get('range', 2.0)) + 0.4
        fx = math.sin(self.facing); fz = math.cos(self.facing)
        half = math.pi * 0.5 if w.get('type') == 'melee_aoe' else math.pi * 0.45
        for eid, e in list(game.enemies.items()):
            if not e.alive:
                continue
            if eid in self.pending_pulse['applied']:
                continue
            dx = e.x - self.x
            dz = e.z - self.z
            d = math.hypot(dx, dz)
            if d > rng + e.contact_radius or d < 1e-3:
                continue
            ndx, ndz = dx / d, dz / d
            dot = ndx * fx + ndz * fz
            ang = math.acos(max(-1.0, min(1.0, dot)))
            if ang > half:
                continue
            self.pending_pulse['applied'].add(eid)
            from_behind = self._is_from_behind(e)
            dmg, crit = self._calc_damage(e, self.pending_pulse['heavy'], from_behind)
            game.apply_damage_to_enemy(
                e, dmg,
                source_pid=self.pid,
                info={'crit': crit, 'backstab': from_behind,
                      'heavy': self.pending_pulse['heavy'], 'weapon': w},
            )

    def _flurry_tick(self, game):
        w = self.weapon
        rng = float(w.get('range', 2.2)) + (1.0 if w.get('type') == 'melee_aoe' else 0.4)
        base = w.get('damage', 18) * 0.45
        for eid, e in list(game.enemies.items()):
            if not e.alive:
                continue
            if math.hypot(e.x - self.x, e.z - self.z) > rng + e.contact_radius:
                continue
            game.apply_damage_to_enemy(
                e, base,
                source_pid=self.pid,
                info={'crit': False, 'backstab': False, 'heavy': False, 'weapon': w},
            )

    def _is_from_behind(self, e) -> bool:
        e_fx = math.sin(e.facing); e_fz = math.cos(e.facing)
        dx = self.x - e.x; dz = self.z - e.z
        d = math.hypot(dx, dz) or 1
        return (e_fx * (dx / d) + e_fz * (dz / d)) < -0.2

    def _calc_damage(self, e, heavy: bool, from_behind: bool):
        base = float(self.weapon.get('damage', 14))
        base *= (1 + self.stats.get('combo_damage', 0) * self.combo_count)
        if heavy:
            base *= 1.65
        crit = False
        if random.random() < self.stats.get('crit_chance', 0.10):
            crit = True
            base *= self.stats.get('crit_damage', 1.5)
        if self.stealth_first_strike:
            crit = True
            base *= self.stats.get('crit_damage', 1.5)
            self.stealth_first_strike = False
        if from_behind:
            base *= 2.0 * self.stats.get('backstab_mult', 1.0)
        et = self.stats.get('execute_thresh', 0)
        if et > 0 and e.health / max(1, e.max_health) <= et:
            base = e.health + 9999
        return base, crit

    # --------------------------- skills --------------------------

    def _try_dash(self, game):
        if self.cd_q > 0:
            return
        if self.stamina < 18:
            return
        self.stamina = max(0, self.stamina - 18)
        self.cd_q = 5.0
        # Dash forward (bow backsteps)
        sign = -1 if self.cls == 'bow' else 1
        dist = 7.0 if self.cls == 'scythe' else (6.5 if self.cls == 'bow' else 8.0)
        dur = 0.22
        fx = math.sin(self.yaw)
        fz = math.cos(self.yaw)
        self.dash_active = True
        self.dash_time = dur
        self.dash_dx = fx * sign * (dist / dur)
        self.dash_dz = fz * sign * (dist / dur)
        self.invuln = max(self.invuln, 0.6 + self.stats.get('iframe_bonus', 0))
        # Damage enemies passed through
        dmg = self.weapon.get('damage', 12) * 0.6
        for eid, e in list(game.enemies.items()):
            if not e.alive: continue
            if math.hypot(e.x - self.x, e.z - self.z) < 1.4:
                game.apply_damage_to_enemy(
                    e, dmg,
                    source_pid=self.pid,
                    info={'crit': False, 'backstab': False, 'heavy': False,
                          'weapon': self.weapon, 'source': 'dash'},
                )
        game.broadcast({'type': 'fx_dash', 'pid': self.pid, 'cls': self.cls})

    def _try_smoke(self, game):
        if self.cd_e > 0: return
        self.cd_e = 12.0
        self.stealth_until = 3.0
        self.stealth_first_strike = True
        game.broadcast({'type': 'fx_smoke', 'pid': self.pid,
                        'x': self.x, 'z': self.z})

    def _try_flurry(self, game):
        if self.cd_r > 0 or self.r_active: return
        self.cd_r = 10.0
        self.r_active = True
        self.r_time = 1.5
        self.r_tick = 0
        self.swing_kind = 3
        if self.cls == 'bow':
            # Arrow Storm: 24 arrows in a ring
            for i in range(24):
                ang = (i / 24.0) * math.pi * 2
                game.spawn_player_projectile(
                    self, kind='arrow',
                    speed=26, life=1.6,
                    dmg=self.weapon.get('damage', 20) * 0.7, size=0.16,
                    direction=(math.sin(ang), math.cos(ang)),
                    pierce=bool(self.weapon.get('modifies', {}).get('pierce')),
                )
            self.r_active = False  # arrow storm is fire-and-forget
            self.swing_kind = 0
        game.broadcast({'type': 'fx_flurry', 'pid': self.pid, 'cls': self.cls})

    # --------------------------- damage IO -----------------------

    def take_damage(self, amount: float, source_eid: Optional[str], game) -> bool:
        if not self.alive: return False
        if self.invuln > 0: return False
        self.health -= amount
        self.invuln = 0.8
        self.combo_count = 0
        self.combo_timer = 0
        game.broadcast({'type': 'fx_player_hit', 'pid': self.pid, 'dmg': int(amount)})
        if self.health <= 0:
            self.health = 0
            self.alive = False
            game.on_player_died(self)
            return True
        return True

    def heal(self, amount: float, game=None):
        before = self.health
        self.health = min(self.max_health, self.health + amount)
        delta = self.health - before
        if delta > 0.5 and game is not None:
            game.broadcast({'type': 'fx_heal', 'pid': self.pid, 'amt': int(delta)})

    def revive(self, x: float, z: float):
        self.alive = True
        self.health = self.max_health
        self.invuln = 1.5
        self.x = x; self.z = z
        self.combo_count = 0
        self.combo_timer = 0

    def equip(self, weapon_id: str):
        wd = WEAPONS.get(weapon_id)
        if not wd: return False
        self.weapon_id = weapon_id
        self.weapon = dict(wd)
        if self.cls and weapon_id.startswith(self.cls + '_'):
            pass  # class still matches
        if weapon_id not in self.weapons_found:
            self.weapons_found.append(weapon_id)
        return True

    def apply_upgrade(self, upgrade: dict):
        v = upgrade.get('value', 0)
        stat = upgrade.get('stat')
        s = self.stats
        if stat == 'crit_chance':       s['crit_chance']    = s.get('crit_chance', 0) + v
        elif stat == 'crit_damage':     s['crit_damage']    = s.get('crit_damage', 1.5) + v
        elif stat == 'max_health':
            self.max_health += v; self.health += v
        elif stat == 'lifesteal':       s['lifesteal']      = s.get('lifesteal', 0) + v
        elif stat == 'move_speed':      s['move_speed']     = s.get('move_speed', 1) + v
        elif stat == 'stamina_regen':   s['stamina_regen']  = s.get('stamina_regen', 1) + v
        elif stat == 'combo_damage':    s['combo_damage']   = s.get('combo_damage', 0) + v
        elif stat == 'backstab_mult':   s['backstab_mult']  = s.get('backstab_mult', 1) + v
        elif stat == 'dash_charges':    s['dash_charges']   = s.get('dash_charges', 1) + v
        elif stat == 'iframe_bonus':    s['iframe_bonus']   = s.get('iframe_bonus', 0) + v
        elif stat == 'energy_gain':     s['energy_gain']    = s.get('energy_gain', 1) + v
        elif stat == 'chain_lightning': s['chain_lightning']= s.get('chain_lightning', 0) + v
        elif stat == 'smoke_damage':    s['smoke_damage']   = s.get('smoke_damage', 0) + v
        elif stat == 'poison_dash':     s['poison_dash']    = s.get('poison_dash', 0) + v
        elif stat == 'ricochet':        s['ricochet']       = s.get('ricochet', 0) + v
        elif stat == 'ult_duration':    s['ult_duration']   = s.get('ult_duration', 0) + v
        elif stat == 'explode_kills':   s['explode_kills']  = s.get('explode_kills', 0) + v
        elif stat == 'execute_thresh':  s['execute_thresh'] = max(s.get('execute_thresh', 0), v)
        elif stat == 'extra_combo_hits':s['extra_combo_hits']= s.get('extra_combo_hits', 0) + v
        elif stat == 'ult_dmg_mult':    s['ult_dmg_mult']   = s.get('ult_dmg_mult', 0) + v
        elif stat == 'multishot':       s['multishot']      = s.get('multishot', 0) + v
        self.upgrades.append(upgrade)

    def to_state(self) -> dict:
        # Compact float for skill cooldowns — clients display sweep based on
        # cd / max_cd. Hardcoded max-cd values match the client's Skill ctor.
        return {
            'pid': self.pid,
            'name': self.name,
            'cls': self.cls,
            'x': round(self.x, 2),
            'z': round(self.z, 2),
            'f': round(self.facing, 3),
            'hp': max(0, int(round(self.health))),
            'max_hp': int(self.max_health),
            'st': max(0, int(self.stamina)),
            'max_st': int(self.max_stamina),
            'en': max(0, int(self.energy)),
            'max_en': int(self.max_energy),
            'alive': self.alive,
            'inv': self.invuln > 0,
            'sw': self.swing_kind,
            'wpn': self.weapon_id,
            'combo': self.combo_count,
            # Cooldowns — clients use these to drive the skill sweep.
            'cdQ': round(self.cd_q, 2),
            'cdE': round(self.cd_e, 2),
            'cdR': round(self.cd_r, 2),
            # Live stats so the local HUD / inventory reflect upgrades.
            'stats': dict(self.stats),
            # Upgrade history (full list — drives Inventory's "Upgrades Acquired").
            'upgrades': list(self.upgrades),
        }


# --------------------------------------------------------------------------
# Enemy
# --------------------------------------------------------------------------

class ServerEnemy:
    def __init__(self, eid: str, type_: str, spec: dict, x: float, z: float):
        self.eid = eid
        self.type = type_
        self.spec = spec
        self.color = spec.get('color', '#ff4040')
        self.x = float(x); self.z = float(z)
        self.facing = 0.0
        self.max_health = float(spec.get('hp', 50))
        self.health = self.max_health
        self.damage = float(spec.get('damage', 8))
        self.speed = float(spec.get('speed', 4.0))
        self.behavior = spec.get('behavior', 'melee')
        self.scale = float(spec.get('scale', 1.0))
        self.alive = True
        self.state = 'idle'
        self.attack_cooldown = 0.0
        self.attack_windup = 0.0
        self.flash_time = 0.0
        self.stagger_time = 0.0
        self.bleed = 0.0
        self.bleed_dps = 0.0
        self.bleed_tick = 0.0
        self.poisoned = 0.0
        self.poison_dps = 0.0
        self.contact_radius = 0.55 * self.scale
        self.attack_range = 1.7 * self.scale
        self.aggro_range = 22.0
        self.is_boss = self.behavior == 'boss'
        self.is_miniboss = self.behavior == 'miniboss'
        if self.is_miniboss:
            self.attack_range = 2.6 * self.scale
            self.aggro_range = 40
        if self.is_boss:
            self.attack_range = 3.2 * self.scale
            self.aggro_range = 60

    def step(self, dt: float, game) -> None:
        if not self.alive:
            return
        # Status effects
        if self.bleed > 0:
            self.bleed -= dt
            self.bleed_tick -= dt
            if self.bleed_tick <= 0:
                self.bleed_tick = 0.4
                self.health -= self.bleed_dps * 0.4
                if self.health <= 0:
                    self.alive = False
                    game.on_enemy_killed(self, source_pid=None)
                    return
        if self.poisoned > 0:
            self.poisoned -= dt
            self.health -= self.poison_dps * dt
            if self.health <= 0:
                self.alive = False
                game.on_enemy_killed(self, source_pid=None)
                return

        if self.flash_time > 0:
            self.flash_time -= dt

        if self.stagger_time > 0:
            self.stagger_time -= dt
            return

        # Find target — nearest non-stealthed living player
        target = game.nearest_living_player(self.x, self.z)
        if target is None:
            return

        dx = target.x - self.x
        dz = target.z - self.z
        d = math.hypot(dx, dz) or 0.001
        ndx, ndz = dx / d, dz / d

        if self.state == 'attack':
            self.attack_windup -= dt
            if self.attack_windup <= 0:
                self.flash_time = 0
                if self.behavior == 'ranged':
                    game.spawn_mob_arrow(self, target)
                else:
                    if d <= self.attack_range + 0.4:
                        target.take_damage(self.damage, self.eid, game)
                self.state = 'chase'
                self.attack_cooldown = (
                    1.6 if self.behavior == 'heavy' else
                    (1.5 if self.behavior == 'ranged' else 1.0)
                )
            return

        # Per-behavior chase
        if self.behavior == 'ranged':
            desired = 9.0
            if d < desired - 1:
                self.x -= ndx * self.speed * dt
                self.z -= ndz * self.speed * dt
            elif d > desired + 1:
                self.x += ndx * self.speed * dt * 0.6
                self.z += ndz * self.speed * dt * 0.6
            self.x, self.z = game.resolve_collision(self.x, self.z, self.contact_radius)
            self.facing = math.atan2(ndx, ndz)
            if self.attack_cooldown <= 0 and d < self.aggro_range:
                self._begin_attack()
            else:
                self.attack_cooldown = max(0, self.attack_cooldown - dt)
            return

        # Default melee chase
        v = self.speed * dt
        self.x += ndx * v
        self.z += ndz * v
        self.x, self.z = game.resolve_collision(self.x, self.z, self.contact_radius)
        self.facing = math.atan2(ndx, ndz)
        if d < self.attack_range and self.attack_cooldown <= 0:
            self._begin_attack()
        else:
            self.attack_cooldown = max(0, self.attack_cooldown - dt)

    def _begin_attack(self):
        self.state = 'attack'
        if self.behavior == 'heavy': self.attack_windup = 0.85
        elif self.behavior == 'ranged': self.attack_windup = 0.55
        elif self.behavior == 'teleport': self.attack_windup = 0.25
        else: self.attack_windup = 0.4
        self.flash_time = self.attack_windup

    def take_damage(self, amount: float, info: dict, game):
        if not self.alive: return
        self.health -= amount
        self.flash_time = 0.12
        if amount > self.max_health * 0.18 or info.get('heavy'):
            self.stagger_time = max(self.stagger_time, 0.45)
            self.state = 'staggered'
        if self.health <= 0:
            self.health = 0
            self.alive = False
            # caller (game.apply_damage_to_enemy) handles on_enemy_killed.

    def to_state(self) -> dict:
        return {
            'eid': self.eid,
            'type': self.type,
            'x': round(self.x, 2),
            'z': round(self.z, 2),
            'f': round(self.facing, 2),
            'hp': max(0, int(round(self.health))),
            'max_hp': int(self.max_health),
            's': self.state,
            'fl': self.flash_time > 0,
            'sg': self.stagger_time > 0,
            'spec': {
                'name': self.spec.get('name'),
                'color': self.color,
                'scale': self.scale,
                'behavior': self.behavior,
            },
            'b': self.is_boss,
            'mb': self.is_miniboss,
        }


# --------------------------------------------------------------------------
# Projectile
# --------------------------------------------------------------------------

class ServerProjectile:
    def __init__(self, prid: str, *,
                 owner_pid: Optional[str], owner_eid: Optional[str],
                 x: float, z: float, dx: float, dz: float,
                 speed: float, life: float, damage: float,
                 kind: str = 'arrow', color: str = '#9bff9b',
                 size: float = 0.18, pierce: bool = False, ricochet: int = 0,
                 weapon_ref: Optional[dict] = None):
        self.prid = prid
        self.owner_pid = owner_pid
        self.owner_eid = owner_eid
        self.x = x; self.z = z
        self.dx = dx; self.dz = dz
        self.speed = speed
        self.life = life
        self.damage = damage
        self.kind = kind
        self.color = color
        self.size = size
        self.pierce = pierce
        self.ricochet = ricochet
        self.weapon_ref = weapon_ref
        self.dead = False
        self.hit_set: Set[str] = set()

    def step(self, dt: float, game) -> None:
        if self.dead: return
        self.life -= dt
        if self.life <= 0:
            self.dead = True; return
        self.x += self.dx * self.speed * dt
        self.z += self.dz * self.speed * dt

        # Out of arena
        if math.hypot(self.x, self.z) > game.arena_radius - 0.4:
            self.dead = True; return
        # Wall colliders
        for c in game.colliders:
            if math.hypot(self.x - c['x'], self.z - c['z']) < c['r'] + self.size:
                self.dead = True; return

        # Hit check
        if self.owner_pid:
            # Player projectile -> enemies
            for eid, e in list(game.enemies.items()):
                if not e.alive or eid in self.hit_set: continue
                if math.hypot(e.x - self.x, e.z - self.z) < (e.contact_radius + self.size + 0.4):
                    self.hit_set.add(eid)
                    sp = game.players.get(self.owner_pid)
                    info = {'crit': False, 'backstab': False, 'heavy': False,
                            'source': 'projectile',
                            'weapon': self.weapon_ref or (sp.weapon if sp else {})}
                    if sp:
                        # Roll crit using owner's stats
                        if random.random() < sp.stats.get('crit_chance', 0.1):
                            info['crit'] = True
                            self.damage *= sp.stats.get('crit_damage', 1.5)
                    game.apply_damage_to_enemy(e, self.damage,
                                               source_pid=self.owner_pid, info=info)
                    if self.kind == 'wave':
                        continue
                    if self.pierce:
                        continue
                    if self.ricochet > 0:
                        # bounce to nearest unhit
                        cands = [(eid2, en) for eid2, en in game.enemies.items()
                                 if en.alive and eid2 not in self.hit_set]
                        if not cands:
                            self.dead = True; return
                        cands.sort(key=lambda kv: math.hypot(kv[1].x - self.x, kv[1].z - self.z))
                        nx = cands[0][1].x - self.x
                        nz = cands[0][1].z - self.z
                        L = math.hypot(nx, nz) or 1
                        self.dx, self.dz = nx / L, nz / L
                        self.ricochet -= 1
                        continue
                    self.dead = True; return
        else:
            # Mob projectile -> players
            for sp in game.players.values():
                if not sp.alive: continue
                if math.hypot(sp.x - self.x, sp.z - self.z) < (self.size + 0.6):
                    sp.take_damage(self.damage, self.owner_eid, game)
                    self.dead = True; return

    def to_state(self) -> dict:
        return {
            'id': self.prid,
            'x': round(self.x, 2),
            'z': round(self.z, 2),
            'dx': round(self.dx, 2),
            'dz': round(self.dz, 2),
            'k': self.kind,
            'c': self.color,
            's': self.size,
            'p': bool(self.owner_pid),     # is from player?
        }


# --------------------------------------------------------------------------
# Loot
# --------------------------------------------------------------------------

class ServerLoot:
    def __init__(self, lid: str, kind: str, value: int, x: float, z: float,
                 weapon_id: Optional[str] = None, owner_pid: Optional[str] = None):
        self.lid = lid
        self.kind = kind          # 'gold' | 'health' | 'shard' | 'weapon'
        self.value = value
        self.x = x; self.z = z
        self.weapon_id = weapon_id
        self.owner_pid = owner_pid  # only this player can pick it up
        self.dead = False

    def to_state(self) -> dict:
        return {
            'id': self.lid,
            'kind': self.kind,
            'x': round(self.x, 2),
            'z': round(self.z, 2),
            'w': self.weapon_id,
            'pid': self.owner_pid,
        }
