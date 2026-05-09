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
        // MeshBasic — no lighting recomputation when lights change in the scene.
        const mat = new THREE.MeshBasicMaterial({ color, transparent: false });
        const geo = (kind === 'health') ? new THREE.BoxGeometry(0.3, 0.3, 0.3)
                  : (kind === 'shard')  ? new THREE.OctahedronGeometry(0.32)
                  : (kind === 'weapon') ? new THREE.ConeGeometry(0.25, 0.7, 6)
                  : new THREE.IcosahedronGeometry(0.25);
        const mesh = new THREE.Mesh(geo, mat);
        // No shadow casting — pickups don't need to cast.
        this.group.add(mesh);
        this.mesh = mesh;

        // Glow beam — additive cylinder. Cheap, no light recompile.
        const beam = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.5, 6, 12, 1, true),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
        );
        beam.position.y = 2.5;
        this.group.add(beam);
        // NB: previously each drop added a THREE.PointLight, which recompiled
        // every material's shader on the next frame — causing a 1-2s freeze
        // when several drops appeared at once (boss kill + explosion). Removed.
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
            const cls = this.game.playerClass || (this.game.player && this.game.player.weaponClass) || 'sword';
            const r = await fetch(`/api/procedural/weapon_drop?wave=${wave}&seed=${this.game.runState.seed || 0}&class=${cls}`);
            const d = await r.json();
            if (d.ok) {
                this.pendingWeapon = d.weapon_id;
                this.spawn(pos.clone(), 'weapon', 1, d.weapon_id);
            }
        } catch (e) {
            // fallback — uncommon of player's class
            const cls = this.game.playerClass || 'sword';
            this.pendingWeapon = `${cls}_uncommon`;
        }
    }

    spawn(pos, kind, value, weaponId = null) {
        const drop = new LootDrop(this.game, pos, kind, value, weaponId);
        this.game.lootDrops.push(drop);
        return drop;
    }

    /** Multiplayer host: roll one drop set per party member, targeted at their pid.
     *  - common enemies: low-roll health/shard chance per player
     *  - mini-bosses: guaranteed health + shard + gold per player
     *  - real bosses: weapon for each player from their own class table + heals/shards
     *  Each drop is broadcast as `loot_spawn` with `target_pid`. The local player
     *  spawns their own visually; remote players receive their own copy.
     */
    async dropForParty(enemy, wave) {
        const game = this.game;
        if (!game.net || !game.net.connected) {
            // Fallback to single-player drop if net is dead.
            if (enemy.isMiniBoss) this.dropMiniBossLoot(enemy.position);
            else if (enemy.isBoss) this.dropBossLoot(enemy.position, wave);
            else this.maybeDropCommonLoot(enemy.position);
            return;
        }
        const members = game.net.roster();
        const ePos = enemy.position;
        const offsetFor = (i) => {
            const a = (i / Math.max(1, members.length)) * Math.PI * 2;
            return { x: Math.cos(a) * 0.9, z: Math.sin(a) * 0.9 };
        };

        const sendDrop = (member, kind, value, weaponId, posOff) => {
            const x = ePos.x + posOff.x;
            const z = ePos.z + posOff.z;
            // Send to the targeted peer (server routes when target is set).
            game.net.send('loot_spawn', {
                target_pid: member.pid,
                kind, value, weaponId, x, z,
            }, member.pid);
            // If the targeted peer IS the host, spawn locally too.
            if (member.pid === game.net.pid) {
                const v = new THREE.Vector3(x, 0, z);
                this.spawn(v, kind, value, weaponId);
                if (kind === 'weapon' && weaponId) this.pendingWeapon = weaponId;
            }
        };

        for (let i = 0; i < members.length; i++) {
            const m = members[i];
            const off = offsetFor(i);
            if (enemy.isBoss) {
                // Per-player boss drop: class-specific weapon + heal + shard.
                try {
                    const r = await fetch(`/api/procedural/weapon_drop?wave=${wave}&seed=${game.runState.seed || 0}&class=${m.class}`);
                    const d = await r.json();
                    if (d.ok && d.weapon_id) {
                        sendDrop(m, 'weapon', 1, d.weapon_id, off);
                    }
                } catch (e) {
                    sendDrop(m, 'weapon', 1, `${m.class}_uncommon`, off);
                }
                sendDrop(m, 'health', 70, null, { x: off.x * 1.4, z: off.z * 1.4 });
                sendDrop(m, 'shard', 60, null, { x: -off.x, z: -off.z });
            } else if (enemy.isMiniBoss) {
                sendDrop(m, 'health', 40, null, off);
                sendDrop(m, 'shard',  25, null, { x: off.x * -0.8, z: off.z * -0.8 });
                sendDrop(m, 'gold',   50, null, { x: 0, z: 0 });
            } else {
                // Common enemies — per-player roll, smaller chance.
                const r = Math.random();
                if (r < 0.18) sendDrop(m, 'health', 18, null, off);
                else if (r < 0.30) sendDrop(m, 'shard', 8, null, off);
            }
        }
    }
}
