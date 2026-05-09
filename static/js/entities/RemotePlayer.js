// RemotePlayer — visualizes another party member.
// Receives sparse position/anim updates over the network and interpolates.

import * as THREE from 'three';

const CLASS_COLOR = {
    sword:  0x6a85b8,
    dagger: 0x9a72d8,
    bow:    0x6dd66d,
    scythe: 0xd04848,
};

export class RemotePlayer {
    constructor(game, pid, info) {
        this.game = game;
        this.scene = game.scene.scene;
        this.pid = pid;
        this.name = info.name || 'Player';
        this.weaponClass = info.class || 'sword';
        this.weaponId = info.weaponId || `${this.weaponClass}_common`;

        this.position = new THREE.Vector3(0, 0, 0);
        this.targetPos = new THREE.Vector3(0, 0, 0);
        this.facing = 0;
        this.targetFacing = 0;
        this.lastUpdate = performance.now();
        this.alive = true;
        this._swingTimer = 0;        // counts UP from 0 to swingDur
        this._swingDur = 0;          // total swing duration
        this._swingHeavy = false;    // server reported swing kind 2
        this._spinning = false;
        this._spinAngle = 0;

        this._buildMesh();
        this._buildWeaponMesh();
        this._buildNamePlate();
    }

    _buildMesh() {
        this.group = new THREE.Group();
        this.scene.add(this.group);

        const tint = new THREE.Color(CLASS_COLOR[this.weaponClass] || 0xa0a0a0);
        const cloth = new THREE.MeshStandardMaterial({ color: tint.clone().multiplyScalar(0.45), roughness: 0.85 });
        const cloak = new THREE.MeshStandardMaterial({ color: tint.clone().multiplyScalar(0.25), roughness: 0.9, side: THREE.DoubleSide });
        const skin = new THREE.MeshStandardMaterial({ color: 0xc7a98a, roughness: 0.7 });
        const accent = new THREE.MeshStandardMaterial({ color: tint, emissive: tint.clone().multiplyScalar(0.4), emissiveIntensity: 0.6, roughness: 0.6 });
        this.materials = [cloth, cloak, skin, accent];

        // legs
        const lLeg = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.8, 0.34), cloth);
        lLeg.position.set(-0.18, 0.4, 0); lLeg.castShadow = true;
        const rLeg = lLeg.clone(); rLeg.position.x = 0.18;
        this.group.add(lLeg); this.group.add(rLeg);
        this.lLeg = lLeg; this.rLeg = rLeg;

        // torso
        const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.5), cloth);
        torso.position.y = 1.25; torso.castShadow = true;
        this.group.add(torso);

        // belt accent
        const belt = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.12, 0.54), accent);
        belt.position.y = 0.85;
        this.group.add(belt);

        // head + hood
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), skin);
        head.position.y = 1.85; head.castShadow = true;
        this.group.add(head);
        const hood = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.5, 12, 1, true), cloak);
        hood.position.y = 2.0; hood.rotation.x = Math.PI;
        this.group.add(hood);

        // arms
        const lArm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.75, 0.22), cloth);
        lArm.position.set(-0.46, 1.32, 0); lArm.castShadow = true;
        const rArm = lArm.clone(); rArm.position.x = 0.46;
        this.group.add(lArm); this.group.add(rArm);
        this.lArm = lArm; this.rArm = rArm;

        // weapon mount — actual mesh is built in _buildWeaponMesh from the
        // server-reported weapon ID.
        this.weaponMount = new THREE.Group();
        this.weaponMount.position.set(0.48, 0.95, 0.10);
        this.group.add(this.weaponMount);
        this._weaponBaseTransform = {
            x: 0.48, y: 0.95, z: 0.10,
        };

        // colored ring under foot to identify allies
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.55, 0.7, 24),
            new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.04;
        this.group.add(ring);
        this._ring = ring;
    }

    /** Build / rebuild the weapon mesh from the current weaponId. Mirrors
     *  Player._buildWeaponMesh so peers see the right shape for each class. */
    _buildWeaponMesh() {
        // Tear down current weapon mount + offhand mount.
        while (this.weaponMount.children.length) {
            const c = this.weaponMount.children.pop();
            this.weaponMount.remove(c);
            if (c.geometry) c.geometry.dispose();
            if (c.material) c.material.dispose && c.material.dispose();
        }
        if (this.offhandMount) {
            this.group.remove(this.offhandMount);
            this.offhandMount.traverse(o => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) o.material.dispose && o.material.dispose();
            });
            this.offhandMount = null;
        }

        const w = (this.game.weaponData || {})[this.weaponId];
        if (!w) return;
        const mat = new THREE.MeshStandardMaterial({
            color: w.color || '#aaaaaa',
            metalness: 0.85,
            roughness: 0.25,
            emissive: new THREE.Color(w.color || '#aaaaaa').multiplyScalar(0.15),
        });
        if (w.type === 'dual_fast') {
            const d1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.7), mat);
            d1.position.set(0, 0, 0.35); d1.castShadow = true;
            this.weaponMount.add(d1);
            this.offhandMount = new THREE.Group();
            this.offhandMount.position.set(-0.48, 0.95, 0.10);
            const d2 = d1.clone();
            this.offhandMount.add(d2);
            this.group.add(this.offhandMount);
        } else if (w.type === 'melee_heavy' || w.type === 'melee_balanced') {
            const len = w.type === 'melee_balanced' ? 1.05 : 1.4;
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, len), mat);
            blade.position.set(0, 0, len * 0.5); blade.castShadow = true;
            this.weaponMount.add(blade);
            const guard = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.08), mat);
            guard.position.set(0, 0, 0);
            this.weaponMount.add(guard);
        } else if (w.type === 'ranged') {
            const bow = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 8, 24, Math.PI * 1.4), mat);
            bow.rotation.set(0, Math.PI / 2, 0);
            bow.position.set(0, 0, 0.2);
            this.weaponMount.add(bow);
        } else if (w.type === 'melee_aoe') {
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6),
                                         new THREE.MeshStandardMaterial({ color: 0x2a1010 }));
            shaft.rotation.x = Math.PI / 2;
            shaft.position.set(0, 0, 0.8);
            this.weaponMount.add(shaft);
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.18), mat);
            blade.position.set(0.4, 0, 1.4);
            blade.rotation.y = -0.5;
            this.weaponMount.add(blade);
        } else {
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.55), mat);
            blade.position.set(0, 0, 0.25); blade.castShadow = true;
            this.weaponMount.add(blade);
            const guard = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.06), mat);
            guard.position.set(0, 0, 0);
            this.weaponMount.add(guard);
        }
        this._weaponSpeed = (w && w.speed) || 1.0;
    }

    _buildNamePlate() {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 64;
        this._npCanvas = c;
        this._renderNamePlate();
        const tex = new THREE.CanvasTexture(c);
        tex.minFilter = THREE.LinearFilter;
        const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
        const spr = new THREE.Sprite(mat);
        spr.scale.set(2.4, 0.6, 1);
        spr.position.y = 2.5;
        this.group.add(spr);
        this._namePlate = spr;
        this._namePlateTex = tex;
    }

    _renderNamePlate() {
        const c = this._npCanvas;
        const g = c.getContext('2d');
        g.clearRect(0, 0, c.width, c.height);
        g.fillStyle = 'rgba(0,0,0,0.55)';
        g.fillRect(0, 18, c.width, 36);
        g.font = 'bold 28px "Cinzel", serif';
        g.textAlign = 'center';
        g.fillStyle = '#e9e3d4';
        g.shadowColor = '#000';
        g.shadowBlur = 4;
        g.fillText(this.name, c.width / 2, 44);
        if (this._namePlateTex) this._namePlateTex.needsUpdate = true;
    }

    /** Apply a network state snapshot. Position is interpolated over ~100ms. */
    applyState(state) {
        if (state.x !== undefined) this.targetPos.set(state.x, 0, state.z);
        if (state.facing !== undefined) this.targetFacing = state.facing;
        if (state.cls && state.cls !== this.weaponClass) {
            this.weaponClass = state.cls;
            const c = new THREE.Color(CLASS_COLOR[state.cls] || 0xa0a0a0);
            if (this._ring) this._ring.material.color.copy(c);
        }
        // Weapon swap — rebuild the mount mesh.
        if (state.weaponId && state.weaponId !== this.weaponId) {
            this.weaponId = state.weaponId;
            this._buildWeaponMesh();
        }
        // Swing kinds (server): 0 idle, 1 light, 2 heavy, 3 R-skill spin.
        // Latch a fresh swing animation on a 0→{1,2} transition.
        if (state.swing !== undefined) {
            const sw = state.swing | 0;
            const prev = this._lastSwing | 0;
            if (sw === 1 || sw === 2) {
                if (prev !== sw && this._swingTimer <= 0) {
                    const speed = this._weaponSpeed || 1.0;
                    this._swingDur = (sw === 2 ? 0.55 : 0.34) / speed;
                    this._swingTimer = this._swingDur;
                    this._swingHeavy = (sw === 2);
                }
            }
            this._spinning = (sw === 3);
            this._lastSwing = sw;
        }
        if (state.alive !== undefined) {
            const wasAlive = this.alive;
            this.alive = state.alive !== false;
            if (this.group) this.group.visible = this.alive;
            if (wasAlive && !this.alive && this._namePlate) {
                // Tint the name plate when dead — visible only on revive.
            }
        }
        this.lastUpdate = performance.now();
    }

    update(dt) {
        // Lerp position toward target
        this.position.x += (this.targetPos.x - this.position.x) * Math.min(1, dt * 12);
        this.position.z += (this.targetPos.z - this.position.z) * Math.min(1, dt * 12);

        // Spin overrides facing while R-skill is active.
        if (this._spinning) {
            this._spinAngle += dt * 12;
            this.facing = this._spinAngle;
        } else {
            let df = this.targetFacing - this.facing;
            while (df >  Math.PI) df -= Math.PI * 2;
            while (df < -Math.PI) df += Math.PI * 2;
            this.facing += df * Math.min(1, dt * 12);
            this._spinAngle = this.facing;
        }

        this.group.position.copy(this.position);
        this.group.rotation.y = this.facing;

        const t = performance.now() / 1000;
        const moving = Math.hypot(this.targetPos.x - this.position.x, this.targetPos.z - this.position.z) > 0.05;

        // Swing / spin / idle animations — class-specific so the off-hand
        // dagger flicks, the bow draws, etc., the same as Player.update.
        const base = this._weaponBaseTransform || { x: 0.48, y: 0.95, z: 0.10 };
        if (this._swingTimer > 0) {
            this._swingTimer -= dt;
            const totalDur = this._swingDur || 0.34;
            const tProg = 1 - Math.max(0, this._swingTimer / totalDur);
            const s = Math.sin(Math.PI * tProg);
            const cls = this.weaponClass || 'sword';
            if (this.weaponMount) {
                if (cls === 'sword') {
                    this.weaponMount.rotation.z = 0.7 - 1.7 * s;
                    this.weaponMount.rotation.x = -0.6 * s;
                    this.weaponMount.rotation.y = -0.3 * s;
                    this.rArm.rotation.x = -1.5 * s;
                    this.rArm.rotation.z = -0.5 * s;
                } else if (cls === 'dagger') {
                    this.weaponMount.position.set(base.x, base.y, base.z + 0.7 * s);
                    this.weaponMount.rotation.x = -0.3 * s;
                    this.rArm.rotation.x = -1.6 * s;
                    if (this.offhandMount) {
                        const phase = Math.sin(Math.PI * tProg + Math.PI / 2);
                        this.offhandMount.position.set(-base.x, base.y, base.z + 0.6 * Math.max(0, phase));
                        this.lArm.rotation.x = -1.4 * Math.max(0, phase);
                    }
                } else if (cls === 'bow') {
                    this.lArm.rotation.x = -1.0 * s;
                    this.lArm.position.z = -0.6 * s;
                    this.rArm.rotation.x = -0.5;
                    this.weaponMount.rotation.x = -0.1 * s;
                } else if (cls === 'scythe') {
                    this.weaponMount.rotation.y = 1.4 - 2.8 * s;
                    this.weaponMount.rotation.x = -0.2 * s;
                    this.rArm.rotation.x = -1.2 * s;
                    this.rArm.rotation.z = 0.6 * s;
                } else {
                    this.weaponMount.rotation.x = -1.6 * s;
                    this.rArm.rotation.x = -1.4 * s;
                }
            }
        } else if (this._spinning) {
            // R-skill spin: server already rotates the group via `facing`,
            // we just hold an attack-ready pose.
            this.rArm.rotation.x = -1.0 - Math.sin(t * 12) * 0.3;
            this.rArm.rotation.z = -0.4;
            this.lArm.rotation.x = -0.5 + Math.cos(t * 12) * 0.3;
            if (this.weaponMount) this.weaponMount.rotation.z = 0.4;
        } else {
            // Ease back to neutral pose.
            if (this.weaponMount) {
                this.weaponMount.rotation.x *= 0.78;
                this.weaponMount.rotation.y *= 0.78;
                this.weaponMount.rotation.z *= 0.78;
                this.weaponMount.position.x += (base.x - this.weaponMount.position.x) * 0.3;
                this.weaponMount.position.y += (base.y - this.weaponMount.position.y) * 0.3;
                this.weaponMount.position.z += (base.z - this.weaponMount.position.z) * 0.3;
            }
            if (this.offhandMount) {
                this.offhandMount.position.x += (-base.x - this.offhandMount.position.x) * 0.3;
                this.offhandMount.position.y += (base.y - this.offhandMount.position.y) * 0.3;
                this.offhandMount.position.z += (base.z - this.offhandMount.position.z) * 0.3;
            }
            const bob = moving ? Math.sin(t * 9) : 0;
            this.lArm.rotation.x = -bob * 0.4;
            this.rArm.rotation.x = bob * 0.4;
            this.rArm.rotation.z *= 0.78;
            this.lArm.rotation.z *= 0.78;
            this.lArm.position.z *= 0.78;
        }

        const bob = moving ? Math.sin(t * 9) : 0;
        this.lLeg.rotation.x = bob * 0.5;
        this.rLeg.rotation.x = -bob * 0.5;
    }

    dispose() {
        this.alive = false;
        this.scene.remove(this.group);
        this.group.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
                if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
                else o.material.dispose && o.material.dispose();
            }
        });
        if (this._namePlateTex) this._namePlateTex.dispose();
    }
}
