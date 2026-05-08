// Weapon.js — predicates for weapon-class & rarity-driven behaviour.
// Single source of truth for "does this weapon X?" so combat code doesn't
// have to know individual weapon ids.

export const WeaponTraits = {
    // class detection
    classOf(w)  { return w && w.class ? w.class : (w ? _legacyClass(w) : null); },
    isMelee(w)  { return w && (w.type === 'melee_balanced' || w.type === 'melee_heavy' || w.type === 'melee_aoe' || w.type === 'melee_fast' || w.type === 'dual_fast'); },
    isDual(w)   { return w && w.type === 'dual_fast'; },
    isRanged(w) { return w && w.type === 'ranged'; },
    isAoE(w)    { return w && w.type === 'melee_aoe'; },

    // rarity-tier modifies
    appliesBleed(w)            { return !!(w && w.modifies && w.modifies.bleed); },
    bleedStrong(w)             { return !!(w && w.modifies && w.modifies.bleed_strong); },
    hasHeavyWave(w)            { return !!(w && w.modifies && w.modifies.heavy_wave); },
    hasWavePierce(w)           { return !!(w && w.modifies && w.modifies.wave_pierce); },
    hasDashSlash(w)            { return !!(w && w.modifies && w.modifies.dash_slash); },
    hasUltExplosions(w)        { return !!(w && w.modifies && w.modifies.ult_kill_explosions); },
    hasPierce(w)               { return !!(w && w.modifies && w.modifies.pierce); },
    autoRicochet(w)            { return (w && w.modifies && w.modifies.auto_ricochet) || 0; },
    bonusBladeFlurryHits(w)    { return (w && w.modifies && w.modifies.blade_flurry_extra_hits) || 0; },
    bladeFlurryAsArrowStorm(w) { return !!(w && w.modifies && w.modifies.blade_flurry_arrow_storm); },
    weaponLifesteal(w)         { return (w && w.modifies && w.modifies.lifesteal) || 0; },
};

// Map old type strings → class for legacy weapon entries.
function _legacyClass(w) {
    if (!w) return null;
    if (w.type === 'ranged') return 'bow';
    if (w.type === 'melee_aoe') return 'scythe';
    if (w.type === 'dual_fast' || w.type === 'melee_fast') return 'dagger';
    return 'sword';
}
