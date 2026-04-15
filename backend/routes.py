"""
NexusTrack API Routes
All endpoints: auth, users, demo bookings, contact, newsletter, integrations, plans, testimonials
"""
import json
from flask import Blueprint, request, jsonify, g, make_response
from database import db
from auth import (
    hash_password, verify_password, make_token,
    login_required, admin_required,
    validate_email, validate_name, validate_password
)

api = Blueprint("api", __name__, url_prefix="/api")


# ═══════════════════════════════════════════════════════════
#  HELPERS
# ═══════════════════════════════════════════════════════════
def ok(data=None, **kwargs):
    payload = {"ok": True}
    if data is not None: payload["data"] = data
    payload.update(kwargs)
    return jsonify(payload)

def err(msg, code=400):
    return jsonify({"ok": False, "error": msg}), code

def row_to_dict(row):
    return dict(row) if row else None


# ═══════════════════════════════════════════════════════════
#  AUTH
# ═══════════════════════════════════════════════════════════
@api.route("/auth/register", methods=["POST"])
def register():
    body  = request.get_json(silent=True) or {}
    email = validate_email(body.get("email", ""))
    name  = validate_name(body.get("name", ""))
    pw    = validate_password(body.get("password", ""))

    if not email:   return err("Invalid email address")
    if not name:    return err("Name must be at least 2 characters")
    if not pw:      return err("Password must be at least 8 characters")

    with db() as conn:
        existing = conn.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
        if existing: return err("Email already registered", 409)

        cursor = conn.execute(
            "INSERT INTO users (email, name, password) VALUES (?,?,?)",
            (email, name, hash_password(pw))
        )
        uid = cursor.lastrowid
        user = row_to_dict(conn.execute(
            "SELECT id, email, name, role, plan FROM users WHERE id=?", (uid,)
        ).fetchone())

    token = make_token(user["id"], user["email"], user["role"])
    resp  = make_response(ok(user, token=token), 201)
    resp.set_cookie("token", token, httponly=True, samesite="Lax", max_age=604800)
    return resp


@api.route("/auth/login", methods=["POST"])
def login():
    body  = request.get_json(silent=True) or {}
    email = validate_email(body.get("email", ""))
    pw    = body.get("password", "")

    if not email: return err("Invalid email address")
    if not pw:    return err("Password is required")

    with db() as conn:
        user = row_to_dict(conn.execute(
            "SELECT * FROM users WHERE email=?", (email,)
        ).fetchone())

    if not user or not verify_password(pw, user["password"]):
        return err("Invalid email or password", 401)

    safe = {k: v for k, v in user.items() if k != "password"}
    token = make_token(user["id"], user["email"], user["role"])
    resp  = make_response(ok(safe, token=token))
    resp.set_cookie("token", token, httponly=True, samesite="Lax", max_age=604800)
    return resp


@api.route("/auth/logout", methods=["POST"])
def logout():
    resp = make_response(ok(message="Logged out"))
    resp.delete_cookie("token")
    return resp


@api.route("/auth/me", methods=["GET"])
@login_required
def me():
    return ok(g.user)


@api.route("/auth/change-password", methods=["POST"])
@login_required
def change_password():
    body     = request.get_json(silent=True) or {}
    old_pw   = body.get("current_password", "")
    new_pw   = validate_password(body.get("new_password", ""))

    if not new_pw: return err("New password must be at least 8 characters")

    with db() as conn:
        user = row_to_dict(conn.execute(
            "SELECT password FROM users WHERE id=?", (g.user["id"],)
        ).fetchone())
        if not verify_password(old_pw, user["password"]):
            return err("Current password is incorrect", 401)
        conn.execute(
            "UPDATE users SET password=?, updated_at=datetime('now') WHERE id=?",
            (hash_password(new_pw), g.user["id"])
        )
    return ok(message="Password updated")


# ═══════════════════════════════════════════════════════════
#  USER PROFILE
# ═══════════════════════════════════════════════════════════
@api.route("/user/profile", methods=["PATCH"])
@login_required
def update_profile():
    body  = request.get_json(silent=True) or {}
    name  = validate_name(body.get("name", g.user["name"]))
    if not name: return err("Name must be at least 2 characters")

    with db() as conn:
        conn.execute(
            "UPDATE users SET name=?, updated_at=datetime('now') WHERE id=?",
            (name, g.user["id"])
        )
        user = row_to_dict(conn.execute(
            "SELECT id, email, name, role, plan FROM users WHERE id=?", (g.user["id"],)
        ).fetchone())
    return ok(user)


# ═══════════════════════════════════════════════════════════
#  DEMO BOOKINGS
# ═══════════════════════════════════════════════════════════
@api.route("/bookings/demo", methods=["POST"])
def book_demo():
    body     = request.get_json(silent=True) or {}
    name     = validate_name(body.get("name", ""))
    email    = validate_email(body.get("email", ""))
    company  = (body.get("company") or "").strip()
    size     = (body.get("team_size") or "").strip()
    message  = (body.get("message") or "").strip()[:1000]

    if not name:    return err("Name must be at least 2 characters")
    if not email:   return err("Invalid email address")
    if not company: return err("Company name is required")
    if not size:    return err("Team size is required")

    with db() as conn:
        cursor = conn.execute(
            "INSERT INTO demo_bookings (name,email,company,team_size,message) VALUES (?,?,?,?,?)",
            (name, email, company, size, message)
        )
        booking = row_to_dict(conn.execute(
            "SELECT * FROM demo_bookings WHERE id=?", (cursor.lastrowid,)
        ).fetchone())

    return ok(booking, message="Demo booked! We will be in touch within 24 hours.", code=201), 201


@api.route("/bookings/demo", methods=["GET"])
@admin_required
def list_bookings():
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM demo_bookings ORDER BY created_at DESC LIMIT 100"
        ).fetchall()
    return ok([dict(r) for r in rows])


@api.route("/bookings/demo/<int:booking_id>", methods=["PATCH"])
@admin_required
def update_booking(booking_id):
    body   = request.get_json(silent=True) or {}
    status = body.get("status", "")
    valid  = {"pending", "confirmed", "completed", "cancelled"}
    if status not in valid:
        return err(f"Status must be one of: {', '.join(valid)}")

    with db() as conn:
        conn.execute(
            "UPDATE demo_bookings SET status=? WHERE id=?", (status, booking_id)
        )
    return ok(message="Booking updated")


# ═══════════════════════════════════════════════════════════
#  CONTACT
# ═══════════════════════════════════════════════════════════
@api.route("/contact", methods=["POST"])
def contact():
    body    = request.get_json(silent=True) or {}
    name    = validate_name(body.get("name", ""))
    email   = validate_email(body.get("email", ""))
    subject = (body.get("subject") or "").strip()[:200]
    message = (body.get("message") or "").strip()[:5000]

    if not name:    return err("Name must be at least 2 characters")
    if not email:   return err("Invalid email address")
    if not subject: return err("Subject is required")
    if not message: return err("Message is required")

    with db() as conn:
        conn.execute(
            "INSERT INTO contact_messages (name,email,subject,message) VALUES (?,?,?,?)",
            (name, email, subject, message)
        )
    return ok(message="Message received! We will respond within 1 business day."), 201


@api.route("/contact", methods=["GET"])
@admin_required
def list_messages():
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 100"
        ).fetchall()
    return ok([dict(r) for r in rows])


# ═══════════════════════════════════════════════════════════
#  NEWSLETTER
# ═══════════════════════════════════════════════════════════
@api.route("/newsletter/subscribe", methods=["POST"])
def newsletter_subscribe():
    body   = request.get_json(silent=True) or {}
    email  = validate_email(body.get("email", ""))
    source = (body.get("source") or "website").strip()[:50]

    if not email: return err("Invalid email address")

    with db() as conn:
        existing = conn.execute(
            "SELECT id FROM newsletter_subscribers WHERE email=?", (email,)
        ).fetchone()
        if existing:
            return ok(message="You are already subscribed!")
        conn.execute(
            "INSERT INTO newsletter_subscribers (email, source) VALUES (?,?)",
            (email, source)
        )
    return ok(message="Successfully subscribed! Welcome to NexusTrack."), 201


@api.route("/newsletter/unsubscribe", methods=["POST"])
def newsletter_unsubscribe():
    body  = request.get_json(silent=True) or {}
    email = validate_email(body.get("email", ""))
    if not email: return err("Invalid email address")

    with db() as conn:
        conn.execute(
            "DELETE FROM newsletter_subscribers WHERE email=?", (email,)
        )
    return ok(message="You have been unsubscribed.")


# ═══════════════════════════════════════════════════════════
#  INTEGRATIONS
# ═══════════════════════════════════════════════════════════
@api.route("/integrations", methods=["GET"])
def list_integrations():
    category = request.args.get("category")
    featured = request.args.get("featured")

    query  = "SELECT * FROM integrations WHERE 1=1"
    params = []

    if category:
        query  += " AND category=?"
        params.append(category)
    if featured == "1":
        query  += " AND is_featured=1"

    query += " ORDER BY is_featured DESC, name ASC"

    with db() as conn:
        rows = conn.execute(query, params).fetchall()
    return ok([dict(r) for r in rows])


@api.route("/integrations/<slug>", methods=["GET"])
def get_integration(slug):
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM integrations WHERE slug=?", (slug,)
        ).fetchone()
    if not row: return err("Integration not found", 404)
    return ok(dict(row))


# ═══════════════════════════════════════════════════════════
#  PLANS / PRICING
# ═══════════════════════════════════════════════════════════
@api.route("/plans", methods=["GET"])
def list_plans():
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM plans ORDER BY sort_order ASC"
        ).fetchall()

    plans = []
    for row in rows:
        p = dict(row)
        p["features"] = json.loads(p["features"])
        plans.append(p)

    return ok(plans)


# ═══════════════════════════════════════════════════════════
#  TESTIMONIALS
# ═══════════════════════════════════════════════════════════
@api.route("/testimonials", methods=["GET"])
def list_testimonials():
    featured = request.args.get("featured")
    query    = "SELECT * FROM testimonials WHERE 1=1"
    params   = []

    if featured == "1":
        query  += " AND is_featured=1"

    query += " ORDER BY sort_order ASC"

    with db() as conn:
        rows = conn.execute(query, params).fetchall()
    return ok([dict(r) for r in rows])


# ═══════════════════════════════════════════════════════════
#  ANALYTICS / DASHBOARD (mock data for demo)
# ═══════════════════════════════════════════════════════════
@api.route("/dashboard/stats", methods=["GET"])
@login_required
def dashboard_stats():
    """Returns demo analytics data — in production this would be real tracking data"""
    return ok({
        "revenue":     84200,
        "revenue_chg": 24.1,
        "roas":        5.8,
        "roas_chg":    11.3,
        "conversions": 1247,
        "conv_chg":    8.6,
        "ad_spend":    14517,
        "spend_chg":   -3.2,
        "sources": [
            {"name": "Meta Ads",   "revenue": 31240, "pct": 37, "color": "#3b82f6"},
            {"name": "Google Ads", "revenue": 24810, "pct": 29, "color": "#ef4444"},
            {"name": "Organic",    "revenue": 18150, "pct": 21, "color": "#4a8c6e"},
            {"name": "Email",      "revenue": 10000, "pct": 13, "color": "#c9a96e"},
        ],
        "chart": [
            {"day": "Apr 1",  "revenue": 2100, "spend": 420},
            {"day": "Apr 2",  "revenue": 2800, "spend": 490},
            {"day": "Apr 3",  "revenue": 2400, "spend": 440},
            {"day": "Apr 4",  "revenue": 3200, "spend": 510},
            {"day": "Apr 5",  "revenue": 2900, "spend": 480},
            {"day": "Apr 6",  "revenue": 3600, "spend": 560},
            {"day": "Apr 7",  "revenue": 4100, "spend": 580},
            {"day": "Apr 8",  "revenue": 3800, "spend": 540},
            {"day": "Apr 9",  "revenue": 4400, "spend": 600},
            {"day": "Apr 10", "revenue": 5100, "spend": 650},
            {"day": "Apr 11", "revenue": 4700, "spend": 620},
            {"day": "Apr 12", "revenue": 5600, "spend": 680},
        ]
    })


# ═══════════════════════════════════════════════════════════
#  ADMIN
# ═══════════════════════════════════════════════════════════
@api.route("/admin/users", methods=["GET"])
@admin_required
def admin_users():
    with db() as conn:
        rows = conn.execute(
            "SELECT id,email,name,role,plan,is_verified,created_at FROM users ORDER BY created_at DESC"
        ).fetchall()
    return ok([dict(r) for r in rows])


@api.route("/admin/stats", methods=["GET"])
@admin_required
def admin_stats():
    with db() as conn:
        users    = conn.execute("SELECT COUNT(*) as c FROM users").fetchone()["c"]
        bookings = conn.execute("SELECT COUNT(*) as c FROM demo_bookings").fetchone()["c"]
        pending  = conn.execute("SELECT COUNT(*) as c FROM demo_bookings WHERE status='pending'").fetchone()["c"]
        subs     = conn.execute("SELECT COUNT(*) as c FROM newsletter_subscribers").fetchone()["c"]
        messages = conn.execute("SELECT COUNT(*) as c FROM contact_messages WHERE status='unread'").fetchone()["c"]

    return ok({
        "total_users":       users,
        "total_bookings":    bookings,
        "pending_bookings":  pending,
        "newsletter_subs":   subs,
        "unread_messages":   messages,
    })


# ═══════════════════════════════════════════════════════════
#  HEALTH
# ═══════════════════════════════════════════════════════════
@api.route("/health", methods=["GET"])
def health():
    return ok(status="healthy", version="1.0.0")


# ═══════════════════════════════════════════════════════════
#  ATTRIBUTION — MODEL SWITCHER
# ═══════════════════════════════════════════════════════════
@api.route("/attribution", methods=["GET"])
@login_required
def attribution_data():
    """
    Return attribution data recalculated for the requested model.
    Models: first_touch | last_touch | linear | time_decay | position | data_driven
    """
    model = request.args.get("model", "linear")
    period = request.args.get("period", "30")

    # Model credit weights per channel position (first, middle, last)
    model_weights = {
        "first_touch":  {"first": 1.0, "middle": 0.0, "last": 0.0},
        "last_touch":   {"first": 0.0, "middle": 0.0, "last": 1.0},
        "linear":       {"first": 0.33, "middle": 0.34, "last": 0.33},
        "time_decay":   {"first": 0.10, "middle": 0.25, "last": 0.65},
        "position":     {"first": 0.40, "middle": 0.20, "last": 0.40},
        "data_driven":  {"first": 0.28, "middle": 0.32, "last": 0.40},
    }
    weights = model_weights.get(model, model_weights["linear"])

    # Base revenue data (realistic simulation per model)
    base_sources = [
        {"name": "Meta Ads",    "color": "#3b82f6", "base_rev": 31240, "position": "first"},
        {"name": "Google Ads",  "color": "#ef4444", "base_rev": 24810, "position": "last"},
        {"name": "Organic",     "color": "#4a8c6e", "base_rev": 18150, "position": "middle"},
        {"name": "Email",       "color": "#c9a96e", "base_rev": 10000, "position": "middle"},
        {"name": "TikTok Ads",  "color": "#6366f1", "base_rev":  8200, "position": "first"},
        {"name": "LinkedIn",    "color": "#0ea5e9", "base_rev":  4800, "position": "first"},
        {"name": "YouTube Ads", "color": "#dc2626", "base_rev":  3100, "position": "middle"},
    ]

    total_base = sum(s["base_rev"] for s in base_sources)

    sources = []
    total_attributed = 0
    for s in base_sources:
        w = weights[s["position"]]
        # Randomize slightly per model to show meaningful difference
        noise = {"first_touch": 1.2, "last_touch": 0.8, "data_driven": 1.05}.get(model, 1.0)
        adjusted = round(s["base_rev"] * w * noise * (total_base / sum(
            x["base_rev"] * weights[x["position"]] for x in base_sources
        )))
        total_attributed += adjusted
        sources.append({**s, "revenue": adjusted})

    # Normalize to 100%
    for s in sources:
        s["pct"] = round(s["revenue"] / total_attributed * 100) if total_attributed else 0

    model_descriptions = {
        "first_touch": "100% credit to the channel that first introduced the customer to your brand.",
        "last_touch":  "100% credit to the final touchpoint immediately before conversion.",
        "linear":      "Equal credit distributed across all touchpoints in the customer journey.",
        "time_decay":  "More credit given to touchpoints closer to the conversion event.",
        "position":    "40% first touch, 40% last touch, 20% split across middle touchpoints.",
        "data_driven": "ML-weighted credit based on which touchpoints statistically drive conversions.",
    }

    return ok({
        "model": model,
        "description": model_descriptions.get(model, ""),
        "sources": sorted(sources, key=lambda x: x["revenue"], reverse=True),
        "total_revenue": total_attributed,
        "model_comparison": {
            m: {s["name"]: round(s["base_rev"] * model_weights[m][s["position"]])
                for s in base_sources}
            for m in model_weights
        }
    })


# ═══════════════════════════════════════════════════════════
#  EVENTS MANAGER
# ═══════════════════════════════════════════════════════════
@api.route("/events", methods=["GET"])
@login_required
def list_events():
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM events WHERE user_id=? ORDER BY created_at DESC",
            (g.user["id"],)
        ).fetchall()
    return ok([dict(r) for r in rows])


@api.route("/events", methods=["POST"])
@login_required
def create_event():
    body      = request.get_json(silent=True) or {}
    name      = (body.get("name") or "").strip()[:100]
    etype     = (body.get("event_type") or "conversion").strip()
    desc      = (body.get("description") or "").strip()[:500]
    value     = float(body.get("value") or 0)
    currency  = (body.get("currency") or "USD").strip()[:3].upper()

    if not name: return err("Event name is required")
    valid_types = {"conversion", "lead", "engagement", "pageview", "custom"}
    if etype not in valid_types: return err(f"Event type must be one of: {', '.join(valid_types)}")

    with db() as conn:
        cursor = conn.execute(
            "INSERT INTO events (user_id,name,event_type,description,value,currency) VALUES (?,?,?,?,?,?)",
            (g.user["id"], name, etype, desc, value, currency)
        )
        row = dict(conn.execute("SELECT * FROM events WHERE id=?", (cursor.lastrowid,)).fetchone())
    return ok(row), 201


@api.route("/events/<int:event_id>", methods=["PATCH"])
@login_required
def update_event(event_id):
    body = request.get_json(silent=True) or {}
    with db() as conn:
        ev = conn.execute("SELECT * FROM events WHERE id=? AND user_id=?",
                          (event_id, g.user["id"])).fetchone()
        if not ev: return err("Event not found", 404)

        name    = (body.get("name") or ev["name"]).strip()[:100]
        is_act  = body.get("is_active", ev["is_active"])
        conn.execute("UPDATE events SET name=?, is_active=? WHERE id=?",
                     (name, int(is_act), event_id))
        row = dict(conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone())
    return ok(row)


@api.route("/events/<int:event_id>", methods=["DELETE"])
@login_required
def delete_event(event_id):
    with db() as conn:
        ev = conn.execute("SELECT id FROM events WHERE id=? AND user_id=?",
                          (event_id, g.user["id"])).fetchone()
        if not ev: return err("Event not found", 404)
        conn.execute("DELETE FROM events WHERE id=?", (event_id,))
    return ok(message="Event deleted")


# ═══════════════════════════════════════════════════════════
#  SMART ALERTS
# ═══════════════════════════════════════════════════════════
@api.route("/alerts", methods=["GET"])
@login_required
def list_alerts():
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM alerts WHERE user_id=? ORDER BY created_at DESC",
            (g.user["id"],)
        ).fetchall()
        logs = conn.execute(
            """SELECT al.* FROM alert_logs al
               JOIN alerts a ON al.alert_id=a.id
               WHERE a.user_id=? ORDER BY al.fired_at DESC LIMIT 20""",
            (g.user["id"],)
        ).fetchall()
    return ok({"alerts": [dict(r) for r in rows], "logs": [dict(l) for l in logs]})


@api.route("/alerts", methods=["POST"])
@login_required
def create_alert():
    body      = request.get_json(silent=True) or {}
    name      = (body.get("name") or "").strip()[:100]
    metric    = (body.get("metric") or "").strip()
    operator  = (body.get("operator") or "").strip()
    threshold = float(body.get("threshold") or 0)
    channel   = (body.get("channel") or "email").strip()
    webhook   = (body.get("webhook_url") or "").strip()[:500]

    if not name:   return err("Alert name is required")
    valid_metrics   = {"roas","spend","conversions","revenue","cpa","ctr"}
    valid_operators = {"above","below"}
    if metric not in valid_metrics:   return err(f"Metric must be one of: {', '.join(valid_metrics)}")
    if operator not in valid_operators: return err("Operator must be 'above' or 'below'")
    if channel not in {"email","slack","webhook"}: return err("Channel must be email, slack, or webhook")

    with db() as conn:
        cursor = conn.execute(
            "INSERT INTO alerts (user_id,name,metric,operator,threshold,channel,webhook_url) VALUES (?,?,?,?,?,?,?)",
            (g.user["id"], name, metric, operator, threshold, channel, webhook or None)
        )
        row = dict(conn.execute("SELECT * FROM alerts WHERE id=?", (cursor.lastrowid,)).fetchone())
    return ok(row), 201


@api.route("/alerts/<int:alert_id>", methods=["DELETE"])
@login_required
def delete_alert(alert_id):
    with db() as conn:
        a = conn.execute("SELECT id FROM alerts WHERE id=? AND user_id=?",
                         (alert_id, g.user["id"])).fetchone()
        if not a: return err("Alert not found", 404)
        conn.execute("DELETE FROM alerts WHERE id=?", (alert_id,))
    return ok(message="Alert deleted")


@api.route("/alerts/<int:alert_id>/toggle", methods=["POST"])
@login_required
def toggle_alert(alert_id):
    with db() as conn:
        a = conn.execute("SELECT * FROM alerts WHERE id=? AND user_id=?",
                         (alert_id, g.user["id"])).fetchone()
        if not a: return err("Alert not found", 404)
        new_state = 0 if a["is_active"] else 1
        conn.execute("UPDATE alerts SET is_active=? WHERE id=?", (new_state, alert_id))
    return ok({"is_active": new_state})


# ═══════════════════════════════════════════════════════════
#  CONTACTS + JOURNEY TIMELINE
# ═══════════════════════════════════════════════════════════
@api.route("/contacts", methods=["GET"])
@login_required
def list_contacts():
    page     = int(request.args.get("page", 1))
    limit    = min(int(request.args.get("limit", 25)), 100)
    search   = (request.args.get("q") or "").strip()
    offset   = (page - 1) * limit

    base  = "SELECT * FROM contacts WHERE user_id=?"
    count = "SELECT COUNT(*) as c FROM contacts WHERE user_id=?"
    params = [g.user["id"]]

    search_params = []
    if search:
        like = f"%{search}%"
        base  += " AND (name LIKE ? OR email LIKE ? OR company LIKE ?)"
        count += " AND (name LIKE ? OR email LIKE ? OR company LIKE ?)"
        search_params = [like, like, like]

    base += " ORDER BY last_seen DESC LIMIT ? OFFSET ?"

    with db() as conn:
        rows  = conn.execute(base, params + search_params + [limit, offset]).fetchall()
        total = conn.execute(count, params + search_params).fetchone()["c"]

    return ok({
        "contacts": [dict(r) for r in rows],
        "total":    total,
        "page":     page,
        "pages":    (total + limit - 1) // limit
    })


@api.route("/contacts/<int:contact_id>", methods=["GET"])
@login_required
def get_contact(contact_id):
    with db() as conn:
        contact = conn.execute(
            "SELECT * FROM contacts WHERE id=? AND user_id=?",
            (contact_id, g.user["id"])
        ).fetchone()
        if not contact: return err("Contact not found", 404)

        # Seed demo touchpoints if none exist
        existing = conn.execute(
            "SELECT COUNT(*) as c FROM touchpoints WHERE contact_id=?", (contact_id,)
        ).fetchone()["c"]

        if existing == 0:
            demo_touchpoints = [
                (contact_id, "Meta Ads",    "paid",    "facebook",  "US-LAA-1pct", "video-v1",   "ad_click",    "https://nexustrack.io/landing", 0),
                (contact_id, "Organic",     "organic", "google",    None,          None,          "pageview",    "https://nexustrack.io/blog",    0),
                (contact_id, "Google Ads",  "paid",    "google",    "brand-exact", "headline-v2","ad_click",    "https://nexustrack.io",         0),
                (contact_id, "Email",       "email",   "newsletter",  "onboarding", None,         "email_click", "https://nexustrack.io/pricing", 0),
                (contact_id, "Direct",      "direct",  "direct",    None,          None,          "conversion",  "https://nexustrack.io/signup",  dict(contact).get("revenue", 0)),
            ]
            for tp in demo_touchpoints:
                conn.execute(
                    "INSERT INTO touchpoints (contact_id,channel,source,medium,campaign,content,event_type,page_url,revenue) VALUES (?,?,?,?,?,?,?,?,?)",
                    tp
                )

        touchpoints = conn.execute(
            "SELECT * FROM touchpoints WHERE contact_id=? ORDER BY occurred_at ASC",
            (contact_id,)
        ).fetchall()

    return ok({
        "contact":    dict(contact),
        "touchpoints": [dict(t) for t in touchpoints]
    })


# ═══════════════════════════════════════════════════════════
#  CAMPAIGNS (CREATIVE ANALYTICS)
# ═══════════════════════════════════════════════════════════
@api.route("/campaigns", methods=["GET"])
@login_required
def list_campaigns():
    platform  = request.args.get("platform")
    status    = request.args.get("status")
    sort      = request.args.get("sort", "revenue")
    direction = "DESC" if request.args.get("dir","desc") == "desc" else "ASC"

    safe_sort = {"revenue","spend","roas","conversions","cpa","ctr","budget_daily"}.intersection({sort})
    sort_col  = list(safe_sort)[0] if safe_sort else "revenue"

    query  = "SELECT * FROM campaigns WHERE user_id=?"
    params = [g.user["id"]]
    if platform: query += " AND platform=?"; params.append(platform)
    if status:   query += " AND status=?";   params.append(status)
    query += f" ORDER BY {sort_col} {direction}"

    with db() as conn:
        rows = conn.execute(query, params).fetchall()

    campaigns = [dict(r) for r in rows]

    # Compute totals
    totals = {
        "spend":       round(sum(c["spend"] for c in campaigns), 2),
        "revenue":     round(sum(c["revenue"] for c in campaigns), 2),
        "conversions": sum(c["conversions"] for c in campaigns),
        "roas":        round(sum(c["revenue"] for c in campaigns) / max(sum(c["spend"] for c in campaigns), 1), 2),
    }

    return ok({"campaigns": campaigns, "totals": totals})


# ═══════════════════════════════════════════════════════════
#  UTM BUILDER
# ═══════════════════════════════════════════════════════════
@api.route("/utm/build", methods=["POST"])
def build_utm():
    body     = request.get_json(silent=True) or {}
    base_url = (body.get("url") or "").strip()
    source   = (body.get("source") or "").strip().lower().replace(" ", "_")
    medium   = (body.get("medium") or "").strip().lower().replace(" ", "_")
    campaign = (body.get("campaign") or "").strip().lower().replace(" ", "_")
    term     = (body.get("term") or "").strip().lower().replace(" ", "_")
    content  = (body.get("content") or "").strip().lower().replace(" ", "_")

    if not base_url: return err("URL is required")
    if not source:   return err("utm_source is required")
    if not medium:   return err("utm_medium is required")
    if not campaign: return err("utm_campaign is required")

    params = [
        f"utm_source={source}",
        f"utm_medium={medium}",
        f"utm_campaign={campaign}",
    ]
    if term:    params.append(f"utm_term={term}")
    if content: params.append(f"utm_content={content}")

    sep      = "&" if "?" in base_url else "?"
    full_url = base_url + sep + "&".join(params)

    tips = []
    if medium not in {"cpc","email","social","organic","referral","display","video"}:
        tips.append(f"Consider a standard medium value like 'cpc', 'email', or 'social' instead of '{medium}'")
    if len(campaign) < 5:
        tips.append("Campaign name is very short — consider including date or target audience for better reporting")

    return ok({"url": full_url, "params": {
        "utm_source": source, "utm_medium": medium,
        "utm_campaign": campaign, "utm_term": term, "utm_content": content,
    }, "tips": tips})


@api.route("/utm/templates", methods=["GET"])
def utm_templates():
    return ok([
        {"name": "Meta Ads — Prospecting",    "source": "facebook", "medium": "cpc",   "campaign": "prospecting_{{date}}", "content": "video_v1"},
        {"name": "Google Search — Brand",     "source": "google",   "medium": "cpc",   "campaign": "brand_exact",          "content": ""},
        {"name": "Email Newsletter",          "source": "email",    "medium": "email", "campaign": "weekly_newsletter",    "content": "cta_button"},
        {"name": "LinkedIn — B2B",            "source": "linkedin", "medium": "cpc",   "campaign": "b2b_saas_awareness",   "content": "carousel"},
        {"name": "TikTok — UGC",              "source": "tiktok",   "medium": "cpc",   "campaign": "ugc_test_{{date}}",    "content": "ugc_creator1"},
        {"name": "YouTube — Pre-roll",        "source": "youtube",  "medium": "video", "campaign": "awareness_{{date}}",   "content": "preroll_30s"},
        {"name": "Organic Social — Instagram","source": "instagram","medium": "social","campaign": "organic_post",         "content": ""},
        {"name": "Referral Partner",          "source": "partner",  "medium": "referral","campaign": "partner_program",   "content": ""},
    ])


# ═══════════════════════════════════════════════════════════
#  ROI CALCULATOR
# ═══════════════════════════════════════════════════════════
@api.route("/roi/calculate", methods=["POST"])
def roi_calculate():
    body        = request.get_json(silent=True) or {}
    monthly_spend = float(body.get("monthly_spend") or 0)
    current_roas  = float(body.get("current_roas")  or 0)
    channels      = int(body.get("channels") or 1)
    industry      = (body.get("industry") or "saas").strip()

    if monthly_spend <= 0: return err("Monthly ad spend must be greater than 0")
    if current_roas  <= 0: return err("Current ROAS must be greater than 0")

    # Industry-specific improvement benchmarks
    benchmarks = {
        "ecommerce": {"roas_lift": 0.28, "waste_reduction": 0.22, "time_saved_hrs": 18},
        "saas":      {"roas_lift": 0.24, "waste_reduction": 0.19, "time_saved_hrs": 14},
        "agency":    {"roas_lift": 0.31, "waste_reduction": 0.25, "time_saved_hrs": 24},
        "health":    {"roas_lift": 0.21, "waste_reduction": 0.17, "time_saved_hrs": 12},
        "education": {"roas_lift": 0.19, "waste_reduction": 0.15, "time_saved_hrs": 10},
    }
    b = benchmarks.get(industry, benchmarks["saas"])

    # Scale improvement with number of channels (more complexity = more waste)
    channel_multiplier = 1 + (channels - 1) * 0.08

    roas_improvement    = b["roas_lift"] * channel_multiplier
    new_roas            = round(current_roas * (1 + roas_improvement), 2)
    current_revenue     = round(monthly_spend * current_roas, 2)
    new_revenue         = round(monthly_spend * new_roas, 2)
    monthly_revenue_gain = round(new_revenue - current_revenue, 2)
    wasted_spend        = round(monthly_spend * b["waste_reduction"], 2)
    annual_gain         = round((monthly_revenue_gain + wasted_spend) * 12, 2)
    roi_on_tool         = round((annual_gain / 1788) * 100, 0)  # $149/mo Growth plan

    return ok({
        "inputs": {"monthly_spend": monthly_spend, "current_roas": current_roas,
                   "channels": channels, "industry": industry},
        "results": {
            "current_revenue":      current_revenue,
            "new_revenue":          new_revenue,
            "monthly_revenue_gain": monthly_revenue_gain,
            "new_roas":             new_roas,
            "roas_improvement_pct": round(roas_improvement * 100, 1),
            "wasted_spend_saved":   wasted_spend,
            "annual_gain":          annual_gain,
            "roi_on_tool":          int(roi_on_tool),
            "time_saved_monthly":   b["time_saved_hrs"],
        },
        "breakdown": {
            "better_attribution":  round(monthly_revenue_gain * 0.55, 2),
            "waste_elimination":   wasted_spend,
            "improved_targeting":  round(monthly_revenue_gain * 0.45, 2),
        }
    })


# ═══════════════════════════════════════════════════════════
#  CONVERSION SYNC STATUS
# ═══════════════════════════════════════════════════════════
@api.route("/sync/status", methods=["GET"])
@login_required
def sync_status():
    import random, datetime
    now = datetime.datetime.utcnow()

    def mins_ago(m): return (now - datetime.timedelta(minutes=m)).strftime("%H:%M:%S")

    return ok({
        "overall_match_score": 94,
        "events_last_24h": 1247,
        "match_rate": 94.2,
        "platforms": [
            {
                "name": "Meta Ads (CAPI)",
                "status": "syncing",
                "match_score": 96,
                "events_sent": 842,
                "events_matched": 811,
                "last_event": mins_ago(2),
                "latency_ms": 143,
            },
            {
                "name": "Google Ads (Enhanced Conv.)",
                "status": "syncing",
                "match_score": 91,
                "events_sent": 405,
                "events_matched": 369,
                "last_event": mins_ago(4),
                "latency_ms": 198,
            },
            {
                "name": "TikTok Events API",
                "status": "syncing",
                "match_score": 88,
                "events_sent": 124,
                "events_matched": 109,
                "last_event": mins_ago(11),
                "latency_ms": 241,
            },
            {
                "name": "LinkedIn Insight Tag",
                "status": "warning",
                "match_score": 72,
                "events_sent": 38,
                "events_matched": 27,
                "last_event": mins_ago(38),
                "latency_ms": 612,
                "warning": "High latency detected — check your LinkedIn CAPI credentials",
            },
        ],
        "recent_events": [
            {"type": "Purchase",      "source": "Meta Ads",   "value": 249, "matched": True,  "time": mins_ago(1)},
            {"type": "Trial Signup",  "source": "Google Ads", "value": 0,   "matched": True,  "time": mins_ago(2)},
            {"type": "Demo Booked",   "source": "Organic",    "value": 0,   "matched": True,  "time": mins_ago(3)},
            {"type": "Purchase",      "source": "TikTok Ads", "value": 199, "matched": False, "time": mins_ago(4)},
            {"type": "Page View",     "source": "Email",      "value": 0,   "matched": True,  "time": mins_ago(5)},
            {"type": "Trial Signup",  "source": "Meta Ads",   "value": 0,   "matched": True,  "time": mins_ago(7)},
            {"type": "Purchase",      "source": "Google Ads", "value": 399, "matched": True,  "time": mins_ago(9)},
            {"type": "Demo Booked",   "source": "LinkedIn",   "value": 0,   "matched": False, "time": mins_ago(12)},
        ]
    })
