// NetClient — WebSocket wrapper for the party relay.
// Used both in the lobby and during the run. Host-authoritative model: the
// host sends mob/wave/loot updates; peers send their own player state and
// attack hits.

export class NetClient {
    constructor() {
        this.ws = null;
        this.handlers = {};            // type -> fn(msg)
        this.code = null;
        this.pid = null;
        this.isHost = false;
        this.members = [];             // current party roster
        this.connected = false;
    }

    on(type, fn) { this.handlers[type] = fn; }
    off(type)    { delete this.handlers[type]; }

    me() {
        return this.members.find(m => m.pid === this.pid) || null;
    }

    /** Returns array of {pid, name, class, is_host}. */
    roster() { return this.members.slice(); }

    // -------- REST helpers ---------------------------------------------

    async hostParty({ name = 'Host', cls = 'sword', difficulty = 'normal' } = {}) {
        const r = await fetch('/api/party/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, class: cls, difficulty }),
        });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'create failed');
        this._setIdentity(d);
        await this._connect();
        return d;
    }

    async joinParty({ code, name = 'Player', cls = 'sword' } = {}) {
        const r = await fetch('/api/party/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, name, class: cls }),
        });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'join failed');
        this._setIdentity(d);
        await this._connect();
        return d;
    }

    _setIdentity(info) {
        this.code = info.code;
        this.pid = info.pid;
        this.isHost = !!info.is_host;
        this.members = info.members || [];
        this.difficulty = info.difficulty || 'normal';
        this.seed = info.seed || 0;
    }

    // -------- WebSocket -----------------------------------------------

    _connect() {
        return new Promise((resolve, reject) => {
            const proto = location.protocol === 'https:' ? 'wss' : 'ws';
            const url = `${proto}://${location.host}/ws/party/${this.code}?pid=${this.pid}`;
            const ws = new WebSocket(url);
            this.ws = ws;
            const t0 = performance.now();
            ws.onopen = () => {
                this.connected = true;
                resolve();
            };
            ws.onerror = (e) => {
                if (!this.connected) reject(e);
            };
            ws.onmessage = (e) => {
                let msg;
                try { msg = JSON.parse(e.data); } catch { return; }
                this._dispatch(msg);
            };
            ws.onclose = () => {
                this.connected = false;
                if (this.handlers.disconnect) this.handlers.disconnect();
            };
            // 8-second connect timeout
            setTimeout(() => {
                if (!this.connected) reject(new Error('connect timeout'));
            }, 8000);
        });
    }

    _dispatch(msg) {
        const t = msg.type;
        // Built-in: keep our local roster in sync on lobby_update.
        if (t === 'lobby_update' && msg.members) {
            this.members = msg.members;
            if (msg.host_pid) {
                this.isHost = (msg.host_pid === this.pid);
            }
            if (msg.difficulty) this.difficulty = msg.difficulty;
        }
        const h = this.handlers[t];
        if (h) {
            try { h(msg); } catch (e) { console.error('handler', t, e); }
        }
        // Wildcard handler — useful for debugging
        if (this.handlers['*']) try { this.handlers['*'](msg); } catch {}
    }

    /** Send a message. If `target` is a pid, server routes to that pid only. */
    send(type, data = {}, target = null) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const msg = { type, ...data };
        if (target) msg.target = target;
        this.ws.send(JSON.stringify(msg));
    }

    setClass(cls)      { this.send('set_class', { class: cls }); }
    setDifficulty(d)   { this.send('set_difficulty', { difficulty: d }); }
    startRun()         { this.send('start_run'); }

    leave() {
        if (this.ws) {
            try { this.ws.close(); } catch {}
            this.ws = null;
        }
        this.connected = false;
        this.code = null;
        this.pid = null;
        this.isHost = false;
        this.members = [];
    }
}
