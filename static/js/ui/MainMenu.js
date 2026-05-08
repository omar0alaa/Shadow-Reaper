// MainMenu — wires the menu buttons + settings modal.

export class MainMenu {
    constructor(game) {
        this.game = game;
        this.menu = document.getElementById('mainMenu');
        this.settings = document.getElementById('settingsModal');

        this._wire();
    }

    _wire() {
        const btn = (id, fn) => document.getElementById(id).addEventListener('click', () => {
            this.game.audio.uiClick(); fn();
        });

        btn('btnNewRun',   () => this._newRun());
        btn('btnContinue', () => this._continue());
        btn('btnSettings', () => this._openSettings());
        btn('btnQuit',     () => this._quit());

        // Settings modal
        document.getElementById('settingsClose').addEventListener('click', async () => {
            this.game.audio.uiClick();
            await this._saveSettings();
            this.settings.classList.add('hidden');
        });

        // Pause buttons
        document.getElementById('pauseResume').addEventListener('click', () => { this.game.audio.uiClick(); this.game.togglePause(); });
        document.getElementById('pauseQuit').addEventListener('click', () => { this.game.audio.uiClick(); this.game.quitRun(); });

        // Death screen
        document.getElementById('deathReturn').addEventListener('click', () => {
            this.game.audio.uiClick();
            document.getElementById('deathScreen').classList.add('hidden');
            document.getElementById('hud').classList.add('hidden');
            this.menu.classList.remove('hidden');
            this.game.state = 'menu';
        });

        // Inventory close button
        document.getElementById('invClose').addEventListener('click', () => { this.game.audio.uiClick(); this.game.toggleInventory(); });
    }

    show() {
        this.menu.classList.remove('hidden');
        const cont = document.getElementById('btnContinue');
        cont.disabled = false;
        fetch('/api/run/state').then(r => {
            cont.disabled = !r.ok;
        }).catch(() => { cont.disabled = true; });
    }

    async _newRun() {
        this.menu.classList.add('hidden');
        try {
            await this.game.startNewRun();
        } catch (e) {
            console.error(e);
            this.show();
        }
    }

    async _continue() {
        this.menu.classList.add('hidden');
        const ok = await this.game.continueRun();
        if (!ok) {
            this.show();
            this.game.hud.toast('No saved run found');
        }
    }

    _openSettings() {
        const s = this.game.settings || { master_volume: 0.7, sfx_volume: 0.8, music_volume: 0.5, mouse_sensitivity: 0.0025, invert_y: false };
        document.getElementById('setMaster').value = s.master_volume;
        document.getElementById('setSfx').value = s.sfx_volume;
        document.getElementById('setMusic').value = s.music_volume;
        document.getElementById('setSens').value = s.mouse_sensitivity;
        document.getElementById('setInvert').checked = !!s.invert_y;
        this.settings.classList.remove('hidden');
    }

    async _saveSettings() {
        const s = {
            master_volume: parseFloat(document.getElementById('setMaster').value),
            sfx_volume: parseFloat(document.getElementById('setSfx').value),
            music_volume: parseFloat(document.getElementById('setMusic').value),
            mouse_sensitivity: parseFloat(document.getElementById('setSens').value),
            invert_y: document.getElementById('setInvert').checked,
        };
        this.game.audio.applySettings(s);
        this.game.input.sensitivity = s.mouse_sensitivity;
        this.game.invertY = s.invert_y;
        this.game.settings = s;
        try {
            await fetch('/api/save/settings', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(s),
            });
        } catch(e) {}
    }

    _quit() {
        // close tab is blocked by browsers; show a notice
        this.game.hud.toast('You may close this tab');
    }
}
