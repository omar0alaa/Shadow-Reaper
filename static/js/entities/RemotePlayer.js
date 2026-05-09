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

        this.position = new THREE.Vector3(0, 0, 0);
        this.targetPos = new THREE.Vector3(0, 0, 0);
        this.facing = 0;
        this.targetFacing = 0;
        this.lastUpdate = performance.now();
        this.alive = true;
        this._swingTimer = 0;
        this._spinning = false;
        this._spinAngle = 0;

        this._buildMesh();
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

        // simple weapon stub colored by class
        const wpnMat = new THREE.MeshStandardMaterial({ color: tint, metalness: 0.7, roughness: 0.3 });
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.9), wpnMat);
        blade.position.set(0.48, 0.95, 0.55);
        this.group.add(blade);

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
        if (state.swing !== undefined) {
            if (state.swing === 1 && this._swingTimer < 0.15) this._swingTimer = 0.35;
            this._spinning = (state.swing === 2);
        }
        if (state.alive !== undefined) {
            const wasAlive = this.alive;
            this.alive = state.alive !== false;
            // Toggle visibility to match life state.
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

        // Swing animation latch (visible for ~0.35s after each swing event)
        if (this._swingTimer > 0) {
            this._swingTimer -= dt;
            const phase = 1 - Math.max(0, this._swingTimer / 0.35);
            const s = Math.sin(Math.PI * phase);
            this.rArm.rotation.x = -1.4 * s;
            this.rArm.rotation.z = -0.4 * s;
        } else if (this._spinning) {
            this.rArm.rotation.x = -1.0 - Math.sin(t * 12) * 0.3;
            this.rArm.rotation.z = -0.4;
            this.lArm.rotation.x = -0.5 + Math.cos(t * 12) * 0.3;
        } else {
            const bob = moving ? Math.sin(t * 9) : 0;
            this.lArm.rotation.x = -bob * 0.4;
            this.rArm.rotation.x = bob * 0.4;
            this.rArm.rotation.z = 0;
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
