// R skill — class-driven primary ability.
//   sword:  Whirlwind   (medium range, balanced spin, slight forward drift)
//   dagger: Blade Flurry (faster ticks, tighter range, applies bleed if eligible)
//   bow:    Arrow Storm  (rains arrows in a circle around the player)
//   scythe: Reaping Spin (wide AoE, lifesteal heal per hit)

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

        // BOW class → Arrow Storm
        if (this.player.weaponClass === 'bow' || WeaponTraits.bladeFlurryAsArrowStorm(this.player.weapon)) {
            const total = 24;
            const baseDmg = (this.player.weapon?.damage || 20) * 0.7;
            for (let i = 0; i < total; i++) {
                setTimeout(() => {
                    if (!this.player) return;
                    const a = (i / total) * Math.PI * 2;
                    const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
                    const start = this.player.position.clone().add(new THREE.Vector3(0, 1.2, 0));
                    const proj = new Projectile(this.game, {
                        origin: start, direction: dir, speed: 26,
                        damage: baseDmg, life: 1.6,
                        color: this.player.weapon.color || '#9bff9b', size: 0.16,
                        fromPlayer: true, kind: 'arrow',
                        pierce: WeaponTraits.hasPierce(this.player.weapon),
                    });
                    this.game.projectiles.push(proj);
                }, i * 50);
            }
            this.game.audio.bowShot();
            this.active = false; // arrow storm is fire-and-forget
            return;
        }
    }

    update(dt) {
        if (this.cd > 0) this.cd = Math.max(0, this.cd - dt);
        if (!this.active) return;
        this.timer -= dt;

        const player = this.player;
        const cls = player.weaponClass || 'sword';
        const w = player.weapon;

        // Visual spin — varies by class. Rotate via player.facing so the
        // change actually sticks (Player.update otherwise overwrites
        // group.rotation.y from facing every frame).
        const t = performance.now() / 70;
        const cls2 = cls;
        if (cls2 === 'scythe') {
            // Scythe held out wide — rotate weapon horizontally with the spin.
            player.weaponMount.rotation.y = Math.sin(t * 0.6);
            player.weaponMount.rotation.x = -0.2;
            player.rArm.rotation.x = -1.1;
            player.rArm.rotation.z = 0.6;
            player.lArm.rotation.x = -0.4;
        } else if (cls2 === 'dagger') {
            // Twin-dagger flurry — both arms outstretched and chopping.
            player.weaponMount.rotation.x = Math.sin(t * 1.4) * 0.9;
            player.rArm.rotation.x = -1.2 - Math.sin(t * 1.5) * 0.4;
            player.lArm.rotation.x = -1.2 + Math.cos(t * 1.5) * 0.4;
        } else {
            // Sword Whirlwind — single blade spin out wide.
            player.weaponMount.rotation.z = 0.6;
            player.weaponMount.rotation.x = Math.sin(t) * 0.8;
            player.rArm.rotation.x = -1.0 - Math.sin(t * 1.5) * 0.3;
            player.rArm.rotation.z = -0.4;
            player.lArm.rotation.x = -0.5 + Math.cos(t * 1.5) * 0.3;
        }
        const spinSpeed = cls === 'dagger' ? 16 : cls === 'scythe' ? 9 : 12;
        player.facing += dt * spinSpeed;
        player._spinningSkill = true;

        // Forward drift differs per class
        const driftSpeed = cls === 'sword' ? 1.8 : cls === 'dagger' ? 2.4 : cls === 'scythe' ? 0.8 : 1.4;
        const fwd = new THREE.Vector3(Math.sin(player.facing), 0, Math.cos(player.facing));
        player.position.x += fwd.x * driftSpeed * dt;
        player.position.z += fwd.z * driftSpeed * dt;
        const cr = this.game.arena.resolveCollision(player.position.x, player.position.z, 0.45);
        player.position.x = cr.x; player.position.z = cr.z;

        // Damage tick rate / range / damage / hits varies by class
        const tickInterval = cls === 'dagger' ? 0.08 : cls === 'scythe' ? 0.16 : 0.12;
        this.tickAccum += dt;
        if (this.tickAccum > tickInterval) {
            this.tickAccum = 0;
            // Range per class — scythe has the widest sweep
            const rangeBoost = cls === 'scythe' ? 1.0 : cls === 'sword' ? 0.5 : 0.3;
            const range = (w?.range || 2.2) + rangeBoost;
            // Damage per tick
            const dmgScale = cls === 'dagger' ? 0.32 : cls === 'scythe' ? 0.55 : 0.45;
            const baseDmg = (w?.damage || 18) * dmgScale;
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
            // Particle color tinted by class
            const burstColor = ({ sword: '#cfd8ff', dagger: '#ff4060', bow: '#9bff9b', scythe: '#ff6060' })[cls];
            this.game.particles.spawnBurst(player.position.clone().add(new THREE.Vector3(0, 1, 0)), burstColor, 6, 2.0);
        }

        if (this.timer <= 0) {
            this.active = false;
        }
    }
}
