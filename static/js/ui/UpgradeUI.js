// UpgradeUI — renders 3 upgrade cards after each wave clear.

export class UpgradeUI {
    constructor(game) {
        this.game = game;
        this.screen = document.getElementById('upgradeScreen');
        this.container = document.getElementById('upgradeCards');
    }

    show(onChosen) {
        const cards = this.game.upgrades.pickThree(this.game.wave);
        this.container.innerHTML = '';
        for (const c of cards) {
            const el = document.createElement('div');
            el.className = `upCard ${c.rarity}`;
            const icon = ({ common: '⚔', rare: '✦', epic: '☠' })[c.rarity] || '✦';
            el.innerHTML = `
                <div class="upIcon">${icon}</div>
                <div class="rarity">${c.rarity}</div>
                <div class="upName">${c.name}</div>
                <div class="upDesc">${c.desc}</div>
            `;
            el.addEventListener('mouseenter', () => this.game.audio.uiHover());
            el.addEventListener('click', () => {
                this.game.audio.uiClick();
                this.game.upgrades.applyUpgrade(c);
                this.screen.classList.add('hidden');
                if (onChosen) onChosen(c);
            });
            this.container.appendChild(el);
        }
        this.screen.classList.remove('hidden');
    }

    hide() { this.screen.classList.add('hidden'); }
}
