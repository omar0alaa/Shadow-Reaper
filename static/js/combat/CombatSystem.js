// CombatSystem.js — central damage resolution + combat-feel feedback.

import * as THREE from 'three';
import { WeaponTraits } from './Weapon.js';

export class CombatSystem {
    constructor(game) {
        this.game = game;
        this.meleePulses = []; // [{ owner, startIn, endIn, heavy, comboIndex, applied }]
    }

    registerMeleePulse(owner, opts) {
        this.meleePulses.push({
            owner,
            timer: 0,
            startIn: opts.startIn,
            endIn: opts.endIn,
            heavy: !!opts.heavy,
            comboIndex: opts.comboIndex,
            applied: opts.applied || new Set(),
        });
    }

    update(dt) {
        // Melee pulses → on each frame check enemies in cone in front of owner
        for (const p of this.meleePulses) {
            p.timer += dt;
            if (p.timer < p.startIn || p.timer > p.endIn) continue;
            this._tickPulse(p);
        }
        this.meleePulses = this.meleePulses.filter(p => p.timer < p.endIn);
    }

    _tickPulse(pulse) {
        const player = pulse.owner;
        const w = player.weapon;
        if (!w) return;
        const range = (w.range || 2.0) + 0.4;
        const fwd = player.forwardDir();
        const origin = player.position.clone().add(new THREE.Vector3(0, 1.0, 0));
        const halfAngle = (w.type === 'melee_aoe') ? Math.PI * 0.5 : Math.PI * 0.45;

        for (const e of this.game.enemies) {
            if (!e.alive) continue;
            if (pulse.applied.has(e)) continue;
            const to = new THREE.Vector3(e.position.x - player.position.x, 0, e.position.z - player.position.z);
            const d = to.length();
            if (d > range + e.contactRadius) continue;
            to.normalize();
            const dot = to.dot(fwd);
            const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
            if (ang > halfAngle) continue;

            // Hit
            pulse.applied.add(e);
            const fromBehind = this._isFromBehind(player, e);
            const dmgInfo = this._calcDamage(player, e, w, pulse, fromBehind);
            this.applyDamage(e, dmgInfo.amount, { source: 'melee', crit: dmgInfo.crit, backstab: fromBehind, fromPlayer: true, weapon: w });

            // hit-stop
            this._hitStop(0.05);
            this.game.scene.addShake(pulse.heavy ? 0.18 : 0.08, 0.12);

            // chain lightning
            if ((player.stats.chain_lightning || 0) > 0) {
                this._chainLightning(e, dmgInfo.amount * 0.5, 2);
            }
        }
    }

    _isFromBehind(player, enemy) {
        const eFwd = new THREE.Vector3(Math.sin(enemy.facing), 0, Math.cos(enemy.facing));
        const toPlayer = new THREE.Vector3(player.position.x - enemy.position.x, 0, player.position.z - enemy.position.z).normalize();
        return eFwd.dot(toPlayer) < -0.2; // player is behind enemy
    }

    _calcDamage(player, enemy, w, pulse, fromBehind) {
        let base = w.damage;
        // combo damage scaling per combo index
        const comboBonus = (player.stats.combo_damage || 0) * Math.max(0, (pulse.comboIndex || 1) - 1);
        base *= (1 + comboBonus);
        if (pulse.heavy) base *= 1.65;

        // crit
        let crit = false;
        const cc = player.stats.crit_chance || 0.10;
        if (Math.random() < cc) {
            crit = true;
            base *= (player.stats.crit_damage || 1.5);
        }

        // backstab 2x + bonus
        if (fromBehind) {
            const mult = 2.0 * (player.stats.backstab_mult || 1);
            base *= mult;
        }

        // execute under threshold
        const exec = player.stats.execute_thresh || 0;
        if (exec > 0 && enemy.health / enemy.maxHealth <= exec) {
            base = enemy.health + 9999;
        }

        // ultimate doubles damage
        if (player.ultActive && player.stats.ult_dmg_mult) {
            base *= (1 + player.stats.ult_dmg_mult);
        }

        // stealth crit guarantee
        if (player.stealthFirstStrike) {
            crit = true;
            base *= (player.stats.crit_damage || 1.5);
            player.stealthFirstStrike = false;
        }

        return { amount: base, crit };
    }

    _chainLightning(source, dmg, hops) {
        const me = source;
        const reach = 6.0;
        const visited = new Set([source]);
        let cur = source;
        for (let i = 0; i < hops; i++) {
            const others = this.game.enemies.filter(e => e.alive && !visited.has(e) && e.position.distanceTo(cur.position) < reach);
            if (others.length === 0) break;
            others.sort((a, b) => a.position.distanceTo(cur.position) - b.position.distanceTo(cur.position));
            const target = others[0];
            // visual lightning
            this.game.particles.spawnLine(cur.position.clone().add(new THREE.Vector3(0, 1.2, 0)), target.position.clone().add(new THREE.Vector3(0, 1.2, 0)), '#80ddff');
            this.applyDamage(target, dmg, { source: 'lightning', fromPlayer: true });
            target.shocked = 0.5;
            visited.add(target);
            cur = target;
        }
    }

    applyDamage(enemy, amount, info = {}) {
        if (!enemy.alive) return;
        enemy.takeDamage(amount, info);
        const player = this.game.player;
        if (info.fromPlayer && player) {
            player.incrementCombo();
            this.game.runStats.damage += amount;
            const lifesteal = (player.stats.lifesteal || 0) + WeaponTraits.weaponLifesteal(player.weapon);
            if (lifesteal > 0) player.heal(amount * lifesteal);
            if (info.weapon && WeaponTraits.appliesBleed(info.weapon)) {
                enemy.applyBleed(3.0, amount * 0.4);
            }
        }
        // Damage numbers
        const pos = enemy.position.clone().add(new THREE.Vector3(0, 1.7, 0));
        this.game.dmgNumbers.spawn(pos, Math.floor(amount), { kind: info.crit ? 'crit' : (info.backstab ? 'crit' : 'normal') });

        if (info.fromPlayer && player) {
            if (info.crit) this.game.audio.crit(); else this.game.audio.hit();
        }
        // hit sparks
        this.game.particles.spawnSparks(pos, info.crit ? '#ffd166' : '#ffeecf', info.crit ? 16 : 8);
    }

    applyDamageToPlayer(amount, source) {
        const p = this.game.player;
        if (!p) return;
        if (p.invuln > 0) return;
        p.takeDamage(amount, source);
        this._hitStop(0.04);
    }

    _hitStop(dur) {
        this.game.hitstopTimer = Math.max(this.game.hitstopTimer || 0, dur);
    }
}
