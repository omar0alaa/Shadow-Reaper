// InventoryUI — Tab-toggle panel: weapon + stats + upgrades + skill descriptions.

// Per-class skill catalogue. Q + R are class-specific; E + F are universal.
const SKILL_BOOK = {
    sword: {
        Q: {
            name: 'Shadow Dash',
            desc: 'Forward dash with i-frames. Damages enemies you pass through. Costs stamina.',
            meta: 'CD 5s · 18 stamina',
        },
        R: {
            name: 'Whirlwind',
            desc: '1.5s spinning slash with a forward drift. Hits everything within sword range every 0.12s.',
            meta: 'CD 10s · medium AoE',
        },
    },
    dagger: {
        Q: {
            name: 'Phantom Step',
            desc: 'Quick forward dash with i-frames. Strikes enemies you pass through.',
            meta: 'CD 5s · 18 stamina',
        },
        R: {
            name: 'Blade Flurry',
            desc: '1.5s rapid-stab spin. Higher tick rate than other classes; bleed weapons stack on every hit.',
            meta: 'CD 10s · fast ticks',
        },
    },
    bow: {
        Q: {
            name: 'Shadow Roll',
            desc: 'Backstep with i-frames — kite enemies. Useful for opening distance before charged shots.',
            meta: 'CD 5s · 18 stamina',
        },
        R: {
            name: 'Arrow Storm',
            desc: 'Fires 24 arrows in a circle around you over 1.2s. Pierces if your bow has the trait.',
            meta: 'CD 10s · 360° barrage',
        },
    },
    scythe: {
        Q: {
            name: 'Soul Pull',
            desc: 'Dash forward and yank nearby non-boss enemies inward, setting them up for a wide swing.',
            meta: 'CD 5s · 18 stamina',
        },
        R: {
            name: 'Reaping Spin',
            desc: '1.5s wide AoE sweep. Bigger range than other R-skills; lifesteal-bearing scythes heal on every hit.',
            meta: 'CD 10s · widest AoE',
        },
    },
};

const COMMON_SKILLS = {
    E: {
        name: 'Smoke Bomb',
        desc: 'Drops a smoke cloud. You go stealthed for 3s — enemies lose target — and your next strike is a guaranteed crit.',
        meta: 'CD 12s',
    },
    F: {
        name: 'Reaper Time',
        desc: 'Slows enemies to 0.4× speed for 6s. Costs full Energy; refill by killing enemies.',
        meta: 'Ultimate · costs all Energy',
        ult: true,
    },
};

export class InventoryUI {
    constructor(game) {
        this.game = game;
        this.screen = document.getElementById('inventoryScreen');
        this.weapEl = document.getElementById('invWeapon');
        this.statsEl = document.getElementById('invStats');
        this.upEl = document.getElementById('invUpgrades');
        this.skillsEl = document.getElementById('invSkills');
    }

    show() {
        const p = this.game.player;
        if (!p) return;
        const w = this.game.weaponData[p.weaponId];
        const cls = p.weaponClass || 'sword';

        // Weapon card
        this.weapEl.innerHTML = w ? `
            <div class="invWeapon">
                <div class="swatch" style="background:${w.color};box-shadow:0 0 12px ${w.color}66"></div>
                <div>
                    <div class="wn" style="color:${w.color}">${w.name}</div>
                    <div class="wd rarity-${w.rarity}" style="text-transform:uppercase;letter-spacing:.15em;font-size:11px">${w.rarity}</div>
                    <div class="wd">${w.description}</div>
                    <div class="wd">DMG ${w.damage} · SPD ${w.speed} · RNG ${w.range}</div>
                </div>
            </div>
        ` : '<div class="wd">No weapon equipped</div>';

        // Stats
        const s = p.stats;
        const statRow = (label, val) => `<div class="invStat"><span>${label}</span><span>${val}</span></div>`;
        this.statsEl.innerHTML = [
            statRow('Max HP', `${Math.floor(p.maxHealth)}`),
            statRow('Crit Chance', `${Math.round((s.crit_chance||0)*100)}%`),
            statRow('Crit Damage', `${(s.crit_damage||1.5).toFixed(2)}x`),
            statRow('Lifesteal', `${Math.round((s.lifesteal||0)*100)}%`),
            statRow('Move Speed', `${Math.round((s.move_speed||1)*100)}%`),
            statRow('Combo Damage', `+${((s.combo_damage||0)*100).toFixed(1)}% per hit`),
            statRow('Backstab', `${(s.backstab_mult||1).toFixed(2)}x bonus`),
            statRow('Dash Charges', `${s.dash_charges||1}`),
            s.chain_lightning ? statRow('Chain Lightning', 'Active') : '',
            s.poison_dash ? statRow('Poison Dash', 'Active') : '',
            s.smoke_damage ? statRow('Toxic Smoke', 'Active') : '',
            s.ricochet ? statRow('Ricochet', `+${s.ricochet}`) : '',
            s.multishot ? statRow('Multishot', `+${s.multishot} arrows`) : '',
            s.explode_kills ? statRow('Soul Detonation', `${Math.round(s.explode_kills*100)}% HP`) : '',
            s.execute_thresh ? statRow('Execute', `Below ${Math.round(s.execute_thresh*100)}% HP`) : '',
        ].filter(Boolean).join('');

        // Upgrades
        const ups = (this.game.runState && this.game.runState.upgrades) || [];
        this.upEl.innerHTML = ups.length === 0
            ? '<div class="invUpg">None yet — survive a wave to choose your first.</div>'
            : ups.map(u => `<div class="invUpg ${u.rarity}"><b>${u.name}</b> — ${u.desc}</div>`).join('');

        // Skills (per-class Q + R, universal E + F)
        const book = SKILL_BOOK[cls] || SKILL_BOOK.sword;
        const rows = [
            this._skillRow('Q', book.Q),
            this._skillRow('E', COMMON_SKILLS.E),
            this._skillRow('R', book.R),
            this._skillRow('F', COMMON_SKILLS.F),
        ];
        if (this.skillsEl) this.skillsEl.innerHTML = rows.join('');

        this.screen.classList.remove('hidden');
    }

    _skillRow(key, info) {
        if (!info) return '';
        const ult = info.ult ? ' ult' : '';
        return `
            <div class="invSkill${ult}">
                <div class="invSkillKey">${key}</div>
                <div class="invSkillBody">
                    <div class="invSkillName">${info.name}</div>
                    <div class="invSkillDesc">${info.desc}</div>
                    ${info.meta ? `<div class="invSkillMeta">${info.meta}</div>` : ''}
                </div>
            </div>
        `;
    }

    hide() { this.screen.classList.add('hidden'); }
}
