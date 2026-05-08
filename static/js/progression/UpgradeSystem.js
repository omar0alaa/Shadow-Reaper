// UpgradeSystem — picks 3 weighted random upgrades after each wave clear,
// applies the chosen one to the live Player.stats so it actually affects play.

const RARITY_WEIGHTS = { common: 70, rare: 25, epic: 5 };

export class UpgradeSystem {
    constructor(game) {
        this.game = game;
    }

    pool() {
        return this.game.upgradePool || [];
    }

    pickThree(wave) {
        const pool = this.pool();
        if (!pool.length) return [];
        // bias rarities up with wave
        const weights = { ...RARITY_WEIGHTS };
        if (wave >= 5) { weights.rare += 10; weights.common -= 10; }
        if (wave >= 10) { weights.epic += 8; weights.common -= 8; }
        if (wave >= 20) { weights.epic += 14; weights.rare += 6; weights.common -= 20; }
        const grouped = { common: [], rare: [], epic: [] };
        for (const u of pool) (grouped[u.rarity] || grouped.common).push(u);

        const draws = [];
        const used = new Set();
        for (let i = 0; i < 3; i++) {
            // pick rarity bucket
            const total = weights.common + weights.rare + weights.epic;
            let roll = Math.random() * total;
            let bucket = 'common';
            roll -= weights.common; if (roll <= 0) bucket = 'common';
            else { roll -= weights.rare; if (roll <= 0) bucket = 'rare'; else bucket = 'epic'; }
            const list = grouped[bucket].length ? grouped[bucket] : pool;
            // try a few times to avoid duplicates
            let pick = null;
            for (let t = 0; t < 8; t++) {
                const c = list[Math.floor(Math.random() * list.length)];
                if (!used.has(c.id)) { pick = c; break; }
            }
            if (!pick) pick = list[Math.floor(Math.random() * list.length)];
            used.add(pick.id);
            draws.push(pick);
        }
        return draws;
    }

    applyUpgrade(upgrade, fromLoad = false) {
        const p = this.game.player;
        if (!p) return;
        const s = p.stats;
        const v = upgrade.value;
        switch (upgrade.stat) {
            case 'crit_chance':   s.crit_chance = (s.crit_chance || 0) + v; break;
            case 'crit_damage':   s.crit_damage = (s.crit_damage || 1.5) + v; break;
            case 'max_health':
                p.maxHealth += v;
                if (!fromLoad) p.health += v;
                break;
            case 'lifesteal':     s.lifesteal = (s.lifesteal || 0) + v; break;
            case 'move_speed':    s.move_speed = (s.move_speed || 1) + v; break;
            case 'stamina_regen': s.stamina_regen = (s.stamina_regen || 1) + v; break;
            case 'combo_damage':  s.combo_damage = (s.combo_damage || 0) + v; break;
            case 'backstab_mult': s.backstab_mult = (s.backstab_mult || 1) + v; break;
            case 'dash_charges':  s.dash_charges = (s.dash_charges || 1) + v; break;
            case 'iframe_bonus':  s.iframe_bonus = (s.iframe_bonus || 0) + v; break;
            case 'energy_gain':   s.energy_gain = (s.energy_gain || 1) + v; break;
            case 'chain_lightning': s.chain_lightning = (s.chain_lightning || 0) + v; break;
            case 'smoke_damage':  s.smoke_damage = (s.smoke_damage || 0) + v; break;
            case 'poison_dash':   s.poison_dash = (s.poison_dash || 0) + v; break;
            case 'ricochet':      s.ricochet = (s.ricochet || 0) + v; break;
            case 'ult_duration':  s.ult_duration = (s.ult_duration || 0) + v; break;
            case 'explode_kills': s.explode_kills = (s.explode_kills || 0) + v; break;
            case 'execute_thresh':s.execute_thresh = Math.max(s.execute_thresh || 0, v); break;
            case 'extra_combo_hits': s.extra_combo_hits = (s.extra_combo_hits || 0) + v; break;
            case 'ult_dmg_mult':  s.ult_dmg_mult = (s.ult_dmg_mult || 0) + v; break;
        }
        if (!fromLoad) {
            this.game.runState.upgrades = this.game.runState.upgrades || [];
            this.game.runState.upgrades.push(upgrade);
            this.game.audio.levelup();
        }
    }
}
