"""Exercise permissions and durable publication rules through the WSGI boundary."""
import hashlib
import http.client
import io
import json
import tempfile
import threading
import unittest
from pathlib import Path

from app import BlogApp, COOKIE, check_password
from waitress import create_server

ORIGIN = "https://example.invalid:8088"
PASSWORD = "test-only-strong-passphrase"


class Client:
    def __init__(self, app):
        self.app, self.cookie, self.csrf = app, "", ""

    def request(self, method, path, data=None, origin=ORIGIN, csrf=True, secure=True):
        encoded = json.dumps(data if data is not None else {}).encode()
        environ = {"REQUEST_METHOD": method, "PATH_INFO": path, "wsgi.url_scheme": "https" if secure else "http", "wsgi.input": io.BytesIO(encoded), "CONTENT_LENGTH": str(len(encoded)), "CONTENT_TYPE": "application/json", "HTTP_ORIGIN": origin, "HTTP_COOKIE": self.cookie, "REMOTE_ADDR": "192.0.2.10"}
        if csrf:
            environ["HTTP_X_CSRF_TOKEN"] = self.csrf
        result = {}
        def start(status, headers):
            result.update(status=int(status.split()[0]), headers=dict(headers))
        body = b"".join(self.app(environ, start)).decode()
        if "Set-Cookie" in result["headers"]:
            self.cookie = result["headers"]["Set-Cookie"].split(";")[0]
        if method == "HEAD":
            result["body"] = body
        elif result["headers"]["Content-Type"].startswith("application/json"):
            result["body"] = json.loads(body)
            if isinstance(result["body"], dict) and result["body"].get("csrfToken"):
                self.csrf = result["body"]["csrfToken"]
        else:
            result["body"] = body
        return result

    def register(self, username):
        self.request("GET", "/api/session")
        return self.request("POST", "/api/auth/register", {"username": username, "displayName": username, "password": PASSWORD, "role": "admin"})

    def login(self, username="robot999666", password=PASSWORD):
        self.request("GET", "/api/session")
        return self.request("POST", "/api/auth/login", {"username": username, "password": password})


class BlogSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = BlogApp(data_dir=self.temp.name, origin=ORIGIN, seed_path=Path(__file__).with_name("seed.json"))
        self.app.bootstrap(PASSWORD)
        self.admin = Client(self.app)
        self.assertEqual(self.admin.login()["status"], 200)
        self.writer = Client(self.app)
        self.assertEqual(self.writer.register("writer_one")["status"], 200)

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def content(title="一篇新手记", action="draft", markdown="## 今天\n\n认真写一篇公开手记。"):
        return {"title": title, "description": "来自读者的真实投稿摘要", "category": "生活随笔", "tags": ["生活", "学习"], "markdown": markdown, "action": action}

    def create(self, client, action="draft", title="一篇新手记"):
        result = client.request("POST", "/api/workspace/posts", self.content(title=title, action=action))
        self.assertEqual(result["status"], 200, result)
        return result["body"]["post"]

    def approve(self, post_id):
        post = self.admin.request("GET", f"/api/workspace/posts/{post_id}")["body"]["post"]
        result = self.admin.request("POST", f"/api/admin/posts/{post_id}/review", {"action": "approve", "expectedRevision": post["revision"]})
        self.assertEqual(result["status"], 200, result)
        return result

    def test_https_origin_and_csrf_are_required(self):
        self.assertEqual(self.writer.request("POST", "/api/workspace/posts", self.content(), secure=False)["body"]["code"], "https_required")
        self.assertEqual(self.writer.request("POST", "/api/workspace/posts", self.content(), csrf=False)["body"]["code"], "csrf_rejected")
        self.assertEqual(self.writer.request("POST", "/api/workspace/posts", self.content(), origin="https://attacker.invalid")["body"]["code"], "origin_rejected")

    def test_registration_cannot_grant_administrator(self):
        session = self.writer.request("GET", "/api/session")["body"]
        self.assertEqual(session["user"]["role"], "writer")
        self.assertEqual(self.writer.request("POST", "/api/workspace/posts", self.content(action="publish"))["status"], 403)
        self.assertEqual(self.writer.request("GET", "/api/admin/queue")["status"], 403)
        replacement = Client(self.app)
        self.assertEqual(replacement.register("robot999666")["status"], 409)

    def test_only_approved_posts_reach_public_surfaces(self):
        post = self.create(self.writer)
        post_id = post["id"]
        self.assertEqual(self.writer.request("GET", f"/api/posts/{post_id}")["status"], 404)
        self.assertEqual(self.writer.request("GET", post["url"])["status"], 404)
        self.writer.request("POST", f"/api/workspace/posts/{post_id}/submit")
        queue = self.admin.request("GET", "/api/admin/queue")["body"]["posts"]
        self.assertEqual([p["id"] for p in queue], [post_id])
        self.approve(post_id)
        self.assertEqual(self.writer.request("GET", f"/api/posts/{post_id}")["status"], 200)
        for path in ("/search.json", "/rss.xml", "/sitemap.xml", post["url"]):
            result = self.writer.request("GET", path)
            self.assertEqual(result["status"], 200, result)
            self.assertIn(post["slug"] if path == "/sitemap.xml" else post["title"], json.dumps(result["body"], ensure_ascii=False))

    def test_revision_remains_private_until_reapproved(self):
        post = self.create(self.writer, action="submit", title="已审核的标题")
        self.approve(post["id"])
        result = self.writer.request("PUT", f"/api/workspace/posts/{post['id']}", self.content(title="等待审核的新标题", markdown="还没审核的内容", action="submit"))
        self.assertEqual(result["body"]["post"]["status"], "pending")
        public = self.writer.request("GET", f"/api/posts/{post['id']}")["body"]
        self.assertEqual(public["title"], "已审核的标题")
        self.assertNotIn("还没审核", public["html"])
        self.admin.request("POST", f"/api/admin/posts/{post['id']}/review", {"action": "reject", "feedback": "请增加说明", "expectedRevision": result["body"]["post"]["revision"]})
        self.assertEqual(self.writer.request("GET", f"/api/posts/{post['id']}")["body"]["title"], "已审核的标题")
        self.assertEqual(self.writer.request("GET", "/api/workspace/posts")["body"]["posts"][0]["feedback"], "请增加说明")
        self.writer.request("POST", f"/api/workspace/posts/{post['id']}/submit")
        self.approve(post["id"])
        self.assertEqual(self.writer.request("GET", f"/api/posts/{post['id']}")["body"]["title"], "等待审核的新标题")

    def test_saving_published_writer_draft_does_not_submit_or_change_live_revision(self):
        post = self.create(self.writer, action="submit", title="已发布的旧标题")
        self.approve(post["id"])
        edited = self.writer.request("PUT", f"/api/workspace/posts/{post['id']}", self.content(title="还在写的新草稿", markdown="这个改动还不想送审。", action="draft"))
        self.assertEqual(edited["status"], 200)
        self.assertEqual(edited["body"]["post"]["status"], "draft")
        self.assertTrue(edited["body"]["post"]["isLive"])
        self.assertEqual(self.admin.request("GET", "/api/admin/queue")["body"]["posts"], [])
        public = self.writer.request("GET", f"/api/posts/{post['id']}")["body"]
        self.assertEqual(public["title"], "已发布的旧标题")
        self.assertNotIn("这个改动还不想送审", public["html"])
        self.writer.request("POST", f"/api/workspace/posts/{post['id']}/submit", {"expectedRevision": edited["body"]["post"]["revision"]})
        self.assertEqual([item["id"] for item in self.admin.request("GET", "/api/admin/queue")["body"]["posts"]], [post["id"]])
        self.assertEqual(self.writer.request("GET", f"/api/posts/{post['id']}")["body"]["title"], "已发布的旧标题")

    def test_ownership_and_admin_queue_are_enforced(self):
        post = self.create(self.writer)
        other = Client(self.app)
        other.register("writer_two")
        self.assertEqual(other.request("PUT", f"/api/workspace/posts/{post['id']}", self.content())["status"], 403)
        self.assertEqual(other.request("DELETE", f"/api/workspace/posts/{post['id']}")["status"], 403)
        self.assertEqual(len(other.request("GET", "/api/workspace/posts")["body"]["posts"]), 0)
        self.assertGreaterEqual(len(self.admin.request("GET", "/api/workspace/posts")["body"]["posts"]), 9)

    def test_markdown_xss_is_sanitized_in_preview_and_published_html(self):
        payload = '<script>alert(1)</script><img src="https://example.invalid/image.png" onerror="alert(2)"><a href="javascript:alert(3)">危险链接</a>\n\n## 正常标题'
        rendered = self.writer.request("POST", "/api/preview", {"markdown": payload})["body"]["html"]
        self.assertNotIn("<script", rendered)
        self.assertNotIn("onerror", rendered)
        self.assertNotIn("javascript:", rendered)
        self.assertIn("<h2>正常标题</h2>", rendered)
        created = self.admin.request("POST", "/api/workspace/posts", self.content(markdown=payload, action="publish"))["body"]["post"]
        public = self.writer.request("GET", created["url"])["body"]
        self.assertNotIn("onerror", public)
        self.assertNotIn("javascript:", public)

    def test_passwords_and_session_tokens_are_hashed_and_logout_invalidates(self):
        token = self.writer.cookie.split("=", 1)[1]
        old_cookie = self.writer.cookie
        with self.app.connect() as db:
            user = db.execute("SELECT password_hash FROM users WHERE username='writer_one'").fetchone()
            self.assertNotEqual(user["password_hash"], PASSWORD)
            self.assertTrue(check_password(PASSWORD, user["password_hash"]))
            self.assertIsNotNone(db.execute("SELECT 1 FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),)).fetchone())
            self.assertIsNone(db.execute("SELECT 1 FROM sessions WHERE token_hash=?", (token,)).fetchone())
        self.assertEqual(self.writer.request("POST", "/api/auth/logout")["status"], 200)
        stale = Client(self.app)
        stale.cookie = old_cookie
        self.assertIsNone(stale.request("GET", "/api/session")["body"]["user"])

    def test_password_change_revokes_other_sessions(self):
        another = Client(self.app)
        another.login("writer_one")
        result = self.writer.request("POST", "/api/auth/change-password", {"currentPassword": PASSWORD, "password": PASSWORD + "-changed"})
        self.assertEqual(result["status"], 200)
        self.assertIsNone(another.request("GET", "/api/session")["body"]["user"])
        self.assertIsNotNone(self.writer.request("GET", "/api/session")["body"]["user"])

    def test_database_survives_restart_without_reseeding_or_overwriting_edits(self):
        seed = self.admin.request("GET", "/api/workspace/posts")["body"]["posts"][0]
        self.admin.request("PUT", f"/api/workspace/posts/{seed['id']}", self.content(title="管理员更新后的标题", action="publish"))
        restarted = BlogApp(data_dir=self.temp.name, origin=ORIGIN, seed_path=Path(__file__).with_name("seed.json"))
        reader = Client(restarted)
        all_posts = reader.request("GET", "/api/posts")["body"]["posts"]
        self.assertEqual(len(all_posts), 8)
        self.assertIn("管理员更新后的标题", [p["title"] for p in all_posts])
        self.assertTrue(any(p.get("source") for p in all_posts))

    def test_unpublish_and_delete_remove_article_from_public_index(self):
        post = self.create(self.admin, action="publish")
        self.admin.request("POST", f"/api/admin/posts/{post['id']}/review", {"action": "unpublish", "feedback": "暂时下架", "expectedRevision": post["revision"]})
        self.assertEqual(self.writer.request("GET", post["url"])["status"], 404)
        self.assertNotIn(post["id"], [p["id"] for p in self.writer.request("GET", "/api/posts")["body"]["posts"]])
        self.assertEqual(self.admin.request("DELETE", f"/api/workspace/posts/{post['id']}")["status"], 200)

    def test_stale_reviews_and_edits_cannot_publish_unseen_revisions(self):
        post = self.create(self.writer, action="submit", title="管理员已读的旧稿")
        changed = self.writer.request("PUT", f"/api/workspace/posts/{post['id']}", self.content(title="管理员没读过的新稿", action="submit"))["body"]["post"]
        result = self.admin.request("POST", f"/api/admin/posts/{post['id']}/review", {"action": "approve", "expectedRevision": post["revision"]})
        self.assertEqual(result["status"], 409)
        self.assertEqual(result["body"]["code"], "revision_conflict")
        self.assertEqual(self.writer.request("GET", post["url"])["status"], 404)
        missing = self.admin.request("POST", f"/api/admin/posts/{post['id']}/review", {"action": "approve"})
        self.assertEqual(missing["body"]["code"], "revision_required")
        self.approve(post["id"])
        stale = self.admin.request("PUT", f"/api/workspace/posts/{post['id']}", {**self.content(action="publish"), "expectedRevision": changed["revision"]})
        self.assertEqual(stale["status"], 409)

    def test_deleted_seed_is_not_accessible_through_static_alias(self):
        seed = self.admin.request("GET", "/api/workspace/posts")["body"]["posts"][0]
        self.admin.request("DELETE", f"/api/workspace/posts/{seed['id']}")
        self.assertEqual(self.writer.request("GET", seed["url"])["status"], 404)
        self.assertEqual(self.writer.request("GET", seed["url"] + "index.html")["status"], 404)

    def test_anonymous_session_creation_is_bounded_and_private_reads_need_https(self):
        statuses = [Client(self.app).request("GET", "/api/session")["status"] for _ in range(125)]
        self.assertIn(429, statuses)
        self.assertEqual(self.writer.request("GET", "/api/workspace/posts", secure=False)["body"]["code"], "https_required")
        self.assertEqual(self.writer.request("GET", "/api/session", secure=False)["body"]["code"], "https_required")

    def test_statistics_count_real_publication_events(self):
        before = self.writer.request("GET", "/api/stats")["body"]
        self.assertEqual(before["total"], 8)
        self.assertEqual(len(before["days"]), 365)
        self.create(self.writer, action="draft")
        unchanged = self.writer.request("GET", "/api/stats")["body"]
        self.assertEqual(sum(day["count"] for day in unchanged["days"]), sum(day["count"] for day in before["days"]))
        self.create(self.admin, action="publish")
        after = self.writer.request("GET", "/api/stats")["body"]
        self.assertEqual(after["total"], 9)
        self.assertEqual(sum(day["count"] for day in after["days"]), sum(day["count"] for day in before["days"]) + 1)

    def test_rate_limit_and_bounded_payload(self):
        self.writer.csrf = self.writer.csrf
        self.assertEqual(self.writer.request("POST", "/api/preview", {"markdown": "x" * 200000})["status"], 413)
        attacker = Client(self.app)
        attacker.request("GET", "/api/session")
        statuses = [attacker.request("POST", "/api/auth/login", {"username": "missing_user", "password": PASSWORD})["status"] for _ in range(10)]
        self.assertIn(429, statuses)

    def test_real_waitress_proxy_sets_https_and_actual_client_ip(self):
        server = create_server(self.app, host="127.0.0.1", port=0, threads=1, trusted_proxy="127.0.0.1", trusted_proxy_count=1, trusted_proxy_headers={"x-forwarded-proto", "x-forwarded-for"}, clear_untrusted_proxy_headers=True)
        worker = threading.Thread(target=server.run, daemon=True)
        worker.start()
        connection = http.client.HTTPConnection("127.0.0.1", int(server.effective_port), timeout=3)
        try:
            forwarded = {"X-Forwarded-Proto": "https", "X-Forwarded-For": "198.51.100.77"}
            connection.request("GET", "/api/session", headers=forwarded)
            response = connection.getresponse()
            cookie = response.getheader("Set-Cookie").split(";")[0]
            session = json.loads(response.read())
            self.assertIn(("guest_session", "198.51.100.77"), self.app.limits)
            headers = {**forwarded, "Cookie": cookie, "X-CSRF-Token": session["csrfToken"], "Origin": ORIGIN, "Content-Type": "application/json"}
            connection.request("POST", "/api/auth/register", body=json.dumps({"username": "proxy_writer", "password": PASSWORD}), headers=headers)
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            new_cookie = response.getheader("Set-Cookie").split(";")[0]
            self.assertEqual(json.loads(response.read())["user"]["role"], "writer")
            connection.request("GET", "/api/workspace/posts", headers={"Cookie": new_cookie})
            response = connection.getresponse()
            self.assertEqual(response.status, 403)
            self.assertEqual(json.loads(response.read())["code"], "https_required")
        finally:
            connection.close()
            server.task_dispatcher.shutdown(cancel_pending=True, timeout=1)
            server.close()
            worker.join(timeout=2)

    def test_reader_templates_replace_user_marker_text_only_once(self):
        site = Path(self.temp.name) / "static"
        (site / "reader").mkdir(parents=True)
        (site / "reader" / "index.html").write_text('<html><head><title>__BLOG_POST_TITLE__</title><meta name="description" content="__BLOG_POST_DESCRIPTION__"></head><body>__BLOG_POST_CONTENT__</body></html>', encoding="utf-8")
        self.app.static_dir = site
        post = self.admin.request("POST", "/api/workspace/posts", {**self.content(title="__BLOG_POST_CONTENT__", action="publish"), "description": "__BLOG_POST_TITLE__"})["body"]["post"]
        rendered = self.writer.request("GET", post["url"])["body"]
        head = rendered.split("</head>")[0]
        self.assertIn("<title>__BLOG_POST_CONTENT__</title>", head)
        self.assertIn('content="__BLOG_POST_TITLE__"', head)
        self.assertNotIn("<article", head)
        self.assertEqual(rendered.count("<article"), 1)
        # The standalone fallback follows the same rule for its own marker syntax.
        self.app.static_dir = site / "missing"
        fallback = self.admin.request("POST", "/api/workspace/posts", {**self.content(title="{{html}}", action="publish"), "description": "{{title}}"})["body"]["post"]
        rendered = self.writer.request("GET", fallback["url"])["body"]
        self.assertIn("<title>{{html}} · 窗边手记</title>", rendered)
        self.assertNotIn("<article", rendered.split("</head>")[0])

    def test_head_api_and_public_indexes_return_headers_without_body(self):
        for path in ("/api/health", "/api/posts", "/api/stats", "/search.json", "/rss.xml", "/sitemap.xml"):
            result = self.writer.request("HEAD", path)
            self.assertEqual(result["status"], 200)
            self.assertEqual(result["body"], "")
            self.assertGreater(int(result["headers"]["Content-Length"]), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
