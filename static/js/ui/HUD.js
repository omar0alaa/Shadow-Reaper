// HUD — bars, skill cooldowns, wave counter, boss bar, toasts, combo, countdown.

export class HUD {
    constructor(game) {
        this.game = game;
        this.healthBar = document.getElementById('healthBar');
        this.healthText = document.getElementById('healthText');
        this.staminaBar = document.getElementById('staminaBar');
        this.energyBar = document.getElementById('energyBar');
        this.waveBanner = document.getElementById('waveBanner');
        this.waveSub = document.getElementById('waveSub');
        this.bossWrap = document.getElementById('bossBarWrap');
        this.bossBar = document.getElementById('bossBar');
        this.bossName = document.getElementById('bossName');
        this.comboEl = document.getElementById('comboDisplay');
        this.countdownEl = document.getElementById('waveCountdown');
        this.cd = {
            Q: document.getElementById('cdQ'),
            E: document.getElementById('cdE'),
            R: document.getElementById('cdR'),
            F: document.getElementById('cdF'),
        };
        this._curBoss = null;
        this._lerp = { hp: 1, st: 1, en: 0 };
        this._lastCombo = 0;
    }

    toast(text) {
        const el = document.getElementById('toast');
        el.textContent = text;
        el.classList.remove('hidden');
        // Restart animation by cloning
        const clone = el.cloneNode(true);
        el.parentNode.replaceChild(clone, el);
        clone.id = 'toast';
        setTimeout(() => clone.classList.add('hidden'), 2200);
    }

    showBoss(boss) {
        this._curBoss = boss;
        this.bossWrap.classList.remove('hidden');
        this.bossName.textContent = boss.name.toUpperCase();
    }
    hideBoss() {
        this._curBoss = null;
        this.bossWrap.classList.add('hidden');
    }

    update(dt) {
        const g = this.game;
        if (!g.player) return;
        const p = g.player;
        // smooth lerps
        const hpTarget = Math.max(0, p.health / p.maxHealth);
        this._lerp.hp += (hpTarget - this._lerp.hp) * Math.min(1, dt * 6);
        const stTarget = p.stamina / p.maxStamina;
        this._lerp.st += (stTarget - this._lerp.st) * Math.min(1, dt * 8);
        const enTarget = p.energy / p.maxEnergy;
        this._lerp.en += (enTarget - this._lerp.en) * Math.min(1, dt * 8);

        this.healthBar.style.width = (this._lerp.hp * 100).toFixed(1) + '%';
        this.staminaBar.style.width = (this._lerp.st * 100).toFixed(1) + '%';
        this.energyBar.style.width = (this._lerp.en * 100).toFixed(1) + '%';
        this.healthText.textContent = `${Math.ceil(p.health)} / ${Math.floor(p.maxHealth)}`;

        // wave info
        const aliveEnemies = g.enemies.filter(e => e.alive).length;
        if (g.waveData && g.waveData.is_boss_wave) {
            this.waveBanner.textContent = `WAVE ${g.wave} — BOSS`;
        } else if (g.waveData && g.waveData.is_miniboss_wave) {
            this.waveBanner.textContent = `WAVE ${g.wave} — MINI BOSS`;
        } else {
            this.waveBanner.textContent = `WAVE ${g.wave}`;
        }
        this.waveSub.textContent = `Enemies: ${aliveEnemies}`;

        // boss bar
        if (this._curBoss) {
            if (!this._curBoss.alive) { this.hideBoss(); }
            else this.bossBar.style.width = ((this._curBoss.health / this._curBoss.maxHealth) * 100).toFixed(1) + '%';
        }

        // Combo multiplier display
        const combo = p.comboCount || 0;
        if (this.comboEl) {
            if (combo >= 2) {
                const comboDmgBonus = p.stats.combo_damage || 0;
                const bonusPct = Math.round(combo * comboDmgBonus * 100);
                this.comboEl.classList.remove('hidden');
                this.comboEl.querySelector('#comboCount').textContent = `×${combo}`;
                this.comboEl.querySelector('#comboBonus').textContent =
                    comboDmgBonus > 0 ? `+${bonusPct}% DMG` : 'COMBO';
                // Pulse animation when combo increments
                if (combo !== this._lastCombo) {
                    this.comboEl.classList.remove('combo-pulse');
                    void this.comboEl.offsetWidth; // reflow to restart animation
                    this.comboEl.classList.add('combo-pulse');
                }
            } else {
                this.comboEl.classList.add('hidden');
            }
        }
        this._lastCombo = combo;

        // skill cooldowns
        for (const k of ['Q', 'E', 'R', 'F']) {
            const sk = p.skills[k];
            const pct = sk.cooldownPct;
            this._setCooldownSweep(this.cd[k], pct);
            const parent = this.cd[k].parentElement;
            parent.style.opacity = sk.ready ? 1 : 0.85;
            parent.style.filter = sk.ready ? 'none' : 'grayscale(.4)';
        }
    }

    showCountdown(remaining) {
        if (!this.countdownEl) return;
        this.countdownEl.classList.remove('hidden');
        const secs = Math.ceil(remaining);
        this.countdownEl.textContent = `Upgrade in ${secs}…`;
    }

    hideCountdown() {
        if (!this.countdownEl) return;
        this.countdownEl.classList.add('hidden');
    }

    _setCooldownSweep(el, pct) {
        // pct 1 = full overlay; 0 = clear
        const deg = pct * 360;
        el.style.background = `conic-gradient(rgba(0,0,0,.85) 0deg, rgba(0,0,0,.85) ${deg}deg, transparent ${deg}deg)`;
    }
}
