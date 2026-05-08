// Concrete enemy types (Bandit, Archer, Knight, Assassin, Necromancer, Skeleton).
// All share Enemy.js as base; tweaks are mostly stat/behavior driven.

import { Enemy } from './Enemy.js';

class Bandit extends Enemy {
    constructor(game, spec, x, z) {
        super(game, spec, x, z);
        this.aggroRange = 24;
    }
}
class Archer extends Enemy {
    constructor(game, spec, x, z) {
        super(game, spec, x, z);
        this.aggroRange = 30;
    }
}
class Knight extends Enemy {
    constructor(game, spec, x, z) {
        super(game, spec, x, z);
        this.aggroRange = 18;
    }
}
class Assassin extends Enemy {
    constructor(game, spec, x, z) {
        super(game, spec, x, z);
        this.aggroRange = 28;
    }
}
class Necromancer extends Enemy {
    constructor(game, spec, x, z) {
        super(game, spec, x, z);
        this.aggroRange = 22;
        this.attackCooldown = 3.0;
    }
}
class Skeleton extends Enemy {
    constructor(game, spec, x, z) {
        super(game, spec, x, z);
    }
}

export function spawnEnemyByType(game, type, spec, x, z) {
    switch (type) {
        case 'bandit':      return new Bandit(game, spec, x, z);
        case 'archer':      return new Archer(game, spec, x, z);
        case 'knight':      return new Knight(game, spec, x, z);
        case 'assassin':    return new Assassin(game, spec, x, z);
        case 'necromancer': return new Necromancer(game, spec, x, z);
        case 'skeleton':    return new Skeleton(game, spec, x, z);
        default:            return new Bandit(game, spec, x, z);
    }
}

// Hook for Necromancer summoning — Game.spawnSkeleton
export function attachSpawnHelpers(game, ENEMY_DATA) {
    game.spawnSkeleton = (x, z) => {
        const sk = spawnEnemyByType(game, 'skeleton', { ...ENEMY_DATA.skeleton, type: 'skeleton' }, x, z);
        game.enemies.push(sk);
    };
}
