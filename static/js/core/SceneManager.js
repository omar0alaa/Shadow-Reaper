// Three.js scene/camera/renderer/lighting + post-processing wrapper.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        offset:   { value: 1.05 },
        darkness: { value: 0.85 },
        chroma:   { value: 0.0 },
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float offset;
        uniform float darkness;
        uniform float chroma;
        varying vec2 vUv;
        void main() {
            vec2 uv = vUv;
            vec2 center = uv - 0.5;
            float aberr = chroma * length(center);
            vec3 col;
            col.r = texture2D(tDiffuse, uv + center * aberr).r;
            col.g = texture2D(tDiffuse, uv).g;
            col.b = texture2D(tDiffuse, uv - center * aberr).b;
            float vig = smoothstep(offset, offset - 0.6, length(center) * 1.4);
            col *= mix(1.0 - darkness * 0.4, 1.0, vig);
            gl_FragColor = vec4(col, 1.0);
        }`,
};

export class SceneManager {
    constructor(canvas) {
        this.canvas = canvas;

        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
        this.renderer.setSize(window.innerWidth, window.innerHeight, false);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.55;
        // r155+ uses physically-correct lighting by default; switch to the legacy
        // intensity scale so our hand-tuned values actually light the scene.
        if ('useLegacyLights' in this.renderer) this.renderer.useLegacyLights = true;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color('#1a1428');
        this.scene.fog = new THREE.FogExp2(0x241830, 0.010);

        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
        this.camera.position.set(0, 5, 8);

        this._buildLights();
        this._buildPost();
        this._shake = { time: 0, magnitude: 0 };

        window.addEventListener('resize', () => this.resize());
    }

    _buildLights() {
        this.ambient = new THREE.AmbientLight(0x9a8ab8, 0.95);
        this.scene.add(this.ambient);

        this.hemi = new THREE.HemisphereLight(0xb09ad8, 0x383040, 0.85);
        this.scene.add(this.hemi);

        // Soft key directional (moonlight)
        this.dir = new THREE.DirectionalLight(0xe0e8ff, 1.1);
        this.dir.position.set(20, 35, 12);
        this.dir.castShadow = true;
        this.dir.shadow.mapSize.set(1024, 1024);
        this.dir.shadow.camera.left = -45;
        this.dir.shadow.camera.right = 45;
        this.dir.shadow.camera.top = 45;
        this.dir.shadow.camera.bottom = -45;
        this.dir.shadow.camera.near = 1;
        this.dir.shadow.camera.far = 100;
        this.dir.shadow.bias = -0.0005;
        this.scene.add(this.dir);
    }

    _buildPost() {
        this.composer = new EffectComposer(this.renderer);
        this.composer.setPixelRatio(this.renderer.getPixelRatio());
        this.composer.setSize(window.innerWidth, window.innerHeight);

        this.renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(this.renderPass);

        this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.85, 0.18);
        this.composer.addPass(this.bloom);

        this.vignette = new ShaderPass(VignetteShader);
        this.vignette.renderToScreen = true;
        this.composer.addPass(this.vignette);
    }

    setUltimatePost(active) {
        this.vignette.uniforms.chroma.value = active ? 0.04 : 0.0;
        this.vignette.uniforms.darkness.value = active ? 1.4 : 0.85;
        this.bloom.strength = active ? 0.85 : 0.5;
    }

    setFog(color, density) {
        this.scene.fog.color.set(color);
        this.scene.fog.density = density;
        // Background slightly darker than fog so distant fog blends naturally
        this.scene.background = new THREE.Color(color).multiplyScalar(0.85);
    }

    resize() {
        const w = window.innerWidth, h = window.innerHeight;
        this.renderer.setSize(w, h, false);
        this.composer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    addShake(magnitude, time = 0.25) {
        this._shake.magnitude = Math.max(this._shake.magnitude, magnitude);
        this._shake.time = Math.max(this._shake.time, time);
    }

    applyShake(dt) {
        if (this._shake.time <= 0) return { x: 0, y: 0 };
        this._shake.time -= dt;
        const m = this._shake.magnitude * Math.max(0, this._shake.time / 0.25);
        const x = (Math.random() - 0.5) * m;
        const y = (Math.random() - 0.5) * m;
        if (this._shake.time <= 0) this._shake.magnitude = 0;
        return { x, y };
    }

    render() {
        this.composer.render();
    }
}
