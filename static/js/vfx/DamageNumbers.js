// DamageNumbers — float floating numbers in 3D, projected to CSS overlay.

import * as THREE from 'three';

export class DamageNumbers {
    constructor(camera) {
        this.camera = camera;
        this.layer = document.getElementById('damageNumbers');
        this.entries = [];
    }

    spawn(worldPos, value, opts = {}) {
        const el = document.createElement('div');
        el.className = `dmgNum ${opts.kind || ''}`;
        el.textContent = (opts.kind === 'crit') ? `${value}!` : `${value}`;
        this.layer.appendChild(el);
        const e = { el, world: worldPos.clone(), born: performance.now() };
        this.entries.push(e);
        // auto-remove after CSS animation length
        setTimeout(() => {
            try { el.remove(); } catch(e){}
        }, 900);
    }

    update() {
        const now = performance.now();
        const remaining = [];
        for (const e of this.entries) {
            if (now - e.born > 900) continue;
            const v = e.world.clone();
            v.project(this.camera);
            const x = (v.x * 0.5 + 0.5) * window.innerWidth;
            const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
            // hide if behind camera
            if (v.z > 1 || v.z < -1) {
                e.el.style.display = 'none';
            } else {
                e.el.style.display = '';
                e.el.style.left = x + 'px';
                e.el.style.top = y + 'px';
            }
            remaining.push(e);
        }
        this.entries = remaining;
    }
}
