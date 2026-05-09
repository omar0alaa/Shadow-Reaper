"""Multiplayer party manager — pure relay over WebSocket.

Architecture: HOST-AUTHORITATIVE. The host's browser runs the game simulation
and broadcasts mob/wave/loot state. Peers send their own player state and
attack hits. The server only routes messages between party members and
maintains the membership list.
"""
from __future__ import annotations

import json
import secrets
import threading
import time
from typing import Dict, Optional

from .game_data import WEAPON_CLASSES
from .server_game import ServerGame


CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no I/O/L/0/1
CODE_LEN = 5
MAX_MEMBERS = 5

# code -> Party
PARTIES: Dict[str, "Party"] = {}
_PARTIES_LOCK = threading.Lock()


def make_code() -> str:
    while True:
        c = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))
        if c not in PARTIES:
            return c


class Party:
    def __init__(self, code: str, host_pid: str):
        self.code = code
        self.host_pid = host_pid
        self.created_at = time.time()
        self.started = False
        self.difficulty = "normal"
        self.seed = 0
        # pid -> {ws, name, class, ready}
        self.members: Dict[str, dict] = {}
        self.lock = threading.Lock()
        # Server-authoritative game once the run starts.
        self.game: Optional[ServerGame] = None

    # -- membership ---------------------------------------------------------

    def add(self, pid: str, name: str, cls: str) -> bool:
        with self.lock:
            if len(self.members) >= MAX_MEMBERS:
                return False
            if cls not in WEAPON_CLASSES:
                cls = "sword"
            self.members[pid] = {
                "ws": None,
                "name": (name or "Player")[:20],
                "class": cls,
                "ready": False,
            }
            return True

    def remove(self, pid: str) -> bool:
        """Remove member; return True if party is now empty (caller should drop it)."""
        with self.lock:
            if pid not in self.members:
                return False
            del self.members[pid]
            if not self.members:
                return True
            # Promote a new host if needed
            if pid == self.host_pid:
                self.host_pid = next(iter(self.members.keys()))
        return False

    def attach_ws(self, pid: str, ws) -> bool:
        with self.lock:
            if pid not in self.members:
                return False
            self.members[pid]["ws"] = ws
            return True

    def serialize_members(self) -> list:
        return [
            {
                "pid": pid,
                "name": info["name"],
                "class": info["class"],
                "ready": info["ready"],
                "is_host": pid == self.host_pid,
            }
            for pid, info in self.members.items()
        ]

    # -- broadcast ----------------------------------------------------------

    def _send_one(self, pid: str, data: str) -> None:
        info = self.members.get(pid)
        if not info or info["ws"] is None:
            return
        try:
            info["ws"].send(data)
        except Exception:
            pass

    def broadcast(self, msg: dict, exclude: Optional[str] = None) -> None:
        data = json.dumps(msg, separators=(",", ":"))
        with self.lock:
            pids = list(self.members.keys())
        for pid in pids:
            if pid == exclude:
                continue
            self._send_one(pid, data)

    def send_to(self, pid: str, msg: dict) -> None:
        data = json.dumps(msg, separators=(",", ":"))
        self._send_one(pid, data)


# ---------------------------------------------------------------------------

def get_party(code: str) -> Optional[Party]:
    with _PARTIES_LOCK:
        return PARTIES.get(code)


def create_party(host_pid: str) -> Party:
    with _PARTIES_LOCK:
        code = make_code()
        p = Party(code, host_pid)
        PARTIES[code] = p
    return p


def drop_party(code: str) -> None:
    with _PARTIES_LOCK:
        PARTIES.pop(code, None)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

def register_party_routes(app, sock, api_bp):
    """Wire REST + WebSocket endpoints. Called from app factory."""
    from flask import jsonify, request

    @api_bp.route("/party/create", methods=["POST"])
    def party_create():
        data = request.get_json(silent=True) or {}
        name = data.get("name") or "Host"
        cls = data.get("class") or "sword"
        difficulty = data.get("difficulty") or "normal"
        if cls not in WEAPON_CLASSES:
            cls = "sword"
        host_pid = secrets.token_hex(8)
        party = create_party(host_pid)
        party.difficulty = difficulty
        party.seed = secrets.randbelow(2**31)
        party.add(host_pid, name, cls)
        return jsonify({
            "ok": True,
            "code": party.code,
            "pid": host_pid,
            "is_host": True,
            "difficulty": party.difficulty,
            "seed": party.seed,
            "members": party.serialize_members(),
        })

    @api_bp.route("/party/join", methods=["POST"])
    def party_join():
        data = request.get_json(silent=True) or {}
        code = (data.get("code") or "").upper().strip()
        name = data.get("name") or "Player"
        cls = data.get("class") or "sword"
        if cls not in WEAPON_CLASSES:
            cls = "sword"
        party = get_party(code)
        if not party:
            return jsonify({"ok": False, "error": "party not found"}), 404
        if len(party.members) >= MAX_MEMBERS:
            return jsonify({"ok": False, "error": "party full"}), 409
        pid = secrets.token_hex(8)
        if not party.add(pid, name, cls):
            return jsonify({"ok": False, "error": "join failed"}), 400
        return jsonify({
            "ok": True,
            "code": party.code,
            "pid": pid,
            "is_host": False,
            "difficulty": party.difficulty,
            "seed": party.seed,
            "members": party.serialize_members(),
            "started": party.started,
        })

    @api_bp.route("/party/info/<code>", methods=["GET"])
    def party_info(code):
        party = get_party(code.upper())
        if not party:
            return jsonify({"ok": False, "error": "not found"}), 404
        return jsonify({
            "ok": True,
            "code": party.code,
            "difficulty": party.difficulty,
            "members": party.serialize_members(),
            "started": party.started,
        })

    # ----- WebSocket relay -----
    @sock.route("/ws/party/<code>")
    def party_ws(ws, code):
        from flask import request as flask_request
        pid = flask_request.args.get("pid")
        if not pid:
            ws.close()
            return
        party = get_party(code.upper())
        if not party or pid not in party.members:
            ws.close()
            return
        if not party.attach_ws(pid, ws):
            ws.close()
            return

        # Notify everyone of the new lobby state
        party.broadcast({
            "type": "lobby_update",
            "members": party.serialize_members(),
            "host_pid": party.host_pid,
            "difficulty": party.difficulty,
            "started": party.started,
        })

        # Late-join: if the run is already in progress, drop this player into
        # the running game and tell only them to start their client up.
        if party.started and party.game is not None and not party.game.run_ended:
            info = party.members.get(pid, {})
            try:
                party.game.add_player(pid, info.get("name", "Player"),
                                      info.get("class", "sword"))
            except Exception as e:
                print(f"[party {party.code}] late add_player error:", e)
            members = [
                {'pid': p, 'name': mi['name'], 'class': mi['class']}
                for p, mi in party.members.items()
            ]
            party.send_to(pid, {
                "type": "start_run",
                "seed": party.seed,
                "difficulty": party.difficulty,
                "members": party.serialize_members(),
                "host_pid": party.host_pid,
                "late_join": True,
            })

        try:
            while True:
                raw = ws.receive(timeout=120)  # close after 2 min idle
                if raw is None:
                    break
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                if not isinstance(msg, dict):
                    continue
                msg["from"] = pid
                t = msg.get("type")

                # Special-case messages the server cares about
                if t == "set_class":
                    new_cls = msg.get("class")
                    if new_cls in WEAPON_CLASSES and pid in party.members:
                        party.members[pid]["class"] = new_cls
                        party.broadcast({
                            "type": "lobby_update",
                            "members": party.serialize_members(),
                            "host_pid": party.host_pid,
                            "difficulty": party.difficulty,
                            "started": party.started,
                        })
                    continue

                if t == "set_difficulty" and pid == party.host_pid:
                    diff = msg.get("difficulty", "normal")
                    if diff in ("easy", "normal", "hard"):
                        party.difficulty = diff
                        party.broadcast({
                            "type": "lobby_update",
                            "members": party.serialize_members(),
                            "host_pid": party.host_pid,
                            "difficulty": party.difficulty,
                            "started": party.started,
                        })
                    continue

                if t == "start_run" and pid == party.host_pid:
                    # Force-clean any lingering game from a previous run so
                    # we don't re-use a stopped tick thread.
                    if party.game is not None:
                        try:
                            party.game.stop()
                        except Exception:
                            pass
                        party.game = None
                    party.started = True
                    party.seed = secrets.randbelow(2**31)  # new seed each run
                    members = [
                        {'pid': p, 'name': info['name'], 'class': info['class']}
                        for p, info in party.members.items()
                    ]
                    # Tell every client the run is starting BEFORE we kick off
                    # the simulation. This guarantees clients have time to
                    # finish startNewRunMP / build the arena before they see
                    # wave_start / state events.
                    party.broadcast({
                        "type": "start_run",
                        "seed": party.seed,
                        "difficulty": party.difficulty,
                        "members": party.serialize_members(),
                        "host_pid": party.host_pid,
                    })

                    def _on_run_ended(p=party):
                        """Called by ServerGame when all players die. Resets party to lobby."""
                        p.started = False
                        p.game = None
                        # Broadcast lobby_update so PartyUI re-renders, then tell
                        # clients to return to the lobby screen.
                        p.broadcast({
                            "type": "lobby_update",
                            "members": p.serialize_members(),
                            "host_pid": p.host_pid,
                            "difficulty": p.difficulty,
                            "started": False,
                        })
                        p.broadcast({"type": "return_to_lobby"})

                    party.game = ServerGame(
                        party.code, members, party.seed, party.difficulty,
                        broadcast_fn=lambda m, p=party: p.broadcast(m),
                        send_to_fn=lambda pid_, m, p=party: p.send_to(pid_, m),
                        on_run_ended_fn=_on_run_ended,
                    )
                    # Small grace period so the start_run JSON has time to
                    # hit the wire / clients can finish their first awaits.
                    threading.Timer(0.4, party.game.start).start()
                    continue

                if t == "abandon_run" and pid == party.host_pid:
                    # Host explicitly abandoned the run — end it for everyone.
                    if party.game is not None and not party.game.run_ended:
                        try:
                            party.game.host_abandon()
                        except Exception as e:
                            print(f"[party {party.code}] abandon_run error:", e)
                    continue

                # Server-authoritative game messages
                if party.game and not party.game.run_ended:
                    if t == "input":
                        party.game.on_input(pid, msg)
                        continue
                    if t == "upgrade_pick":
                        party.game.on_upgrade_pick(pid, msg.get("upgrade_id"))
                        continue
                    if t == "weapon_pick":
                        party.game.on_weapon_pick(pid, bool(msg.get("equip")), msg.get("weapon_id"))
                        continue

                # Targeted relay (lobby chat etc.)
                target = msg.get("target")
                if target:
                    party.send_to(target, msg)
                else:
                    party.broadcast(msg, exclude=pid)
        except Exception:
            pass
        finally:
            was_host = (pid == party.host_pid)
            run_in_progress = party.started
            # Tell the server-game this player has left.
            if party.game is not None:
                try:
                    party.game.remove_player(pid)
                except Exception:
                    pass
            empty = party.remove(pid)
            if empty:
                if party.game is not None:
                    party.game.stop()
                drop_party(party.code)
            else:
                # Server-authoritative: host is just a UI role now. The run
                # continues for remaining players. We DO end the run if the
                # host leaves mid-run though, since they hold the start-run
                # privilege; survivors can re-create a party from the menu.
                if was_host and run_in_progress and party.game is not None:
                    party.game.stop()
                    party.broadcast({"type": "host_left"})
                    party.broadcast({"type": "peer_left", "pid": pid})
                    drop_party(party.code)
                else:
                    party.broadcast({
                        "type": "lobby_update",
                        "members": party.serialize_members(),
                        "host_pid": party.host_pid,
                        "difficulty": party.difficulty,
                        "started": party.started,
                    })
                    party.broadcast({"type": "peer_left", "pid": pid})
