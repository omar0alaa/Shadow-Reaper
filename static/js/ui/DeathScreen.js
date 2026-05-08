// DeathScreen — show run summary.

export class DeathScreen {
    constructor(game) {
        this.game = game;
        this.screen = document.getElementById('deathScreen');
        this.summary = document.getElementById('deathSummary');
    }

    show(summary) {
        const wd = this.game.weaponData;
        const weaponNames = (summary.weapons_found || []).map(id => (wd[id]?.name) || id).join(', ');
        this.summary.innerHTML = `
            <div><b>Waves Cleared:</b> ${summary.waves_cleared}</div>
            <div><b>Enemies Slain:</b> ${summary.enemies_killed}</div>
            <div><b>Damage Dealt:</b> ${summary.damage_dealt}</div>
            <div><b>Weapons Found:</b> ${weaponNames || '—'}</div>
        `;
        this.screen.classList.remove('hidden');
    }

    hide() { this.screen.classList.add('hidden'); }
}
