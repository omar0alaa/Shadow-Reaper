// Player.js — third-person assassin protagonist.
// Movement, combat combos, lock-on, skills.

import * as THREE from 'three';
import { ShadowDash } from '../skills/ShadowDash.js';
import { SmokeBomb } from '../skills/SmokeBomb.js';
import { BladeFlurry } from '../skills/BladeFlurry.js';
import { ReaperTime } from '../skills/ReaperTime.js';
import { Projectile } from '../combat/Projectile.js';

const TMP_V = new THREE.Vector3();

// Map old type strings → class for any legacy weapon entries that lack `class`.
function _legacyClass(w) {
    if (!w) return 'sword';
    if (w.class) return w.class;
    if (w.type === 'ranged') return 'bow';
    if (w.type === 'melee_aoe') return 'scythe';
    if (w.type === 'dual_fast' || w.type === 'melee_fast') return 'dagger';
    return 'sword';
}

export class Player {
    constructor(game) {
        this.game = game;
        this.scene = game.scene.scene;
        this.camera = game.scene.camera;

        this.position = new THREE.Vector3(0, 0, 0);
        this.velocity = new THREE.Vector3();
        this.facing = 0;          // yaw player faces in world (radians)
        this.yaw = 0;             // camera yaw (only axis the player can change)
        this.pitch = -0.45;       // camera pitch — fixed; camera sits slightly above the player
        this.cameraDist = 6.0;
        this.cameraHeight = 3.6;  // world units above the player
        this.cameraTarget = new THREE.Vector3();

        // stats
        this.maxHealth = 120; this.health = 120;
        this.maxStamina = 100; this.stamina = 100;
        this.maxEnergy = 100; this.energy = 0;
        this.stats = {
            crit_chance: 0.10, crit_damage: 1.5,
            lifesteal: 0.0, move_speed: 1.0, stamina_regen: 1.0,
            combo_damage: 0.0, backstab_mult: 1.0, dash_charges: 1, iframe_bonus: 0.0,
            energy_gain: 1.0,
            chain_lightning: 0, smoke_damage: 0, poison_dash: 0, ricochet: 0,
            ult_duration: 0, explode_kills: 0, execute_thresh: 0,
            extra_combo_hits: 0, ult_dmg_mult: 0,
        };

        // weapon — chosen class drives the starter
        const startCls = game.playerClass || 'sword';
        this.weaponClass = startCls;
        this.weaponId = `${startCls}_common`;
        this.weapon = game.weaponData[this.weaponId]
                   || game.weaponData['sword_common']
                   || null;

        // combat
        this.attackTimer = 0;
        this.comboIndex = 0;
        this.comboWindow = 0;     // swing window (for animation)
        this.comboCount = 0;      // total hits (infinite)
        this.comboTimer = 0;      // 1.5s timeout
        this.attackHitFrame = false;
        this.heavyWindup = 0;
        this.heavyActive = false;
        this.invuln = 0;          // i-frames
        this.alive = true;        // false = spectator (MP) / death screen (SP)
        this.bleedStacksDealt = new WeakMap();

        // lock-on
        this.lockTarget = null;

        // skills
        this.skills = {
            Q: new ShadowDash(this),
            E: new SmokeBomb(this),
            R: new BladeFlurry(this),
            F: new ReaperTime(this),
        };

        this._buildMesh();
        this._buildSlashTrail();
    }

    _buildMesh() {
        this.group = new THREE.Group();
        this.scene.add(this.group);

        const skin = new THREE.MeshStandardMaterial({ color: 0xc7a98a, roughness: 0.7 });
        const cloth = new THREE.MeshStandardMaterial({ color: 0x1a1320, roughness: 0.85 });
        const cloak = new THREE.MeshStandardMaterial({ color: 0x0f0a18, roughness: 0.9, side: THREE.DoubleSide });
        const accent = new THREE.MeshStandardMaterial({ color: 0xa83232, roughness: 0.7, emissive: 0x2a0606, emissiveIntensity: 0.6 });

        // legs
        this.lLeg = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.8, 0.34), cloth);
        this.lLeg.position.set(-0.18, 0.4, 0); this.lLeg.castShadow = true;
        this.rLeg = this.lLeg.clone(); this.rLeg.position.x = 0.18;
        this.group.add(this.lLeg); this.group.add(this.rLeg);

        // torso
        this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.5), cloth);
        this.torso.position.y = 1.25; this.torso.castShadow = true;
        this.group.add(this.torso);

        // belt accent
        const belt = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.12, 0.54), accent);
        belt.position.y = 0.85;
        this.group.add(belt);

        // head + hood
        this.head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), skin);
        this.head.position.y = 1.85; this.head.castShadow = true;
        this.group.add(this.head);

        const hood = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.5, 12, 1, true), cloak);
        hood.position.y = 2.0; hood.rotation.x = Math.PI;
        this.group.add(hood);

        // cloak (back drape)
        const cloakBack = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.4), cloak);
        cloakBack.position.set(0, 1.2, -0.3);
        cloakBack.rotation.y = Math.PI;
        this.group.add(cloakBack);

        // arms
        this.lArm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.75, 0.22), cloth);
        this.lArm.position.set(-0.46, 1.32, 0); this.lArm.castShadow = true;
        this.rArm = this.lArm.clone(); this.rArm.position.x = 0.46;
        this.group.add(this.lArm); this.group.add(this.rArm);

        // weapon mount
        this.weaponMount = new THREE.Group();
        this.weaponMount.position.set(0.48, 0.95, 0.1); // exactly at hand level
        this.group.add(this.weaponMount);
        this._buildWeaponMesh();

        // glowing eyes inside hood
        const eye = new THREE.MeshBasicMaterial({ color: 0xff5050 });
        this.eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), eye);
        this.eyeR = this.eyeL.clone();
        this.eyeL.position.set(-0.07, 1.86, 0.18);
        this.eyeR.position.set( 0.07, 1.86, 0.18);
        this.group.add(this.eyeL); this.group.add(this.eyeR);

        this.group.position.copy(this.position);
    }

    _buildWeaponMesh() {
        // Clear current
        while (this.weaponMount.children.length) {
            const c = this.weaponMount.children.pop();
            this.weaponMount.remove(c);
            if (c.geometry) c.geometry.dispose();
            if (c.material) c.material.dispose && c.material.dispose();
        }
        const w = this.weapon;
        if (!w) return;
        const mat = new THREE.MeshStandardMaterial({
            color: w.color || '#aaaaaa', metalness: 0.85, roughness: 0.25,
            emissive: new THREE.Color(w.color || '#aaaaaa').multiplyScalar(0.15),
        });
        if (w.type === 'dual_fast') {
            // two daggers
            const d1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.7), mat);
            d1.position.set(0, 0, 0.35); d1.castShadow = true;
            this.weaponMount.add(d1);
            // off-hand mirrored
            this.offhandMount = new THREE.Group();
            this.offhandMount.position.set(-0.48, 0.95, 0.1);
            const d2 = d1.clone();
            this.offhandMount.add(d2);
            this.group.add(this.offhandMount);
        } else if (w.type === 'melee_heavy' || w.type === 'melee_balanced') {
            // sword: blade + crossguard
            const len = w.type === 'melee_balanced' ? 1.05 : 1.4;
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, len), mat);
            blade.position.set(0, 0, len * 0.5); blade.castShadow = true;
            this.weaponMount.add(blade);
            const guard = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.08), mat);
            guard.position.set(0, 0, 0);
            this.weaponMount.add(guard);
        } else if (w.type === 'ranged') {
            const bow = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 8, 24, Math.PI * 1.4), mat);
            bow.rotation.set(0, Math.PI / 2, 0);
            bow.position.set(0, 0, 0.2);
            this.weaponMount.add(bow);
        } else if (w.type === 'melee_aoe') {
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), new THREE.MeshStandardMaterial({ color: 0x2a1010 }));
            shaft.rotation.x = Math.PI / 2;
            shaft.position.set(0, 0, 0.8);
            this.weaponMount.add(shaft);
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.18), mat);
            blade.position.set(0.4, 0, 1.4);
            blade.rotation.y = -0.5;
            this.weaponMount.add(blade);
        } else {
            // basic dagger
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.55), mat);
            blade.position.set(0, 0, 0.25); blade.castShadow = true;
            this.weaponMount.add(blade);
            const guard = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.06), mat);
            guard.position.set(0, 0, 0);
            this.weaponMount.add(guard);
        }

        // remove off-hand if no longer dual-wield
        if (this.offhandMount && w.type !== 'dual_fast') {
            this.group.remove(this.offhandMount);
            this.offhandMount = null;
        }
    }

    _buildSlashTrail() {
        // ribbon-like swing trail. We expose `setTrailActive` to enable for `n` seconds.
        const len = 12;
        const positions = new Float32Array(len * 3 * 2);
        this.trailGeo = new THREE.BufferGeometry();
        this.trailGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const indices = [];
        for (let i = 0; i < len - 1; i++) {
            const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
            indices.push(a, b, c, b, d, c);
        }
        this.trailGeo.setIndex(indices);
        this.trailMat = new THREE.MeshBasicMaterial({ color: 0xff4060, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
        this.trail = new THREE.Mesh(this.trailGeo, this.trailMat);
        this.trail.frustumCulled = false;
        this.scene.add(this.trail);
        this.trailLife = 0;
        this.trailHistory = []; // array of THREE.Vector3 (tip pos + base pos pairs)
        this.trailLen = len;
    }

    setTrailActive(durationSec, color = 0xff4060) {
        this.trailLife = durationSec;
        this.trailMat.color.setHex(color);
        this.trailMat.opacity = 0.85;
    }

    _updateTrail(dt) {
        // Sample tip+base each frame while active
        if (this.trailLife > 0) {
            this.trailLife -= dt;
            // tip = end of weapon pointing forward; base = mount base
            const tip = new THREE.Vector3();
            this.weaponMount.getWorldPosition(tip);
            const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion);
            const tipPos = tip.clone().addScaledVector(fwd, 1.6).add(new THREE.Vector3(0, 0.3, 0));
            const basePos = tip.clone().addScaledVector(fwd, 0.2);
            this.trailHistory.unshift([tipPos, basePos]);
            if (this.trailHistory.length > this.trailLen) this.trailHistory.length = this.trailLen;

            const pos = this.trailGeo.attributes.position.array;
            for (let i = 0; i < this.trailLen; i++) {
                const sample = this.trailHistory[i] || this.trailHistory[this.trailHistory.length - 1] || [tipPos, basePos];
                pos[i * 6 + 0] = sample[0].x; pos[i * 6 + 1] = sample[0].y; pos[i * 6 + 2] = sample[0].z;
                pos[i * 6 + 3] = sample[1].x; pos[i * 6 + 4] = sample[1].y; pos[i * 6 + 5] = sample[1].z;
            }
            this.trailGeo.attributes.position.needsUpdate = true;
            this.trailMat.opacity = Math.max(0, this.trailLife * 2.0);
        } else if (this.trailMat.opacity > 0) {
            this.trailMat.opacity = Math.max(0, this.trailMat.opacity - dt * 4);
            this.trailHistory.length = 0;
        }
    }

    applyState(state) {
        Object.assign(this.stats, state.stats || {});
        this.maxHealth = state.stats.max_health || 120;
        this.health = state.stats.health ?? this.maxHealth;
        this.maxStamina = state.stats.max_stamina || 100;
        this.stamina = state.stats.stamina ?? this.maxStamina;
        this.maxEnergy = state.stats.max_energy || 100;
        this.energy = state.stats.energy ?? 0;
        const cls = state.class || this.game.playerClass || 'sword';
        this.game.playerClass = cls;
        const weaponId = state.weapon || `${cls}_common`;
        this.equipWeapon(weaponId);
        // re-apply upgrades
        if (state.upgrades) {
            for (const u of state.upgrades) this.game.upgrades.applyUpgrade(u, /* fromLoad */ true);
        }
    }

    snapshotStats() {
        return {
            ...this.stats,
            max_health: this.maxHealth, health: this.health,
            max_stamina: this.maxStamina, stamina: this.stamina,
            max_energy: this.maxEnergy, energy: this.energy,
        };
    }

    equipWeapon(id) {
        // Resolve fallback if id missing (e.g. legacy save). Try the player's
        // class default; if still missing, fall back to the first known weapon.
        let weapon = this.game.weaponData[id];
        if (!weapon) {
            const cls = this.weaponClass || this.game.playerClass || 'sword';
            id = `${cls}_common`;
            weapon = this.game.weaponData[id];
        }
        this.weaponId = id;
        this.weapon = weapon || null;
        this.weaponClass = weapon ? (weapon.class || _legacyClass(weapon)) : 'sword';
        if (this.weapon) this.game.playerClass = this.weaponClass;
        this._buildWeaponMesh();

        // Update HUD weapon label with rarity-tinted color
        if (this.game.hud && this.weapon) {
            const rarityColors = {
                common: '#cfcfcf', uncommon: '#6dd66d', rare: '#3aa0ff',
                epic: '#a45cff', legendary: '#ffb635',
            };
            const c = rarityColors[this.weapon.rarity] || this.weapon.color || '#fff';
            this.game.hud.setWeaponLabel(this.weapon.name, c);

            // Skill name labels can vary by class
            const r = this._rNameForClass(this.weaponClass);
            const q = this._qNameForClass(this.weaponClass);
            this.game.hud.setSkillNames({ Q: q, E: 'Smoke Bomb', R: r, F: 'Reaper Time' });
        }
    }

    _rNameForClass(cls) {
        return {
            sword:  'Whirlwind',
            dagger: 'Blade Flurry',
            bow:    'Arrow Storm',
            scythe: 'Reaping Spin',
        }[cls] || 'Blade Flurry';
    }
    _qNameForClass(cls) {
        return {
            sword:  'Shadow Dash',
            dagger: 'Phantom Step',
            bow:    'Shadow Roll',
            scythe: 'Soul Pull',
        }[cls] || 'Shadow Dash';
    }

    /** Bump the infinite combo counter and refresh its 1.5s decay timer. */
    incrementCombo() {
        this.comboCount = (this.comboCount || 0) + 1;
        this.comboTimer = 1.5;
    }

    isRanged() { return this.weapon && this.weapon.type === 'ranged'; }

    /** Apply a server snapshot in MP mode. */
    _serverApply(ps) {
        // Detect a fresh swing so we can latch a swing animation timer.
        const prevSwing = this._serverSwing || 0;

        this._serverTargetX = ps.x;
        this._serverTargetZ = ps.z;
        this._serverTargetFacing = ps.f;
        this._serverSwing = ps.sw || 0;
        this._serverAlive = ps.alive !== false;
        this.health = ps.hp;
        this.maxHealth = ps.max_hp;
        this.stamina = ps.st;
        this.maxStamina = ps.max_st;
        this.energy = ps.en;
        this.maxEnergy = ps.max_en;
        this.alive = this._serverAlive;
        this.invuln = ps.inv ? 0.1 : 0;
        if (ps.combo !== undefined) this.comboCount = ps.combo;

        // Cooldowns — drive the HUD's radial sweep.
        if (this.skills) {
            if (ps.cdQ !== undefined) this.skills.Q.cd = ps.cdQ;
            if (ps.cdE !== undefined) this.skills.E.cd = ps.cdE;
            if (ps.cdR !== undefined) this.skills.R.cd = ps.cdR;
            // Reaper Time / F is energy-gated; energy is updated above.
        }

        // Live stats so the HUD combo bonus / inventory show real numbers.
        if (ps.stats && typeof ps.stats === 'object') {
            Object.assign(this.stats, ps.stats);
        }

        // Upgrade history — used by InventoryUI's "Upgrades Acquired" panel.
        if (Array.isArray(ps.upgrades)) {
            if (!this.game.runState) this.game.runState = {};
            this.game.runState.upgrades = ps.upgrades;
        }

        // Latch a brief weapon-mount swing animation when swing rises 0 -> 1/2.
        if (prevSwing === 0 && this._serverSwing >= 1) {
            const speed = (this.weapon && this.weapon.speed) || 1.0;
            const dur = (this._serverSwing === 2 ? 0.55 : 0.34) / speed;
            this.attackTimer = dur;
            this._curSwingDuration = dur;
        }

        // Re-equip if server swapped weapon
        if (ps.wpn && ps.wpn !== this.weaponId) {
            this.equipWeapon(ps.wpn);
        }
    }

    // ---- damage IO ----
    takeDamage(amount, source) {
        if (!this.alive) return false;
        if (this.invuln > 0) return false;
        this.health -= amount;
        this.invuln = 0.8; // increased i-frames
        this.game.audio.hurt();
        this.game.scene.addShake(0.2 + Math.min(0.4, amount / 60), 0.25);
        this.game.dmgNumbers.spawn(this.position.clone().add(new THREE.Vector3(0, 1.6, 0)), Math.floor(amount), { kind: 'player' });
        if (this.health <= 0) {
            this.health = 0;
            this.alive = false;
            this.game.onPlayerDied();
        }
        return true;
    }

    /** Bring the player back to life — used in MP wave-clear revives. */
    revive(pos) {
        this.alive = true;
        this.health = this.maxHealth;
        this.invuln = 1.5;
        if (pos) {
            this.position.copy(pos);
            this.position.y = 0;
        }
        this.group.visible = true;
        // Reset combat timers so they can attack immediately.
        this.attackTimer = 0;
        this.comboCount = 0;
        this.comboTimer = 0;
    }

    heal(a) {
        const before = this.health;
        this.health = Math.min(this.maxHealth, this.health + a);
        const delta = this.health - before;
        if (delta > 0.1) this.game.dmgNumbers.spawn(this.position.clone().add(new THREE.Vector3(0, 1.6, 0)), Math.ceil(delta), { kind: 'heal' });
    }

    // ---- main update ----
    update(dt, rawDt, input) {
        // Mouse only controls horizontal rotation — vertical pitch is fixed.
        const mouse = input.consumeMouse();
        const sens = input.sensitivity;
        this.yaw -= mouse.dx * sens;

        // Multiplayer: server-driven. We only update camera + animation here.
        // (Buttons are sampled in Game._loop and sent via _netInputTick.)
        if (this._mp) {
            // Smooth-lerp toward the last server-applied target position.
            if (this._serverTargetX !== undefined) {
                this.position.x += (this._serverTargetX - this.position.x) * Math.min(1, rawDt * 16);
                this.position.z += (this._serverTargetZ - this.position.z) * Math.min(1, rawDt * 16);
                let df = (this._serverTargetFacing ?? this.facing) - this.facing;
                while (df >  Math.PI) df -= Math.PI * 2;
                while (df < -Math.PI) df += Math.PI * 2;
                this.facing += df * Math.min(1, rawDt * 14);
            }
            this.group.position.copy(this.position);
            this.group.rotation.y = this.facing;

            // Walk-bob based on perceived movement
            const moving = (Math.hypot((this._serverTargetX ?? this.position.x) - this.position.x,
                                       (this._serverTargetZ ?? this.position.z) - this.position.z) > 0.05);
            const tNow = performance.now() / 1000;
            const bob = moving ? Math.sin(tNow * 9) : 0;
            if (this.lLeg) this.lLeg.rotation.x = bob * 0.6;
            if (this.rLeg) this.rLeg.rotation.x = -bob * 0.6;

            // Tick the local swing-animation timer set by _serverApply.
            if (this.attackTimer > 0) this.attackTimer -= rawDt;

            // Class-specific weapon-swing animation (mirrors the SP path).
            if (this.attackTimer > 0) {
                const totalDur = this._curSwingDuration || 0.3;
                const tProg = 1 - (this.attackTimer / totalDur);
                const sw = Math.sin(Math.PI * tProg);
                const cls = this.weaponClass || 'sword';
                if (cls === 'sword') {
                    this.weaponMount.rotation.z = 0.7 - 1.7 * sw;
                    this.weaponMount.rotation.x = -0.6 * sw;
                    this.weaponMount.rotation.y = -0.3 * sw;
                    this.rArm.rotation.x = -1.5 * sw;
                    this.rArm.rotation.z = -0.5 * sw;
                } else if (cls === 'dagger') {
                    this.weaponMount.position.set(0.48, 0.95, 0.10 + 0.7 * sw);
                    this.weaponMount.rotation.x = -0.3 * sw;
                    this.rArm.rotation.x = -1.6 * sw;
                    if (this.offhandMount) {
                        const phase = Math.sin(Math.PI * tProg + Math.PI / 2);
                        this.offhandMount.position.set(-0.48, 0.95, 0.10 + 0.6 * Math.max(0, phase));
                        this.lArm.rotation.x = -1.4 * Math.max(0, phase);
                    }
                } else if (cls === 'bow') {
                    this.lArm.rotation.x = -1.0 * sw;
                    this.lArm.position.z = -0.6 * sw;
                    this.rArm.rotation.x = -0.5;
                    this.weaponMount.rotation.x = -0.1 * sw;
                } else if (cls === 'scythe') {
                    this.weaponMount.rotation.y = 1.4 - 2.8 * sw;
                    this.weaponMount.rotation.x = -0.2 * sw;
                    this.rArm.rotation.x = -1.2 * sw;
                    this.rArm.rotation.z = 0.6 * sw;
                } else {
                    this.weaponMount.rotation.x = -1.6 * sw;
                    this.rArm.rotation.x = -1.4 * sw;
                }
                // Activate the slash trail for the current weapon's color.
                if (!this._mpTrailLatched) {
                    this.setTrailActive(totalDur + 0.15, this._weaponTrailColor());
                    this._mpTrailLatched = true;
                }
            } else {
                // Ease back to neutral pose after a swing finishes.
                this.weaponMount.rotation.x *= 0.78;
                this.weaponMount.rotation.y *= 0.78;
                this.weaponMount.rotation.z *= 0.78;
                const baseX = 0.48, baseY = 0.95, baseZ = 0.10;
                this.weaponMount.position.x += (baseX - this.weaponMount.position.x) * 0.3;
                this.weaponMount.position.y += (baseY - this.weaponMount.position.y) * 0.3;
                this.weaponMount.position.z += (baseZ - this.weaponMount.position.z) * 0.3;
                if (this.offhandMount) {
                    this.offhandMount.position.x += (-baseX - this.offhandMount.position.x) * 0.3;
                    this.offhandMount.position.y += (baseY - this.offhandMount.position.y) * 0.3;
                    this.offhandMount.position.z += (baseZ - this.offhandMount.position.z) * 0.3;
                }
                this.rArm.rotation.z *= 0.78;
                this.lArm.rotation.z *= 0.78;
                this.lArm.position.z *= 0.78;
                // Idle bobbing arms when not swinging.
                this.lArm.rotation.x = -bob * 0.4;
                this.rArm.rotation.x = bob * 0.4;
                this._mpTrailLatched = false;
            }

            // R-skill spin override — server reports swing == 2 while spinning.
            if (this._serverSwing === 2) {
                this.facing += rawDt * 12;
                this.group.rotation.y = this.facing;
            }

            // Hide the mesh while dead.
            this.group.visible = (this._serverAlive !== false);
            this._updateCamera(rawDt);
            this._updateTrail(rawDt);
            return;
        }

        // Spectator mode: dead but party still alive — let the camera rotate
        // and follow the last position, but no movement / attacks / skills.
        if (!this.alive) {
            this._updateCamera(rawDt);
            return;
        }

        if (input.pressed('KeyL')) this._cycleLockOn();

        // movement input
        const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        const right = new THREE.Vector3(Math.sin(this.yaw + Math.PI / 2), 0, Math.cos(this.yaw + Math.PI / 2));
        const move = new THREE.Vector3();
        if (input.isDown('KeyW')) move.add(fwd);
        if (input.isDown('KeyS')) move.sub(fwd);
        if (input.isDown('KeyA')) move.add(right);
        if (input.isDown('KeyD')) move.sub(right);
        const sprinting = input.isDown('ShiftLeft') && this.stamina > 5 && move.lengthSq() > 0.01;
        if (sprinting) {
            this.stamina = Math.max(0, this.stamina - 30 * rawDt);
        } else {
            this.stamina = Math.min(this.maxStamina, this.stamina + 22 * rawDt * (this.stats.stamina_regen || 1));
        }

        const baseSpeed = (sprinting ? 8.0 : 5.0) * (this.stats.move_speed || 1);
        if (move.lengthSq() > 0) {
            move.normalize().multiplyScalar(baseSpeed);
        }

        // dash skill
        if (input.pressed('Space')) {
            this.skills.Q.activate(input);
        }
        if (input.pressed('KeyQ')) this.skills.Q.activate(input);
        if (input.pressed('KeyE')) this.skills.E.activate(input);
        if (input.pressed('KeyR')) this.skills.R.activate(input);
        if (input.pressed('KeyF')) this.skills.F.activate(input);

        // skill ticks
        for (const k of Object.keys(this.skills)) this.skills[k].update(dt, rawDt);

        // dash velocity override (set on skill)
        if (this._dashVel) {
            this.position.x += this._dashVel.x * dt;
            this.position.z += this._dashVel.z * dt;
            this._dashTime -= dt;
            if (this._dashTime <= 0) this._dashVel = null;
        } else {
            this.position.x += move.x * dt;
            this.position.z += move.z * dt;
        }
        // Collision against arena
        const r = this.game.arena.resolveCollision(this.position.x, this.position.z, 0.45);
        this.position.x = r.x; this.position.z = r.z;
        this.position.y = 0;

        // facing: skills like Whirlwind / Blade Flurry spin the player and
        // set _spinningSkill so we don't snap back to mouse / movement facing.
        if (!this._spinningSkill) {
            if (move.lengthSq() > 0.001) {
                this.facing = Math.atan2(move.x, move.z);
            }
            if (input.mouse.lmb || this.attackTimer > 0) {
                this.facing = this.yaw;
            }
            if (this.lockTarget && this.lockTarget.alive) {
                const dx = this.lockTarget.position.x - this.position.x;
                const dz = this.lockTarget.position.z - this.position.z;
                this.facing = Math.atan2(dx, dz);
            }
        }
        // Skill resets the flag every frame it's active — clear it now so
        // it's only honoured for one frame at a time.
        this._spinningSkill = false;

        this.group.position.copy(this.position);
        this.group.rotation.y = this.facing;
        // Forward-lean visual during a dash, then ease back upright.
        const dashing = !!this._dashVel;
        const targetTilt = dashing ? (this.weaponClass === 'bow' ? -0.35 : 0.35) : 0;
        this.group.rotation.x += (targetTilt - this.group.rotation.x) * Math.min(1, rawDt * 12);

        // Limb bobbing while moving
        const t = performance.now() / 1000;
        const moving = move.lengthSq() > 0.01;
        const bob = moving ? Math.sin(t * (sprinting ? 14 : 9)) : 0;
        this.lLeg.rotation.x = bob * 0.6;
        this.rLeg.rotation.x = -bob * 0.6;
        if (this.attackTimer <= 0) {
            this.lArm.rotation.x = -bob * 0.5;
            this.rArm.rotation.x = bob * 0.5;
        }

        // Combat input
        if (this.attackTimer > 0) this.attackTimer -= dt;
        if (this.comboWindow > 0) this.comboWindow -= dt;
        else if (this.comboWindow <= 0 && this.comboIndex !== 0) this.comboIndex = 0;

        if (this.comboTimer > 0) {
            this.comboTimer -= rawDt;
            if (this.comboTimer <= 0) {
                this.comboCount = 0; // reset combo multiplier
            }
        }

        if (input.mouse.lmbJust && this.attackTimer <= 0) this._lightAttack();
        if (input.mouse.rmbJust && this.attackTimer <= 0) this._heavyAttack();

        // Heavy windup → release
        if (this.heavyActive && this.attackTimer < 0.1 && !this.heavyReleased) {
            this._heavyRelease();
        }

        // Class-specific weapon-swing animation.
        if (this.attackTimer > 0) {
            const totalDur = this._curSwingDuration || 0.3;
            const t = 1 - (this.attackTimer / totalDur);   // 0..1 across the swing
            const swing = Math.sin(Math.PI * t);            // 0..1..0 bell curve
            const cls = this.weaponClass || 'sword';

            if (cls === 'sword') {
                // Diagonal slash — swings from upper-right down across the body.
                this.weaponMount.rotation.z = 0.7 - 1.7 * swing;
                this.weaponMount.rotation.x = -0.6 * swing;
                this.weaponMount.rotation.y = -0.3 * swing;
                this.rArm.rotation.x = -1.5 * swing;
                this.rArm.rotation.z = -0.5 * swing;
            } else if (cls === 'dagger') {
                // Quick forward stab — translate the mount along Z.
                this.weaponMount.position.set(0.48, 0.95, 0.10 + 0.7 * swing);
                this.weaponMount.rotation.x = -0.3 * swing;
                this.rArm.rotation.x = -1.6 * swing;
                if (this.offhandMount) {
                    // Off-hand stabs on the opposite half-beat for a flurry feel.
                    const phase = Math.sin(Math.PI * t + Math.PI / 2);
                    this.offhandMount.position.set(-0.48, 0.95, 0.10 + 0.6 * Math.max(0, phase));
                    this.lArm.rotation.x = -1.4 * Math.max(0, phase);
                }
            } else if (cls === 'bow') {
                // Draw the bowstring — left arm pulls back, right arm holds the bow.
                // Peak draw is ~80% through the wind-up (heavy / charged), then release.
                const draw = swing;
                this.lArm.rotation.x = -1.0 * draw;
                this.lArm.position.z = -0.6 * draw;       // pulled back
                this.rArm.rotation.x = -0.5;               // bow arm extended forward
                this.weaponMount.rotation.x = -0.1 * swing;
            } else if (cls === 'scythe') {
                // Wide horizontal sweep — rotation around Y.
                this.weaponMount.rotation.y = 1.4 - 2.8 * swing;
                this.weaponMount.rotation.x = -0.2 * swing;
                this.rArm.rotation.x = -1.2 * swing;
                this.rArm.rotation.z = 0.6 * swing;
            } else {
                // Generic vertical chop fallback.
                this.weaponMount.rotation.x = -1.6 * swing;
                this.rArm.rotation.x = -1.4 * swing;
            }
        } else {
            // Ease everything back to neutral pose.
            this.weaponMount.rotation.x *= 0.78;
            this.weaponMount.rotation.y *= 0.78;
            this.weaponMount.rotation.z *= 0.78;
            // Mount and offhand return to base position
            const baseX = 0.48, baseY = 0.95, baseZ = 0.10;
            this.weaponMount.position.x += (baseX - this.weaponMount.position.x) * 0.3;
            this.weaponMount.position.y += (baseY - this.weaponMount.position.y) * 0.3;
            this.weaponMount.position.z += (baseZ - this.weaponMount.position.z) * 0.3;
            if (this.offhandMount) {
                this.offhandMount.position.x += (-baseX - this.offhandMount.position.x) * 0.3;
                this.offhandMount.position.y += (baseY - this.offhandMount.position.y) * 0.3;
                this.offhandMount.position.z += (baseZ - this.offhandMount.position.z) * 0.3;
            }
            // Reset arm offsets used during bow draw / sword slash
            this.rArm.rotation.z *= 0.78;
            this.lArm.rotation.z *= 0.78;
            this.lArm.position.z *= 0.78;
        }

        // i-frames countdown
        if (this.invuln > 0) {
            this.invuln -= rawDt;
            // Visual blink effect for i-frames
            const blink = Math.floor(this.invuln * 15) % 2 === 0;
            this.lLeg.visible = this.rLeg.visible = this.torso.visible = this.head.visible = this.lArm.visible = this.rArm.visible = blink;
        } else {
            this.lLeg.visible = this.rLeg.visible = this.torso.visible = this.head.visible = this.lArm.visible = this.rArm.visible = true;
        }

        // Camera follow
        this._updateCamera(rawDt);

        // Trail update
        this._updateTrail(rawDt);

        // bookkeeping
        if (this.health <= 0 && this.game.state === 'playing') this.game.onPlayerDied();
    }

    _cycleLockOn() {
        const me = this.position;
        const cands = this.game.enemies.filter(e => e.alive);
        if (cands.length === 0) { this.lockTarget = null; return; }
        cands.sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me));
        if (!this.lockTarget) this.lockTarget = cands[0];
        else {
            const idx = cands.indexOf(this.lockTarget);
            this.lockTarget = cands[(idx + 1) % cands.length];
        }
        this.game.hud.toast(`Locked on: ${this.lockTarget.name}`);
    }

    _updateCamera(dt) {
        // Camera is locked at a fixed offset above and behind the player; only yaw orbits.
        const desired = new THREE.Vector3(
            this.position.x - Math.sin(this.yaw) * this.cameraDist,
            this.position.y + this.cameraHeight,
            this.position.z - Math.cos(this.yaw) * this.cameraDist,
        );
        // Snappy camera follow — orientation matches mouse immediately, position eases.
        this.camera.position.lerp(desired, Math.min(1, dt * 18));
        this.cameraTarget.set(this.position.x, this.position.y + 1.5, this.position.z);
        this.camera.lookAt(this.cameraTarget);
    }

    // ---- attacks ----
    _lightAttack() {
        if (this.isRanged()) return this._fireArrow(false);

        const w = this.weapon;
        if (!w) return;
        const baseCombo = w.combo + (this.stats.extra_combo_hits || 0);
        const total = baseCombo;
        this.comboIndex = ((this.comboIndex) % total) + 1;
        this.comboWindow = 0.7;

        const speedMul = w.speed || 1.0;
        const swingDur = 0.34 / speedMul;
        this.attackTimer = swingDur;
        this._curSwingDuration = swingDur;
        this.game.audio.swing();
        this.setTrailActive(swingDur + 0.15, this._weaponTrailColor());
        // Hit window roughly mid-swing
        this._scheduleMeleeHit(swingDur * 0.45, swingDur * 0.85);
    }

    _heavyAttack() {
        if (this.isRanged()) return this._fireArrow(true);
        const w = this.weapon;
        if (!w) return;
        const swingDur = 0.55 / (w.speed || 1.0);
        this.attackTimer = swingDur;
        this._curSwingDuration = swingDur;
        this.heavyActive = true;
        this.heavyReleased = false;
        this.game.audio.heavySwing();
        this.setTrailActive(swingDur + 0.2, this._weaponTrailColor());
        this._scheduleMeleeHit(swingDur * 0.55, swingDur * 0.9, /* heavy */ true);
    }

    _heavyRelease() {
        this.heavyActive = false; this.heavyReleased = true;
        // Moonveil: spawn an energy crescent projectile
        if (this.weapon && this.weapon.modifies && this.weapon.modifies.heavy_wave) {
            const fwd = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
            const start = this.position.clone().add(fwd.clone().multiplyScalar(1.2)).add(new THREE.Vector3(0, 1.1, 0));
            const opts = {
                origin: start, direction: fwd, speed: 22,
                damage: this.weapon.damage * 1.4, life: 1.4,
                color: this.weapon.color || '#7fdaff', size: 0.55, fromPlayer: true, kind: 'wave',
            };
            const proj = new Projectile(this.game, opts);
            this.game.projectiles.push(proj);
            this.game.audio.skill();
            this._broadcastProjectile(opts);
        }
    }

    /** Broadcast a projectile spawn so other party members can render it as
     *  a ghost (visual-only — they don't compute hits). */
    _broadcastProjectile(opts) {
        if (!this.game.net || !this.game.net.connected) return;
        if (this.game.netMode === 'sp') return;
        this.game.net.send('projectile_spawn', {
            ox: opts.origin.x, oy: opts.origin.y, oz: opts.origin.z,
            dx: opts.direction.x, dz: opts.direction.z,
            speed: opts.speed, damage: opts.damage, life: opts.life,
            color: opts.color, size: opts.size, kind: opts.kind,
            pierce: !!opts.pierce, ricochet: opts.ricochet || 0,
        });
    }

    _fireArrow(charged) {
        const w = this.weapon;
        const dur = charged ? 0.45 : 0.22;
        if (this.stamina < 5) return;
        this.stamina = Math.max(0, this.stamina - 4);
        this.attackTimer = dur;
        this._curSwingDuration = dur;
        this.game.audio.bowShot();
        const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        const target = this.lockTarget && this.lockTarget.alive
            ? this.lockTarget.position.clone()
            : this.position.clone().add(fwd.clone().multiplyScalar(20));
        const start = this.position.clone().add(fwd.clone().multiplyScalar(0.6)).add(new THREE.Vector3(0, 1.3, 0));
        const baseDir = target.clone().sub(start); baseDir.y = 0; baseDir.normalize();
        const dmg = (charged ? w.damage * 1.8 : w.damage);

        // Multishot: extra arrows fan out at small angles
        const extraShots = (this.stats.multishot || 0);
        const totalShots = 1 + extraShots;
        const fanAngle = 0.10; // radians between shots
        const ricochet = this.stats.ricochet ? 1 : 0;
        const autoRic = (w.modifies && w.modifies.auto_ricochet) || 0;
        const pierce = (w.modifies && w.modifies.pierce) || charged;

        for (let i = 0; i < totalShots; i++) {
            const offset = (i - (totalShots - 1) / 2) * fanAngle;
            const c = Math.cos(offset), s = Math.sin(offset);
            const dir = new THREE.Vector3(
                baseDir.x * c - baseDir.z * s,
                0,
                baseDir.x * s + baseDir.z * c,
            );
            const opts = {
                origin: start.clone(), direction: dir, speed: 36, damage: dmg,
                life: 2.5, color: w.color || '#9bff9b', size: 0.18,
                fromPlayer: true, kind: 'arrow',
                pierce, ricochet: ricochet + autoRic,
            };
            const proj = new Projectile(this.game, opts);
            this.game.projectiles.push(proj);
            this._broadcastProjectile(opts);
        }
    }

    _scheduleMeleeHit(startT, endT, heavy = false) {
        // Simple model: register a "hit pulse" that the combat system polls.
        this.game.combat.registerMeleePulse(this, {
            startIn: startT,
            endIn: endT,
            heavy,
            comboIndex: this.comboIndex,
            applied: new Set(),
        });
    }

    incrementCombo() {
        this.comboCount = (this.comboCount || 0) + 1;
        this.comboTimer = 1.5; // 1.5s before combo resets
    }

    _weaponTrailColor() {
        const w = this.weapon;
        if (!w) return 0xff4060;
        return new THREE.Color(w.color || '#ff4060').getHex();
    }

    // helpers used by skills/combat
    forwardDir() {
        return new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
    }

    dispose() {
        this.scene.remove(this.group);
        this.scene.remove(this.trail);
    }
}
