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
import { LootSystem } from '../progression/LootSystem.js';
import { UpgradeSystem } from '../progression/UpgradeSystem.js';
import { ParticleSystem } from '../vfx/ParticleSystem.js';
import { DamageNumbers } from '../vfx/DamageNumbers.js';
import { HUD } from '../ui/HUD.js';
import { UpgradeUI } from '../ui/UpgradeUI.js';
import { InventoryUI } from '../ui/InventoryUI.js';
import { DeathScreen } from '../ui/DeathScreen.js';

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

        // game state
        this.state = 'menu'; // menu | playing | paused | upgrade | inventory | weapondrop | dead | loading
        this.runState = null;
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
    async startNewRun() {
        this.state = 'loading';
        document.getElementById('loadingScreen').classList.remove('hidden');
        const r = await fetch('/api/run/new', { method: 'POST' });
        const d = await r.json();
        if (!d.ok) throw new Error('run start failed');
        await this._enterRun(d.state, d.arena);
    }

    async continueRun() {
        const r = await fetch('/api/run/state');
        if (!r.ok) return false;
        const d = await r.json();
        if (!d.ok) return false;
        this.state = 'loading';
        document.getElementById('loadingScreen').classList.remove('hidden');
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

        if (this.waveData.is_boss_wave && this.waveData.boss) {
            const s = pickSpawn();
            const b = new Boss(this, this.waveData.boss, s.x, s.z);
            this.enemies.push(b);
            this.audio.bossRoar();
            this.scene.addShake(0.5, 0.8);
            this.hud.showBoss(b);
            return;
        }

        for (const e of this.waveData.enemies) {
            const s = pickSpawn();
            const en = spawnEnemyByType(this, e.type, e, s.x, s.z);
            this.enemies.push(en);
        }

        if (this.waveData.is_miniboss_wave && this.waveData.miniboss) {
            const s = pickSpawn();
            const mb = new MiniBoss(this, this.waveData.miniboss, s.x, s.z);
            this.enemies.push(mb);
            this.audio.bossRoar();
            this.scene.addShake(0.4, 0.6);
        }
    }

    onEnemyKilled(enemy) {
        this.runStats.kills++;
        this.runState.kills = (this.runState.kills || 0) + 1;
        this.player.energy = Math.min(this.player.maxEnergy, this.player.energy + 8 * (this.player.stats.energy_gain || 1));

        // explode-on-kill upgrade
        if (this.player.stats.explode_kills > 0) {
            const r = 4.0;
            const dmg = enemy.maxHealth * this.player.stats.explode_kills;
            this.particles.spawnBurst(enemy.position, '#ff8c1a', 24, 5);
            for (const e of this.enemies) {
                if (e === enemy || !e.alive) continue;
                if (e.position.distanceTo(enemy.position) < r) {
                    this.combat.applyDamage(e, dmg, { source: 'explosion' });
                }
            }
        }

        // Spawn loot
        if (enemy.isMiniBoss) {
            this.loot.dropMiniBossLoot(enemy.position);
        } else if (enemy.isBoss) {
            this.loot.dropBossLoot(enemy.position, this.wave);
        } else {
            this.loot.maybeDropCommonLoot(enemy.position);
        }

        if (enemy.isBoss) this.hud.hideBoss();

        // Wave end check
        const aliveEnemies = this.enemies.filter(e => e.alive);
        if (aliveEnemies.length === 0 && this.waveActive) {
            this._onWaveCleared();
        }
    }

    _onWaveCleared() {
        this.waveActive = false;
        this.intermission = true;
        this.runStats.waves = Math.max(this.runStats.waves, this.wave);
        this.runState.wave = this.wave + 1;
        this.persistRun();

        // Show a 2-second countdown before showing the upgrade/weapon-drop screen
        // so the player cannot accidentally click an upgrade immediately after killing the last mob.
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
        // abandon → menu
        this.persistRun();
        this.audio.stopAmbient();
        document.getElementById('hud').classList.add('hidden');
        document.getElementById('pauseScreen').classList.add('hidden');
        document.getElementById('mainMenu').classList.remove('hidden');
        this.state = 'menu';
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
            this.player.update(dt, rawDt, this.input);
            for (const e of this.enemies) e.update(enemyDt, this.player);
            // Drop fully dissolved enemies
            this.enemies = this.enemies.filter(e => e.alive || e.dissolveT < 1.2);
            for (const p of this.projectiles) p.update(dt);
            this.projectiles = this.projectiles.filter(p => !p.dead);
            for (const l of this.lootDrops) l.update(rawDt);
            this.lootDrops = this.lootDrops.filter(l => !l.dead);
            this.combat.update(rawDt);
            this.particles.update(rawDt);
            this.arena.update(rawDt);
            this.dmgNumbers.update();
            this.hud.update(rawDt);
            this.minimap.draw(this);
            // pickup loot
            for (const l of this.lootDrops) {
                if (l.dead) continue;
                if (l.position.distanceTo(this.player.position) < 1.6) {
                    l.onPickup(this);
                }
            }
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
