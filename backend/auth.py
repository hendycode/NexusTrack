"""
Auth utilities: JWT tokens, password hashing, decorators
"""
import jwt
import os
import hashlib
import hmac
import secrets
import functools
from datetime import datetime, timedelta, timezone
from flask import request, jsonify, g
from database import db

SECRET_KEY = os.environ.get("SECRET_KEY", secrets.token_hex(32))
JWT_ALGO   = "HS256"
TOKEN_TTL  = 60 * 60 * 24 * 7   # 7 days


# ── Password ────────────────────────────────────────────────────────────
def hash_password(plain: str) -> str:
    salt = secrets.token_hex(16)
    digest = hmac.new(SECRET_KEY.encode(), (salt + plain).encode(), hashlib.sha256).hexdigest()
    return f"{salt}:{digest}"

def verify_password(plain: str, stored: str) -> bool:
    try:
        salt, digest = stored.split(":", 1)
        expected = hmac.new(SECRET_KEY.encode(), (salt + plain).encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, digest)
    except Exception:
        return False


# ── JWT ─────────────────────────────────────────────────────────────────
def make_token(user_id: int, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(seconds=TOKEN_TTL),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGO)

def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


# ── Decorators ───────────────────────────────────────────────────────────
def _get_bearer():
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[7:]
    return request.cookies.get("token")

def login_required(f):
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        token = _get_bearer()
        if not token:
            return jsonify({"error": "Authentication required"}), 401
        payload = decode_token(token)
        if not payload:
            return jsonify({"error": "Token expired or invalid"}), 401
        # Attach user to g
        with db() as conn:
            row = conn.execute(
                "SELECT id, email, name, role, plan, is_verified FROM users WHERE id=?",
                (payload["sub"],)
            ).fetchone()
        if not row:
            return jsonify({"error": "User not found"}), 401
        g.user = dict(row)
        return f(*args, **kwargs)
    return wrapper

def admin_required(f):
    @login_required
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        if g.user.get("role") != "admin":
            return jsonify({"error": "Admin access required"}), 403
        return f(*args, **kwargs)
    return wrapper


# ── Validation helpers ───────────────────────────────────────────────────
import re

EMAIL_RE   = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
NAME_MIN   = 2
PASS_MIN   = 8

def validate_email(v: str) -> str | None:
    v = (v or "").strip().lower()
    if not EMAIL_RE.match(v): return None
    return v

def validate_name(v: str) -> str | None:
    v = (v or "").strip()
    if len(v) < NAME_MIN: return None
    return v

def validate_password(v: str) -> str | None:
    v = (v or "")
    if len(v) < PASS_MIN: return None
    return v
