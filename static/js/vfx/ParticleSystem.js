// ParticleSystem — pooled additive particles for sparks, smoke, blood, shadow trails, etc.

import * as THREE from 'three';

const MAX_PARTICLES = 700;

function makeRoundTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.minFilter = THREE.LinearFilter;
    return t;
}

export class ParticleSystem {
    constructor(scene) {
        this.scene = scene;
        this.particles = [];
        this._pool = [];
        this._tex = makeRoundTexture();

        this.geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(MAX_PARTICLES * 3);
        const colors = new Float32Array(MAX_PARTICLES * 3);
        const sizes = new Float32Array(MAX_PARTICLES);
        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        this.geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        this.material = new THREE.PointsMaterial({
            map: this._tex,
            size: 0.5,
            sizeAttenuation: true,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            vertexColors: true,
        });
        this.points = new THREE.Points(this.geometry, this.material);
        this.points.frustumCulled = false;
        this.scene.add(this.points);
        this.geometry.setDrawRange(0, 0);

        // line layer for chain lightning
        this.lineLayers = [];
    }

    _alloc() {
        if (this.particles.length >= MAX_PARTICLES) {
            // recycle the oldest
            return this.particles.shift();
        }
        const p = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1, life: 0, maxLife: 1, size: 0.5, gravity: 0 };
        this.particles.push(p);
        return p;
    }

    spawnSmall(pos, color, size = 0.5) {
        const p = this._alloc();
        const c = new THREE.Color(color);
        p.x = pos.x; p.y = pos.y; p.z = pos.z;
        p.vx = (Math.random() - 0.5) * 0.5;
        p.vy = (Math.random() - 0.2) * 0.4;
        p.vz = (Math.random() - 0.5) * 0.5;
        p.r = c.r; p.g = c.g; p.b = c.b;
        p.life = 0.4 + Math.random() * 0.3;
        p.maxLife = p.life;
        p.size = size;
        p.gravity = 0;
    }

    spawnSparks(pos, color, count = 8) {
        const c = new THREE.Color(color);
        for (let i = 0; i < count; i++) {
            const p = this._alloc();
            p.x = pos.x; p.y = pos.y; p.z = pos.z;
            const s = 4 + Math.random() * 4;
            const a = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI;
            p.vx = Math.cos(a) * Math.sin(phi) * s;
            p.vy = Math.cos(phi) * s * 0.6 + 1.5;
            p.vz = Math.sin(a) * Math.sin(phi) * s;
            p.r = c.r; p.g = c.g; p.b = c.b;
            p.life = 0.4 + Math.random() * 0.4;
            p.maxLife = p.life;
            p.size = 0.32 + Math.random() * 0.18;
            p.gravity = -8;
        }
    }

    spawnBurst(pos, color, count = 18, force = 4) {
        const c = new THREE.Color(color);
        for (let i = 0; i < count; i++) {
            const p = this._alloc();
            p.x = pos.x; p.y = pos.y; p.z = pos.z;
            const a = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI;
            const s = (0.4 + Math.random()) * force;
            p.vx = Math.cos(a) * Math.sin(phi) * s;
            p.vy = Math.cos(phi) * s + Math.random() * 1.5;
            p.vz = Math.sin(a) * Math.sin(phi) * s;
            p.r = c.r; p.g = c.g; p.b = c.b;
            p.life = 0.6 + Math.random() * 0.5;
            p.maxLife = p.life;
            p.size = 0.5 + Math.random() * 0.3;
            p.gravity = -3;
        }
    }

    spawnSmoke(pos, color, count = 6) {
        const c = new THREE.Color(color);
        for (let i = 0; i < count; i++) {
            const p = this._alloc();
            p.x = pos.x + (Math.random() - 0.5) * 0.6;
            p.y = pos.y + (Math.random() - 0.5) * 0.4;
            p.z = pos.z + (Math.random() - 0.5) * 0.6;
            p.vx = (Math.random() - 0.5) * 0.6;
            p.vy = 0.4 + Math.random() * 0.6;
            p.vz = (Math.random() - 0.5) * 0.6;
            p.r = c.r; p.g = c.g; p.b = c.b;
            p.life = 1.2 + Math.random() * 0.9;
            p.maxLife = p.life;
            p.size = 1.4 + Math.random() * 0.8;
            p.gravity = 0.6; // floats up
        }
    }

    spawnLine(a, b, color = '#80ddff') {
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(6);
        pos[0] = a.x; pos[1] = a.y; pos[2] = a.z;
        pos[3] = b.x; pos[4] = b.y; pos[5] = b.z;
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending, depthWrite: false });
        const line = new THREE.Line(geo, mat);
        this.scene.add(line);
        this.lineLayers.push({ line, life: 0.18, mat, geo });
    }

    update(dt) {
        if (dt <= 0) {
            // still update sizing/draw range
        }
        // step particles
        const pos = this.geometry.attributes.position.array;
        const col = this.geometry.attributes.color.array;
        const siz = this.geometry.attributes.size.array;
        let count = 0;
        const survivors = [];
        for (const p of this.particles) {
            p.life -= dt;
            if (p.life <= 0) continue;
            p.vy += p.gravity * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;
            const k = Math.max(0, p.life / p.maxLife);
            const idx = count * 3;
            pos[idx] = p.x; pos[idx + 1] = p.y; pos[idx + 2] = p.z;
            col[idx] = p.r * k; col[idx + 1] = p.g * k; col[idx + 2] = p.b * k;
            siz[count] = p.size * k;
            survivors.push(p);
            count++;
            if (count >= MAX_PARTICLES) break;
        }
        this.particles = survivors;
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
        this.geometry.attributes.size.needsUpdate = true;
        this.geometry.setDrawRange(0, count);

        // line layers (chain lightning fade)
        for (const layer of this.lineLayers) {
            layer.life -= dt;
            layer.mat.opacity = Math.max(0, layer.life / 0.18);
        }
        this.lineLayers = this.lineLayers.filter(l => {
            if (l.life > 0) return true;
            this.scene.remove(l.line);
            l.geo.dispose();
            l.mat.dispose();
            return false;
        });
    }
}
