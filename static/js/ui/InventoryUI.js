// InventoryUI — Tab-toggle panel with weapon, stats, upgrades.

export class InventoryUI {
    constructor(game) {
        this.game = game;
        this.screen = document.getElementById('inventoryScreen');
        this.weapEl = document.getElementById('invWeapon');
        this.statsEl = document.getElementById('invStats');
        this.upEl = document.getElementById('invUpgrades');
    }

    show() {
        const p = this.game.player;
        if (!p) return;
        const w = this.game.weaponData[p.weaponId];
        this.weapEl.innerHTML = w ? `
            <div class="invWeapon">
                <div class="swatch" style="background:${w.color};box-shadow:0 0 12px ${w.color}66"></div>
                <div>
                    <div class="wn" style="color:${w.color}">${w.name}</div>
                    <div class="wd" style="text-transform:uppercase;letter-spacing:.15em;font-size:11px;color:${w.color}">${w.rarity}</div>
                    <div class="wd">${w.description}</div>
                    <div class="wd">DMG ${w.damage} · SPD ${w.speed} · RNG ${w.range}</div>
                </div>
            </div>
        ` : '<div class="wd">No weapon equipped</div>';

        const s = p.stats;
        const statRow = (label, val) => `<div class="invStat"><span>${label}</span><span>${val}</span></div>`;
        this.statsEl.innerHTML = [
            statRow('Max HP', `${Math.floor(p.maxHealth)}`),
            statRow('Crit Chance', `${Math.round((s.crit_chance||0)*100)}%`),
            statRow('Crit Damage', `${(s.crit_damage||1.5).toFixed(2)}x`),
            statRow('Lifesteal', `${Math.round((s.lifesteal||0)*100)}%`),
            statRow('Move Speed', `${Math.round((s.move_speed||1)*100)}%`),
            statRow('Combo Damage', `+${Math.round((s.combo_damage||0)*100)}% per hit`),
            statRow('Backstab', `${(s.backstab_mult||1).toFixed(2)}x bonus`),
            statRow('Dash Charges', `${s.dash_charges||1}`),
            s.chain_lightning ? statRow('Chain Lightning', 'Active') : '',
            s.poison_dash ? statRow('Poison Dash', 'Active') : '',
            s.smoke_damage ? statRow('Toxic Smoke', 'Active') : '',
            s.ricochet ? statRow('Ricochet', `+${s.ricochet}`) : '',
            s.explode_kills ? statRow('Soul Detonation', `${Math.round(s.explode_kills*100)}% HP`) : '',
            s.execute_thresh ? statRow('Execute', `Below ${Math.round(s.execute_thresh*100)}% HP`) : '',
        ].join('');

        const ups = (this.game.runState && this.game.runState.upgrades) || [];
        this.upEl.innerHTML = ups.length === 0
            ? '<div class="invUpg">None yet — survive a wave to choose your first.</div>'
            : ups.map(u => `<div class="invUpg ${u.rarity}"><b>${u.name}</b> — ${u.desc}</div>`).join('');

        this.screen.classList.remove('hidden');
    }

    hide() { this.screen.classList.add('hidden'); }
}
