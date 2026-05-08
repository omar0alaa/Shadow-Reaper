// Keyboard + mouse with pointer-lock for camera control.

export class InputManager {
    constructor(canvas) {
        this.canvas = canvas;
        this.keys = new Set();
        this.justPressed = new Set();
        this.justReleased = new Set();
        this.mouse = { dx: 0, dy: 0, lmb: false, rmb: false, lmbJust: false, rmbJust: false };
        this.locked = false;
        this.enabled = true;
        this.sensitivity = 0.0025;

        // listeners
        window.addEventListener('keydown', this._kd = (e) => {
            if (e.repeat) return;
            const k = e.code;
            this.keys.add(k);
            this.justPressed.add(k);
            // intercept page scroll/whatever
            if (['Space', 'Tab'].includes(k) && this.locked) e.preventDefault();
        });
        window.addEventListener('keyup', this._ku = (e) => {
            this.keys.delete(e.code);
            this.justReleased.add(e.code);
        });
        window.addEventListener('mousedown', this._md = (e) => {
            if (e.button === 0) { this.mouse.lmb = true; this.mouse.lmbJust = true; }
            if (e.button === 2) { this.mouse.rmb = true; this.mouse.rmbJust = true; }
        });
        window.addEventListener('mouseup', this._mu = (e) => {
            if (e.button === 0) this.mouse.lmb = false;
            if (e.button === 2) this.mouse.rmb = false;
        });
        window.addEventListener('contextmenu', e => e.preventDefault());
        window.addEventListener('mousemove', this._mm = (e) => {
            if (this.locked) {
                this.mouse.dx += e.movementX || 0;
                this.mouse.dy += e.movementY || 0;
            }
        });
        document.addEventListener('pointerlockchange', () => {
            this.locked = document.pointerLockElement === this.canvas;
            document.body.classList.toggle('locked', this.locked);
        });
    }

    requestLock() {
        if (this.canvas.requestPointerLock) this.canvas.requestPointerLock();
    }
    releaseLock() {
        if (document.pointerLockElement) document.exitPointerLock();
    }
    isDown(code) { return this.enabled && this.keys.has(code); }
    pressed(code) { return this.enabled && this.justPressed.has(code); }
    released(code) { return this.enabled && this.justReleased.has(code); }

    consumeMouse() {
        const m = { dx: this.mouse.dx, dy: this.mouse.dy };
        this.mouse.dx = 0; this.mouse.dy = 0;
        return m;
    }

    endFrame() {
        this.justPressed.clear();
        this.justReleased.clear();
        this.mouse.lmbJust = false;
        this.mouse.rmbJust = false;
    }
}
