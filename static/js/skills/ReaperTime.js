// ReaperTime — F. Ultimate. Slow time for enemies. Costs full energy. Lasts 6s + upgrades.

export class ReaperTime {
    constructor(player) {
        this.player = player;
        this.game = player.game;
        this.cd = 0;
        this.active = false;
        this.timer = 0;
        this.maxCd = 0;        // gated by energy, not raw CD
    }

    get cooldownPct() {
        // Visualize as energy fill (inverted).
        const e = this.player.energy / this.player.maxEnergy;
        return Math.max(0, 1 - e);
    }
    get key() { return 'F'; }
    get ready() { return !this.active && this.player.energy >= this.player.maxEnergy; }

    activate() {
        if (this.active) return;
        if (this.player.energy < this.player.maxEnergy) return;
        this.player.energy = 0;
        this.timer = 6.0 + (this.player.stats.ult_duration || 0);
        this.active = true;
        this.player.ultActive = true;
        this.game.enemyTimeScale = 0.4;
        this.game.timeScale = 1.0;
        this.game.scene.setUltimatePost(true);
        this.game.audio.ult();
        this.game.scene.addShake(0.4, 0.5);
        this.game.hud.toast('REAPER TIME');
    }

    update(dt, rawDt) {
        if (!this.active) return;
        // Use raw dt because we slowed enemy time but not the timer.
        this.timer -= rawDt;
        if (this.timer <= 0) {
            this.active = false;
            this.player.ultActive = false;
            this.game.enemyTimeScale = 1.0;
            this.game.scene.setUltimatePost(false);
        }
    }
}
