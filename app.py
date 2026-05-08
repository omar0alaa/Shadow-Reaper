"""Shadow Reaper — Flask entry point.

Serves the Three.js front-end at / and exposes REST endpoints for
procedural generation, save/load and run lifecycle.
"""
from __future__ import annotations

import os
from flask import Flask, render_template, send_from_directory

from backend.routes import api_bp


def create_app() -> Flask:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    app = Flask(
        __name__,
        template_folder=os.path.join(base_dir, "templates"),
        static_folder=os.path.join(base_dir, "static"),
    )
    app.config["SAVES_DIR"] = os.path.join(base_dir, "saves")
    os.makedirs(app.config["SAVES_DIR"], exist_ok=True)

    app.register_blueprint(api_bp, url_prefix="/api")

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/favicon.ico")
    def favicon():
        return ("", 204)

    return app


if __name__ == "__main__":
    app = create_app()
    print("\n  Shadow Reaper — open https://localhost:443 to play\n")
    cert_path = '/etc/letsencrypt/live/shadow.omarkhater.com/fullchain.pem'
    key_path = '/etc/letsencrypt/live/shadow.omarkhater.com/privkey.pem'
    
    # Launch on public HTTPS port 443
    app.run(host='0.0.0.0', port=443, ssl_context=(cert_path, key_path))