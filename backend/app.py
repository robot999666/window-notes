"""Isolated blog application. Runtime data never belongs in a release or Git checkout."""
import base64
import hashlib
import hmac
import html
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import quote

import bleach
import markdown

SHANGHAI = timezone(timedelta(hours=8))
CATEGORIES = ("工程实践", "AI 与研究", "学习记录", "生活随笔")
COOKIE = "window_session"
MAX_BODY = 128 * 1024
ALLOWED_TAGS = set(bleach.sanitizer.ALLOWED_TAGS) | {
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr", "pre",
    "table", "thead", "tbody", "tr", "th", "td", "del", "img", "span",
}


class ClosingConnection(sqlite3.Connection):
    """sqlite's usual context manager commits, but does not close the connection."""
    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def json_dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, maxmem=64 * 1024 * 1024)
    return "scrypt$16384$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def check_password(password, stored):
    try:
        algorithm, rounds, salt, expected = stored.split("$")
        if algorithm != "scrypt" or rounds != "16384":
            return False
        actual = hashlib.scrypt(password.encode("utf-8"), salt=base64.b64decode(salt), n=16384, r=8, p=1, maxmem=64 * 1024 * 1024)
        return hmac.compare_digest(actual, base64.b64decode(expected))
    except (ValueError, TypeError, AttributeError):
        return False


def render_markdown(value):
    raw = markdown.markdown(value, extensions=["fenced_code", "tables", "sane_lists"])
    # Strip embedded HTML scripts before the allowlist pass (their text is not useful prose).
    raw = re.sub(r"<(script|style|iframe)\b[^>]*>.*?</\1\s*>", "", raw, flags=re.I | re.S)
    clean = bleach.clean(raw, tags=ALLOWED_TAGS, attributes={"a": ["href", "title"], "img": ["src", "alt", "title"], "th": ["align"], "td": ["align"], "code": ["class"]}, protocols=["http", "https", "mailto"], strip=True, strip_comments=True)
    return bleach.linkifier.Linker(callbacks=[bleach.callbacks.nofollow]).linkify(clean)


class APIError(Exception):
    def __init__(self, status, message, code="invalid_request"):
        super().__init__(message)
        self.status, self.message, self.code = status, message, code


class BlogApp:
    def __init__(self, data_dir=None, origin=None, allow_insecure=None, secure_cookie=None, seed_path=None, static_dir=None):
        self.data_dir = Path(data_dir or os.environ.get("BLOG_DATA_DIR", "/var/lib/robot-blog"))
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.data_dir / "blog.sqlite3"
        self.origin = (origin or os.environ.get("BLOG_ORIGIN", "https://152.136.191.171:8088")).rstrip("/")
        self.allow_insecure = allow_insecure if allow_insecure is not None else os.environ.get("BLOG_ALLOW_INSECURE", "0") == "1"
        self.secure_cookie = secure_cookie if secure_cookie is not None else os.environ.get("BLOG_SECURE_COOKIE", "1") == "1"
        self.static_dir = Path(static_dir or os.environ.get("BLOG_STATIC_DIR", "/opt/robot-blog/current"))
        self.seed_path = Path(seed_path or os.environ.get("BLOG_SEED_PATH", str(Path(__file__).with_name("seed.json"))))
        self.limit_lock = threading.Lock()
        self.limits = defaultdict(deque)
        self._initialize()

    def connect(self):
        db = sqlite3.connect(self.db_path, timeout=10, factory=ClosingConnection)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=10000")
        return db

    def _initialize(self):
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE,
                    display_name TEXT NOT NULL, password_hash TEXT,
                    role TEXT NOT NULL CHECK(role IN ('admin','writer')), created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    csrf TEXT NOT NULL, expires REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS posts (
                    id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
                    slug TEXT UNIQUE NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','pending','published','rejected')),
                    draft_json TEXT NOT NULL, live_json TEXT, published_at TEXT, live_updated_at TEXT,
                    updated_at TEXT NOT NULL, feedback TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1
                );
                CREATE TABLE IF NOT EXISTS publication_events (
                    id INTEGER PRIMARY KEY, post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
                    date TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('published','updated'))
                );
                CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS posts_owner ON posts(owner_id);
                CREATE INDEX IF NOT EXISTS events_date ON publication_events(date);
                CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
            """)
            if "revision" not in {column["name"] for column in db.execute("PRAGMA table_info(posts)")}:
                db.execute("ALTER TABLE posts ADD COLUMN revision INTEGER NOT NULL DEFAULT 1")
            db.execute("INSERT OR IGNORE INTO users(username,display_name,password_hash,role,created_at) VALUES(?,?,NULL,'admin',?)", ("robot999666", "robot999666", now()))
            if not db.execute("SELECT 1 FROM metadata WHERE key='initial_seed'").fetchone() and self.seed_path.exists():
                owner = db.execute("SELECT id FROM users WHERE username='robot999666'").fetchone()["id"]
                entries = json.loads(self.seed_path.read_text(encoding="utf-8"))
                for entry in entries:
                    slug = entry.pop("slug")
                    content = self.validate_content(entry, seed=True)
                    published = content["date"] + "T00:00:00+08:00"
                    cursor = db.execute("INSERT OR IGNORE INTO posts(owner_id,slug,status,draft_json,live_json,published_at,live_updated_at,updated_at) VALUES(?,?,'published',?,?,?,?,?)", (owner, slug, json_dump(content), json_dump(content), published, published, published))
                    if cursor.rowcount:
                        db.execute("INSERT INTO publication_events(post_id,date,kind) VALUES(?,?,'published')", (cursor.lastrowid, content["date"]))
                db.execute("INSERT INTO metadata(key,value) VALUES('initial_seed',?)", (now(),))
        try:
            self.db_path.chmod(0o600)
        except OSError:
            pass

    def bootstrap(self, password):
        self.validate_password(password)
        with self.connect() as db:
            db.execute("UPDATE users SET password_hash=? WHERE username='robot999666' AND role='admin'", (hash_password(password),))
            db.execute("DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE username='robot999666')")

    @staticmethod
    def validate_password(password):
        if not isinstance(password, str) or not 12 <= len(password) <= 256:
            raise APIError(400, "密码需要 12 至 256 个字符。", "password_length")

    def validate_content(self, data, seed=False):
        if not isinstance(data, dict):
            raise APIError(400, "文章格式不正确。")
        result = {}
        for key, maximum, minimum in [("title", 150, 1), ("description", 500, 1), ("markdown", 100000, 1)]:
            value = data.get(key)
            if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
                raise APIError(400, f"{ {'title':'标题','description':'摘要','markdown':'正文'}[key] }不能为空，且不能超过 {maximum} 个字符。")
            result[key] = value.strip()
        category = data.get("category", "生活随笔")
        if category not in CATEGORIES:
            raise APIError(400, "请选择有效的文章分类。")
        tags = data.get("tags", [])
        if not isinstance(tags, list) or len(tags) > 10 or any(not isinstance(t, str) or not 1 <= len(t.strip()) <= 30 for t in tags):
            raise APIError(400, "最多填写 10 个标签，每个标签不超过 30 字。")
        result.update(category=category, tags=list(dict.fromkeys(t.strip() for t in tags)), readingTime=f"{max(1, (len(result['markdown']) + 399) // 400)} 分钟", date=datetime.now(SHANGHAI).date().isoformat())
        if seed:
            result["date"] = data["date"]
            result["readingTime"] = data.get("readingTime", result["readingTime"])
            result["source"] = data.get("source", "")
            result["sourceLabel"] = data.get("sourceLabel", "公开项目")
        return result

    def rate_limit(self, key, maximum, interval):
        current = time.time()
        with self.limit_lock:
            # Bound memory even if a visitor sends many arbitrary names.
            if len(self.limits) > 4096:
                for old_key in list(self.limits):
                    if not self.limits[old_key] or self.limits[old_key][-1] < current - 3600:
                        del self.limits[old_key]
                if len(self.limits) > 4096:
                    raise APIError(429, "请求较多，请稍后再试。", "rate_limited")
            times = self.limits[key]
            while times and times[0] < current - interval:
                times.popleft()
            if len(times) >= maximum:
                raise APIError(429, "请求较多，请稍后再试。", "rate_limited")
            times.append(current)

    @staticmethod
    def client_ip(environ):
        # Waitress resolves X-Forwarded-For from the trusted local proxy only.
        return environ.get("REMOTE_ADDR", "unknown")

    def is_https(self, environ):
        return environ.get("wsgi.url_scheme") == "https" or (environ.get("REMOTE_ADDR") in ("127.0.0.1", "::1") and environ.get("HTTP_X_FORWARDED_PROTO") == "https")

    def require_secure(self, environ):
        if not self.allow_insecure and not self.is_https(environ):
            raise APIError(403, "请通过 HTTPS 安全连接使用登录和编辑功能。", "https_required")

    def session(self, db, environ, create=False):
        cookie = SimpleCookie()
        try:
            cookie.load(environ.get("HTTP_COOKIE", ""))
        except Exception:
            cookie = SimpleCookie()
        token = cookie[COOKIE].value if COOKIE in cookie else ""
        row = db.execute("SELECT s.*,u.username,u.display_name,u.role FROM sessions s LEFT JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires>?", (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone() if token and len(token) < 200 else None
        if row:
            return dict(row), None
        if not create:
            return None, None
        self.rate_limit(("guest_session", self.client_ip(environ)), 120, 3600)
        return self.new_session(db, None)

    def new_session(self, db, user_id, old=None):
        if old:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (old["token_hash"],))
        db.execute("DELETE FROM sessions WHERE expires<?", (time.time(),))
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        hashed = hashlib.sha256(token.encode()).hexdigest()
        lifetime = 7 * 86400 if user_id else 86400
        db.execute("INSERT INTO sessions(token_hash,user_id,csrf,expires) VALUES(?,?,?,?)", (hashed, user_id, csrf, time.time() + lifetime))
        row = db.execute("SELECT s.*,u.username,u.display_name,u.role FROM sessions s LEFT JOIN users u ON u.id=s.user_id WHERE token_hash=?", (hashed,)).fetchone()
        cookie = f"{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={lifetime}" + ("; Secure" if self.secure_cookie else "")
        return dict(row), cookie

    @staticmethod
    def session_json(session):
        user = None if not session or not session["user_id"] else {"id": session["user_id"], "username": session["username"], "displayName": session["display_name"], "role": session["role"]}
        return {"user": user, "csrfToken": session["csrf"] if session else None}

    def authorize(self, environ, session, admin=False):
        self.require_secure(environ)
        if not session or not session.get("user_id"):
            raise APIError(401, "请先登录。", "login_required")
        if admin and session["role"] != "admin":
            raise APIError(403, "此操作仅限管理员。", "admin_required")

    def csrf(self, environ, session):
        self.require_secure(environ)
        if environ.get("HTTP_ORIGIN", "").rstrip("/") != self.origin:
            raise APIError(403, "请求来源校验失败，请从本站页面操作。", "origin_rejected")
        token = environ.get("HTTP_X_CSRF_TOKEN", "")
        if not session or not token or not hmac.compare_digest(token, session["csrf"]):
            raise APIError(403, "页面凭据已过期，请刷新页面后重试。", "csrf_rejected")

    def read_body(self, environ):
        if not environ.get("CONTENT_TYPE", "").lower().startswith("application/json"):
            raise APIError(415, "请使用 JSON 格式提交。")
        try:
            length = int(environ.get("CONTENT_LENGTH", "0"))
        except ValueError:
            raise APIError(400, "请求长度无效。")
        if length < 1 or length > MAX_BODY:
            raise APIError(413, "提交内容过大。")
        try:
            value = json.loads(environ["wsgi.input"].read(length).decode("utf-8"))
        except (ValueError, UnicodeError):
            raise APIError(400, "提交内容不是有效的 JSON。")
        if not isinstance(value, dict):
            raise APIError(400, "提交内容格式无效。")
        return value

    def post_json(self, row, workspace=False, include_html=False):
        content = json.loads(row["draft_json"] if workspace else row["live_json"])
        result = {**content, "id": row["id"], "slug": row["slug"], "url": "/notes/" + quote(row["slug"]) + "/", "author": row["display_name"], "updatedAt": row["updated_at"] if workspace else row["live_updated_at"]}
        if workspace:
            result.update(status=row["status"], feedback=row["feedback"], isLive=bool(row["live_json"]), ownerId=row["owner_id"], publishedAt=row["published_at"], revision=row["revision"])
        else:
            result.pop("markdown", None)
        if include_html:
            result["html"] = render_markdown(content["markdown"])
        return result

    def get_post(self, db, post_id):
        row = db.execute("SELECT p.*,u.display_name FROM posts p JOIN users u ON u.id=p.owner_id WHERE p.id=?", (post_id,)).fetchone()
        if not row:
            raise APIError(404, "文章不存在。", "not_found")
        return row

    def own_post(self, db, post_id, session):
        row = self.get_post(db, post_id)
        if session["role"] != "admin" and row["owner_id"] != session["user_id"]:
            raise APIError(403, "你只能编辑自己的文章。", "forbidden")
        return row

    @staticmethod
    def check_revision(row, data, required=False):
        revision = data.get("expectedRevision")
        if (required and revision is None) or (revision is not None and (not isinstance(revision, int) or isinstance(revision, bool))):
            raise APIError(400, "请重新打开这篇文章后再审核。", "revision_required")
        if revision is not None and revision != row["revision"]:
            raise APIError(409, "这篇文章已有新的修改，请刷新后重新查看。", "revision_conflict")

    def publish(self, db, post_id):
        row = self.get_post(db, post_id)
        stamp = now()
        content = json.loads(row["draft_json"])
        if row["live_json"]:
            content["date"] = json.loads(row["live_json"])["date"]
        else:
            content["date"] = datetime.now(SHANGHAI).date().isoformat()
        db.execute("UPDATE posts SET status='published',draft_json=?,live_json=?,published_at=COALESCE(published_at,?),live_updated_at=?,updated_at=?,feedback='',revision=revision+1 WHERE id=?", (json_dump(content), json_dump(content), stamp, stamp, stamp, post_id))
        db.execute("INSERT INTO publication_events(post_id,date,kind) VALUES(?,?,?)", (post_id, datetime.now(SHANGHAI).date().isoformat(), "updated" if row["live_json"] else "published"))

    def dispatch(self, db, environ, method, path):
        session, cookie = self.session(db, environ, create=path == "/api/session")
        if method not in ("GET", "HEAD"):
            self.csrf(environ, session)
            self.rate_limit(("write", self.client_ip(environ)), 120, 60)
            # Serialize moderation checks and writes; a review never switches to a
            # newer draft between checking its revision and publishing it.
            db.execute("BEGIN IMMEDIATE")
        headers = [("Set-Cookie", cookie)] if cookie else []
        if path == "/api/health" and method == "GET":
            db.execute("SELECT 1")
            return {"ok": True, "storage": "sqlite"}, headers
        if path == "/api/session" and method == "GET":
            if session and session.get("user_id"):
                self.require_secure(environ)
            return self.session_json(session), headers
        if path.startswith("/api/auth/") and method == "POST":
            self.require_secure(environ)
            body = self.read_body(environ)
            action = path.rsplit("/", 1)[-1]
            if action in ("login", "register"):
                username, password = body.get("username", ""), body.get("password", "")
                if not isinstance(username, str) or not re.fullmatch(r"[A-Za-z0-9_-]{3,32}", username):
                    raise APIError(400, "用户名须为 3 至 32 位字母、数字、下划线或短横线。")
                if not isinstance(password, str) or len(password) > 256:
                    raise APIError(400, "密码格式无效。")
                ip = self.client_ip(environ)
                self.rate_limit(("auth", ip), 25, 900)
                self.rate_limit(("account", username.lower()), 8, 900)
                if action == "register":
                    self.rate_limit(("register", ip), 5, 3600)
                    self.validate_password(password)
                    display = body.get("displayName", username)
                    if not isinstance(display, str) or not 1 <= len(display.strip()) <= 40:
                        raise APIError(400, "显示名称需要 1 至 40 个字符。")
                    if db.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
                        raise APIError(409, "这个用户名已被使用。", "username_taken")
                    user_id = db.execute("INSERT INTO users(username,display_name,password_hash,role,created_at) VALUES(?,?,?,'writer',?)", (username, display.strip(), hash_password(password), now())).lastrowid
                else:
                    user = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
                    if not user or not check_password(password, user["password_hash"]):
                        # A failed login never reveals whether an account exists or is disabled.
                        if not user or not user["password_hash"]:
                            hash_password("timing-equivalent-dummy-password")
                        raise APIError(401, "用户名或密码不正确。", "invalid_credentials")
                    user_id = user["id"]
                session, cookie = self.new_session(db, user_id, session)
                return self.session_json(session), [("Set-Cookie", cookie)]
            self.authorize(environ, session)
            if action == "logout":
                session, cookie = self.new_session(db, None, session)
                return self.session_json(session), [("Set-Cookie", cookie)]
            if action == "change-password":
                user = db.execute("SELECT * FROM users WHERE id=?", (session["user_id"],)).fetchone()
                if not isinstance(body.get("currentPassword"), str) or not check_password(body["currentPassword"], user["password_hash"]):
                    raise APIError(400, "当前密码不正确。", "invalid_credentials")
                self.validate_password(body.get("password"))
                db.execute("UPDATE users SET password_hash=? WHERE id=?", (hash_password(body["password"]), session["user_id"]))
                db.execute("DELETE FROM sessions WHERE user_id=?", (session["user_id"],))
                session, cookie = self.new_session(db, user["id"])
                return self.session_json(session), [("Set-Cookie", cookie)]
        if path == "/api/posts" and method == "GET":
            rows = db.execute("SELECT p.*,u.display_name FROM posts p JOIN users u ON u.id=p.owner_id WHERE p.live_json IS NOT NULL ORDER BY p.live_updated_at DESC,p.id DESC").fetchall()
            return {"posts": [self.post_json(row) for row in rows]}, headers
        match = re.fullmatch(r"/api/posts/(\d+)", path)
        if match and method == "GET":
            row = self.get_post(db, int(match[1]))
            if not row["live_json"]:
                raise APIError(404, "文章尚未发布。", "not_found")
            return self.post_json(row, include_html=True), headers
        if path == "/api/stats" and method == "GET":
            today = datetime.now(SHANGHAI).date()
            start = today - timedelta(days=364)
            events = dict(db.execute("SELECT date,COUNT(*) FROM publication_events WHERE date>=? AND date<=? GROUP BY date", (start.isoformat(), today.isoformat())).fetchall())
            total = db.execute("SELECT COUNT(*) FROM posts WHERE live_json IS NOT NULL").fetchone()[0]
            month = today.strftime("%Y-%m-")
            published_month = db.execute("SELECT COUNT(*) FROM posts WHERE live_json IS NOT NULL AND json_extract(live_json,'$.date') LIKE ?", (month + "%",)).fetchone()[0]
            last = db.execute("SELECT MAX(live_updated_at) FROM posts WHERE live_json IS NOT NULL").fetchone()[0]
            return {"days": [{"date": (start + timedelta(days=offset)).isoformat(), "count": events.get((start + timedelta(days=offset)).isoformat(), 0)} for offset in range(365)], "total": total, "publishedThisMonth": published_month, "lastUpdated": last, "timezone": "Asia/Shanghai"}, headers
        if path == "/api/workspace/posts":
            self.authorize(environ, session)
            if method == "GET":
                query = "SELECT p.*,u.display_name FROM posts p JOIN users u ON u.id=p.owner_id"
                args = ()
                if session["role"] != "admin":
                    query += " WHERE p.owner_id=?"
                    args = (session["user_id"],)
                rows = db.execute(query + " ORDER BY p.updated_at DESC,p.id DESC", args).fetchall()
                return {"posts": [self.post_json(row, workspace=True) for row in rows]}, headers
            if method == "POST":
                data = self.read_body(environ)
                content = self.validate_content(data)
                action = data.get("action", "draft")
                if action not in ("draft", "submit", "publish"):
                    raise APIError(400, "文章操作无效。")
                if action == "publish":
                    self.authorize(environ, session, admin=True)
                cursor = db.execute("INSERT INTO posts(owner_id,slug,status,draft_json,updated_at) VALUES(?,?,?,?,?)", (session["user_id"], "note-" + secrets.token_hex(6), "pending" if action == "submit" else "draft", json_dump(content), now()))
                if action == "publish":
                    self.publish(db, cursor.lastrowid)
                return {"post": self.post_json(self.get_post(db, cursor.lastrowid), workspace=True)}, headers
        match = re.fullmatch(r"/api/workspace/posts/(\d+)(/submit)?", path)
        if match:
            self.authorize(environ, session)
            row = self.own_post(db, int(match[1]), session)
            if method == "DELETE" and not match[2]:
                if int(environ.get("CONTENT_LENGTH", "0")) > 0:
                    self.check_revision(row, self.read_body(environ))
                db.execute("DELETE FROM posts WHERE id=?", (row["id"],))
                return {"deleted": True}, headers
            if method == "GET" and not match[2]:
                return {"post": self.post_json(row, workspace=True)}, headers
            if method == "POST" and match[2]:
                data = self.read_body(environ)
                self.check_revision(row, data)
                db.execute("UPDATE posts SET status='pending',feedback='',updated_at=?,revision=revision+1 WHERE id=?", (now(), row["id"]))
                return {"post": self.post_json(self.get_post(db, row["id"]), workspace=True)}, headers
            if method == "PUT" and not match[2]:
                data = self.read_body(environ)
                self.check_revision(row, data)
                content = self.validate_content(data)
                old = json.loads(row["draft_json"])
                # Public-source annotations on the original notes cannot disappear by accident.
                content["date"] = old["date"]
                for key in ("source", "sourceLabel"):
                    if key in old:
                        content[key] = old[key]
                action = data.get("action", "draft")
                if action not in ("draft", "submit", "publish"):
                    raise APIError(400, "文章操作无效。")
                if action == "publish":
                    self.authorize(environ, session, admin=True)
                status = "pending" if action == "submit" else "draft"
                db.execute("UPDATE posts SET draft_json=?,status=?,feedback='',updated_at=?,revision=revision+1 WHERE id=?", (json_dump(content), status, now(), row["id"]))
                if action == "publish":
                    self.publish(db, row["id"])
                return {"post": self.post_json(self.get_post(db, row["id"]), workspace=True)}, headers
        if path == "/api/admin/queue" and method == "GET":
            self.authorize(environ, session, admin=True)
            rows = db.execute("SELECT p.*,u.display_name FROM posts p JOIN users u ON u.id=p.owner_id WHERE p.status='pending' ORDER BY p.updated_at,p.id").fetchall()
            return {"posts": [self.post_json(row, workspace=True) for row in rows]}, headers
        match = re.fullmatch(r"/api/admin/posts/(\d+)/review", path)
        if match and method == "POST":
            self.authorize(environ, session, admin=True)
            row = self.get_post(db, int(match[1]))
            data = self.read_body(environ)
            self.check_revision(row, data, required=True)
            action = data.get("action")
            feedback = data.get("feedback", "")
            if not isinstance(feedback, str) or len(feedback) > 2000:
                raise APIError(400, "审核意见不能超过 2000 字。")
            if action == "approve":
                if row["status"] != "pending":
                    raise APIError(409, "这篇文章不在待审核队列中。")
                self.publish(db, row["id"])
            elif action == "reject":
                if row["status"] != "pending":
                    raise APIError(409, "这篇文章不在待审核队列中。")
                db.execute("UPDATE posts SET status='rejected',feedback=?,updated_at=?,revision=revision+1 WHERE id=?", (feedback, now(), row["id"]))
            elif action == "unpublish":
                db.execute("UPDATE posts SET live_json=NULL,status='draft',feedback=?,updated_at=?,revision=revision+1 WHERE id=?", (feedback, now(), row["id"]))
            else:
                raise APIError(400, "审核操作无效。")
            return {"post": self.post_json(self.get_post(db, row["id"]), workspace=True)}, headers
        if path == "/api/preview" and method == "POST":
            self.authorize(environ, session)
            body = self.read_body(environ)
            if not isinstance(body.get("markdown"), str) or len(body["markdown"]) > 100000:
                raise APIError(400, "正文过长或格式无效。")
            return {"html": render_markdown(body["markdown"])}, headers
        raise APIError(404, "找不到这个地址。", "not_found")

    def render_public(self, db, path):
        rows = db.execute("SELECT p.*,u.display_name FROM posts p JOIN users u ON u.id=p.owner_id WHERE p.live_json IS NOT NULL ORDER BY p.live_updated_at DESC,p.id DESC").fetchall()
        posts = [self.post_json(row) for row in rows]
        if path == "/search.json":
            return "application/json; charset=utf-8", json_dump(posts)
        if path == "/rss.xml":
            entries = []
            for post in posts:
                entries.append("<item><title>" + html.escape(post["title"]) + "</title><link>" + html.escape(self.origin + post["url"]) + "</link><guid>" + html.escape(self.origin + post["url"]) + "</guid><description>" + html.escape(post["description"]) + "</description></item>")
            return "application/rss+xml; charset=utf-8", '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>窗边手记</title><link>' + html.escape(self.origin) + '</link><description>代码、学习与生活</description>' + "".join(entries) + "</channel></rss>"
        if path == "/sitemap.xml":
            urls = ["/", "/notes/", "/projects/"] + [post["url"] for post in posts]
            return "application/xml; charset=utf-8", '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "".join("<url><loc>" + html.escape(self.origin + url) + "</loc></url>" for url in urls) + "</urlset>"
        match = re.fullmatch(r"/notes/([A-Za-z0-9_-]+)/?", path)
        if not match:
            raise APIError(404, "文章不存在。", "not_found")
        row = next((row for row in rows if row["slug"] == match[1]), None)
        if not row:
            raise APIError(404, "文章尚未发布或已下架。", "not_found")
        post = self.post_json(row, include_html=True)
        shell = Path(__file__).with_name("post.html").read_text(encoding="utf-8")
        index = (self.static_dir / "index.html").read_text(encoding="utf-8") if (self.static_dir / "index.html").exists() else ""
        styles = re.findall(r'<link\b[^>]*\bhref="(/_astro/[^"<>]+\.css)"[^>]*>', index)
        scripts = re.findall(r'<script\b[^>]*\bsrc="(/_astro/[^"<>]+\.js)"[^>]*>\s*</script>', index)
        updated = datetime.fromisoformat(post["updatedAt"]).astimezone(SHANGHAI).date().isoformat() if post["updatedAt"] else post["date"]
        values = {"title": html.escape(post["title"]), "description": html.escape(post["description"], quote=True), "category": html.escape(post["category"]), "date": html.escape(post["date"]), "updated": html.escape(updated), "readingTime": html.escape(post["readingTime"]), "author": html.escape(post["author"]), "canonical": html.escape(self.origin + post["url"], quote=True), "html": post["html"], "tags": "".join("<span>#" + html.escape(tag) + "</span>" for tag in post["tags"]), "styles": "".join('<link rel="stylesheet" href="' + value + '">' for value in dict.fromkeys(styles)), "scripts": "".join('<script type="module" src="' + value + '"></script>' for value in dict.fromkeys(scripts)), "source": ""}
        if post.get("source"):
            values["source"] = '<p class="source-callout">首版整理于 ' + html.escape(post["date"]) + '。依据 <a href="' + html.escape(post["source"], quote=True) + '" target="_blank" rel="noopener noreferrer">' + html.escape(post.get("sourceLabel", "公开项目")) + ' 的公开说明 ↗</a> 编写；项目状态以源仓库为准。</p>'
        reader_path = self.static_dir / "reader" / "index.html"
        if reader_path.exists():
            article = '<article data-public-article data-title="' + values["title"] + '" data-description="' + values["description"] + '"><div class="eyebrow">' + values["category"] + '</div><h1>' + values["title"] + '</h1><p class="article-lead">' + values["description"] + '</p><div class="article-meta"><time datetime="' + values["date"] + '">' + values["date"] + '</time><span>' + values["readingTime"] + '</span><span>' + values["author"] + '</span><span>最近更新 ' + values["updated"] + '</span></div>' + values["source"] + '<div class="prose">' + values["html"] + '</div><div class="tag-list">' + values["tags"] + '</div><footer class="article-end"><p>每一次理解，都值得被好好留下。</p><a class="text-link" href="/notes/">继续读一篇手记 ↗</a></footer></article>'
            reader_shell = reader_path.read_text(encoding="utf-8")
            markers = {"__BLOG_POST_TITLE__": values["title"], "__BLOG_POST_DESCRIPTION__": values["description"], "__BLOG_POST_CONTENT__": article}
            # Inserted user text is never scanned again as a template instruction.
            reader_shell = re.sub(r"__BLOG_POST_(?:TITLE|DESCRIPTION|CONTENT)__", lambda match: markers[match[0]], reader_shell)
            # Astro builds the shell at /reader/, whereas the canonical URL belongs to the article.
            reader_shell = re.sub(r'(<link\b[^>]*\brel="canonical"[^>]*\bhref=")[^"]*(")', lambda match: match[1] + values["canonical"] + match[2], reader_shell)
            reader_shell = re.sub(r'(<meta\b[^>]*\bproperty="og:url"[^>]*\bcontent=")[^"]*(")', lambda match: match[1] + values["canonical"] + match[2], reader_shell)
            return "text/html; charset=utf-8", reader_shell
        shell = re.sub(r"\{\{([A-Za-z]+)\}\}", lambda match: values.get(match[1], match[0]), shell)
        return "text/html; charset=utf-8", shell

    def __call__(self, environ, start_response):
        method, path = environ.get("REQUEST_METHOD", "GET"), environ.get("PATH_INFO", "/")
        headers = [("X-Content-Type-Options", "nosniff"), ("X-Frame-Options", "DENY"), ("Referrer-Policy", "same-origin"), ("Cache-Control", "no-store" if path.startswith("/api/") else "no-cache")]
        status = 200
        try:
            with self.connect() as db:
                if path.startswith("/api/"):
                    data, extra = self.dispatch(db, environ, "GET" if method == "HEAD" else method, path)
                    headers.extend(extra)
                    body, mime = json_dump(data), "application/json; charset=utf-8"
                elif method in ("GET", "HEAD"):
                    mime, body = self.render_public(db, path)
                else:
                    raise APIError(405, "此地址不支持该操作。", "method_not_allowed")
        except APIError as error:
            status, body, mime = error.status, json_dump({"error": error.message, "code": error.code}), "application/json; charset=utf-8"
        except sqlite3.IntegrityError:
            status, body, mime = 409, json_dump({"error": "内容发生冲突，请刷新后重试。", "code": "conflict"}), "application/json; charset=utf-8"
        except Exception:
            # Never write request payloads, cookies, passwords or tracebacks into public logs.
            status, body, mime = 500, json_dump({"error": "服务暂时无法处理请求，请稍后重试。", "code": "server_error"}), "application/json; charset=utf-8"
        encoded = body.encode("utf-8")
        headers.extend([("Content-Type", mime), ("Content-Length", str(len(encoded)))])
        reason = {200: "OK", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 409: "Conflict", 413: "Payload Too Large", 415: "Unsupported Media Type", 429: "Too Many Requests", 500: "Internal Server Error"}[status]
        start_response(f"{status} {reason}", headers)
        return [b"" if method == "HEAD" else encoded]


def main():
    from waitress import serve
    application = BlogApp()
    # Forwarded headers are only meaningful from the independent local nginx proxy.
    serve(application, host="127.0.0.1", port=int(os.environ.get("BLOG_PORT", "18088")), threads=4, connection_limit=64, max_request_body_size=MAX_BODY, channel_timeout=30, trusted_proxy="127.0.0.1", trusted_proxy_count=1, trusted_proxy_headers={"x-forwarded-proto", "x-forwarded-for"}, clear_untrusted_proxy_headers=True)


if __name__ == "__main__":
    main()
