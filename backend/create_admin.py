"""
Create an admin user for NexusTrack
Usage: python3 create_admin.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from database import init_db, db
from auth import hash_password

init_db()

name  = input("Admin name [Admin]: ").strip() or "Admin"
email = input("Admin email [admin@nexustrack.com]: ").strip() or "admin@nexustrack.com"
pw    = input("Admin password [admin1234]: ").strip() or "admin1234"

with db() as conn:
    existing = conn.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
    if existing:
        conn.execute("UPDATE users SET role='admin', password=? WHERE email=?", (hash_password(pw), email))
        print(f"\n✓  Updated {email} to admin role")
    else:
        conn.execute(
            "INSERT INTO users (email, name, password, role, is_verified) VALUES (?,?,?,?,1)",
            (email, name, hash_password(pw), 'admin')
        )
        print(f"\n✓  Created admin user: {email}")

print(f"   Login at: http://localhost:5000/login")
