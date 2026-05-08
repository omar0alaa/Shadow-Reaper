"""REST endpoints for Shadow Reaper."""
from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request

from . import procedural, save_manager
from .game_data import UPGRADES, WEAPONS

api_bp = Blueprint("api", __name__)


def _saves_dir() -> str:
    return current_app.config["SAVES_DIR"]


@api_bp.route("/run/new", methods=["POST"])
def run_new():
    seed = procedural.make_seed()
    state = {
        "seed": seed,
        "wave": 1,
        "alive": True,
        "stats": {
            "max_health": 120,
            "health": 120,
            "max_stamina": 100,
            "stamina": 100,
            "max_energy": 100,
            "energy": 0,
            "crit_chance": 0.10,
            "crit_damage": 1.5,
            "lifesteal": 0.0,
            "move_speed": 1.0,
            "stamina_regen": 1.0,
            "combo_damage": 0.0,
            "backstab_mult": 1.0,
            "dash_charges": 1,
            "iframe_bonus": 0.0,
            "energy_gain": 1.0,
        },
        "upgrades": [],
        "weapon": "rusted_dagger",
        "kills": 0,
        "damage_dealt": 0,
        "weapons_found": ["rusted_dagger"],
    }
    save_manager.save_run(_saves_dir(), state)
    return jsonify({"ok": True, "state": state, "arena": procedural.generate_arena(seed)})


@api_bp.route("/run/state", methods=["GET"])
def run_state():
    state = save_manager.load_run(_saves_dir())
    if state is None:
        return jsonify({"ok": False, "error": "no run"}), 404
    arena = procedural.generate_arena(state.get("seed", 1))
    return jsonify({"ok": True, "state": state, "arena": arena})


@api_bp.route("/run/save", methods=["POST"])
def run_save():
    data = request.get_json(silent=True) or {}
    if "state" not in data:
        return jsonify({"ok": False, "error": "missing state"}), 400
    save_manager.save_run(_saves_dir(), data["state"])
    return jsonify({"ok": True})


@api_bp.route("/run/end", methods=["POST"])
def run_end():
    data = request.get_json(silent=True) or {}
    summary = data.get("summary", {})
    save_manager.append_meta(_saves_dir(), summary)
    save_manager.clear_run(_saves_dir())
    return jsonify({"ok": True})


@api_bp.route("/save/settings", methods=["GET"])
def settings_get():
    return jsonify({"ok": True, "settings": save_manager.load_settings(_saves_dir())})


@api_bp.route("/save/settings", methods=["POST"])
def settings_set():
    data = request.get_json(silent=True) or {}
    merged = save_manager.save_settings(_saves_dir(), data)
    return jsonify({"ok": True, "settings": merged})


@api_bp.route("/procedural/wave/<int:n>", methods=["GET"])
def procedural_wave(n: int):
    if n < 1 or n > 999:
        return jsonify({"ok": False, "error": "wave out of range"}), 400
    seed = request.args.get("seed", default=0, type=int)
    return jsonify({"ok": True, "wave": procedural.generate_wave(n, seed)})


@api_bp.route("/procedural/arena/<int:seed>", methods=["GET"])
def procedural_arena(seed: int):
    return jsonify({"ok": True, "arena": procedural.generate_arena(seed)})


@api_bp.route("/data/upgrades", methods=["GET"])
def data_upgrades():
    return jsonify({"ok": True, "upgrades": UPGRADES})


@api_bp.route("/data/weapons", methods=["GET"])
def data_weapons():
    return jsonify({"ok": True, "weapons": WEAPONS})


@api_bp.route("/procedural/weapon_drop", methods=["GET"])
def procedural_weapon_drop():
    wave = request.args.get("wave", default=10, type=int)
    seed = request.args.get("seed", default=0, type=int)
    wid = procedural.pick_weapon_drop(wave, seed)
    return jsonify({"ok": True, "weapon_id": wid, "weapon": WEAPONS.get(wid)})
