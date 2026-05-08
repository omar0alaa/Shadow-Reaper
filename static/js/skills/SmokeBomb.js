// SmokeBomb — E. Drop smoke cloud → 3s stealth, lose enemy aggro, next attack guaranteed crit.

import * as THREE from 'three';

export class SmokeBomb {
    constructor(player) {
        this.player = player;
        this.game = player.game;
        this.cd = 0;
        this.maxCd = 12.0;
    }

    get cooldownPct() { return Math.max(0, Math.min(1, this.cd / this.maxCd)); }
    get key() { return 'E'; }
    get ready() { return this.cd <= 0; }

    activate() {
        if (this.cd > 0) return;
        this.cd = this.maxCd;
        this.game.audio.skill();
        const center = this.player.position.clone().add(new THREE.Vector3(0, 0.5, 0));
        // big particle puff over time
        let t = 0;
        const totalDur = 3.2;
        const interval = setInterval(() => {
            t += 0.12;
            if (t > totalDur) { clearInterval(interval); return; }
            this.game.particles.spawnSmoke(center.clone().add(new THREE.Vector3(
                (Math.random() - 0.5) * 2, Math.random() * 1.2, (Math.random() - 0.5) * 2
            )), '#888888', 6);
            // damage if upgrade
            if (this.player.stats.smoke_damage) {
                for (const e of this.game.enemies) {
                    if (!e.alive) continue;
                    if (e.position.distanceTo(center) < 3.5) {
                        this.game.combat.applyDamage(e, 6, { source: 'smoke', fromPlayer: true });
                    }
                }
            }
        }, 100);

        // stealth state
        this.player.stealthActive = true;
        this.player.stealthFirstStrike = true;
        setTimeout(() => {
            this.player.stealthActive = false;
        }, 3000);
    }

    update(dt) {
        if (this.cd > 0) this.cd = Math.max(0, this.cd - dt);
    }
}
