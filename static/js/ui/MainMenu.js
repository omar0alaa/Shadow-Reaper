// MainMenu — wires the menu buttons + settings modal + class selection.

const CLASS_GLYPHS = { sword: '⚔', dagger: '✦', bow: '➹', scythe: '☠' };

export class MainMenu {
    constructor(game) {
        this.game = game;
        this.menu = document.getElementById('mainMenu');
        this.settings = document.getElementById('settingsModal');
        this._pendingDifficulty = 'normal';

        this._wire();
    }

    _wire() {
        const btn = (id, fn) => document.getElementById(id).addEventListener('click', () => {
            this.game.audio.uiClick(); fn();
        });

        btn('btnNewRun',     () => this._promptDifficulty());
        btn('btnMultiplayer',() => this._openMultiplayer());
        btn('btnContinue',   () => this._continue());
        btn('btnSettings',   () => this._openSettings());
        btn('btnQuit',       () => this._quit());

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

        // Difficulty modal — picking a difficulty leads into the class picker.
        const diffModal = document.getElementById('difficultyModal');
        btn('btnDiffEasy',   () => this._chooseDifficulty('easy'));
        btn('btnDiffNormal', () => this._chooseDifficulty('normal'));
        btn('btnDiffHard',   () => this._chooseDifficulty('hard'));
        btn('btnDiffCancel', () => diffModal.classList.add('hidden'));

        // Class picker
        const classScreen = document.getElementById('classSelectScreen');
        document.getElementById('classCancel').addEventListener('click', () => {
            this.game.audio.uiClick();
            classScreen.classList.add('hidden');
            diffModal.classList.remove('hidden');
        });
    }

    _chooseDifficulty(diff) {
        this._pendingDifficulty = diff;
        document.getElementById('difficultyModal').classList.add('hidden');
        this._showClassPicker();
    }

    async _showClassPicker() {
        const classScreen = document.getElementById('classSelectScreen');
        const cards = document.getElementById('classCards');
        // Fetch class info + sample weapons so we can show preview stats
        let classes;
        try {
            const r = await fetch('/api/data/classes');
            const d = await r.json();
            classes = d.classes || {};
        } catch (e) {
            classes = {
                sword:  { name: 'Sword',  tagline: 'Balanced melee' },
                dagger: { name: 'Dagger', tagline: 'Fast dual-wield' },
                bow:    { name: 'Bow',    tagline: 'Ranged kiter' },
                scythe: { name: 'Scythe', tagline: 'Wide AoE' },
            };
        }
        const wd = this.game.weaponData || {};
        cards.innerHTML = '';
        for (const cls of ['sword', 'dagger', 'bow', 'scythe']) {
            const info = classes[cls];
            const starter = wd[`${cls}_common`];
            const el = document.createElement('div');
            el.className = `classCard ${cls}`;
            el.innerHTML = `
                <div class="classGlyph" style="color:${info.color || '#fff'}">${CLASS_GLYPHS[cls]}</div>
                <div class="classTitle">${info.name.toUpperCase()}</div>
                <div class="classTagline">${info.tagline || ''}</div>
                <hr style="border:0;border-top:1px dashed rgba(255,255,255,.1);width:100%"/>
                <div class="classStats">
                    Starter: <b>${starter ? starter.name : cls + ' common'}</b><br/>
                    DMG <b>${starter ? starter.damage : '—'}</b> · SPD <b>${starter ? starter.speed : '—'}</b>
                </div>
            `;
            el.addEventListener('mouseenter', () => this.game.audio.uiHover());
            el.addEventListener('click', () => {
                this.game.audio.uiClick();
                classScreen.classList.add('hidden');
                this._newRun(this._pendingDifficulty, cls);
            });
            cards.appendChild(el);
        }
        classScreen.classList.remove('hidden');
    }

    _promptDifficulty() {
        document.getElementById('difficultyModal').classList.remove('hidden');
    }

    show() {
        this.menu.classList.remove('hidden');
        const cont = document.getElementById('btnContinue');
        cont.disabled = false;
        fetch('/api/run/state').then(r => {
            cont.disabled = !r.ok;
        }).catch(() => { cont.disabled = true; });
    }

    async _newRun(difficulty, playerClass = 'sword') {
        document.getElementById('difficultyModal').classList.add('hidden');
        document.getElementById('classSelectScreen').classList.add('hidden');
        this.menu.classList.add('hidden');
        try {
            await this.game.startNewRun(difficulty, playerClass);
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

    _openMultiplayer() {
        this.menu.classList.add('hidden');
        if (this.game.partyUI) this.game.partyUI.show();
    }

    _quit() {
        // close tab is blocked by browsers; show a notice
        this.game.hud.toast('You may close this tab');
    }
}
