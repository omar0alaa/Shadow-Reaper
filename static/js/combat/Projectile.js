// Projectile.js — arrows, energy waves, etc.
// Handles travel, hit detection (against player or enemies), pierce, ricochet.

import * as THREE from 'three';

export class Projectile {
    constructor(game, opts) {
        this.game = game;
        this.scene = game.scene.scene;
        this.position = opts.origin.clone();
        this.direction = opts.direction.clone().normalize();
        this.speed = opts.speed || 24;
        this.damage = opts.damage || 10;
        this.life = opts.life || 2.0;
        this.color = opts.color || '#ffffff';
        this.size = opts.size || 0.18;
        this.fromPlayer = !!opts.fromPlayer;
        this.kind = opts.kind || 'arrow';
        this.pierce = !!opts.pierce;
        this.ricochet = opts.ricochet || 0;
        this.dead = false;
        this._hits = new Set();

        const c = new THREE.Color(this.color);
        if (this.kind === 'wave') {
            const geo = new THREE.TorusGeometry(this.size, this.size * 0.18, 6, 18, Math.PI);
            const mat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
            this.mesh = new THREE.Mesh(geo, mat);
            this.mesh.rotation.y = Math.atan2(this.direction.x, this.direction.z) + Math.PI / 2;
            this.mesh.rotation.x = -Math.PI / 2;
        } else {
            const geo = new THREE.ConeGeometry(this.size, this.size * 5, 6);
            const mat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95 });
            this.mesh = new THREE.Mesh(geo, mat);
            // Orient cone to direction
            const q = new THREE.Quaternion();
            const up = new THREE.Vector3(0, 1, 0);
            q.setFromUnitVectors(up, this.direction);
            this.mesh.quaternion.copy(q);
        }
        this.mesh.position.copy(this.position);
        this.scene.add(this.mesh);
    }

    update(dt) {
        if (this.dead) return;
        this.life -= dt;
        if (this.life <= 0) return this.dispose();

        const step = this.speed * dt;
        this.position.x += this.direction.x * step;
        this.position.z += this.direction.z * step;

        // Trail
        if (Math.random() < 0.7) {
            this.game.particles.spawnSmall(this.position, this.color, 0.8);
        }

        // Hit checks
        if (this.fromPlayer) {
            for (const e of this.game.enemies) {
                if (!e.alive || this._hits.has(e)) continue;
                const d = e.position.clone().setY(0).distanceTo(this.position.clone().setY(0));
                if (d < (e.contactRadius + this.size + 0.4)) {
                    this._hits.add(e);
                    this.game.combat.applyDamage(e, this.damage, { source: 'projectile', fromPlayer: true });
                    if (this.kind === 'wave') {
                        // wave keeps going (pierce)
                    } else if (this.pierce) {
                        // continues
                    } else if (this.ricochet > 0) {
                        // pick a new target
                        const others = this.game.enemies.filter(en => en.alive && !this._hits.has(en));
                        if (others.length === 0) return this.dispose();
                        others.sort((a, b) => a.position.distanceTo(this.position) - b.position.distanceTo(this.position));
                        const next = others[0];
                        const dir = new THREE.Vector3().subVectors(next.position, this.position); dir.y = 0; dir.normalize();
                        this.direction.copy(dir);
                        this.ricochet--;
                    } else {
                        return this.dispose();
                    }
                }
            }
        } else {
            // hits player
            const p = this.game.player;
            if (!p) return;
            const d = p.position.clone().setY(0).distanceTo(this.position.clone().setY(0));
            if (d < (this.size + 0.6)) {
                if (p.invuln <= 0) {
                    this.game.combat.applyDamageToPlayer(this.damage, { name: 'arrow' });
                }
                return this.dispose();
            }
        }

        // Hit arena walls / props
        let hitWall = false;
        if (Math.hypot(this.position.x, this.position.z) > this.game.arena.radius - 0.4) {
            hitWall = true;
        } else {
            for (const c of this.game.arena.colliders) {
                if (Math.hypot(this.position.x - c.x, this.position.z - c.z) < c.r + this.size) {
                    hitWall = true;
                    break;
                }
            }
        }
        
        if (hitWall) {
            this.game.particles.spawnSmall(this.position, this.color, 0.8);
            return this.dispose();
        }

        this.mesh.position.copy(this.position);
        if (this.kind !== 'wave') {
            // Re-orient cone to direction
            const q = new THREE.Quaternion();
            const up = new THREE.Vector3(0, 1, 0);
            q.setFromUnitVectors(up, this.direction);
            this.mesh.quaternion.copy(q);
        } else {
            this.mesh.rotation.z += dt * 4;
        }
    }

    dispose() {
        if (this.dead) return;
        this.dead = true;
        this.scene.remove(this.mesh);
        if (this.mesh.geometry) this.mesh.geometry.dispose();
        if (this.mesh.material) this.mesh.material.dispose();
    }
}
