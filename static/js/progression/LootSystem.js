// LootSystem — drops gold/health/upgrade-shards from enemies; weapons only from real bosses.

import * as THREE from 'three';

class LootDrop {
    constructor(game, position, kind, value, weaponId = null) {
        this.game = game;
        this.scene = game.scene.scene;
        this.position = position.clone();
        this.position.y = 0.6;
        this.kind = kind; // 'gold' | 'health' | 'shard' | 'weapon'
        this.value = value;
        this.weaponId = weaponId;
        this.dead = false;
        this.t = 0;

        this.group = new THREE.Group();
        this.group.position.copy(this.position);
        this.scene.add(this.group);

        const color = ({ gold: 0xffd166, health: 0xff5a5a, shard: 0xa45cff, weapon: 0xfff099 })[kind] || 0xffffff;
        const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, metalness: 0.4, roughness: 0.4 });
        const geo = (kind === 'health') ? new THREE.BoxGeometry(0.3, 0.3, 0.3)
                  : (kind === 'shard')  ? new THREE.OctahedronGeometry(0.32)
                  : (kind === 'weapon') ? new THREE.ConeGeometry(0.25, 0.7, 6)
                  : new THREE.IcosahedronGeometry(0.25);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        this.group.add(mesh);
        this.mesh = mesh;

        // light beam — simple cylinder with additive material
        const beam = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.5, 6, 12, 1, true),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
        );
        beam.position.y = 2.5;
        this.group.add(beam);

        this.point = new THREE.PointLight(color, 1.0, 5, 1.4);
        this.point.position.y = 0.4;
        this.group.add(this.point);
    }

    update(dt) {
        this.t += dt;
        this.mesh.rotation.y += dt * 1.6;
        this.mesh.position.y = 0.0 + Math.sin(this.t * 2.5) * 0.15;
    }

    onPickup(game) {
        if (this.dead) return;
        this.dead = true;
        game.audio.pickup();
        game.particles.spawnBurst(this.position, '#ffd166', 12, 3);
        if (this.kind === 'health') game.player.heal(this.value);
        else if (this.kind === 'shard') game.player.energy = Math.min(game.player.maxEnergy, game.player.energy + this.value);
        else if (this.kind === 'gold') {
            // currency for future use; for now grants energy
            game.player.energy = Math.min(game.player.maxEnergy, game.player.energy + 4);
        } else if (this.kind === 'weapon') {
            // Trigger weapon drop screen via flag (pre-resolved by Game)
        }
        this.dispose();
    }

    dispose() {
        this.dead = true;
        this.scene.remove(this.group);
        this.group.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose && o.material.dispose();
        });
    }
}

export class LootSystem {
    constructor(game) {
        this.game = game;
        this.pendingWeapon = null; // weapon id to offer at end of wave
    }

    maybeDropCommonLoot(pos) {
        const r = Math.random();
        if (r < 0.18) this.spawn(pos, 'health', 18);
        else if (r < 0.30) this.spawn(pos, 'shard', 8);
    }

    dropMiniBossLoot(pos) {
        this.spawn(pos.clone().add(new THREE.Vector3( 0.6, 0,  0.0)), 'health', 40);
        this.spawn(pos.clone().add(new THREE.Vector3(-0.6, 0,  0.0)), 'shard', 25);
        this.spawn(pos.clone().add(new THREE.Vector3( 0.0, 0, -0.6)), 'gold', 50);
    }

    async dropBossLoot(pos, wave) {
        this.spawn(pos.clone().add(new THREE.Vector3( 1.0, 0,  0.0)), 'health', 70);
        this.spawn(pos.clone().add(new THREE.Vector3(-1.0, 0,  0.0)), 'shard', 60);
        // weapon drop — fetch from server
        try {
            const r = await fetch(`/api/procedural/weapon_drop?wave=${wave}&seed=${this.game.runState.seed || 0}`);
            const d = await r.json();
            if (d.ok) {
                this.pendingWeapon = d.weapon_id;
                this.spawn(pos.clone(), 'weapon', 1, d.weapon_id);
            }
        } catch (e) {
            // fallback — pick from local data
            const candidates = ['shadowfang', 'moonveil', 'phantom_bow'];
            this.pendingWeapon = candidates[Math.floor(Math.random() * candidates.length)];
        }
    }

    spawn(pos, kind, value, weaponId = null) {
        const drop = new LootDrop(this.game, pos, kind, value, weaponId);
        this.game.lootDrops.push(drop);
        return drop;
    }
}
