// ShadowDash — Q. Teleport-dash forward, i-frames, passes through enemies dealing damage.

import * as THREE from 'three';
import { WeaponTraits } from '../combat/Weapon.js';

export class ShadowDash {
    constructor(player) {
        this.player = player;
        this.game = player.game;
        this.cd = 0;
        this.maxCd = 5.0;
        this.charges = 1;
    }

    get cooldownPct() { return Math.max(0, Math.min(1, this.cd / this.maxCd)); }
    get key() { return 'Q'; }
    get ready() { return this.cd <= 0; }

    activate() {
        if (this.cd > 0) return;
        const charges = (this.player.stats.dash_charges || 1);
        if (this.player.stamina < 18) return;
        this.player.stamina = Math.max(0, this.player.stamina - 18);

        const cls = this.player.weaponClass || 'sword';
        const fwd = this.player.forwardDir();
        // Bow class backsteps (kiting); others dash forward.
        const sign = cls === 'bow' ? -1 : 1;
        const dist = cls === 'bow' ? 6.5 : (cls === 'scythe' ? 7.0 : 8.0);
        const dur = 0.22;
        this.player._dashVel = new THREE.Vector3(fwd.x * sign * (dist / dur), 0, fwd.z * sign * (dist / dur));
        this.player._dashTime = dur;
        this.player.invuln = Math.max(this.player.invuln, 0.6 + (this.player.stats.iframe_bonus || 0));
        this.cd = this.maxCd / Math.max(1, charges);
        this.game.audio.dash();
        this.game.scene.addShake(0.15, 0.2);

        // shadow trail particles — color per class
        const dashColor = ({ sword: '#3a4a90', dagger: '#3a0a55', bow: '#1a4a1a', scythe: '#5a0a0a' })[cls] || '#3a0a55';
        let t = 0;
        const tick = () => {
            if (t > dur) return;
            this.game.particles.spawnBurst(this.player.position.clone().add(new THREE.Vector3(0, 0.8, 0)), dashColor, 5, 1.5);
            if (this.player.stats.poison_dash) {
                this.game.particles.spawnBurst(this.player.position.clone(), '#7fff5f', 4, 1.2);
            }
            t += 0.04;
            setTimeout(tick, 40);
        };
        tick();

        // Scythe: pull nearby enemies inward (Soul Pull flavour)
        if (cls === 'scythe') {
            for (const e of this.game.enemies) {
                if (!e.alive) continue;
                if (e.isBoss || e.isMiniBoss) continue;
                if (e.position.distanceTo(this.player.position) < 6) {
                    const dx = this.player.position.x - e.position.x;
                    const dz = this.player.position.z - e.position.z;
                    const len = Math.hypot(dx, dz) || 1;
                    e.position.x += (dx / len) * 2.5;
                    e.position.z += (dz / len) * 2.5;
                }
            }
        }

        // damage enemies passed through
        const damageZone = () => {
            const dmg = (this.player.weapon ? this.player.weapon.damage : 12) * 0.6;
            for (const e of this.game.enemies) {
                if (!e.alive) continue;
                if (e.position.distanceTo(this.player.position) < 1.2) {
                    this.game.combat.applyDamage(e, dmg, { source: 'dash', fromPlayer: true });
                    if (this.player.stats.poison_dash) e.applyPoison(3.0, 8);
                }
            }
        };
        const interval = setInterval(damageZone, 60);
        setTimeout(() => clearInterval(interval), dur * 1000 + 50);

        // Moonveil: leaves damaging slash on exit
        if (WeaponTraits.hasDashSlash(this.player.weapon)) {
            setTimeout(() => {
                if (!this.player) return;
                this.player.setTrailActive(0.2, 0x7fdaff);
                const dmg = (this.player.weapon.damage || 30) * 1.1;
                for (const e of this.game.enemies) {
                    if (!e.alive) continue;
                    if (e.position.distanceTo(this.player.position) < 3.5) {
                        this.game.combat.applyDamage(e, dmg, { source: 'dashslash', fromPlayer: true, weapon: this.player.weapon });
                    }
                }
                this.game.particles.spawnBurst(this.player.position.clone().add(new THREE.Vector3(0,1,0)), '#7fdaff', 24, 5);
            }, dur * 1000);
        }
    }

    update(dt) {
        if (this.cd > 0) this.cd = Math.max(0, this.cd - dt);
    }
}
