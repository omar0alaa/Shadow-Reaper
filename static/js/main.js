// Shadow Reaper — boot.
// Boots the menu, then hands off to Game on "New Run" / "Continue".

import { Game } from './core/Game.js';
import { MainMenu } from './ui/MainMenu.js';

const loading = document.getElementById('loadingScreen');
const game = new Game();
const menu = new MainMenu(game);

window.addEventListener('error', (e) => {
    console.error('[ShadowReaper]', e.error || e.message);
});

(async () => {
    await game.preload();
    loading.classList.add('hidden');
    menu.show();
})();

// expose for debugging
window.__sr = { game, menu };
