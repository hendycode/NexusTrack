"""
NexusTrack Database Layer
SQLite3 with connection pooling pattern
"""
import sqlite3
import os
from contextlib import contextmanager

DB_PATH = os.path.join(os.path.dirname(__file__), 'nexustrack.db')

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    name        TEXT    NOT NULL,
    password    TEXT    NOT NULL,
    role        TEXT    NOT NULL DEFAULT 'user',
    plan        TEXT    NOT NULL DEFAULT 'free',
    is_verified INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS demo_bookings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    email        TEXT    NOT NULL,
    company      TEXT    NOT NULL,
    team_size    TEXT    NOT NULL,
    message      TEXT,
    status       TEXT    NOT NULL DEFAULT 'pending',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contact_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    email      TEXT    NOT NULL,
    subject    TEXT    NOT NULL,
    message    TEXT    NOT NULL,
    status     TEXT    NOT NULL DEFAULT 'unread',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    source     TEXT    NOT NULL DEFAULT 'website',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS integrations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    slug        TEXT    NOT NULL UNIQUE,
    category    TEXT    NOT NULL,
    description TEXT    NOT NULL,
    icon        TEXT    NOT NULL DEFAULT 'plug',
    color       TEXT    NOT NULL DEFAULT '#4a8c6e',
    is_featured INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plans (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    slug           TEXT    NOT NULL UNIQUE,
    name           TEXT    NOT NULL,
    price_monthly  INTEGER NOT NULL,
    price_annual   INTEGER NOT NULL,
    description    TEXT    NOT NULL,
    features       TEXT    NOT NULL,
    is_popular     INTEGER NOT NULL DEFAULT 0,
    cta_label      TEXT    NOT NULL DEFAULT 'Get Started',
    sort_order     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS testimonials (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    role         TEXT    NOT NULL,
    company      TEXT    NOT NULL,
    initials     TEXT    NOT NULL,
    quote        TEXT    NOT NULL,
    rating       INTEGER NOT NULL DEFAULT 5,
    is_featured  INTEGER NOT NULL DEFAULT 0,
    sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON demo_bookings(status);
CREATE INDEX IF NOT EXISTS idx_contact_status ON contact_messages(status);
"""

SEED_DATA = """
INSERT OR IGNORE INTO integrations (name, slug, category, description, icon, color, is_featured) VALUES
('Stripe',        'stripe',        'payments',  'Accept payments and track revenue',  'credit-card', '#635BFF', 1),
('HubSpot',       'hubspot',       'crm',       'Sync leads and contacts',            'users',       '#FF7A59', 1),
('Shopify',       'shopify',       'ecommerce', 'Connect your Shopify store',         'shopping-bag','#96BF48', 1),
('Meta Ads',      'meta-ads',      'ads',       'Track Facebook & Instagram ads',     'target',      '#1877F2', 1),
('Google Ads',    'google-ads',    'ads',       'Connect Google Ads campaigns',       'bar-chart',   '#4285F4', 1),
('Zapier',        'zapier',        'automation','Automate with 5000+ apps',           'zap',         '#FF4A00', 1),
('Calendly',      'calendly',      'scheduling','Track demo bookings',                'calendar',    '#006BFF', 0),
('Kajabi',        'kajabi',        'education', 'Course and membership tracking',     'book',        '#FF7A00', 0),
('ClickFunnels',  'clickfunnels',  'funnels',   'Track funnel conversions',           'funnel',      '#DE5833', 1),
('Salesforce',    'salesforce',    'crm',       'Enterprise CRM integration',         'cloud',       '#00A1E0', 0),
('Webflow',       'webflow',       'website',   'Track Webflow site events',          'layout',      '#4353FF', 0),
('WooCommerce',   'woocommerce',   'ecommerce', 'WordPress ecommerce tracking',       'shopping-cart','#96588A',0),
('Intercom',      'intercom',      'support',   'Track customer conversations',       'message',     '#1F8DED', 0),
('Pipedrive',     'pipedrive',     'crm',       'Sales pipeline attribution',         'trending-up', '#1A9C3E', 0),
('Monday',        'monday',        'pm',        'Project management sync',            'grid',        '#FF3D57', 0),
('TikTok Ads',    'tiktok-ads',    'ads',       'TikTok campaign tracking',           'video',       '#010101', 0),
('LinkedIn Ads',  'linkedin-ads',  'ads',       'B2B lead attribution',               'briefcase',   '#0A66C2', 0),
('YouTube Ads',   'youtube-ads',   'ads',       'Video ad conversion tracking',       'play',        '#FF0000', 0);

INSERT OR IGNORE INTO plans (slug, name, price_monthly, price_annual, description, features, is_popular, cta_label, sort_order) VALUES
('starter', 'Starter', 49, 39,
 'Perfect for solo marketers getting started with attribution.',
 '["Up to 5,000 conversions/mo","3 ad platform connections","Basic attribution models","Standard dashboards","7-day data history","Email support"]',
 0, 'Get Started', 1),
('growth', 'Growth', 149, 119,
 'For growing teams that need full attribution and AI-powered insights.',
 '["Up to 50,000 conversions/mo","Unlimited ad connections","All attribution models","AI Chat & AI Ads Manager","Conversion Sync","Custom dashboards","30-day data history","Priority support","Slack reports"]',
 1, 'Start Free Trial', 2),
('enterprise', 'Enterprise', 0, 0,
 'For agencies and large teams with advanced reporting and multi-client needs.',
 '["Unlimited conversions","Multi-client dashboards","Custom integrations","Dedicated account manager","White-label reporting","API access","Custom data retention","24/7 phone support","SLA guarantee"]',
 0, 'Contact Sales', 3);

INSERT OR IGNORE INTO testimonials (name, role, company, initials, quote, rating, is_featured, sort_order) VALUES
('Jonathan Ronzio','Co-founder & CMO','Trainual','JR',
 'Better ad targeting. Better funnel insights. Better CPA control. We have scaled our ad spend 40% since implementing NexusTrack and it has definitely given us the confidence to do so. Not to mention the incredible partner-level support.',
 5, 1, 1),
('Baris Zeren','CEO','Book Your Data','BZ',
 'NexusTrack has been a game-changer — perfect for seeing all paid channels in one unified dashboard, making it easy to track and analyze performance across platforms. Their support team is outstanding.',
 5, 1, 2),
('Rexell Espinosa','Growth Marketing','Design Pickle','RE',
 'Our team relies on NexusTrack to track and attribute various KPIs, including revenue, to the correct marketing sources. The easy-to-use interface and customizable dashboard views make reporting effortless.',
 5, 0, 3),
('Aleric Heck','Founder & CEO','AdOutreach','AH',
 'NexusTrack has streamlined our ad reporting and eliminated numerous internal processes, saving my team valuable time. For any business looking to optimize their ad operations and performance, this is a game-changer.',
 5, 1, 4),
('David Trachsel','Head of Growth','SaaSRise','DT',
 'NexusTrack has been an invaluable tool that delivers rock-solid advertising attribution and tracking. It has allowed us to scale and make strategic advertising decisions knowing our conversion data is accurate.',
 5, 0, 5),
('Dustin Cucciarre','Head of Marketing','Clicks Geek','DC',
 'With the ability to track clicks, conversions, and key metrics across multiple channels, I can quickly identify what is working and make data-driven decisions to optimize my campaigns instantly.',
 5, 0, 6);
"""

def get_conn():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

@contextmanager
def db():
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    conn = get_conn()
    conn.executescript(SCHEMA)
    conn.executescript(SEED_DATA)
    conn.commit()
    conn.close()
    print(f"[DB] Initialized at {DB_PATH}")


# ── NEW TABLES MIGRATION ─────────────────────────────────────────────────
NEW_TABLES = """

CREATE TABLE IF NOT EXISTS events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT    NOT NULL,
    event_type   TEXT    NOT NULL DEFAULT 'conversion',
    description  TEXT,
    value        REAL    NOT NULL DEFAULT 0,
    currency     TEXT    NOT NULL DEFAULT 'USD',
    is_active    INTEGER NOT NULL DEFAULT 1,
    fire_count   INTEGER NOT NULL DEFAULT 0,
    last_fired   TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT    NOT NULL,
    metric       TEXT    NOT NULL,
    operator     TEXT    NOT NULL,
    threshold    REAL    NOT NULL,
    channel      TEXT    NOT NULL DEFAULT 'email',
    webhook_url  TEXT,
    is_active    INTEGER NOT NULL DEFAULT 1,
    last_fired   TEXT,
    fire_count   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alert_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_id   INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    metric     TEXT    NOT NULL,
    value      REAL    NOT NULL,
    threshold  REAL    NOT NULL,
    fired_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           TEXT    NOT NULL,
    platform       TEXT    NOT NULL,
    status         TEXT    NOT NULL DEFAULT 'active',
    budget_daily   REAL    NOT NULL DEFAULT 0,
    spend          REAL    NOT NULL DEFAULT 0,
    revenue        REAL    NOT NULL DEFAULT 0,
    impressions    INTEGER NOT NULL DEFAULT 0,
    clicks         INTEGER NOT NULL DEFAULT 0,
    conversions    INTEGER NOT NULL DEFAULT 0,
    roas           REAL    NOT NULL DEFAULT 0,
    cpa            REAL    NOT NULL DEFAULT 0,
    ctr            REAL    NOT NULL DEFAULT 0,
    creative_type  TEXT    NOT NULL DEFAULT 'image',
    creative_url   TEXT,
    headline       TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email          TEXT,
    name           TEXT,
    phone          TEXT,
    company        TEXT,
    first_source   TEXT,
    last_source    TEXT,
    total_touches  INTEGER NOT NULL DEFAULT 0,
    converted      INTEGER NOT NULL DEFAULT 0,
    revenue        REAL    NOT NULL DEFAULT 0,
    match_score    INTEGER NOT NULL DEFAULT 0,
    first_seen     TEXT    NOT NULL DEFAULT (datetime('now')),
    last_seen      TEXT    NOT NULL DEFAULT (datetime('now')),
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS touchpoints (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id   INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    channel      TEXT    NOT NULL,
    source       TEXT    NOT NULL,
    medium       TEXT,
    campaign     TEXT,
    content      TEXT,
    event_type   TEXT    NOT NULL DEFAULT 'pageview',
    page_url     TEXT,
    revenue      REAL    NOT NULL DEFAULT 0,
    occurred_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_user   ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_user   ON alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_user  ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_touchpoints_contact ON touchpoints(contact_id);
"""

# ── SEED DEMO DATA ───────────────────────────────────────────────────────
DEMO_SEED = """
INSERT OR IGNORE INTO campaigns (user_id,name,platform,status,budget_daily,spend,revenue,impressions,clicks,conversions,roas,cpa,ctr,creative_type,headline)
SELECT 1,'US Lookalike 1-2% — LAA','Meta Ads','active',400,594.18,2354.59,48200,1842,15,3.96,39.61,3.82,'video','Stop Guessing Which Ads Work'
WHERE EXISTS(SELECT 1 FROM users WHERE id=1);
INSERT OR IGNORE INTO campaigns (user_id,name,platform,status,budget_daily,spend,revenue,impressions,clicks,conversions,roas,cpa,ctr,creative_type,headline)
SELECT 1,'FB News Feed — Broad','Meta Ads','active',900,1840.49,8354.59,92400,3710,53,4.54,34.73,4.02,'image','Know Exactly What Drives Revenue'
WHERE EXISTS(SELECT 1 FROM users WHERE id=1);
INSERT OR IGNORE INTO campaigns (user_id,name,platform,status,budget_daily,spend,revenue,impressions,clicks,conversions,roas,cpa,ctr,creative_type,headline)
SELECT 1,'Instagram LAA 5%','Meta Ads','active',125,1264.06,0,31200,842,18,0,70.23,2.70,'carousel','AI Attribution for Growth Teams'
WHERE EXISTS(SELECT 1 FROM users WHERE id=1);
INSERT OR IGNORE INTO campaigns (user_id,name,platform,status,budget_daily,spend,revenue,impressions,clicks,conversions,roas,cpa,ctr,creative_type,headline)
SELECT 1,'Google Search — Brand','Google Ads','active',200,743.49,4210.00,18900,2140,28,5.66,26.55,11.32,'text','NexusTrack Attribution Software'
WHERE EXISTS(SELECT 1 FROM users WHERE id=1);
INSERT OR IGNORE INTO campaigns (user_id,name,platform,status,budget_daily,spend,revenue,impressions,clicks,conversions,roas,cpa,ctr,creative_type,headline)
SELECT 1,'Google Search — Competitor','Google Ads','paused',150,178.34,1240.00,9400,412,8,6.95,22.29,4.38,'text','Better Than [Competitor] Attribution'
WHERE EXISTS(SELECT 1 FROM users WHERE id=1);
INSERT OR IGNORE INTO campaigns (user_id,name,platform,status,budget_daily,spend,revenue,impressions,clicks,conversions,roas,cpa,ctr,creative_type,headline)
SELECT 1,'UK Retargeting — L30Days','Meta Ads','active',125,618.34,3842.00,22100,891,18,6.21,34.35,4.03,'video','Welcome Back — See Your Attribution'
WHERE EXISTS(SELECT 1 FROM users WHERE id=1);
INSERT OR IGNORE INTO campaigns (user_id,name,platform,status,budget_daily,spend,revenue,impressions,clicks,conversions,roas,cpa,ctr,creative_type,headline)
SELECT 1,'TikTok — UGC Creative Test','TikTok Ads','active',80,243.18,892.00,88400,1240,12,3.67,20.27,1.40,'video','This Changed How We Track Ads'
WHERE EXISTS(SELECT 1 FROM users WHERE id=1);

INSERT OR IGNORE INTO contacts (user_id,email,name,company,first_source,last_source,total_touches,converted,revenue,match_score)
SELECT 1,'sarah@techcorp.com','Sarah Mitchell','TechCorp Inc','Meta Ads','Email','5',1,2400,94
WHERE EXISTS(SELECT 1 FROM users WHERE id=1);
INSERT OR IGNORE INTO contacts (user_id,email,name,company,first_source,last_source,total_touches,converted,revenue,match_score)
SELECT 1,'james@growthco.io','James Thornton','GrowthCo','Google Ads','Direct','3',1,1800,88
WHERE EXISTS(SELECT 1 FROM users WHERE id=1);
INSERT OR IGNORE INTO contacts (user_id,email,name,company,first_source,last_source,total_touches,converted,revenue,match_score)
SELECT 1,'priya@saasrise.com','Priya Sharma','SaaSRise','TikTok Ads','Meta Ads','7',1,4200,97
WHERE EXISTS(SELECT 1 FROM users WHERE id=1);
INSERT OR IGNORE INTO contacts (user_id,email,name,company,first_source,last_source,total_touches,converted,revenue,match_score)
SELECT 1,'alex@designpickle.com','Alex Reynolds','Design Pickle','Organic','Google Ads','2',0,0,71
WHERE EXISTS(SELECT 1 FROM users WHERE id=1);
INSERT OR IGNORE INTO contacts (user_id,email,name,company,first_source,last_source,total_touches,converted,revenue,match_score)
SELECT 1,'marco@adoutreach.com','Marco Alvarez','AdOutreach','Email','Email','4',1,3100,91
WHERE EXISTS(SELECT 1 FROM users WHERE id=1);

INSERT OR IGNORE INTO events (user_id,name,event_type,description,value,fire_count,last_fired)
SELECT 1,'Purchase','conversion','Customer completed a checkout',0,247,datetime('now','-1 hour')
WHERE EXISTS(SELECT 1 FROM users WHERE id=1);
INSERT OR IGNORE INTO events (user_id,name,event_type,description,value,fire_count,last_fired)
SELECT 1,'Trial Signup','lead','User started a free trial',0,89,datetime('now','-3 hour')
WHERE EXISTS(SELECT 1 FROM users WHERE id=1);
INSERT OR IGNORE INTO events (user_id,name,event_type,description,value,fire_count,last_fired)
SELECT 1,'Demo Booked','lead','User booked a demo call',0,34,datetime('now','-6 hour')
WHERE EXISTS(SELECT 1 FROM users WHERE id=1);
INSERT OR IGNORE INTO events (user_id,name,event_type,description,value,fire_count,last_fired)
SELECT 1,'Page View','engagement','User visited a key page',0,8421,datetime('now','-5 min')
WHERE EXISTS(SELECT 1 FROM users WHERE id=1);

INSERT OR IGNORE INTO alerts (user_id,name,metric,operator,threshold,channel,is_active)
SELECT 1,'ROAS Drop Alert','roas','below',3.0,'email',1
WHERE EXISTS(SELECT 1 FROM users WHERE id=1);
INSERT OR IGNORE INTO alerts (user_id,name,metric,operator,threshold,channel,is_active)
SELECT 1,'Daily Spend Limit','spend','above',2000,'email',1
WHERE EXISTS(SELECT 1 FROM users WHERE id=1);
INSERT OR IGNORE INTO alerts (user_id,name,metric,operator,threshold,channel,is_active)
SELECT 1,'Conversion Milestone','conversions','above',100,'email',1
WHERE EXISTS(SELECT 1 FROM users WHERE id=1);
"""

def migrate_db():
    """Run new table migrations — safe to call multiple times"""
    conn = get_conn()
    conn.executescript(NEW_TABLES)
    conn.executescript(DEMO_SEED)
    conn.commit()
    conn.close()
    print("[DB] Migration complete")
