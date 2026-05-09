// PartyUI — host/join modals + party lobby with class selection.
// Talks to game.net (NetClient). On Start, hands off to game.startNewRunMP().

const CLASS_GLYPHS = { sword: '⚔', dagger: '✦', bow: '➹', scythe: '☠' };
const CLASSES = ['sword', 'dagger', 'bow', 'scythe'];

function defaultName() {
    return 'Reaper-' + Math.floor(1000 + Math.random() * 9000);
}

export class PartyUI {
    constructor(game) {
        this.game = game;
        this.modeScreen   = document.getElementById('mpModeScreen');
        this.hostScreen   = document.getElementById('mpHostScreen');
        this.joinScreen   = document.getElementById('mpJoinScreen');
        this.lobbyScreen  = document.getElementById('mpLobbyScreen');
        this._wire();
    }

    _wire() {
        const click = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', () => { this.game.audio.uiClick(); fn(); });
        };

        // Back from the Host/Join mode-select screen → main menu
        click('mpBack',          () => this._returnToMainMenu());
        click('mpHostBtn',       () => this._openHost());
        click('mpJoinBtn',       () => this._openJoin());
        // Back from Host config / Join config → mode-select screen (Host or Join)
        click('mpHostBack',      () => { this._closeAll(); this.show(); });
        click('mpJoinBack',      () => { this._closeAll(); this.show(); });
        click('mpHostConfirm',   () => this._doHost());
        click('mpJoinConfirm',   () => this._doJoin());
        click('mpLobbyLeave',    () => this._leaveLobby());
        click('mpLobbyStart',    () => this._startRun());

        // Difficulty toggles in the host config + lobby
        for (const d of ['easy', 'normal', 'hard']) {
            const b1 = document.getElementById(`mpHostDiff_${d}`);
            if (b1) b1.addEventListener('click', () => { this._setHostDifficulty(d); });
            const b2 = document.getElementById(`mpLobbyDiff_${d}`);
            if (b2) b2.addEventListener('click', () => { this._setLobbyDifficulty(d); });
        }

        // Code input — uppercase as you type
        const codeInput = document.getElementById('mpJoinCode');
        if (codeInput) codeInput.addEventListener('input', () => {
            codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        });
    }

    show() {
        this.modeScreen.classList.remove('hidden');
    }
    _closeAll() {
        for (const s of [this.modeScreen, this.hostScreen, this.joinScreen, this.lobbyScreen]) {
            if (s) s.classList.add('hidden');
        }
    }

    // ---------- Host flow ----------

    _openHost() {
        this._closeAll();
        document.getElementById('mpHostName').value = defaultName();
        this._hostDifficulty = 'normal';
        this._hostClass = 'sword';
        this._renderHostClassChoices();
        this._renderHostDifficultyChoices();
        this.hostScreen.classList.remove('hidden');
    }

    _setHostDifficulty(d) {
        this._hostDifficulty = d;
        this._renderHostDifficultyChoices();
    }

    _renderHostDifficultyChoices() {
        for (const d of ['easy', 'normal', 'hard']) {
            const el = document.getElementById(`mpHostDiff_${d}`);
            if (el) el.classList.toggle('active', this._hostDifficulty === d);
        }
    }

    _renderHostClassChoices() {
        const wrap = document.getElementById('mpHostClasses');
        if (!wrap) return;
        wrap.innerHTML = '';
        const wd = this.game.weaponData || {};
        for (const cls of CLASSES) {
            const starter = wd[`${cls}_common`];
            const el = document.createElement('div');
            el.className = `classCard ${cls}` + (this._hostClass === cls ? ' active' : '');
            el.innerHTML = `
                <div class="classGlyph">${CLASS_GLYPHS[cls]}</div>
                <div class="classTitle">${cls.toUpperCase()}</div>
                <div class="classStats">DMG <b>${starter ? starter.damage : '—'}</b> · SPD <b>${starter ? starter.speed : '—'}</b></div>
            `;
            el.addEventListener('mouseenter', () => this.game.audio.uiHover());
            el.addEventListener('click', () => {
                this.game.audio.uiClick();
                this._hostClass = cls;
                this._renderHostClassChoices();
            });
            wrap.appendChild(el);
        }
    }

    async _doHost() {
        const name = document.getElementById('mpHostName').value.trim() || defaultName();
        try {
            await this.game.net.hostParty({
                name, cls: this._hostClass, difficulty: this._hostDifficulty,
            });
            this._enterLobby();
        } catch (e) {
            this.game.hud.toast('Host failed: ' + (e.message || e));
        }
    }

    // ---------- Join flow ----------

    _openJoin() {
        this._closeAll();
        document.getElementById('mpJoinName').value = defaultName();
        this._joinClass = 'sword';
        this._renderJoinClassChoices();
        this.joinScreen.classList.remove('hidden');
        const codeIn = document.getElementById('mpJoinCode');
        if (codeIn) { codeIn.value = ''; codeIn.focus(); }
    }

    _renderJoinClassChoices() {
        const wrap = document.getElementById('mpJoinClasses');
        if (!wrap) return;
        wrap.innerHTML = '';
        const wd = this.game.weaponData || {};
        for (const cls of CLASSES) {
            const starter = wd[`${cls}_common`];
            const el = document.createElement('div');
            el.className = `classCard ${cls}` + (this._joinClass === cls ? ' active' : '');
            el.innerHTML = `
                <div class="classGlyph">${CLASS_GLYPHS[cls]}</div>
                <div class="classTitle">${cls.toUpperCase()}</div>
                <div class="classStats">DMG <b>${starter ? starter.damage : '—'}</b> · SPD <b>${starter ? starter.speed : '—'}</b></div>
            `;
            el.addEventListener('mouseenter', () => this.game.audio.uiHover());
            el.addEventListener('click', () => {
                this.game.audio.uiClick();
                this._joinClass = cls;
                this._renderJoinClassChoices();
            });
            wrap.appendChild(el);
        }
    }

    async _doJoin() {
        const code = document.getElementById('mpJoinCode').value.trim().toUpperCase();
        const name = document.getElementById('mpJoinName').value.trim() || defaultName();
        if (!code || code.length < 4) {
            this.game.hud.toast('Enter a party code'); return;
        }
        try {
            await this.game.net.joinParty({ code, name, cls: this._joinClass });
            this._enterLobby();
        } catch (e) {
            this.game.hud.toast('Join failed: ' + (e.message || e));
        }
    }

    // ---------- Lobby ----------

    _enterLobby() {
        this._closeAll();
        const code = this.game.net.code;
        const codeEl = document.getElementById('mpLobbyCode');
        codeEl.textContent = code;
        codeEl.classList.add('mpCodeCopy');
        codeEl.title = 'Click to copy';
        codeEl.onclick = async () => {
            this.game.audio.uiClick();
            const txt = this.game.net.code || code;
            try {
                await navigator.clipboard.writeText(txt);
                this.game.hud.toast(`Copied: ${txt}`);
                codeEl.classList.add('flash');
                setTimeout(() => codeEl.classList.remove('flash'), 400);
            } catch (e) {
                // Fallback for browsers / contexts without clipboard API
                const ta = document.createElement('textarea');
                ta.value = txt;
                ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); this.game.hud.toast(`Copied: ${txt}`); }
                catch (_) { this.game.hud.toast('Copy failed — select manually'); }
                ta.remove();
            }
        };
        this._renderLobby();
        this.game.net.on('lobby_update', (msg) => this._renderLobby());
        this.game.net.on('start_run', (msg) => this._onStartRun(msg));
        this.game.net.on('disconnect', () => {
            this.game.hud.toast('Disconnected from party');
            this._closeAll();
            this.show();
        });
        this.lobbyScreen.classList.remove('hidden');
    }

    _renderLobby() {
        const net = this.game.net;
        const isHost = net.isHost;
        const list = document.getElementById('mpLobbyList');
        list.innerHTML = '';
        for (const m of net.roster()) {
            const row = document.createElement('div');
            row.className = `lobbyRow ${m.class}`;
            const tag = m.is_host ? '<span class="lobbyHost">HOST</span>' : '';
            const isMe = m.pid === net.pid;
            row.innerHTML = `
                <div class="lobbyGlyph">${CLASS_GLYPHS[m.class] || '?'}</div>
                <div class="lobbyName">${m.name}${isMe ? ' <span style="color:var(--gold)">(you)</span>' : ''} ${tag}</div>
                <div class="lobbyClass">${m.class.toUpperCase()}</div>
            `;
            list.appendChild(row);
        }
        // Difficulty buttons — host can toggle, others see read-only.
        for (const d of ['easy', 'normal', 'hard']) {
            const el = document.getElementById(`mpLobbyDiff_${d}`);
            if (!el) continue;
            el.classList.toggle('active', net.difficulty === d);
            el.disabled = !isHost;
            el.style.opacity = isHost ? 1 : 0.6;
        }
        // Class swap buttons
        const swap = document.getElementById('mpLobbyClassSwap');
        if (swap) {
            swap.innerHTML = '';
            for (const cls of CLASSES) {
                const me = net.me();
                const active = me && me.class === cls;
                const b = document.createElement('button');
                b.className = `lobbyClassBtn ${cls}` + (active ? ' active' : '');
                b.innerHTML = `${CLASS_GLYPHS[cls]} ${cls}`;
                b.addEventListener('click', () => {
                    this.game.audio.uiClick();
                    net.setClass(cls);
                });
                swap.appendChild(b);
            }
        }
        // Start button — host only, requires ≥1 member (always true)
        const start = document.getElementById('mpLobbyStart');
        if (start) {
            start.style.display = isHost ? '' : 'none';
        }
        // Member count
        const count = document.getElementById('mpLobbyCount');
        if (count) count.textContent = `${net.roster().length} / 5`;
    }

    _setLobbyDifficulty(d) {
        if (!this.game.net.isHost) return;
        this.game.net.setDifficulty(d);
    }

    _startRun() {
        if (!this.game.net.isHost) return;
        this.game.net.startRun();
    }

    async _onStartRun(msg) {
        // Server confirmed run start. Hand off to Game.
        const net = this.game.net;
        const me = net.me();
        if (!me) return;
        this._closeAll();
        try {
            await this.game.startNewRunMP({
                difficulty: msg.difficulty || 'normal',
                playerClass: me.class,
                seed: msg.seed,
                hostPid: msg.host_pid,
                members: msg.members,
            });
        } catch (e) {
            console.error(e);
        }
    }

    _leaveLobby() {
        this.game.net.leave();
        this._closeAll();
        // Drop back to the main menu — not the Host/Join mode-select screen.
        this._returnToMainMenu();
    }

    /** Close all party UI panels and return to the game's main menu. */
    _returnToMainMenu() {
        this._closeAll();
        const menu = document.getElementById('mainMenu');
        if (menu) menu.classList.remove('hidden');
        this.game.state = 'menu';
    }
}
