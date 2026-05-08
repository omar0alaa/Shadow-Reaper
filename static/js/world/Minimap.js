// Minimap.js — Canvas2D minimap.
export class Minimap {
    constructor() {
        this.canvas = document.getElementById('minimap');
        this.ctx = this.canvas.getContext('2d');
        this.size = this.canvas.width;
    }

    draw(game) {
        const ctx = this.ctx;
        const s = this.size;
        ctx.clearRect(0, 0, s, s);

        if (!game.arena) return;
        const r = game.arena.radius;
        const scale = (s * 0.46) / r;
        const cx = s / 2, cy = s / 2;

        // arena floor
        ctx.fillStyle = 'rgba(40,30,55,0.5)';
        ctx.beginPath();
        ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(197,37,47,0.45)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Props
        ctx.fillStyle = 'rgba(180,180,180,0.55)';
        for (const p of game.arena.data.props) {
            if (p.type === 'brazier') ctx.fillStyle = '#ffa040';
            else if (p.type === 'pillar') ctx.fillStyle = 'rgba(180,180,180,0.7)';
            else if (p.type === 'statue') ctx.fillStyle = 'rgba(170,140,200,0.7)';
            else ctx.fillStyle = 'rgba(140,130,150,0.5)';
            ctx.beginPath();
            ctx.arc(cx + p.x * scale, cy + p.z * scale, 1.6, 0, Math.PI * 2);
            ctx.fill();
        }

        // Loot
        ctx.fillStyle = '#ffd166';
        for (const l of game.lootDrops) {
            ctx.beginPath();
            ctx.arc(cx + l.position.x * scale, cy + l.position.z * scale, 2, 0, Math.PI * 2);
            ctx.fill();
        }

        // Enemies
        for (const e of game.enemies) {
            if (!e.alive) continue;
            if (e.isBoss) { ctx.fillStyle = '#ff2a2a'; }
            else if (e.isMiniBoss) { ctx.fillStyle = '#ff8c1a'; }
            else { ctx.fillStyle = '#ff4060'; }
            const sz = e.isBoss ? 5 : (e.isMiniBoss ? 4 : 2.4);
            ctx.beginPath();
            ctx.arc(cx + e.position.x * scale, cy + e.position.z * scale, sz, 0, Math.PI * 2);
            ctx.fill();
        }

        // Player as arrow
        if (game.player) {
            const px = cx + game.player.position.x * scale;
            const pz = cy + game.player.position.z * scale;
            const angle = game.player.facing;
            ctx.save();
            ctx.translate(px, pz);
            ctx.rotate(angle);
            ctx.fillStyle = '#9bff9b';
            ctx.beginPath();
            ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath();
            ctx.fill();
            ctx.restore();
        }

        // Border
        ctx.strokeStyle = 'rgba(255,255,255,.12)';
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, s - 1, s - 1);
    }
}
