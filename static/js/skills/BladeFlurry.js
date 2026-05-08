// BladeFlurry — R. 1.5s spin attack, multi-hit. With Phantom Bow, becomes Arrow Storm.

import * as THREE from 'three';
import { WeaponTraits } from '../combat/Weapon.js';
import { Projectile } from '../combat/Projectile.js';

export class BladeFlurry {
    constructor(player) {
        this.player = player;
        this.game = player.game;
        this.cd = 0;
        this.maxCd = 10.0;
        this.active = false;
        this.timer = 0;
        this.tickAccum = 0;
    }

    get cooldownPct() { return Math.max(0, Math.min(1, this.cd / this.maxCd)); }
    get key() { return 'R'; }
    get ready() { return this.cd <= 0 && !this.active; }

    activate() {
        if (this.cd > 0 || this.active) return;
        this.cd = this.maxCd;
        this.game.audio.skill();
        this.active = true;
        this.timer = 1.5;
        this.tickAccum = 0;
        this.player.setTrailActive(this.timer + 0.3, this.player._weaponTrailColor());

        // arrow storm variant
        if (WeaponTraits.bladeFlurryAsArrowStorm(this.player.weapon)) {
            const total = 24;
            for (let i = 0; i < total; i++) {
                setTimeout(() => {
                    if (!this.player) return;
                    const a = (i / total) * Math.PI * 2;
                    const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
                    const start = this.player.position.clone().add(new THREE.Vector3(0, 1.2, 0));
                    const proj = new Projectile(this.game, {
                        origin: start, direction: dir, speed: 26,
                        damage: this.player.weapon.damage * 0.7, life: 1.6,
                        color: this.player.weapon.color || '#9bff9b', size: 0.16,
                        fromPlayer: true, kind: 'arrow', pierce: false,
                    });
                    this.game.projectiles.push(proj);
                }, i * 50);
            }
            this.game.audio.bowShot();
            return;
        }
    }

    update(dt) {
        if (this.cd > 0) this.cd = Math.max(0, this.cd - dt);
        if (!this.active) return;
        this.timer -= dt;

        const player = this.player;
        // rotate weapon and arms fast
        const t = performance.now() / 70;
        player.weaponMount.rotation.x = Math.sin(t) * 0.8;
        player.rArm.rotation.x = -1.0 - Math.sin(t * 1.5) * 0.3;
        player.lArm.rotation.x = -0.5 + Math.cos(t * 1.5) * 0.3;
        player.group.rotation.y += dt * 12; // visible spin

        // forward drift
        const fwd = new THREE.Vector3(Math.sin(player.facing), 0, Math.cos(player.facing));
        player.position.x += fwd.x * 1.4 * dt;
        player.position.z += fwd.z * 1.4 * dt;
        const r = this.game.arena.resolveCollision(player.position.x, player.position.z, 0.45);
        player.position.x = r.x; player.position.z = r.z;

        // tick damage every 0.12s in 360° around
        this.tickAccum += dt;
        if (this.tickAccum > 0.12) {
            this.tickAccum = 0;
            const w = player.weapon;
            const range = (w?.range || 2.2) + 0.3;
            const baseDmg = (w?.damage || 18) * 0.45;
            const extraHits = WeaponTraits.bonusBladeFlurryHits(w);
            const hits = 1 + Math.floor(extraHits / 6);

            for (const e of this.game.enemies) {
                if (!e.alive) continue;
                const d = e.position.distanceTo(player.position);
                if (d > range + e.contactRadius) continue;
                for (let i = 0; i < hits; i++) {
                    this.game.combat.applyDamage(e, baseDmg, { source: 'flurry', fromPlayer: true, weapon: w });
                }
                this.game.combat._hitStop(0.02);
            }
            this.game.particles.spawnBurst(player.position.clone().add(new THREE.Vector3(0, 1, 0)), '#ff4060', 6, 2.0);
        }

        if (this.timer <= 0) {
            this.active = false;
        }
    }
}
