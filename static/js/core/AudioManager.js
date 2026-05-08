// All sound is synthesized via WebAudio — no external files.
// Generates: swing, hit, hurt, dash, skill, ult, ui_click, ambient drone, music.

export class AudioManager {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.sfxGain = null;
        this.musicGain = null;
        this.musicTimer = null;
        this.ambient = null;
        this.settings = {
            master_volume: 0.7,
            sfx_volume: 0.8,
            music_volume: 0.5,
        };
    }

    ensure() {
        if (this.ctx) return;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.settings.master_volume;
        this.master.connect(this.ctx.destination);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = this.settings.sfx_volume;
        this.sfxGain.connect(this.master);
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = this.settings.music_volume;
        this.musicGain.connect(this.master);
    }

    resume() {
        this.ensure();
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    applySettings(s) {
        this.settings.master_volume = s.master_volume ?? 0.7;
        this.settings.sfx_volume = s.sfx_volume ?? 0.8;
        this.settings.music_volume = s.music_volume ?? 0.5;
        if (this.master) this.master.gain.value = this.settings.master_volume;
        if (this.sfxGain) this.sfxGain.gain.value = this.settings.sfx_volume;
        if (this.musicGain) this.musicGain.gain.value = this.settings.music_volume;
    }

    _envOsc(type, freqStart, freqEnd, dur, gain = 0.4, target = null) {
        if (!this.ctx) return;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freqStart, this.ctx.currentTime);
        o.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 0.01), this.ctx.currentTime + dur);
        g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(gain, this.ctx.currentTime + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
        o.connect(g);
        g.connect(target || this.sfxGain);
        o.start();
        o.stop(this.ctx.currentTime + dur + 0.02);
    }

    _noiseBurst(dur, freq = 1500, q = 1, gain = 0.3, target = null) {
        if (!this.ctx) return;
        const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
        const d = buffer.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = freq;
        filter.Q.value = q;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(gain, this.ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
        src.connect(filter); filter.connect(g); g.connect(target || this.sfxGain);
        src.start();
        src.stop(this.ctx.currentTime + dur + 0.05);
    }

    swing()   { this.ensure(); this._noiseBurst(0.18, 2200, 4, 0.18); }
    heavySwing() { this.ensure(); this._noiseBurst(0.32, 1100, 2.5, 0.28); }
    hit()     { this.ensure(); this._envOsc('square', 220, 80, 0.13, 0.32); this._noiseBurst(0.08, 4200, 1, 0.18); }
    crit()    { this.ensure(); this._envOsc('triangle', 880, 180, 0.18, 0.4); this._noiseBurst(0.1, 6500, 1.2, 0.22); }
    hurt()    { this.ensure(); this._envOsc('square', 320, 110, 0.18, 0.28); }
    enemyHurt() { this.ensure(); this._envOsc('square', 540, 220, 0.12, 0.18); }
    dash()    { this.ensure(); this._noiseBurst(0.22, 700, 0.6, 0.32); this._envOsc('sine', 220, 880, 0.18, 0.18); }
    skill()   { this.ensure(); this._envOsc('triangle', 700, 1400, 0.18, 0.22); this._envOsc('sine', 1200, 600, 0.16, 0.14); }
    ult()     { this.ensure(); this._envOsc('sine', 80, 40, 0.6, 0.5); this._envOsc('triangle', 660, 220, 0.4, 0.3); this._noiseBurst(0.3, 200, 0.4, 0.2); }
    bowShot() { this.ensure(); this._envOsc('sawtooth', 1200, 280, 0.18, 0.22); }
    arrowHit(){ this.ensure(); this._envOsc('square', 600, 200, 0.1, 0.22); }
    pickup()  { this.ensure(); this._envOsc('triangle', 660, 1320, 0.2, 0.22); }
    levelup() { this.ensure(); this._envOsc('triangle', 440, 1320, 0.4, 0.25); this._envOsc('sine', 880, 1760, 0.4, 0.18); }
    bossRoar(){ this.ensure(); this._envOsc('sawtooth', 110, 60, 0.9, 0.4); this._noiseBurst(0.6, 240, 0.3, 0.2); }
    death()   { this.ensure(); this._envOsc('sine', 220, 40, 1.5, 0.4); }
    uiClick() { this.ensure(); this._envOsc('square', 880, 880, 0.04, 0.1); }
    uiHover() { this.ensure(); this._envOsc('triangle', 1200, 1200, 0.03, 0.05); }

    startAmbient() {
        this.ensure();
        if (!this.ctx || this.ambient) return;
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        lfo.frequency.value = 0.08;
        lfoGain.gain.value = 6;
        lfo.connect(lfoGain);

        const o1 = this.ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 55;
        const o2 = this.ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 82.41;
        const o3 = this.ctx.createOscillator(); o3.type = 'sine'; o3.frequency.value = 110;

        lfoGain.connect(o1.frequency);
        lfoGain.connect(o2.frequency);

        const drone = this.ctx.createGain();
        drone.gain.value = 0.0;
        drone.gain.linearRampToValueAtTime(0.10, this.ctx.currentTime + 1.5);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1200;

        o1.connect(filter); o2.connect(filter); o3.connect(filter);
        filter.connect(drone); drone.connect(this.musicGain);

        lfo.start(); o1.start(); o2.start(); o3.start();
        this.ambient = { lfo, o1, o2, o3, drone, filter };

        // procedural minor-key arpeggio sequencer
        const scale = [220, 261.63, 311.13, 349.23, 415.30, 466.16, 523.25];
        let i = 0;
        const step = () => {
            if (!this.ambient) return;
            const n = scale[(i++) % scale.length];
            const o = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            o.type = 'sine';
            o.frequency.value = n;
            g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.07, this.ctx.currentTime + 0.05);
            g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.6);
            o.connect(g); g.connect(this.musicGain);
            o.start();
            o.stop(this.ctx.currentTime + 0.7);
            this.musicTimer = setTimeout(step, 380 + Math.random() * 80);
        };
        this.musicTimer = setTimeout(step, 1200);
    }

    stopAmbient() {
        if (this.musicTimer) { clearTimeout(this.musicTimer); this.musicTimer = null; }
        if (this.ambient) {
            try {
                const a = this.ambient;
                a.drone.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.4);
                setTimeout(() => { try { a.lfo.stop(); a.o1.stop(); a.o2.stop(); a.o3.stop(); } catch(e){} }, 500);
            } catch (e) { /* ignore */ }
            this.ambient = null;
        }
    }
}
