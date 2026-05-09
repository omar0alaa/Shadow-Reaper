// Game.js — main loop & state machine.
// States: MENU → PLAYING → PAUSED, UPGRADING, INVENTORY, WEAPON_DROP, DEAD

import * as THREE from 'three';

import { SceneManager } from './SceneManager.js';
import { InputManager } from './InputManager.js';
import { AudioManager } from './AudioManager.js';
import { Arena } from '../world/Arena.js';
import { Minimap } from '../world/Minimap.js';
import { Player } from '../entities/Player.js';
import { spawnEnemyByType } from '../entities/EnemyTypes.js';
import { MiniBoss } from '../entities/MiniBoss.js';
import { Boss } from '../entities/Boss.js';
import { CombatSystem } from '../combat/CombatSystem.js';
import { Projectile } from '../combat/Projectile.js';
import { LootSystem } from '../progression/LootSystem.js';
import { UpgradeSystem } from '../progression/UpgradeSystem.js';
import { ParticleSystem } from '../vfx/ParticleSystem.js';
import { DamageNumbers } from '../vfx/DamageNumbers.js';
import { HUD } from '../ui/HUD.js';
import { UpgradeUI } from '../ui/UpgradeUI.js';
import { InventoryUI } from '../ui/InventoryUI.js';
import { DeathScreen } from '../ui/DeathScreen.js';
import { PartyUI } from '../ui/PartyUI.js';
import { NetClient } from '../net/NetClient.js';
import { RemotePlayer } from '../entities/RemotePlayer.js';

export class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.scene = new SceneManager(this.canvas);
        this.input = new InputManager(this.canvas);
        this.audio = new AudioManager();
        this.particles = new ParticleSystem(this.scene.scene);
        this.dmgNumbers = new DamageNumbers(this.scene.camera);
        this.combat = new CombatSystem(this);
        this.loot = new LootSystem(this);
        this.upgrades = new UpgradeSystem(this);
        this.hud = new HUD(this);
        this.upgradeUI = new UpgradeUI(this);
        this.inventoryUI = new InventoryUI(this);
        this.deathScreen = new DeathScreen(this);

        // Multiplayer (server-authoritative)
        this.net = new NetClient();
        this.partyUI = new PartyUI(this);
        this.netMode = 'sp';                // 'sp' | 'mp'
        this.myPid = null;                  // our pid in MP
        this.remotePlayers = new Map();     // pid -> RemotePlayer
        this.serverEnemies = new Map();     // eid -> Enemy (puppet)
        this.serverProjectiles = new Map(); // id -> Projectile (puppet)
        this.serverLoot = new Map();        // id -> LootDrop (locally rendered, owner-only)
        this._mpDyingEnemies = [];          // enemies removed from snapshot but still dissolving
        this.partySize = 1;
        this._netInputAccum = 0;
        this._lastInputState = null;
        this._lmbJustSend = false;
        this._rmbJustSend = false;
        this._qJustSend = false; this._eJustSend = false;
        this._rJustSend = false; this._fJustSend = false;
        this._ProjectileClass = Projectile;
        this._wireNetHandlers();

        // game state
        this.state = 'menu'; // menu | playing | paused | upgrade | inventory | weapondrop | dead | loading
        this.runState = null;
        this.difficulty = 'normal';
        this.arenaData = null;
        this.arena = null;
        this.player = null;
        this.enemies = [];
        this.projectiles = [];
        this.lootDrops = [];
        this.minimap = new Minimap();
        this.timeScale = 1.0;
        this.enemyTimeScale = 1.0;
        this.hitstopTimer = 0;
        this.weaponData = {};   // loaded from backend
        this.upgradePool = [];  // loaded from backend

        // run stats
        this.runStats = { kills: 0, damage: 0, waves: 0, weapons: [] };

        // wave management
        this.wave = 1;
        this.waveData = null;
        this.waveActive = false;
        this.intermission = false;

        // bind loop
        this._lastT = performance.now();
        this._loop = this._loop.bind(this);

        // Global pause/inventory keys (work regardless of which state we're in)
        window.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            if (e.code === 'Escape') {
                if (this.state === 'playing' || this.state === 'paused') {
                    e.preventDefault();
                    this.togglePause();
                } else if (this.state === 'inventory') {
                    e.preventDefault();
                    this.toggleInventory();
                }
            } else if (e.code === 'Tab') {
                if (this.state === 'playing' || this.state === 'inventory') {
                    e.preventDefault();
                    this.toggleInventory();
                }
            }
        });
    }

    async preload() {
        try {
            const [w, u, s] = await Promise.all([
                fetch('/api/data/weapons').then(r => r.json()),
                fetch('/api/data/upgrades').then(r => r.json()),
                fetch('/api/save/settings').then(r => r.json()),
            ]);
            this.weaponData = w.weapons || {};
            this.upgradePool = u.upgrades || [];
            if (s.ok) {
                this.audio.applySettings(s.settings);
                this.input.sensitivity = s.settings.mouse_sensitivity || 0.0025;
                this.invertY = !!s.settings.invert_y;
                this.settings = s.settings;
            }
        } catch (e) {
            console.warn('preload failed', e);
            this.weaponData = {};
            this.upgradePool = [];
        }
        // start render loop even on menu (so menu has the dark scene rendering)
        requestAnimationFrame(this._loop);
    }

    // ---------- run lifecycle ----------
    async startNewRun(difficulty = 'normal', playerClass = 'sword') {
        this.netMode = 'sp';
        this.partySize = 1;
        this.state = 'loading';
        document.getElementById('loadingScreen').classList.remove('hidden');
        const r = await fetch(`/api/run/new?difficulty=${difficulty}&class=${playerClass}`, { method: 'POST' });
        const d = await r.json();
        if (!d.ok) throw new Error('run start failed');
        this.difficulty = difficulty;
        this.playerClass = playerClass;
        await this._enterRun(d.state, d.arena);
    }

    /** Multiplayer entry point — server already started its tick.
     *  Every party member enters via this method; there's no host-vs-peer
     *  distinction in the simulation. */
    async startNewRunMP({ difficulty, playerClass, seed, hostPid, members }) {
        this.netMode = 'mp';
        this.myPid = this.net.pid;
        this.partySize = (members || []).length || 1;
        this.partyMembers = members || [];
        this.hostPid = hostPid;
        this.difficulty = difficulty;
        this.playerClass = playerClass;
        this.state = 'loading';
        document.getElementById('loadingScreen').classList.remove('hidden');

        // Build the arena from the shared seed (same arena for everyone).
        const arenaR = await fetch(`/api/procedural/arena/${seed}`);
        const arenaD = await arenaR.json();
        const arena = arenaD.arena;

        // Build a minimal local "state" — no /api/run/new in MP since the
        // server owns the state. We just need enough scaffolding for Player +
        // arena rendering. The server will overwrite Player position every
        // snapshot anyway.
        const state = {
            seed, wave: 1, alive: true, class: playerClass,
            weapon: `${playerClass}_common`,
            stats: { max_health: 120, health: 120, max_stamina: 100, stamina: 100,
                     max_energy: 100, energy: 0,
                     crit_chance: 0.10, crit_damage: 1.5, lifesteal: 0,
                     move_speed: 1, stamina_regen: 1, combo_damage: 0,
                     backstab_mult: 1, dash_charges: 1, iframe_bonus: 0,
                     energy_gain: 1 },
            upgrades: [],
            kills: 0, damage_dealt: 0,
            weapons_found: [`${playerClass}_common`],
        };
        await this._enterRun(state, arena);
        // Make local Player a "thin" version: server-driven.
        if (this.player) this.player._mp = true;
    }

    async continueRun() {
        const r = await fetch('/api/run/state');
        if (!r.ok) return false;
        const d = await r.json();
        if (!d.ok) return false;
        this.state = 'loading';
        document.getElementById('loadingScreen').classList.remove('hidden');
        this.difficulty = d.state.difficulty || 'normal';
        this.playerClass = d.state.class || 'sword';
        await this._enterRun(d.state, d.arena);
        return true;
    }

    async _enterRun(state, arena) {
        this.runState = state;
        this.arenaData = arena;
        this.runStats = { kills: state.kills || 0, damage: state.damage_dealt || 0, waves: 0, weapons: state.weapons_found || ['rusted_dagger'] };

        // wipe old scene contents
        if (this.arena) this.arena.dispose();
        if (this.player) this.player.dispose();
        for (const e of this.enemies) e.dispose();
        for (const p of this.projectiles) p.dispose();
        for (const l of this.lootDrops) l.dispose && l.dispose();
        this.enemies = []; this.projectiles = []; this.lootDrops = [];
        // Reset world-state knobs that previous runs may have flipped
        this.timeScale = 1.0; this.enemyTimeScale = 1.0; this.hitstopTimer = 0;
        this.scene.setUltimatePost(false);
        this.hud.hideBoss();

        this.arena = new Arena(this.scene.scene, arena);
        this.scene.setFog(arena.fog_color, arena.fog_density);

        this.player = new Player(this);
        this.player.applyState(state);

        // Hook necromancer summons → spawn skeleton in this run
        this.spawnSkeleton = (x, z) => {
            const skSpec = {
                name: 'Skeleton', color: '#dcdcdc', hp: 22 + this.wave * 2,
                damage: 6 + this.wave, speed: 4.4, behavior: 'melee', scale: 0.85, type: 'skeleton',
            };
            const sk = spawnEnemyByType(this, 'skeleton', skSpec, x, z);
            this.enemies.push(sk);
        };

        this.audio.resume();
        this.audio.startAmbient();

        this.wave = state.wave || 1;
        document.getElementById('mainMenu').classList.add('hidden');
        document.getElementById('loadingScreen').classList.add('hidden');
        document.getElementById('hud').classList.remove('hidden');

        this.state = 'playing';
        this.input.requestLock();
        this._beginWave(this.wave);
    }

    async _beginWave(n) {
        this.wave = n;
        // In MP the server runs waves; this method is SP-only now.
        if (this.netMode !== 'sp') return;

        const r = await fetch(`/api/procedural/wave/${n}?seed=${this.runState.seed}`);
        const d = await r.json();
        if (!d.ok) return;
        this.waveData = d.wave;
        this.waveActive = true;
        this.intermission = false;
        this.hud.toast(`WAVE ${n}${this.waveData.is_boss_wave ? ' — BOSS' : (this.waveData.is_miniboss_wave ? ' — MINI BOSS' : '')}`);
        this._spawnWave();
    }

    _spawnWave() {
        const sp = this.arenaData.spawns;
        const used = new Set();
        const pickSpawn = () => {
            for (let tries = 0; tries < 30; tries++) {
                const i = Math.floor(Math.random() * sp.length);
                if (!used.has(i)) { used.add(i); return sp[i]; }
            }
            return sp[Math.floor(Math.random() * sp.length)];
        };

        // Difficulty scales with party size: +35% HP and +20% damage per extra player.
        const partyMult = 1 + 0.35 * Math.max(0, (this.partySize || 1) - 1);
        const dmgMult = 1 + 0.20 * Math.max(0, (this.partySize || 1) - 1);
        const scaleSpec = (spec) => {
            const out = { ...spec };
            out.hp = Math.round((spec.hp || 0) * partyMult);
            out.damage = Math.round((spec.damage || 0) * dmgMult);
            return out;
        };

        const stamp = (en, type, spec) => {
            // Tag for network sync + remember type/spec for resync.
            en.netId = `m${this._mobIdCounter++}`;
            en.specType = type;
            en.spawnSpec = spec;
            return en;
        };
        const broadcastSpawn = (en, spec, type) => {
            if (this.netMode !== 'host') return;
            this.net.send('enemy_spawn', {
                id: en.netId,
                type,
                spec,
                x: en.position.x,
                z: en.position.z,
                isBoss: !!en.isBoss,
                isMiniBoss: !!en.isMiniBoss,
            });
        };

        if (this.waveData.is_boss_wave && this.waveData.boss) {
            const s = pickSpawn();
            const spec = scaleSpec(this.waveData.boss);
            const b = stamp(new Boss(this, spec, s.x, s.z), 'boss', spec);
            this.enemies.push(b);
            this.audio.bossRoar();
            this.scene.addShake(0.5, 0.8);
            this.hud.showBoss(b);
            broadcastSpawn(b, spec, 'boss');
            return;
        }

        for (const e of this.waveData.enemies) {
            const s = pickSpawn();
            const spec = scaleSpec(e);
            const en = stamp(spawnEnemyByType(this, e.type, spec, s.x, s.z), e.type, spec);
            this.enemies.push(en);
            broadcastSpawn(en, spec, e.type);
        }

        if (this.waveData.is_miniboss_wave && this.waveData.miniboss) {
            const s = pickSpawn();
            const spec = scaleSpec(this.waveData.miniboss);
            const mb = stamp(new MiniBoss(this, spec, s.x, s.z), 'miniboss', spec);
            this.enemies.push(mb);
            this.audio.bossRoar();
            this.scene.addShake(0.4, 0.6);
            broadcastSpawn(mb, spec, 'miniboss');
        }
    }

    onEnemyKilled(enemy) {
        // SP-only path. In MP the server is authoritative; this hook is unused.
        if (this.netMode !== 'sp') return;
        this.runStats.kills++;
        this.runState.kills = (this.runState.kills || 0) + 1;
        this.player.energy = Math.min(this.player.maxEnergy, this.player.energy + 8 * (this.player.stats.energy_gain || 1));

        // explode-on-kill upgrade
        if (this.player.stats.explode_kills > 0) {
            const r = 4.5;
            const dmg = Math.max(15, enemy.maxHealth * this.player.stats.explode_kills);
            this.particles.spawnBurst(enemy.position.clone().add(new THREE.Vector3(0, 0.6, 0)), '#ff8c1a', 32, 6);
            this.audio.heavySwing();
            this.scene.addShake(0.18, 0.18);
            for (const e of this.enemies) {
                if (e === enemy || !e.alive) continue;
                if (e.position.distanceTo(enemy.position) < r) {
                    this.combat.applyDamage(e, dmg, { source: 'explosion', fromPlayer: true });
                }
            }
        }

        if (enemy.isMiniBoss) this.loot.dropMiniBossLoot(enemy.position);
        else if (enemy.isBoss) this.loot.dropBossLoot(enemy.position, this.wave);
        else this.loot.maybeDropCommonLoot(enemy.position);

        if (enemy.isBoss) this.hud.hideBoss();

        const aliveEnemies = this.enemies.filter(e => e.alive);
        if (aliveEnemies.length === 0 && this.waveActive) {
            this._onWaveCleared();
        }
    }

    _onWaveCleared() {
        // SP-only — MP wave clears are driven by the server's `wave_cleared` event.
        if (this.netMode !== 'sp') return;
        this.waveActive = false;
        this.intermission = true;
        this.runStats.waves = Math.max(this.runStats.waves, this.wave);
        this.runState.wave = this.wave + 1;
        this.persistRun();
        this.hud.toast('WAVE CLEARED!');
        this._waveCountdown = 2.0;
        this._waveCountdownPending = () => {
            if (this.loot.pendingWeapon) {
                this._openWeaponDrop(this.loot.pendingWeapon);
                this.loot.pendingWeapon = null;
            } else {
                this._openUpgrade();
            }
        };
    }

    _openUpgrade() {
        this.state = 'upgrade';
        this.input.releaseLock();
        this.upgradeUI.show(() => this._afterUpgrade());
    }

    _openWeaponDrop(weaponId) {
        this.state = 'weapondrop';
        this.input.releaseLock();
        const cur = this.weaponData[this.player.weaponId];
        const drop = this.weaponData[weaponId];
        const screen = document.getElementById('weaponDropScreen');
        const card = document.getElementById('weaponDropCard');
        card.innerHTML = `
            <div class="wd-name" style="color:${drop.color}">${drop.name}</div>
            <div class="wd-rarity" style="color:${drop.color}">${drop.rarity}</div>
            <div class="wd-desc">${drop.description}</div>
            <hr style="border-color:rgba(255,255,255,.1);margin:12px 0;" />
            <div style="font-size:12px;color:#b0a691">Replacing: <b style="color:${cur.color}">${cur.name}</b></div>
        `;
        screen.classList.remove('hidden');
        const equip = document.getElementById('weaponDropEquip');
        const keep  = document.getElementById('weaponDropKeep');
        const close = (chose) => {
            screen.classList.add('hidden');
            if (chose) {
                this.player.equipWeapon(weaponId);
                if (!this.runStats.weapons.includes(weaponId)) this.runStats.weapons.push(weaponId);
                this.runState.weapons_found = this.runStats.weapons;
                this.runState.weapon = weaponId;
                this.audio.pickup();
                this.hud.toast(`Equipped ${drop.name}`);
            }
            this._openUpgrade();
        };
        equip.onclick = () => { this.audio.uiClick(); close(true); };
        keep.onclick  = () => { this.audio.uiClick(); close(false); };
    }

    _afterUpgrade() {
        // next wave
        this.state = 'playing';
        this.input.requestLock();
        this._beginWave(this.wave + 1);
    }

    onPlayerDied() {
        if (this.state === 'dead') return;
        // SP only — MP death is driven by the server's `player_died` / `run_ended`.
        if (this.netMode === 'sp') this._endRun();
    }

    /** End-of-run for SP. */
    _endRun() {
        if (this.state === 'dead') return;
        this.state = 'dead';
        this.audio.death();
        this.scene.addShake(0.8, 0.8);
        this.input.releaseLock();
        const summary = {
            waves_cleared: this.runStats.waves,
            enemies_killed: this.runStats.kills,
            damage_dealt: Math.floor(this.runStats.damage),
            weapons_found: this.runStats.weapons,
        };
        fetch('/api/run/end', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ summary })
        }).catch(()=>{});
        this.deathScreen.show(summary);
        this.audio.stopAmbient();
    }

    /** Unused-in-MP helper kept for now. */
    _nearestLivingPlayerTo(pos) {
        let best = null;
        let bestD = Infinity;
        if (this.player && this.player.alive) {
            const d = this.player.position.distanceTo(pos);
            if (d < bestD) { bestD = d; best = this.player; }
        }
        for (const rp of this.remotePlayers.values()) {
            if (rp.alive === false) continue;
            const d = rp.position.distanceTo(pos);
            if (d < bestD) { bestD = d; best = rp; }
        }
        return best || this.player;
    }

    async persistRun() {
        if (!this.runState) return;
        this.runState.kills = this.runStats.kills;
        this.runState.damage_dealt = Math.floor(this.runStats.damage);
        this.runState.weapons_found = this.runStats.weapons;
        this.runState.weapon = this.player ? this.player.weaponId : this.runState.weapon;
        if (this.player) this.runState.stats = this.player.snapshotStats();
        try {
            await fetch('/api/run/save', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state: this.runState }),
            });
        } catch(e) {}
    }

    togglePause() {
        if (this.state === 'playing') {
            this.state = 'paused';
            document.getElementById('pauseScreen').classList.remove('hidden');
            this.input.releaseLock();
        } else if (this.state === 'paused') {
            document.getElementById('pauseScreen').classList.add('hidden');
            this.state = 'playing';
            this.input.requestLock();
        }
    }

    toggleInventory() {
        if (this.state === 'playing') {
            this.state = 'inventory';
            this.inventoryUI.show();
            this.input.releaseLock();
        } else if (this.state === 'inventory') {
            this.inventoryUI.hide();
            this.state = 'playing';
            this.input.requestLock();
        }
    }

    quitRun() {
        // Multiplayer branch:
        //   • Host  → tell the server to end the run; everyone returns to lobby.
        //   • Peer  → leave the party entirely and return to the main menu.
        if (this.netMode === 'mp') {
            document.getElementById('pauseScreen').classList.add('hidden');
            if (this.net.isHost) {
                this.net.send('abandon_run');
                // Server will broadcast run_ended + return_to_lobby to everyone.
                // We'll be put back in the lobby alongside our peers.
            } else {
                this._mpBackToMenu();
            }
            return;
        }
        // Single-player → save and back to menu.
        this.persistRun();
        this.audio.stopAmbient();
        document.getElementById('hud').classList.add('hidden');
        document.getElementById('pauseScreen').classList.add('hidden');
        document.getElementById('mainMenu').classList.remove('hidden');
        this.state = 'menu';
    }

    /** Peer-side abandon: leave the party and return to the main menu. */
    _mpBackToMenu() {
        this.input.releaseLock();
        this.audio.stopAmbient();
        this._cleanMPPuppets();
        if (this.arena) { this.arena.dispose(); this.arena = null; }
        if (this.player) { this.player.dispose(); this.player = null; }
        for (const e of this.enemies) e.dispose();
        this.enemies = [];
        for (const p of this.projectiles) p.dispose();
        this.projectiles = [];
        for (const l of this.lootDrops) l.dispose && l.dispose();
        this.lootDrops = [];
        this.scene.setUltimatePost(false);
        this.hud.hideBoss();
        this.timeScale = 1.0; this.enemyTimeScale = 1.0; this.hitstopTimer = 0;
        this.net.leave();
        this.netMode = 'sp';
        this.state = 'menu';
        document.getElementById('hud').classList.add('hidden');
        document.getElementById('pauseScreen').classList.add('hidden');
        document.getElementById('upgradeScreen').classList.add('hidden');
        document.getElementById('weaponDropScreen').classList.add('hidden');
        document.getElementById('mainMenu').classList.remove('hidden');
    }

    // ---------- multiplayer (server-authoritative) ----------

    _wireNetHandlers() {
        const net = this.net;

        // The big one — full state snapshot from the server.
        net.on('state', (msg) => this._applyServerState(msg));

        // VFX-only events (the server runs the sim, we just play the sound/spark).
        net.on('fx_hit', (msg) => this._fxHit(msg));
        net.on('fx_player_hit', (msg) => this._fxPlayerHit(msg));
        net.on('fx_explode', (msg) => {
            this.particles.spawnBurst(new THREE.Vector3(msg.x, 0.6, msg.z), '#ff8c1a', 32, 6);
            this.audio.heavySwing();
        });
        net.on('fx_lightning', (msg) => {
            this.particles.spawnLine(
                new THREE.Vector3(msg.a.x, 1.2, msg.a.z),
                new THREE.Vector3(msg.b.x, 1.2, msg.b.z),
                '#80ddff',
            );
        });
        net.on('fx_smoke', (msg) => {
            for (let i = 0; i < 12; i++) {
                this.particles.spawnSmoke(new THREE.Vector3(
                    msg.x + (Math.random() - 0.5) * 2,
                    0.4 + Math.random() * 1.0,
                    msg.z + (Math.random() - 0.5) * 2,
                ), '#888888', 6);
            }
            this.audio.skill();
        });
        net.on('fx_dash', (msg) => {
            const dashColor = ({ sword: '#3a4a90', dagger: '#3a0a55',
                                 bow: '#1a4a1a', scythe: '#5a0a0a' })[msg.cls] || '#3a0a55';
            // Where to spawn the trail particles
            let pos = null;
            if (msg.pid === this.myPid && this.player) {
                pos = this.player.position;
                this.audio.dash();
                this.scene.addShake(0.15, 0.2);
            } else {
                const rp = this.remotePlayers.get(msg.pid);
                if (rp) pos = rp.position;
            }
            if (!pos) return;
            // Burst a stream of dark particles for ~0.22s (matches server dash dur)
            let i = 0;
            const tick = () => {
                if (i++ > 6) return;
                this.particles.spawnBurst(pos.clone().add(new THREE.Vector3(0, 0.8, 0)),
                                          dashColor, 5, 1.5);
                setTimeout(tick, 40);
            };
            tick();
        });
        net.on('fx_flurry', (msg) => { this.audio.skill(); });
        net.on('fx_ult', (msg) => {
            if (msg.pid === this.myPid) {
                this.audio.ult();
                this.scene.addShake(0.4, 0.5);
                this.scene.setUltimatePost(true);
                this.hud.toast('REAPER TIME');
                if (this.player) this.player.ultActive = true;
            } else {
                // Mark the puppet so we can show a brief aura particle.
                const rp = this.remotePlayers.get(msg.pid);
                if (rp && rp.position) {
                    this.particles.spawnBurst(rp.position.clone().add(new THREE.Vector3(0, 1, 0)),
                                              '#a45cff', 32, 4);
                }
            }
        });
        net.on('fx_ult_end', (msg) => {
            if (msg.pid === this.myPid) {
                this.scene.setUltimatePost(false);
                if (this.player) this.player.ultActive = false;
            }
        });
        net.on('fx_heal', (msg) => {
            const rp = this.remotePlayers.get(msg.pid);
            if (rp) this.dmgNumbers.spawn(rp.position.clone().add(new THREE.Vector3(0, 1.6, 0)), msg.amt, { kind: 'heal' });
            else if (msg.pid === this.myPid && this.player) {
                this.dmgNumbers.spawn(this.player.position.clone().add(new THREE.Vector3(0, 1.6, 0)), msg.amt, { kind: 'heal' });
            }
        });
        net.on('fx_projectile_spawn', (msg) => this._fxProjectileSpawn(msg));

        // Wave events
        net.on('wave_start', (msg) => {
            this.wave = msg.wave;
            this.waveData = { is_boss_wave: msg.is_boss_wave, is_miniboss_wave: msg.is_miniboss_wave };
            this.waveActive = true;
            this.intermission = false;
            const tag = msg.is_boss_wave ? ' — BOSS' : (msg.is_miniboss_wave ? ' — MINI BOSS' : '');
            this.hud.toast(`WAVE ${msg.wave}${tag}`);
            // Force-resume play if any wave-end UI is still open.
            if (this.state !== 'playing') {
                if (this.upgradeUI) this.upgradeUI.hide();
                const wd = document.getElementById('weaponDropScreen');
                if (wd) wd.classList.add('hidden');
                this.hud.hideCountdown();
                this.state = 'playing';
                this.input.requestLock();
            }
        });
        net.on('wave_cleared', (msg) => {
            this.waveActive = false;
            this.intermission = true;
            this.hud.toast('WAVE CLEARED!');
        });

        // Targeted upgrade choices (only sent to survivors)
        net.on('upgrade_offer', (msg) => {
            this._mpUpgradeCards = msg.cards || [];
            this._waveCountdown = 2.0;
            this._waveCountdownPending = () => {
                if (this._mpPendingWeapon) {
                    this._openMPWeaponDrop(this._mpPendingWeapon);
                    this._mpPendingWeapon = null;
                } else {
                    this._openMPUpgrade(this._mpUpgradeCards);
                }
            };
        });
        net.on('upgrade_picked', (msg) => {
            // Apply locally for instant inventory feedback (the next state
            // snapshot will overwrite anyway, but this covers the gap).
            if (msg.pid === this.myPid && msg.upgrade) {
                if (!this.runState) this.runState = {};
                this.runState.upgrades = this.runState.upgrades || [];
                this.runState.upgrades.push(msg.upgrade);
                this.audio.levelup && this.audio.levelup();
            }
        });

        net.on('weapon_offer', (msg) => {
            // Only sent to the picker. Stash it until the wave-clear UI fires.
            this._mpPendingWeapon = { weapon_id: msg.weapon_id, weapon: msg.weapon };
        });
        net.on('player_equipped', (msg) => {
            // Server confirmed an equip; nothing to do — state will reflect it.
        });

        // Player events
        net.on('player_died', (msg) => {
            if (msg.pid === this.myPid) {
                this.audio.death();
                this.scene.addShake(0.8, 0.8);
                this.hud.toast('You died — wait for the wave to clear');
            } else {
                const rp = this.remotePlayers.get(msg.pid);
                if (rp) this.hud.toast(`${rp.name} has fallen`);
            }
        });
        net.on('player_revived', (msg) => {
            if (msg.pid === this.myPid) this.hud.toast('You were revived!');
        });

        // Loot — only sent to the owner.
        net.on('loot_spawn', (msg) => {
            // Render a local LootDrop. (No pickup logic on the client; server detects walk-over.)
            const drop = this.loot.spawn(new THREE.Vector3(msg.x, 0, msg.z), msg.kind, msg.value, msg.weaponId || null);
            drop.netId = msg.id;
        });
        net.on('loot_pickup', (msg) => {
            const idx = this.lootDrops.findIndex(l => l.netId === msg.id);
            if (idx >= 0) {
                this.audio.pickup();
                this.particles.spawnBurst(this.lootDrops[idx].position, '#ffd166', 12, 3);
                this.lootDrops[idx].dispose && this.lootDrops[idx].dispose();
                this.lootDrops.splice(idx, 1);
            }
        });

        net.on('enemy_die', (msg) => {
            // Visual only — actual entity removal happens on next state snapshot.
            const e = this.serverEnemies.get(msg.eid);
            if (e) {
                this.particles.spawnBurst(new THREE.Vector3(msg.x, 1.0, msg.z), msg.color || '#ff4040', 18, 4);
                this.audio.enemyHurt();
                e.alive = false;
                e._die && e._die();
            }
        });

        net.on('peer_left', (msg) => {
            const rp = this.remotePlayers.get(msg.pid);
            if (rp) { rp.dispose(); this.remotePlayers.delete(msg.pid); }
        });
        net.on('host_left', () => {
            this.hud.toast('Host left the party — run ended.');
            this._endMP();
        });
        net.on('run_ended', (msg) => {
            this.hud.toast('The party has fallen!');
            // Don't disconnect — server will reset the party. Wait for return_to_lobby.
            // Show a brief death summary then go back to lobby.
            this._returnToLobby(msg.summary);
        });
        net.on('return_to_lobby', (msg) => {
            this._returnToLobby();
        });
        net.on('disconnect', () => {
            this.hud.toast('Disconnected from party');
            if (this.netMode !== 'sp') this._endMP();
        });
    }

    /** Apply a `state` snapshot from the server. Drives all entity positions. */
    _applyServerState(msg) {
        if (this.netMode !== 'mp') return;

        // Sync wave/active flags so late-joiners (and post-revive players)
        // see the right HUD banner without waiting for the next wave_start.
        if (msg.wave !== undefined && msg.wave !== this.wave) {
            this.wave = msg.wave;
        }
        if (msg.wave_active !== undefined) this.waveActive = !!msg.wave_active;

        // Players
        const seenPids = new Set();
        for (const ps of (msg.players || [])) {
            seenPids.add(ps.pid);
            if (ps.pid === this.myPid) {
                if (this.player) {
                    this.player._serverApply(ps);
                }
            } else {
                let rp = this.remotePlayers.get(ps.pid);
                if (!rp) {
                    rp = new RemotePlayer(this, ps.pid, {
                        name: ps.name, class: ps.cls, weaponId: ps.wpn,
                    });
                    this.remotePlayers.set(ps.pid, rp);
                }
                rp.applyState({
                    x: ps.x, z: ps.z, facing: ps.f,
                    cls: ps.cls,
                    weaponId: ps.wpn,
                    swing: ps.sw,
                    alive: ps.alive,
                });
            }
        }
        // Drop remote puppets that left the snapshot
        for (const [pid, rp] of this.remotePlayers) {
            if (!seenPids.has(pid)) { rp.dispose(); this.remotePlayers.delete(pid); }
        }

        // Enemies — snapshot is canonical: any enemy not in the snapshot is gone.
        const seenEids = new Set();
        for (const es of (msg.enemies || [])) {
            seenEids.add(es.eid);
            let e = this.serverEnemies.get(es.eid);
            if (!e) {
                e = this._createServerEnemy(es);
                this.serverEnemies.set(es.eid, e);
                if (es.b) this.hud.showBoss(e);
            }
            // Lerp targets
            e._netTargetX = es.x;
            e._netTargetZ = es.z;
            e._netTargetFacing = es.f;
            e.health = es.hp;
            e.maxHealth = es.max_hp;
            // Flash on attack windup
            if (es.fl && e.materials) {
                e.materials[0].emissive.setRGB(1, 0.15, 0.15);
                e.materials[0].emissiveIntensity = 1.2;
            } else if (e.materials) {
                e.materials[0].emissive.setRGB(0, 0, 0);
                e.materials[0].emissiveIntensity = 0;
            }
            if (typeof e._renderHealthBar === 'function') e._renderHealthBar();
        }
        // Despawn enemies missing from snapshot — move them to dissolve list.
        for (const [eid, e] of this.serverEnemies) {
            if (!seenEids.has(eid)) {
                this.serverEnemies.delete(eid);
                if (e.isBoss) this.hud.hideBoss();
                if (!e.alive && e.dissolveT !== undefined && e.dissolveT < 1.2) {
                    // Already dying — let the dying list finish it.
                    this._mpDyingEnemies.push(e);
                } else {
                    // Still alive on server removal (shouldn't happen often) — start dissolve.
                    if (e.alive) {
                        e.alive = false;
                        e.dissolveT = 0;
                        if (e.hbSprite) e.hbSprite.visible = false;
                    }
                    this._mpDyingEnemies.push(e);
                }
            }
        }

        // Projectiles — snapshot is canonical too.
        const seenProj = new Set();
        for (const ps of (msg.projectiles || [])) {
            seenProj.add(ps.id);
            let p = this.serverProjectiles.get(ps.id);
            if (!p) {
                // Already created by fx_projectile_spawn typically; if not, create.
                p = new Projectile(this, {
                    origin: new THREE.Vector3(ps.x, 1.0, ps.z),
                    direction: new THREE.Vector3(ps.dx, 0, ps.dz),
                    speed: 0, damage: 0, life: 99,
                    color: ps.c, size: ps.s, kind: ps.k,
                    fromPlayer: !!ps.p, ghost: true,
                });
                this.serverProjectiles.set(ps.id, p);
                this.projectiles.push(p);
            }
            // Snap to server position
            p.position.x = ps.x; p.position.z = ps.z;
            p.direction.set(ps.dx, 0, ps.dz);
            if (p.mesh) p.mesh.position.copy(p.position);
        }
        for (const [id, p] of this.serverProjectiles) {
            if (!seenProj.has(id)) {
                p.dispose && p.dispose();
                this.serverProjectiles.delete(id);
                const idx = this.projectiles.indexOf(p);
                if (idx >= 0) this.projectiles.splice(idx, 1);
            }
        }
    }

    _createServerEnemy(es) {
        const sp = es.spec || {};
        let e;
        if (es.b) {
            e = new Boss(this, sp, es.x, es.z);
            e.isBoss = true;
        } else if (es.mb) {
            e = new MiniBoss(this, sp, es.x, es.z);
            e.isMiniBoss = true;
        } else {
            e = spawnEnemyByType(this, es.type, sp, es.x, es.z);
        }
        e.netId = es.eid;
        e.health = es.hp;
        e.maxHealth = es.max_hp;
        // Make it a puppet — game loop will lerp position only.
        e.netLerp = (dt) => {
            if (e._netTargetX !== undefined) {
                e.position.x += (e._netTargetX - e.position.x) * Math.min(1, dt * 14);
                e.position.z += (e._netTargetZ - e.position.z) * Math.min(1, dt * 14);
                let df = (e._netTargetFacing ?? e.facing) - e.facing;
                while (df >  Math.PI) df -= Math.PI * 2;
                while (df < -Math.PI) df += Math.PI * 2;
                e.facing += df * Math.min(1, dt * 10);
            }
            if (typeof e._render === 'function') e._render(dt);
        };
        return e;
    }

    _fxHit(msg) {
        const pos = new THREE.Vector3(msg.x, 1.7, msg.z);
        this.dmgNumbers.spawn(pos, msg.dmg, { kind: msg.crit ? 'crit' : 'normal' });
        if (msg.pid === this.myPid) {
            if (msg.crit) this.audio.crit(); else this.audio.hit();
        }
        this.particles.spawnSparks(pos, msg.crit ? '#ffd166' : '#ffeecf', msg.crit ? 16 : 8);
    }

    _fxPlayerHit(msg) {
        // Damage number on the targeted player.
        let pos;
        if (msg.pid === this.myPid && this.player) {
            pos = this.player.position.clone().add(new THREE.Vector3(0, 1.6, 0));
            this.audio.hurt();
            this.scene.addShake(0.2 + Math.min(0.4, msg.dmg / 60), 0.25);
        } else {
            const rp = this.remotePlayers.get(msg.pid);
            if (!rp) return;
            pos = rp.position.clone().add(new THREE.Vector3(0, 1.6, 0));
        }
        this.dmgNumbers.spawn(pos, msg.dmg, { kind: 'player' });
    }

    _fxProjectileSpawn(msg) {
        // Authoritative projectile — create a ghost we'll snap to server pos.
        const origin = new THREE.Vector3(msg.x, 1.2, msg.z);
        const direction = new THREE.Vector3(msg.dx, 0, msg.dz);
        const p = new Projectile(this, {
            origin, direction,
            speed: 0, damage: 0, life: msg.life || 2.5,
            color: msg.color, size: msg.size, kind: msg.kind || 'arrow',
            fromPlayer: false, ghost: true,
        });
        if (msg.id) this.serverProjectiles.set(msg.id, p);
        this.projectiles.push(p);
        if (msg.pid === this.myPid) this.audio.bowShot();
    }

    /** Open the upgrade screen with server-supplied cards. */
    _openMPUpgrade(cards) {
        this.state = 'upgrade';
        this.input.releaseLock();
        // Render via the existing UpgradeUI's display, but our pick path
        // sends to the server.
        const screen = document.getElementById('upgradeScreen');
        const container = document.getElementById('upgradeCards');
        container.innerHTML = '';
        for (const c of cards) {
            const el = document.createElement('div');
            el.className = `upCard ${c.rarity}`;
            const icon = ({ common: '⚔', rare: '✦', epic: '☠' })[c.rarity] || '✦';
            el.innerHTML = `
                <div class="upIcon">${icon}</div>
                <div class="rarity">${c.rarity}</div>
                <div class="upName">${c.name}</div>
                <div class="upDesc">${c.desc}</div>`;
            el.addEventListener('mouseenter', () => this.audio.uiHover());
            el.addEventListener('click', () => {
                this.audio.uiClick();
                this.net.send('upgrade_pick', { upgrade_id: c.id });
                screen.classList.add('hidden');
                this.state = 'playing';
                this.input.requestLock();
            });
            container.appendChild(el);
        }
        screen.classList.remove('hidden');
    }

    _openMPWeaponDrop(info) {
        this.state = 'weapondrop';
        this.input.releaseLock();
        const cur = this.weaponData[this.player.weaponId];
        const drop = info.weapon;
        const screen = document.getElementById('weaponDropScreen');
        const card = document.getElementById('weaponDropCard');
        card.innerHTML = `
            <div class="wd-name" style="color:${drop.color}">${drop.name}</div>
            <div class="wd-rarity" style="color:${drop.color}">${drop.rarity}</div>
            <div class="wd-desc">${drop.description}</div>
            <hr style="border-color:rgba(255,255,255,.1);margin:12px 0;" />
            <div style="font-size:12px;color:#b0a691">Replacing: <b style="color:${cur ? cur.color : '#fff'}">${cur ? cur.name : '—'}</b></div>`;
        screen.classList.remove('hidden');
        const equip = document.getElementById('weaponDropEquip');
        const keep = document.getElementById('weaponDropKeep');
        const close = (chose) => {
            screen.classList.add('hidden');
            this.net.send('weapon_pick', { equip: chose, weapon_id: info.weapon_id });
            // After resolving the weapon, show the upgrade pick.
            if (this._mpUpgradeCards && this._mpUpgradeCards.length) {
                this._openMPUpgrade(this._mpUpgradeCards);
                this._mpUpgradeCards = null;
            } else {
                this.state = 'playing';
                this.input.requestLock();
            }
        };
        equip.onclick = () => { this.audio.uiClick(); close(true); };
        keep.onclick  = () => { this.audio.uiClick(); close(false); };
    }

    /** Per-frame: collect input and send to server at 20 Hz. */
    _netInputTick(rawDt) {
        if (!this.net.connected || this.netMode !== 'mp') return;
        this._netInputAccum += rawDt;
        if (this._netInputAccum < 0.05) return;
        this._netInputAccum = 0;
        const inp = this.input;
        if (!inp) return;
        const msg = {
            type: 'input',
            w: inp.isDown('KeyW'),
            a: inp.isDown('KeyA'),
            s: inp.isDown('KeyS'),
            d: inp.isDown('KeyD'),
            shift: inp.isDown('ShiftLeft'),
            yaw: this.player ? this.player.yaw : 0,
            lmb_just: this._lmbJustSend,
            rmb_just: this._rmbJustSend,
            q_just: this._qJustSend,
            e_just: this._eJustSend,
            r_just: this._rJustSend,
            f_just: this._fJustSend,
        };
        this._lmbJustSend = this._rmbJustSend = false;
        this._qJustSend = this._eJustSend = false;
        this._rJustSend = this._fJustSend = false;
        this.net.send('input', msg);
    }

    /** Cleanly tear down an MP run — back to menu after death screen. */
    _endMP(summary) {
        if (this.state === 'menu') return;
        this.state = 'dead';
        this.input.releaseLock();
        this.audio.stopAmbient();
        this.deathScreen.show(summary || {
            waves_cleared: this.wave - 1,
            enemies_killed: 0,
            damage_dealt: 0,
            weapons_found: this.runStats.weapons,
        });
        this.net.leave();
        this.netMode = 'sp';
        this._cleanMPPuppets();
    }

    /** Return to the party lobby screen after a wipe — keep the WS connection. */
    _returnToLobby(summary) {
        if (this.state === 'menu') return;
        this.input.releaseLock();
        this.audio.stopAmbient();
        this._cleanMPPuppets();
        // Tear down the run visuals but stay connected.
        if (this.arena) { this.arena.dispose(); this.arena = null; }
        if (this.player) { this.player.dispose(); this.player = null; }
        for (const e of this.enemies) e.dispose();
        this.enemies = [];
        for (const p of this.projectiles) p.dispose();
        this.projectiles = [];
        for (const l of this.lootDrops) l.dispose && l.dispose();
        this.lootDrops = [];
        // Reset state machine
        this.state = 'menu';
        this.netMode = 'mp';  // keep mp mode — still connected
        document.getElementById('hud').classList.add('hidden');
        document.getElementById('mainMenu').classList.add('hidden');
        document.getElementById('loadingScreen').classList.add('hidden');
        // Show a brief summary toast then go back to the party lobby UI.
        if (summary) {
            this.hud.toast(`Run over — ${summary.waves_cleared ?? (this.wave - 1)} waves cleared`);
        }
        // Re-enter the lobby screen (party is still alive on the server).
        this.partyUI._enterLobby();
    }

    _cleanMPPuppets() {
        for (const rp of this.remotePlayers.values()) rp.dispose();
        this.remotePlayers.clear();
        for (const e of this.serverEnemies.values()) if (e.dispose) e.dispose();
        this.serverEnemies.clear();
        for (const e of this._mpDyingEnemies) if (e.dispose) e.dispose();
        this._mpDyingEnemies = [];
        for (const p of this.serverProjectiles.values()) if (p.dispose) p.dispose();
        this.serverProjectiles.clear();
    }

    // ---------- main loop ----------
    _loop(t) {
        const rawDt = Math.min(0.066, (t - this._lastT) / 1000);
        this._lastT = t;

        // Hitstop overrides timescale briefly
        if (this.hitstopTimer > 0) {
            this.hitstopTimer -= rawDt;
        }
        const playing = (this.state === 'playing');
        const dt = playing && this.hitstopTimer <= 0 ? rawDt * this.timeScale : 0;
        const enemyDt = playing && this.hitstopTimer <= 0 ? rawDt * this.enemyTimeScale : 0;

        // Wave-cleared countdown: tick down and fire callback when ready
        if (this._waveCountdown > 0 && this.state === 'playing') {
            this._waveCountdown -= rawDt;
            this.hud.showCountdown(this._waveCountdown);
            if (this._waveCountdown <= 0) {
                this.hud.hideCountdown();
                this._waveCountdown = 0;
                if (this._waveCountdownPending) {
                    const cb = this._waveCountdownPending;
                    this._waveCountdownPending = null;
                    cb();
                }
            }
        }

        if (playing) {
            // ---- Single-player ----
            if (this.netMode === 'sp') {
                this.player.update(dt, rawDt, this.input);
                for (const e of this.enemies) e.update(enemyDt, this.player);
                this.enemies = this.enemies.filter(e => e.alive || e.dissolveT < 1.2);
                for (const p of this.projectiles) p.update(dt);
                this.projectiles = this.projectiles.filter(p => !p.dead);
                for (const l of this.lootDrops) l.update(rawDt);
                this.lootDrops = this.lootDrops.filter(l => !l.dead);
                this.combat.update(rawDt);
                // Loot pickup (SP only — server handles in MP)
                for (const l of this.lootDrops) {
                    if (l.dead) continue;
                    if (l.position.distanceTo(this.player.position) < 1.6) {
                        l.onPickup(this);
                    }
                }
            }
            // ---- Multiplayer (server-authoritative) ----
            else if (this.netMode === 'mp') {
                // Capture just-pressed buttons for the next input packet.
                if (this.input.mouse.lmbJust) this._lmbJustSend = true;
                if (this.input.mouse.rmbJust) this._rmbJustSend = true;
                if (this.input.pressed('KeyQ') || this.input.pressed('Space')) {
                    this._qJustSend = true;
                    // Predict the cooldown so the HUD sweep starts the moment
                    // we press, not when the next snapshot arrives. The
                    // server's value will take over via _serverApply.
                    if (this.player && this.player.skills && this.player.skills.Q.cd <= 0
                        && this.player.stamina >= 18) {
                        this.player.skills.Q.cd = this.player.skills.Q.maxCd;
                    }
                }
                if (this.input.pressed('KeyE')) {
                    this._eJustSend = true;
                    if (this.player && this.player.skills && this.player.skills.E.cd <= 0) {
                        this.player.skills.E.cd = this.player.skills.E.maxCd;
                    }
                }
                if (this.input.pressed('KeyR')) {
                    this._rJustSend = true;
                    if (this.player && this.player.skills && this.player.skills.R.cd <= 0) {
                        this.player.skills.R.cd = this.player.skills.R.maxCd;
                    }
                }
                if (this.input.pressed('KeyF')) this._fJustSend = true;
                // Update local player (camera + mouse only — server moves us).
                this.player.update(dt, rawDt, this.input);
                // Lerp remote enemies to server snapshot.
                for (const e of this.serverEnemies.values()) {
                    if (typeof e.netLerp === 'function') e.netLerp(rawDt);
                }
                // Tick dying enemies (dissolve animation) and prune when done.
                for (const e of this._mpDyingEnemies) e.update(rawDt, null);
                this._mpDyingEnemies = this._mpDyingEnemies.filter(e => e.dissolveT < 1.5);
                // Lerp remote players.
                for (const rp of this.remotePlayers.values()) rp.update(rawDt);
                // Server-spawned projectiles fly via their own update path
                // (kind 'wave' rotates etc.). Local projectiles list mirrors server.
                for (const p of this.projectiles) {
                    // Snap to direction we have; speed is 0 so no movement.
                    if (p.update) p.update(0);
                }
                // Loot is rendered locally but pickup is server-detected.
                for (const l of this.lootDrops) l.update(rawDt);
                // Send input to server.
                this._netInputTick(rawDt);
            }

            this.particles.update(rawDt);
            this.arena.update(rawDt);
            this.dmgNumbers.update();
            this.hud.update(rawDt);
            this.minimap.draw(this);

            // camera shake
            const shake = this.scene.applyShake(rawDt);
            this.scene.camera.position.x += shake.x;
            this.scene.camera.position.y += shake.y;
        } else {
            // Allow particles to keep playing on pause/menu so VFX finish gracefully
            this.particles.update(rawDt * 0.5);
        }

        this.scene.render();
        this.input.endFrame();
        requestAnimationFrame(this._loop);
    }
}
