"""Shadow Reaper — Flask entry point.

Serves the Three.js front-end at / and exposes REST endpoints for
procedural generation, save/load, run lifecycle, and multiplayer party
relay (WebSocket via flask-sock).
"""
from __future__ import annotations

import os
from flask import Flask, render_template, send_from_directory
from flask_sock import Sock

from backend.routes import api_bp
from backend.multiplayer import register_party_routes


def create_app() -> Flask:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    app = Flask(
        __name__,
        template_folder=os.path.join(base_dir, "templates"),
        static_folder=os.path.join(base_dir, "static"),
    )
    app.config["SAVES_DIR"] = os.path.join(base_dir, "saves")
    os.makedirs(app.config["SAVES_DIR"], exist_ok=True)

    sock = Sock(app)
    register_party_routes(app, sock, api_bp)
    app.register_blueprint(api_bp, url_prefix="/api")

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/favicon.ico")
    def favicon():
        return ("", 204)

    return app

# For Server
# if __name__ == "__main__":
#     app = create_app()
#     print("\n  Shadow Reaper — open https://localhost:443 to play\n")
#     cert_path = '/etc/letsencrypt/live/shadow.omarkhater.com/fullchain.pem'
#     key_path = '/etc/letsencrypt/live/shadow.omarkhater.com/privkey.pem'
    
#     # Launch on public HTTPS port 443
#     app.run(host='0.0.0.0', port=443, ssl_context=(cert_path, key_path))


# For Localhost
if __name__ == "__main__":
    app = create_app()
    print("\n  Shadow Reaper — open http://localhost:80 to play\n")
    app.run(host="0.0.0.0", port=80, debug=False, use_reloader=False)
