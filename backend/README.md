# Blog application

The public Astro site is served by the blog's independent nginx process. This WSGI application listens only on `127.0.0.1:18088`, behind that process. Python 3.12 and the pinned, pure Python dependencies in `requirements.txt` are required.

Configuration:

| Variable | Purpose |
| --- | --- |
| `BLOG_DATA_DIR` | Persistent SQLite directory, outside source and release directories. |
| `BLOG_STATIC_DIR` | Currently deployed static site, including `reader/index.html`. |
| `BLOG_SEED_PATH` | Public Markdown seed exported with `node scripts/export-seed.mjs`. Imported once. |
| `BLOG_ORIGIN` | Exact public HTTPS origin used for CSRF validation. |
| `BLOG_SECURE_COOKIE` | Keep `1` in production. |
| `BLOG_ALLOW_INSECURE` | Default `0`; `1` is only for an explicitly isolated local development server. |

Run `python backend/run.py`. Administrator account `robot999666` is reserved and initially disabled. `python backend/manage.py bootstrap` initializes its password by reading one line from stdin; passwords must never be passed as command arguments or committed to the repository. The bootstrap command also revokes existing administrator sessions.

Public indexes, RSS, sitemap and article pages include only published revisions. Ordinary users can save drafts or submit articles. Only administrators can approve or publish. Saving edits to a published article keeps them as a private draft; explicit submission creates a pending revision. Its previous approved version stays public until the submitted revision is approved. Rejecting that revision preserves the approved version. Unpublishing removes the public version. Updates to the eight source notes preserve their public-source annotations.

Session tokens and passwords are hashed in SQLite. Authenticated mutations require the session's CSRF token, exact origin and HTTPS. Password changes revoke all previous sessions. The database uses WAL and closes each request connection. Rate limits and request size limits bound login abuse and submissions. Markdown previews and published HTML pass the same explicit sanitization allowlist.

Workspace records include an integer `revision`. Review requests must include `expectedRevision`, matching the revision that the administrator actually opened. Edits, submissions and deletions also accept this field. Stale revisions return HTTP 409. A write transaction serializes the revision check and publication operation.

Run `python -m unittest discover -s backend -p test_app.py -v` for authentication, authorization, publication, revision isolation, XSS, persistence and session tests. Test data is generated in disposable local directories.

Keep database files, backup files, cookies and administrator credentials out of Git. Database backups must use SQLite's online backup API or a consistent stopped-service snapshot; copying the database alone while WAL is active can omit transactions.
