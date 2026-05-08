// Arena.js — builds the 3D arena from server-provided layout.
// Generates all geometry/textures procedurally (no external textures).

import * as THREE from 'three';

function makeStoneTexture(seed = 1, size = 512) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#2a2530';
    g.fillRect(0, 0, size, size);

    // base noise wash
    const img = g.getImageData(0, 0, size, size);
    let s = seed;
    const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s & 0xffff) / 0xffff; };
    for (let i = 0; i < img.data.length; i += 4) {
        const n = rand();
        const v = 26 + Math.floor(n * 60);
        img.data[i]     = v + Math.floor(rand() * 8);
        img.data[i + 1] = v - 4 + Math.floor(rand() * 8);
        img.data[i + 2] = v + Math.floor(rand() * 12);
        img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);

    // cracks
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 1;
    for (let i = 0; i < 18; i++) {
        const x = rand() * size;
        const y = rand() * size;
        g.beginPath();
        g.moveTo(x, y);
        let cx = x, cy = y;
        const segs = 6 + Math.floor(rand() * 6);
        for (let j = 0; j < segs; j++) {
            cx += (rand() - 0.5) * 50;
            cy += (rand() - 0.5) * 50;
            g.lineTo(cx, cy);
        }
        g.stroke();
    }
    // moss highlights
    for (let i = 0; i < 80; i++) {
        const x = rand() * size, y = rand() * size;
        const r = 4 + rand() * 14;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, 'rgba(40,80,40,0.18)');
        grd.addColorStop(1, 'rgba(40,80,40,0.0)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}


export class Arena {
    constructor(scene, data) {
        this.scene = scene;
        this.data = data;
        this.group = new THREE.Group();
        scene.add(this.group);

        this.radius = data.radius;
        this.colliders = []; // { x, z, r } cylinder colliders for props
        this.braziers = [];

        this._buildFloor();
        this._buildWalls();
        this._buildProps();
        this._buildSky();
    }

    _buildFloor() {
        const tex = makeStoneTexture(this.data.seed || 1, 512);
        tex.repeat.set(this.radius * 0.8, this.radius * 0.8);
        const mat = new THREE.MeshStandardMaterial({
            map: tex, color: 0xa098b0, roughness: 0.85, metalness: 0.05,
        });
        const geo = new THREE.CircleGeometry(this.radius, 64);
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        this.group.add(mesh);

        // Subtle inner ring stripe
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(this.radius * 0.96, this.radius, 64),
            new THREE.MeshBasicMaterial({ color: 0x150a18, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.01;
        this.group.add(ring);
    }

    _buildWalls() {
        const tex = makeStoneTexture((this.data.seed || 1) ^ 0xabcdef, 512);
        tex.repeat.set(8, 2);
        const mat = new THREE.MeshStandardMaterial({
            map: tex, color: 0x807890, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide,
        });
        const wallH = 6.5;
        const segments = 64;
        const geo = new THREE.CylinderGeometry(this.radius, this.radius, wallH, segments, 1, true);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = wallH / 2;
        mesh.receiveShadow = true;
        this.group.add(mesh);
    }

    _buildProps() {
        const stoneTex = makeStoneTexture((this.data.seed || 7) ^ 0x55aa, 256);
        stoneTex.repeat.set(2, 4);

        for (const p of this.data.props) {
            switch (p.type) {
                case 'pillar':   this._addPillar(p, stoneTex); break;
                case 'wall':     this._addRuinedWall(p, stoneTex); break;
                case 'brazier':  this._addBrazier(p); break;
                case 'statue':   this._addStatue(p, stoneTex); break;
            }
        }
    }

    _addPillar(p, tex) {
        const h = 5 * p.scale;
        const r = 0.6;
        const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0x554f5e, roughness: 0.95 });
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, h, 16), mat);
        cyl.position.set(p.x, h / 2, p.z);
        cyl.castShadow = true; cyl.receiveShadow = true;
        cyl.rotation.y = p.rot;
        this.group.add(cyl);

        // capital
        const cap = new THREE.Mesh(new THREE.BoxGeometry(r * 2.2, 0.4, r * 2.2), mat);
        cap.position.set(p.x, h + 0.2, p.z);
        cap.castShadow = true;
        this.group.add(cap);

        this.colliders.push({ x: p.x, z: p.z, r: r * 1.2 });
    }

    _addRuinedWall(p, tex) {
        const w = 3 * p.scale, h = 2 + p.scale;
        const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0x4a444f, roughness: 0.95 });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.5), mat);
        mesh.position.set(p.x, h / 2, p.z);
        mesh.rotation.y = p.rot;
        mesh.castShadow = true; mesh.receiveShadow = true;
        this.group.add(mesh);

        this.colliders.push({ x: p.x, z: p.z, r: w * 0.5 });
    }

    _addBrazier(p) {
        const grp = new THREE.Group();
        grp.position.set(p.x, 0, p.z);

        const stoneMat = new THREE.MeshStandardMaterial({ color: 0x2a2530, roughness: 0.95 });
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, 0.4, 12), stoneMat);
        base.position.y = 0.2; base.castShadow = true;
        grp.add(base);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.2, 8), stoneMat);
        stem.position.y = 0.4 + 0.6;
        stem.castShadow = true;
        grp.add(stem);
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.35, 0.35, 12), new THREE.MeshStandardMaterial({ color: 0x1c1a22, roughness: 0.9 }));
        bowl.position.y = 0.4 + 1.2 + 0.18;
        bowl.castShadow = true;
        grp.add(bowl);

        // Flame: small emissive cone with vertical jitter (animated)
        const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9 });
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.9, 8), flameMat);
        flame.position.y = bowl.position.y + 0.55;
        grp.add(flame);

        const light = new THREE.PointLight(0xffa050, 2.6, 28, 1.0);
        light.position.set(0, bowl.position.y + 0.6, 0);
        light.castShadow = false;
        grp.add(light);

        this.group.add(grp);
        this.braziers.push({ group: grp, light, flame, base: light.intensity, t: Math.random() * Math.PI * 2 });
        this.colliders.push({ x: p.x, z: p.z, r: 0.7 });
    }

    _addStatue(p, tex) {
        const grp = new THREE.Group();
        grp.position.set(p.x, 0, p.z);
        grp.rotation.y = p.rot;
        const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0x6a6275, roughness: 0.95 });
        // pedestal
        const ped = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 1.6), mat);
        ped.position.y = 0.3; ped.castShadow = true; ped.receiveShadow = true;
        grp.add(ped);
        // body
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 2.2, 12), mat);
        body.position.y = 0.6 + 1.1; body.castShadow = true;
        grp.add(body);
        // head
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), mat);
        head.position.y = 0.6 + 2.3 + 0.3; head.castShadow = true;
        grp.add(head);
        // glowing eyes
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff4040 });
        const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eyeMat);
        const e2 = e1.clone();
        e1.position.set(-0.13, head.position.y + 0.05, 0.35);
        e2.position.set(0.13, head.position.y + 0.05, 0.35);
        grp.add(e1); grp.add(e2);

        this.group.add(grp);
        this.colliders.push({ x: p.x, z: p.z, r: 0.9 });
    }

    _buildSky() {
        // Subtle dome of stars/dust to give depth above (nothing too bright)
        const geo = new THREE.SphereGeometry(95, 32, 24);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x040308, side: THREE.BackSide,
        });
        this.sky = new THREE.Mesh(geo, mat);
        this.group.add(this.sky);
    }

    update(dt, t) {
        // flicker braziers
        for (const b of this.braziers) {
            b.t += dt * (4 + Math.random() * 2);
            const flick = 1 + Math.sin(b.t * 7.3) * 0.05 + (Math.random() - 0.5) * 0.18;
            b.light.intensity = b.base * flick;
            b.flame.scale.set(1 + (Math.random() - 0.5) * 0.1, 1 + Math.sin(b.t * 9) * 0.15, 1);
        }
    }

    /** Slide-collision against arena bounds + props. Returns { x, z } adjusted. */
    resolveCollision(x, z, r = 0.4) {
        // Arena outer ring
        const dist = Math.hypot(x, z);
        const max = this.radius - 0.5;
        if (dist > max) {
            const a = Math.atan2(z, x);
            x = Math.cos(a) * max;
            z = Math.sin(a) * max;
        }
        // Prop colliders
        for (const c of this.colliders) {
            const dx = x - c.x, dz = z - c.z;
            const d = Math.hypot(dx, dz);
            const minD = c.r + r;
            if (d < minD && d > 0.001) {
                const n = minD / d;
                x = c.x + dx * n;
                z = c.z + dz * n;
            }
        }
        return { x, z };
    }

    dispose() {
        this.scene.remove(this.group);
        this.group.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
                if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
                else o.material.dispose();
            }
        });
    }
}
