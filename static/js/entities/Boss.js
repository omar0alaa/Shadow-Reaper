// Boss.js — multi-phase real boss for every 10th wave.

import * as THREE from 'three';
import { Enemy } from './Enemy.js';
import { Projectile } from '../combat/Projectile.js';

export class Boss extends Enemy {
    constructor(game, spec, x, z) {
        super(game, spec, x, z);
        this.isBoss = true;
        this.attackRange = 3.2 * this.scale;
        this.aggroRange = 60;
        this.phases = spec.phases || 3;
        this.phase = 1;
        this._aoeCool = 6.0;
        this._waveCool = 4.0;
        this._enraged = false;
        this._buildAura();
    }

    _buildAura() {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(1.5, 2.4, 32),
            new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.05;
        this.group.add(ring);
        this._aura = ring;

        const aura2 = new THREE.Mesh(
            new THREE.SphereGeometry(2.0 * this.scale, 16, 12),
            new THREE.MeshBasicMaterial({ color: 0x550000, transparent: true, opacity: 0.18, side: THREE.BackSide, depthWrite: false }),
        );
        aura2.position.y = 1.4 * this.scale;
        this.group.add(aura2);
    }

    update(dt, player) {
        super.update(dt, player);
        if (!this.alive) return;
        if (this._aura) { this._aura.rotation.z += dt * 0.8; this._aura.scale.setScalar(1 + Math.sin(performance.now()/350)*0.05); }

        // Phase transitions
        const pct = this.health / this.maxHealth;
        if (this.phases >= 2 && this.phase < 2 && pct < 0.5) {
            this.phase = 2;
            this.game.hud.toast('The boss enters phase 2');
            this.game.scene.addShake(0.5, 0.6);
            this.game.audio.bossRoar();
        }
        if (this.phases >= 3 && this.phase < 3 && pct < 0.25) {
            this.phase = 3;
            this._enraged = true;
            this.speed *= 1.6;
            this.game.hud.toast('Enraged!');
            this.game.scene.addShake(0.7, 0.8);
            this.game.audio.bossRoar();
        }

        // AoE in phase 2+
        if (this.phase >= 2) {
            this._aoeCool -= dt;
            if (this._aoeCool <= 0) {
                this._aoeBlast();
                this._aoeCool = this._enraged ? 4.0 : 5.5;
            }
            this._waveCool -= dt;
            if (this._waveCool <= 0) {
                this._waveAttack(player);
                this._waveCool = this._enraged ? 3.0 : 4.5;
            }
        }
    }

    _aoeBlast() {
        const startR = 0;
        const endR = 6.5;
        const dur = 0.8;
        let t0 = performance.now();
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.1, 0.3, 64),
            new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(this.position).y = 0.06;
        this.scene.add(ring);
        this.game.audio.heavySwing();
        const tick = () => {
            const dt = (performance.now() - t0) / 1000;
            const k = Math.min(1, dt / dur);
            const r = startR + (endR - startR) * k;
            ring.geometry.dispose();
            ring.geometry = new THREE.RingGeometry(Math.max(0.05, r - 0.4), r, 64);
            ring.material.opacity = 0.8 * (1 - k);
            // damage if player crosses ring
            const d = this.position.distanceTo(this.game.player.position);
            if (d <= r + 0.4 && d >= r - 0.4) {
                this.game.combat.applyDamageToPlayer(this.damage * 1.1, this);
            }
            if (k < 1 && this.alive) requestAnimationFrame(tick);
            else { this.scene.remove(ring); ring.geometry.dispose(); ring.material.dispose(); }
        };
        requestAnimationFrame(tick);
    }

    _waveAttack(player) {
        // Three crescents
        const baseAng = Math.atan2(player.position.x - this.position.x, player.position.z - this.position.z);
        for (let i = -1; i <= 1; i++) {
            const a = baseAng + i * 0.25;
            const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
            const start = this.position.clone().add(dir.clone().multiplyScalar(1.2)).add(new THREE.Vector3(0, 1.4, 0));
            const proj = new Projectile(this.game, {
                origin: start, direction: dir, speed: 14, damage: this.damage * 0.9,
                life: 2.5, color: this.color || '#ff2a2a', size: 0.55, fromPlayer: false, kind: 'wave',
            });
            this.game.projectiles.push(proj);
        }
        this.game.audio.heavySwing();
    }
}
