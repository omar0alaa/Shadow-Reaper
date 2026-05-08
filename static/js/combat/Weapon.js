// Weapon.js — small helper to evaluate weapon-specific behaviors.
// Most weapon behavior lives in Player.js / CombatSystem because it must intersect
// with the scene; this file holds reusable predicates the rest of the engine uses.

export const WeaponTraits = {
    isMelee(w) { return w && (w.type === 'melee_fast' || w.type === 'melee_heavy' || w.type === 'melee_aoe' || w.type === 'dual_fast'); },
    isDual(w)  { return w && w.type === 'dual_fast'; },
    isRanged(w){ return w && w.type === 'ranged'; },
    appliesBleed(w) { return w && w.modifies && !!w.modifies.bleed; },
    hasHeavyWave(w) { return w && w.modifies && !!w.modifies.heavy_wave; },
    hasDashSlash(w) { return w && w.modifies && !!w.modifies.dash_slash; },
    hasUltExplosions(w) { return w && w.modifies && !!w.modifies.ult_kill_explosions; },
    bonusBladeFlurryHits(w) { return w && w.modifies ? (w.modifies.blade_flurry_extra_hits || 0) : 0; },
    bladeFlurryAsArrowStorm(w) { return w && w.modifies && !!w.modifies.blade_flurry_arrow_storm; },
    weaponLifesteal(w) { return w && w.modifies ? (w.modifies.lifesteal || 0) : 0; },
};
