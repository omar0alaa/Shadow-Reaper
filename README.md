# Shadow Reaper

A dark fantasy 3D roguelike action game running entirely in your browser via a tiny Flask backend and Three.js front-end.

## Run

```
pip install -r requirements.txt
python app.py
```

Then open http://localhost:5000 and click **New Run**.

> First click anywhere unlocks audio (browser policy). The game then locks the mouse pointer for camera control. Press **Esc** to pause and release the cursor.

## Controls

| Action            | Key                |
|-------------------|--------------------|
| Move              | **W A S D**        |
| Sprint            | **Shift**          |
| Look              | Mouse              |
| Light Attack      | **Left Mouse**     |
| Heavy Attack      | **Right Mouse**    |
| Shadow Dash       | **Q** or **Space** |
| Smoke Bomb        | **E**              |
| Blade Flurry      | **R**              |
| Reaper Time (ult) | **F**              |
| Lock-on (cycle)   | **L**              |
| Inventory         | **Tab**            |
| Pause             | **Esc**            |

## Loop

1. Spawn in a procedurally generated stone arena.
2. Survive escalating waves of enemies. After each clear, pick **1 of 3 upgrades** (they stack for the run).
3. Every **5th wave** spawns a **Mini-Boss** alongside normal foes (drops gold/health/shards — *no weapons*).
4. Every **10th wave** is a **Real Boss** (multi-phase). **Bosses are the only source of weapon drops**, and each weapon fundamentally changes how the game plays:

| Weapon              | Style change                                                          |
|---------------------|-----------------------------------------------------------------------|
| Rusted Dagger       | Fast 3-hit melee combo (default)                                      |
| Shadowfang Daggers  | 5-hit dual combo, applies Bleed, Blade Flurry gains extra hits        |
| Moonveil Sword      | Heavy releases crescent waves; Shadow Dash leaves a damaging slash    |
| Phantom Bow         | Ranged. Charged shots; Blade Flurry → **Arrow Storm** (rains arrows)  |
| Reaper's Scythe     | Wide AoE; innate lifesteal; ult gains kill explosions                 |

5. Death is permadeath — back to the main menu with a run summary. Backend logs run history to `saves/meta.json`.

## What's actually in here

* **Real 3D scene** — perspective camera, soft shadows, ACES tone mapping, UnrealBloom, vignette + chromatic aberration during ultimate.
* **5 enemy archetypes** + Skeleton minions + Mini-Boss + multi-phase Bosses.
* **Backstab 2x damage** with crit detection, hit-stop, slash trail ribbons, dissolve-on-death animation.
* **Procedural everything**: arenas (deterministic per seed), waves, weapon drop weights, ambient music, every sound effect (WebAudio synthesis — no external assets).
* **20+ stacking upgrades** (chain lightning, ricochet, poison dash, soul detonation, execute, etc.) and they actually modify combat math, not just stats.
* **Save/load** via Flask + JSON (`saves/run.json`). Settings persist (`saves/settings.json`).
* **Minimap**, **damage numbers** projected from world to screen, **boss health bar**, **smooth HUD lerps**.

## Tips

* **Backstabs deal 2x damage.** Smoke Bomb blinds enemies and your first attack from stealth is a guaranteed crit — combine for huge openers.
* Phantom Bow flips you into a ranged build. Reaper's Scythe with `Soul Detonation` and `Death Incarnate` is what real builds dream of.
* Bosses telegraph attacks with a red emissive flash. AoE rings in phase 2+ deal damage at the wavefront — **dash through them, not against them**.

## Project layout

```
shadow_reaper/
├── app.py                       Flask entry
├── requirements.txt
├── backend/
│   ├── routes.py                REST endpoints
│   ├── procedural.py            Seeded arena + wave generation
│   ├── save_manager.py          JSON save/load
│   └── game_data.py             Weapons, upgrades, enemy specs
├── templates/index.html         App shell + import map
└── static/
    ├── css/style.css            HUD, menus, dark fantasy palette
    └── js/                      ES6 modules
        ├── main.js              boot
        ├── core/                Game, Scene, Input, Audio
        ├── world/               Arena, Minimap
        ├── entities/            Player, Enemy, Boss, MiniBoss
        ├── combat/              CombatSystem, Weapon, Projectile
        ├── skills/              ShadowDash, SmokeBomb, BladeFlurry, ReaperTime
        ├── progression/         Inventory, UpgradeSystem, LootSystem
        ├── ui/                  HUD, MainMenu, UpgradeUI, InventoryUI, DeathScreen
        └── vfx/                 ParticleSystem, DamageNumbers, PostProcessing
```

## Notes

* If audio is silent, click the page once — modern browsers require a user gesture before audio.
* If pointer lock can't engage (some browsers block it from inactive tabs), click the canvas.
