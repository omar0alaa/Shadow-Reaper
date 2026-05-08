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
        super.update(dt, player);
        if (this._aura) this._aura.rotation.z += dt * 0.6;
        this._slamCool -= dt;
        if (this.alive && this._slamCool <= 0 && this.position.distanceTo(player.position) < 6) {
            this._doSlam(player);
            this._slamCool = 5.5;
        }
    }

    _doSlam(player) {
        // visual telegraph then big AoE
        this.materials[0].emissive.setRGB(1, 0.3, 0.0);
        this.materials[0].emissiveIntensity = 1.6;
        const target = this.position.clone();
        setTimeout(() => {
            if (!this.alive) return;
            this.game.audio.bossRoar();
            this.game.scene.addShake(0.4, 0.5);
            this.game.particles.spawnBurst(target.clone().add(new THREE.Vector3(0, 0.2, 0)), '#ff8c1a', 36, 6);
            const d = this.position.distanceTo(player.position);
            if (d < 4.5) this.game.combat.applyDamageToPlayer(this.damage * 1.4, this);
            this.materials[0].emissive.setRGB(0, 0, 0);
            this.materials[0].emissiveIntensity = 0;
        }, 700);
    }
}
