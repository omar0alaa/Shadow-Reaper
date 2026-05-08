// Inventory — minimal model that the InventoryUI renders.
// In this build the inventory is mostly current weapon + acquired upgrades; we
// keep the class as a thin wrapper so it can be expanded later.

export class Inventory {
    constructor(game) {
        this.game = game;
    }

    getEquippedWeapon() {
        const p = this.game.player;
        if (!p) return null;
        return this.game.weaponData[p.weaponId];
    }

    getOwnedWeapons() {
        const ids = this.game.runStats.weapons || [];
        return ids.map(id => this.game.weaponData[id]).filter(Boolean);
    }

    getUpgrades() {
        return (this.game.runState && this.game.runState.upgrades) || [];
    }
}
