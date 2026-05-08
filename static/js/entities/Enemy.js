// Enemy.js — base enemy class.
// Builds a low-poly humanoid from primitives and runs an FSM.

import * as THREE from 'three';
import { Projectile } from '../combat/Projectile.js';

export class Enemy {
    constructor(game, spec, x, z) {
        this.game = game;
        this.scene = game.scene.scene;
        this.spec = spec;
        this.name = spec.name || 'Enemy';
        this.color = spec.color || '#aa4444';
        this.maxHealth = spec.hp;
        this.health = spec.hp;
        this.damage = spec.damage;
        this.speed = spec.speed;
        this.behavior = spec.behavior;
        this.scale = spec.scale || 1.0;
        this.position = new THREE.Vector3(x, 0, z);
        this.velocity = new THREE.Vector3();
        this.facing = 0;

        this.alive = true;
        this.state = 'idle';     // idle | patrol | chase | attack | staggered | dead
        this.stateTime = 0;
        this.attackCooldown = 0;
        this.attackWindup = 0;
        this.attackActive = false;
        this.staggerTime = 0;
        this.contactRadius = 0.55 * this.scale;
        this.attackRange = 1.7 * this.scale;
        this.aggroRange = 22.0;
        this.dissolveT = 0;
        this.bleed = 0;          // remaining bleed time
        this.bleedTick = 0;
        this.poisoned = 0;       // poison timer
        this.shocked = 0;        // chain-lightning visual
        this.isMiniBoss = false;
        this.isBoss = false;
        this.flashTime = 0;      // red flash on hit / windup

        this._buildMesh();
    }

    _buildMesh() {
        this.group = new THREE.Group();
        this.scene.add(this.group);

        const c = new THREE.Color(this.color);
        const cloth = new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.65), roughness: 0.85 });
        const skin = new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.9), roughness: 0.7, emissive: c.clone().multiplyScalar(0.05), emissiveIntensity: 0.5 });
        const accent = new THREE.MeshStandardMaterial({ color: c.clone(), emissive: c.clone().multiplyScalar(0.4), emissiveIntensity: 0.6, roughness: 0.6 });
        this.materials = [cloth, skin, accent];

        const s = this.scale;
        // legs
        this.lLeg = new THREE.Mesh(new THREE.BoxGeometry(0.32 * s, 0.8 * s, 0.34 * s), cloth);
        this.lLeg.position.set(-0.18 * s, 0.4 * s, 0); this.lLeg.castShadow = true;
        this.rLeg = this.lLeg.clone(); this.rLeg.position.x = 0.18 * s;
        this.group.add(this.lLeg); this.group.add(this.rLeg);
        // torso
        this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.7 * s, 0.9 * s, 0.5 * s), cloth);
        this.torso.position.y = 1.25 * s; this.torso.castShadow = true;
        this.group.add(this.torso);
        // accent stripe
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.74 * s, 0.1 * s, 0.54 * s), accent);
        stripe.position.y = 1.05 * s;
        this.group.add(stripe);
        // head
        this.head = new THREE.Mesh(new THREE.SphereGeometry(0.22 * s, 12, 10), skin);
        this.head.position.y = 1.85 * s; this.head.castShadow = true;
        this.group.add(this.head);
        // arms
        this.lArm = new THREE.Mesh(new THREE.BoxGeometry(0.22 * s, 0.75 * s, 0.22 * s), cloth);
        this.lArm.position.set(-0.46 * s, 1.32 * s, 0); this.lArm.castShadow = true;
        this.rArm = this.lArm.clone(); this.rArm.position.x = 0.46 * s;
        this.group.add(this.lArm); this.group.add(this.rArm);

        // weapon stub (varies by behavior)
        const wpnMat = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.7, roughness: 0.3 });
        if (this.behavior === 'ranged') {
            const bow = new THREE.Mesh(new THREE.TorusGeometry(0.4 * s, 0.04 * s, 6, 16, Math.PI * 1.4), wpnMat);
            bow.rotation.set(Math.PI / 2, 0, Math.PI / 2);
            bow.position.set(0.5 * s, 1.3 * s, 0.05);
            this.group.add(bow);
        } else if (this.behavior === 'heavy') {
            const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.3 * s, 0.3 * s, 0.3 * s), wpnMat);
            hammer.position.set(0.6 * s, 1.4 * s, 0.05);
            this.group.add(hammer);
        } else if (this.behavior !== 'summoner') {
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08 * s, 0.6 * s, 0.06 * s), wpnMat);
            blade.position.set(0.55 * s, 1.1 * s, 0.05);
            this.group.add(blade);
            this.bladeMesh = blade;
        }
        // glowing eyes
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.03 * s, 6, 6), eyeMat);
        this.eyeR = this.eyeL.clone();
        this.eyeL.position.set(-0.07 * s, 1.86 * s, 0.18 * s);
        this.eyeR.position.set( 0.07 * s, 1.86 * s, 0.18 * s);
        this.group.add(this.eyeL); this.group.add(this.eyeR);

        // health bar (sprite-ish billboard)
        this._buildHealthBar();

        this.group.position.copy(this.position);
    }

    _buildHealthBar() {
        const c = document.createElement('canvas');
        c.width = 64; c.height = 8;
        this.hbCanvas = c;
        this.hbCtx = c.getContext('2d');
        this.hbTex = new THREE.CanvasTexture(c);
        this.hbTex.minFilter = THREE.LinearFilter;
        const mat = new THREE.SpriteMaterial({ map: this.hbTex, depthTest: false, transparent: true });
        this.hbSprite = new THREE.Sprite(mat);
        this.hbSprite.scale.set(1.4, 0.16, 1);
        this.hbSprite.position.y = 2.3 * this.scale;
        this.group.add(this.hbSprite);
        this._renderHealthBar();
    }

    _renderHealthBar() {
        const c = this.hbCtx;
        const w = this.hbCanvas.width, h = this.hbCanvas.height;
        c.clearRect(0, 0, w, h);
        c.fillStyle = 'rgba(0,0,0,0.7)';
        c.fillRect(0, 0, w, h);
        const pct = Math.max(0, this.health / this.maxHealth);
        const grad = c.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, '#6a0c0c'); grad.addColorStop(1, '#c5252f');
        c.fillStyle = grad;
        c.fillRect(1, 1, (w - 2) * pct, h - 2);
        c.strokeStyle = 'rgba(255,255,255,0.25)';
        c.strokeRect(0.5, 0.5, w - 1, h - 1);

        // draw stun icon if stunned
        if (this.staggerTime > 0 || this.stunned > 0) {
            c.fillStyle = '#ffe600';
            c.font = '7px sans-serif';
            c.fillText('💫', w / 2 - 4, h - 1);
        }

        this.hbTex.needsUpdate = true;
    }

    takeDamage(amount, source = {}) {
        if (!this.alive) return false;
        // Stagger only on big hits or backstab
        const prev = this.health;
        this.health -= amount;
        this._renderHealthBar();
        this.flashTime = 0.12;

        // Stagger threshold
        if (amount > this.maxHealth * 0.18 || source.heavy) {
            this.staggerTime = Math.max(this.staggerTime, 0.45);
            this.state = 'staggered';
        }

        if (this.health <= 0 && this.alive) {
            this.health = 0;
            this._die();
        }
        return true;
    }

    applyBleed(seconds, dps) {
        this.bleed = Math.max(this.bleed, seconds);
        this.bleedDps = Math.max(this.bleedDps || 0, dps);
    }
    applyPoison(seconds, dps) {
        this.poisoned = Math.max(this.poisoned, seconds);
        this.poisonDps = Math.max(this.poisonDps || 0, dps);
    }

    _die() {
        this.alive = false;
        this.state = 'dead';
        this.dissolveT = 0;
        this.game.audio.enemyHurt();
        // small blood/dust burst
        this.game.particles.spawnBurst(this.position.clone().add(new THREE.Vector3(0, 1, 0)), this.color, 18, 4);
        this.game.onEnemyKilled(this);
    }

    update(dt, player) {
        if (!this.alive) {
            // dissolve animation
            this.dissolveT += dt;
            for (const m of this.materials) {
                m.opacity = Math.max(0, 1 - this.dissolveT * 1.4);
                m.transparent = true;
                m.emissiveIntensity = (m.emissiveIntensity || 0) * (1 - this.dissolveT);
            }
            this.group.position.y = -this.dissolveT * 0.4;
            this.group.rotation.y += dt * 1.2;
            this.group.scale.setScalar(Math.max(0.01, 1 - this.dissolveT * 0.3));
            if (this.hbSprite) this.hbSprite.visible = false;
            if (this.dissolveT > 1.2) this.dispose();
            return;
        }

        // status effects
        if (this.bleed > 0) {
            this.bleed -= dt;
            this.bleedTick -= dt;
            if (this.bleedTick <= 0) {
                this.bleedTick = 0.4;
                const dmg = (this.bleedDps || 4) * 0.4;
                this.health -= dmg;
                this._renderHealthBar();
                this.game.particles.spawnBurst(this.position.clone().add(new THREE.Vector3(0,1,0)), '#ff3030', 4, 1.6);
                if (this.health <= 0) { this.health = 0; this._die(); return; }
            }
        }
        if (this.poisoned > 0) {
            this.poisoned -= dt;
            const dmg = (this.poisonDps || 6) * dt;
            this.health -= dmg;
            this._renderHealthBar();
            if (this.health <= 0) { this.health = 0; this._die(); return; }
        }
        if (this.shocked > 0) this.shocked -= dt;

        if (this.flashTime > 0) {
            this.flashTime -= dt;
            const f = this.flashTime > 0 ? 1 : 0;
            this.materials[0].emissive.setRGB(f, f * 0.1, f * 0.1);
            this.materials[0].emissiveIntensity = f * 1.2;
        } else {
            this.materials[0].emissive.setRGB(0, 0, 0);
            this.materials[0].emissiveIntensity = 0;
        }

        if (this.staggerTime > 0) {
            this.staggerTime -= dt;
            this.group.rotation.z = Math.sin(performance.now() / 30) * 0.06;
            if (this.staggerTime <= 0) {
                this.group.rotation.z = 0;
                this._renderHealthBar(); // Clear stun icon
            }
            return;
        } else this.group.rotation.z = 0;

        // FSM
        const toPlayer = new THREE.Vector3().subVectors(player.position, this.position);
        const dist = toPlayer.length();
        toPlayer.normalize();

        // Stealth: if player has stealth, lose target
        if (player.stealthActive) {
            // wander around
            this._wanderUpdate(dt);
            this._render(dt);
            return;
        }

        switch (this.state) {
            case 'idle':
            case 'patrol':
                if (dist < this.aggroRange) this.state = 'chase';
                break;
            case 'chase':
                this._chaseUpdate(dt, player, toPlayer, dist);
                break;
            case 'attack':
                this._attackUpdate(dt, player, dist);
                break;
            case 'staggered':
                if (this.staggerTime <= 0) this.state = 'chase';
                break;
        }

        this._render(dt);
    }

    _wanderUpdate(dt) {
        if (!this._wanderDir || Math.random() < dt * 0.3) {
            const a = Math.random() * Math.PI * 2;
            this._wanderDir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        }
        const v = this.speed * 0.4 * dt;
        this.position.x += this._wanderDir.x * v;
        this.position.z += this._wanderDir.z * v;
        const r = this.game.arena.resolveCollision(this.position.x, this.position.z, this.contactRadius);
        this.position.x = r.x; this.position.z = r.z;
        this.facing = Math.atan2(this._wanderDir.x, this._wanderDir.z);
    }

    _chaseUpdate(dt, player, toPlayer, dist) {
        // Override per-behavior
        if (this.behavior === 'ranged') {
            // keep distance
            const desired = 9.0;
            if (dist < desired - 1) {
                this.position.x -= toPlayer.x * this.speed * dt;
                this.position.z -= toPlayer.z * this.speed * dt;
            } else if (dist > desired + 1) {
                this.position.x += toPlayer.x * this.speed * dt * 0.6;
                this.position.z += toPlayer.z * this.speed * dt * 0.6;
            }
            const r = this.game.arena.resolveCollision(this.position.x, this.position.z, this.contactRadius);
            this.position.x = r.x; this.position.z = r.z;
            this.facing = Math.atan2(toPlayer.x, toPlayer.z);
            if (this.attackCooldown <= 0 && dist < this.aggroRange) this._beginAttack();
            else this.attackCooldown -= dt;
            return;
        }

        if (this.behavior === 'teleport' && this.attackCooldown <= 0 && dist > 5 && dist < 16) {
            // blink to within strike range
            const ang = Math.atan2(toPlayer.x, toPlayer.z);
            const dest = new THREE.Vector3(player.position.x - Math.sin(ang) * 1.8, 0, player.position.z - Math.cos(ang) * 1.8);
            this.game.particles.spawnBurst(this.position.clone().add(new THREE.Vector3(0,1,0)), this.color, 16, 4);
            this.position.copy(dest);
            this.game.particles.spawnBurst(this.position.clone().add(new THREE.Vector3(0,1,0)), this.color, 16, 4);
            this.attackCooldown = 1.6;
            this._beginAttack();
            return;
        }

        if (this.behavior === 'summoner') {
            // pace and summon periodically
            const desired = 7.0;
            if (dist < desired - 1) {
                this.position.x -= toPlayer.x * this.speed * dt * 0.7;
                this.position.z -= toPlayer.z * this.speed * dt * 0.7;
            }
            const r = this.game.arena.resolveCollision(this.position.x, this.position.z, this.contactRadius);
            this.position.x = r.x; this.position.z = r.z;
            this.facing = Math.atan2(toPlayer.x, toPlayer.z);
            this.attackCooldown -= dt;
            if (this.attackCooldown <= 0) {
                this._summonSkeleton();
                this.attackCooldown = 5.0;
            }
            return;
        }

        // melee/heavy default — chase player
        const v = this.speed * dt;
        this.position.x += toPlayer.x * v;
        this.position.z += toPlayer.z * v;
        const r = this.game.arena.resolveCollision(this.position.x, this.position.z, this.contactRadius);
        this.position.x = r.x; this.position.z = r.z;
        this.facing = Math.atan2(toPlayer.x, toPlayer.z);

        if (dist < this.attackRange && this.attackCooldown <= 0) this._beginAttack();
        else this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    }

    _beginAttack() {
        this.state = 'attack';
        // Windup duration depends on behavior
        if (this.behavior === 'heavy') this.attackWindup = 0.85;
        else if (this.behavior === 'ranged') this.attackWindup = 0.55;
        else if (this.behavior === 'teleport') this.attackWindup = 0.25;
        else this.attackWindup = 0.4;
        this.attackActive = true;
        this._didDamageThisAttack = false;
        // visual telegraph: red emissive flash on torso/eyes
        this.materials[0].emissive.setRGB(1, 0.15, 0.15);
        this.materials[0].emissiveIntensity = 1.4;
    }

    _attackUpdate(dt, player, dist) {
        this.attackWindup -= dt;
        if (this.attackWindup <= 0 && !this._didDamageThisAttack) {
            this._didDamageThisAttack = true;
            // Resolve attack
            this.materials[0].emissive.setRGB(0, 0, 0);
            this.materials[0].emissiveIntensity = 0;
            if (this.behavior === 'ranged') {
                this._fireArrowAt(player);
            } else if (this.behavior === 'summoner') {
                this._summonSkeleton();
            } else {
                // melee strike: if player still in range, hit
                const d = this.position.distanceTo(player.position);
                const range = this.attackRange + 0.4;
                if (d <= range) {
                    this.game.combat.applyDamageToPlayer(this.damage, this);
                }
                this.game.particles.spawnBurst(
                    this.position.clone().add(new THREE.Vector3(Math.sin(this.facing), 1, Math.cos(this.facing)).multiplyScalar(1.0)),
                    '#ffaa55', 8, 2.5
                );
            }
            // Recover
            this.attackCooldown = (this.behavior === 'heavy') ? 1.6 : (this.behavior === 'ranged' ? 1.5 : 1.0);
            this.state = 'chase';
        }
        // animate windup: raise arm
        const w = Math.max(0, 1 - this.attackWindup);
        this.rArm.rotation.x = -1.4 * w;
    }

    _fireArrowAt(player) {
        const start = this.position.clone().add(new THREE.Vector3(0, 1.4, 0));
        const dir = new THREE.Vector3().subVectors(player.position, this.position);
        dir.y = 0; dir.normalize();
        // small spread
        const spread = (Math.random() - 0.5) * 0.08;
        const cos = Math.cos(spread), sin = Math.sin(spread);
        const sd = new THREE.Vector3(dir.x * cos - dir.z * sin, 0, dir.x * sin + dir.z * cos);
        const proj = new Projectile(this.game, {
            origin: start, direction: sd, speed: 22, damage: this.damage,
            life: 2.2, color: '#aaff80', size: 0.16, fromPlayer: false, kind: 'arrow',
        });
        this.game.projectiles.push(proj);
    }

    _summonSkeleton() {
        const sp = this.position.clone().add(new THREE.Vector3((Math.random()-0.5)*3, 0, (Math.random()-0.5)*3));
        if (this.game.spawnSkeleton) {
            this.game.spawnSkeleton(sp.x, sp.z);
            this.game.particles.spawnBurst(sp.clone().add(new THREE.Vector3(0, 0.5, 0)), '#5cd1e0', 14, 3);
            this.game.audio.skill();
        }
    }

    _render(dt) {
        // Attack windup makes red flash (handled in _beginAttack)
        // Walking animation
        const moving = this.state === 'chase';
        const t = performance.now() / 1000;
        const bob = moving ? Math.sin(t * 8 + this.position.x) : 0;
        this.lLeg.rotation.x = bob * 0.5;
        this.rLeg.rotation.x = -bob * 0.5;
        if (this.state !== 'attack') {
            this.lArm.rotation.x = -bob * 0.4;
            this.rArm.rotation.x = bob * 0.4;
        }
        this.group.position.copy(this.position);
        this.group.rotation.y = this.facing;
    }

    dispose() {
        this.scene.remove(this.group);
        this.group.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
                if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
                else o.material.dispose && o.material.dispose();
            }
        });
    }
}
