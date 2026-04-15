"""
NexusTrack - Flask Application
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import json
from flask import Flask, send_from_directory, jsonify
from database import init_db, migrate_db
from routes import api


def create_app():
    app = Flask(
        __name__,
        static_folder=os.path.join(os.path.dirname(__file__), "../frontend/static"),
        template_folder=os.path.join(os.path.dirname(__file__), "../frontend/templates"),
    )

    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY", "nexustrack-dev-secret-change-in-prod"),
        JSON_SORT_KEYS=False,
        MAX_CONTENT_LENGTH=16 * 1024 * 1024,
    )

    @app.after_request
    def cors(resp):
        origin = os.environ.get("ALLOWED_ORIGIN", "*")
        resp.headers["Access-Control-Allow-Origin"]      = origin
        resp.headers["Access-Control-Allow-Headers"]     = "Content-Type, Authorization"
        resp.headers["Access-Control-Allow-Methods"]     = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        resp.headers["Access-Control-Allow-Credentials"] = "true"
        return resp

    @app.before_request
    def handle_preflight():
        from flask import request
        if request.method == "OPTIONS":
            return jsonify({}), 200

    app.register_blueprint(api)

    frontend_dir = os.path.join(os.path.dirname(__file__), "../frontend")

    @app.route("/api/", defaults={"path": ""})
    @app.route("/api/<path:path>")
    def api_not_found(path):
        return jsonify({"ok": False, "error": "API endpoint not found"}), 404

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_frontend(path):
        static_path = os.path.join(frontend_dir, "static", path)
        if path and os.path.isfile(static_path):
            return send_from_directory(os.path.join(frontend_dir, "static"), path)
        return send_from_directory(frontend_dir, "index.html")

    @app.errorhandler(404)
    def not_found(e):
        return jsonify({"ok": False, "error": "Not found"}), 404

    @app.errorhandler(405)
    def method_not_allowed(e):
        return jsonify({"ok": False, "error": "Method not allowed"}), 405

    @app.errorhandler(500)
    def server_error(e):
        return jsonify({"ok": False, "error": "Internal server error"}), 500

    return app


if __name__ == "__main__":
    init_db()
    migrate_db()
    app = create_app()
    port = int(os.environ.get("PORT", 5000))
    print(f"\n NexusTrack running at http://localhost:{port}")
    print(f"   Open this in Chrome: http://localhost:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=True)
