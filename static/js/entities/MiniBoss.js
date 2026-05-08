// MiniBoss — larger, glowing, hybrid moveset (slam + dash strike).

import * as THREE from 'three';
import { Enemy } from './Enemy.js';

export class MiniBoss extends Enemy {
    constructor(game, spec, x, z) {
        super(game, spec, x, z);
        this.isMiniBoss = true;
        this.attackRange = 2.6 * this.scale;
        this.aggroRange = 40;
        this._slamCool = 4.5;
        this._aura = this._buildAura();
    }

    _buildAura() {
        const m = new THREE.Mesh(
            new THREE.RingGeometry(1.0, 1.6, 24),
            new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
        );
        m.rotation.x = -Math.PI / 2;
        m.position.y = 0.05;
        this.group.add(m);
        return m;
    }

    update(dt, player) {
        if (!this.alive && this.telegraphRing) {
            this.scene.remove(this.telegraphRing);
            this.telegraphRing = null;
        }

        super.update(dt, player);
        if (!this.alive) return;

        if (this.state === 'slam_windup') {
            this.slamWindupTime -= dt;
            const pct = Math.max(0, this.slamWindupTime / 0.85); // 0.85s windup
            const r = 0.5 + 4.0 * pct;
            if (this.telegraphRing) this.telegraphRing.scale.setScalar(r / 4.5);

            if (this.slamWindupTime <= 0) {
                // Execute slam
                this.game.audio.bossRoar();
                this.game.scene.addShake(0.4, 0.5);
                this.game.particles.spawnBurst(this.slamTarget.clone().add(new THREE.Vector3(0, 0.2, 0)), '#ff8c1a', 36, 6);
                const d = this.position.distanceTo(player.position);
                if (d < 4.5) this.game.combat.applyDamageToPlayer(this.damage * 1.4, this);
                
                this.materials[0].emissive.setRGB(0, 0, 0);
                this.materials[0].emissiveIntensity = 0;
                if (this.telegraphRing) {
                    this.scene.remove(this.telegraphRing);
                    this.telegraphRing = null;
                }
                this.state = 'chase';
            }
            return; // Skip normal chase/attack if winding up
        }

        if (this._aura) this._aura.rotation.z += dt * 0.6;
        this._slamCool -= dt;
        if (this.alive && this.state !== 'staggered' && this.state !== 'attack' && this._slamCool <= 0 && this.position.distanceTo(player.position) < 6) {
            this._doSlam(player);
            this._slamCool = 5.5;
        }
    }

    takeDamage(amount, source = {}) {
        const result = super.takeDamage(amount, source);
        if (result && this.state === 'slam_windup') {
            // Interrupt!
            this.state = 'staggered';
            this.staggerTime = 0.5; // Stun for 0.5s
            this.materials[0].emissive.setRGB(0, 0, 0);
            this.materials[0].emissiveIntensity = 0;
            if (this.telegraphRing) {
                this.scene.remove(this.telegraphRing);
                this.telegraphRing = null;
            }
            this.game.hud.toast('INTERRUPTED!');
            this.game.particles.spawnBurst(this.position.clone().add(new THREE.Vector3(0, 1, 0)), '#ffff00', 16, 3);
            this._renderHealthBar(); // Show stun icon
        }
        return result;
    }

    _doSlam(player) {
        this.state = 'slam_windup';
        this.slamWindupTime = 0.85;
        this.slamTarget = this.position.clone();

        // Visual telegraph
        this.materials[0].emissive.setRGB(1, 0.3, 0.0);
        this.materials[0].emissiveIntensity = 1.6;

        // Closing circle telegraph
        const geo = new THREE.RingGeometry(4.3, 4.5, 32);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
        this.telegraphRing = new THREE.Mesh(geo, mat);
        this.telegraphRing.rotation.x = -Math.PI / 2;
        this.telegraphRing.position.set(this.position.x, 0.05, this.position.z);
        this.scene.add(this.telegraphRing);
    }

    dispose() {
        super.dispose();
        if (this.telegraphRing) {
            this.scene.remove(this.telegraphRing);
            if (this.telegraphRing.geometry) this.telegraphRing.geometry.dispose();
            if (this.telegraphRing.material) this.telegraphRing.material.dispose();
            this.telegraphRing = null;
        }
    }
}
