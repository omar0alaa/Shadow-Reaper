// PostProcessing — tiny helper to flip ultimate-mode chroma/vignette knobs.
// (The actual passes live on SceneManager so they can share a single composer.)

export class PostProcessing {
    constructor(sceneManager) { this.sm = sceneManager; }
    setUltimate(active) { this.sm.setUltimatePost(active); }
    flash(intensity = 1) {
        if (!this.sm) return;
        const u = this.sm.vignette.uniforms.darkness;
        u.value = 1.25 + intensity * 0.6;
        setTimeout(() => { u.value = 1.25; }, 90);
    }
}
