"""Administrative commands accept secrets through stdin, never command arguments."""
import json
import sys
from app import BlogApp, APIError


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("bootstrap", "check"):
        raise SystemExit("Usage: python manage.py bootstrap|check")
    app = BlogApp()
    if sys.argv[1] == "bootstrap":
        password = sys.stdin.readline().rstrip("\r\n")
        try:
            app.bootstrap(password)
        except APIError as error:
            raise SystemExit(error.message)
        print("Administrator password initialized; existing administrator sessions revoked.")
    else:
        with app.connect() as db:
            result = db.execute("PRAGMA quick_check").fetchone()[0]
            published = db.execute("SELECT COUNT(*) FROM posts WHERE live_json IS NOT NULL").fetchone()[0]
        print(json.dumps({"integrity": result, "published": published}))


if __name__ == "__main__":
    main()
