#!/usr/bin/env bash
# Only this isolated service and its own port may be changed by this installer.
set -Eeuo pipefail
umask 022

BASE=/opt/robot-blog
UNIT=/etc/systemd/system/robot-blog.service
SERVICE=robot-blog.service
API_SERVICE=robot-blog-api.service
API_UNIT=/etc/systemd/system/robot-blog-api.service
MARKER=robot-blog-managed-v1
stage=
baseline=
previous_target=
previous_app_target=
api_previous_active=false
config_changed=false
api_touched=false
api_enabled_by_run=false
timer_enabled_by_run=false
previous_active=false
switched=false
service_touched=false
new_install=false
unit_installed=false
enabled_by_run=false
firewall_added=false
existing_regression=false
managed_service=false
success=false

fail() { printf 'Deployment stopped: %s\n' "$*" >&2; exit 1; }

capture_http() {
    local code
    code=$(curl --silent --show-error --insecure --max-time 10 --output /dev/null --write-out '%{http_code}' "$1" 2>/dev/null || true)
    [[ "$code" =~ ^[0-9]{3}$ ]] || return 1
    printf '%s\n' "$code"
}

capture_listeners() {
    python3 - <<'PY'
import json
import re
import subprocess

snapshot = subprocess.check_output(['ss', '-H', '-lntp'], text=True)
rows = []
for line in snapshot.splitlines():
    fields = line.split(maxsplit=5)
    if len(fields) < 5:
        raise SystemExit('Could not parse listener snapshot safely.')
    address, peer = fields[3:5]
    if address.rpartition(':')[2] in ('8088', '18088'):
        continue
    details = fields[5] if len(fields) == 6 else ''
    owners = {(name, int(pid)) for name, pid in re.findall(r'\("([^"]+)",pid=(\d+)', details)}
    if details and not owners:
        raise SystemExit('Could not parse listener ownership safely.')
    # A process can own several FDs for a socket. FD allocation and ss ordering
    # can change on daemon-reload without changing the listener or its owners.
    rows.append(('tcp', address, peer, tuple(sorted(owners))))
for row in sorted(rows):
    print(json.dumps(row, ensure_ascii=True, separators=(',', ':')))
PY
}

capture_existing() {
    local destination=$1 service
    mkdir -p "$destination" || return 1
    : > "$destination/services" || return 1
    for service in nginx.service als-bci.service mysql.service; do
        printf '%s\n' "$service" >> "$destination/services"
        systemctl show "$service" --property=LoadState --property=ActiveState --property=SubState --property=MainPID >> "$destination/services" || return 1
    done
    {
        find /etc/nginx -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum || return 1
        find /etc/nginx -type l -printf '%p -> %l\n' | LC_ALL=C sort || return 1
    } > "$destination/nginx-files" || return 1
    # Exclude only the blog's port; preserve all other addresses and process PIDs.
    capture_listeners > "$destination/listeners" || return 1
    capture_http https://127.0.0.1:9443/ > "$destination/9443" || return 1
    capture_http http://127.0.0.1:80/ > "$destination/80" || return 1
    capture_http http://127.0.0.1:8000/ > "$destination/8000" || return 1
}

assert_existing_unchanged() {
    local check=$stage/check file
    rm -rf -- "$check"
    capture_existing "$check" || { existing_regression=true; return 1; }
    for file in services nginx-files listeners 9443 80 8000; do
        if ! cmp -s "$baseline/$file" "$check/$file"; then
            printf 'Existing service safety check changed: %s\n' "$file" >&2
            if [[ "$file" == listeners ]]; then
                diff -u --label 'Before (normalized listeners)' --label 'After (normalized listeners)' "$baseline/listeners" "$check/listeners" >&2 || true
            fi
            existing_regression=true
            return 1
        fi
    done
}

restore_previous_link() {
    if [[ -n "$previous_target" ]]; then
        ln -s -- "$previous_target" "$BASE/.rollback-link"
        mv -Tf -- "$BASE/.rollback-link" "$BASE/current"
    elif [[ -L "$BASE/current" ]]; then
        rm -- "$BASE/current"
    fi
}

finish() {
    local status=$?
    trap - EXIT
    if [[ "$success" != true ]]; then
        set +e
        if [[ "$api_touched" == true ]]; then systemctl stop "$API_SERVICE" >/dev/null 2>&1; fi
        if [[ "$timer_enabled_by_run" == true ]]; then systemctl disable --now robot-blog-cert.timer >/dev/null 2>&1; fi
        if [[ "$api_enabled_by_run" == true ]]; then systemctl disable "$API_SERVICE" >/dev/null 2>&1; fi
        # Never restart an existing service to try to repair a detected regression.
        if [[ "$service_touched" == true || "$switched" == true || ( "$existing_regression" == true && "$managed_service" == true ) ]]; then
            systemctl stop "$SERVICE" >/dev/null 2>&1
        fi
        if [[ "$switched" == true ]]; then restore_previous_link; fi
        if [[ -n "$previous_app_target" ]]; then
            ln -s -- "$previous_app_target" "$BASE/.rollback-app-link"
            mv -Tf -- "$BASE/.rollback-app-link" "$BASE/app-current"
        fi
        if [[ "$config_changed" == true ]]; then
            cp "$stage/previous-nginx.conf" "$BASE/nginx.conf"
            cp "$stage/previous-unit" "$UNIT"
            if [[ -f "$stage/previous-api-unit" ]]; then cp "$stage/previous-api-unit" "$API_UNIT"; else rm -f "$API_UNIT"; fi
            systemctl daemon-reload
        fi
        if [[ "$existing_regression" != true && "$api_previous_active" == true && "$api_touched" == true ]]; then systemctl start "$API_SERVICE"; fi
        if [[ "$existing_regression" != true && "$previous_active" == true && "$service_touched" == true ]]; then
            systemctl start "$SERVICE"
            if ! assert_existing_unchanged; then
                systemctl stop "$SERVICE" >/dev/null 2>&1
                printf 'Rollback stopped because an existing service changed.\n' >&2
            fi
        fi
        if [[ "$firewall_added" == true ]]; then
            ufw --force delete allow 8088/tcp >/dev/null
        fi
        if [[ "$enabled_by_run" == true ]]; then systemctl disable "$SERVICE" >/dev/null 2>&1; fi
        printf 'Deployment did not complete; existing services were not restarted or reconfigured.\n' >&2
        [[ "$status" -ne 0 ]] || status=1
    fi
    if [[ -n "$stage" && "$stage" == /tmp/robot-blog-install.* && -d "$stage" ]]; then
        rm -rf -- "$stage"
    fi
    exit "$status"
}
trap finish EXIT

[[ "$EUID" -eq 0 ]] || fail 'Run through sudo.'
[[ "$#" -eq 2 ]] || fail 'Usage: install.sh /tmp/robot-blog-REVISION.tar.gz REVISION'
archive=$1
revision=$2
[[ "$revision" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$ ]] || fail 'Invalid release identifier.'
[[ "$archive" == "/tmp/robot-blog-$revision.tar.gz" ]] || fail 'Archive must use the owned temporary upload path.'
[[ -f "$archive" && ! -L "$archive" ]] || fail 'Upload is not a regular file.'
for command in nginx systemctl ss curl python3 openssl sha256sum tar cmp diff find awk flock stat install cp chown chmod ln mv readlink grep cut sort; do
    command -v "$command" >/dev/null || fail "Required command missing: $command"
done
[[ -x /usr/sbin/nginx && -f /etc/nginx/mime.types ]] || fail 'Expected Ubuntu nginx installation is unavailable.'
id www-data >/dev/null || fail 'www-data account is unavailable.'

# /run is root-owned; an independent lock prevents concurrent blog releases.
[[ ! -L /run/robot-blog-deploy.lock ]] || fail 'Unexpected deployment lock symlink.'
exec 9>/run/robot-blog-deploy.lock
flock -n 9 || fail 'Another blog deployment is running.'

stage=$(mktemp -d /tmp/robot-blog-install.XXXXXXXX)
baseline=$stage/baseline
capture_existing "$baseline"
[[ "$(cat "$baseline/9443")" == 200 ]] || fail 'Existing HTTPS site on port 9443 is not healthy (expected 200).'

# Reject links, path traversal, duplicate entries, oversized packages, and extras.
python3 - "$archive" "$stage/package" "$revision" <<'PY'
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tarfile

archive, destination, revision = sys.argv[1:]
target = Path(destination)
target.mkdir(mode=0o700)
allowed_deploy = {'deploy', 'deploy/nginx.conf', 'deploy/robot-blog.service', 'deploy/robot-blog-api.service', 'deploy/robot-blog-cert.service', 'deploy/robot-blog-cert.timer', 'deploy/renew-certificate.sh', 'deploy/install.sh', 'deploy/README.md'}
descriptor = os.open(archive, os.O_RDONLY | os.O_NOFOLLOW)
with os.fdopen(descriptor, 'rb') as source:
    info = os.fstat(source.fileno())
    if not stat.S_ISREG(info.st_mode) or info.st_size > 128 * 1024 * 1024:
        raise SystemExit('Invalid or oversized deployment archive.')
    with tarfile.open(fileobj=source, mode='r:gz') as package:
        members = package.getmembers()
        if len(members) > 20000 or sum(m.size for m in members) > 256 * 1024 * 1024:
            raise SystemExit('Deployment package exceeds limits.')
        seen = set()
        for member in members:
            raw = member.name.rstrip('/')
            path = PurePosixPath(raw)
            if not raw or path.is_absolute() or '..' in path.parts or '\\' in raw or str(path) != raw:
                raise SystemExit('Unsafe archive path.')
            if raw in seen or not (member.isdir() or member.isfile()):
                raise SystemExit('Duplicate or unsupported archive entry.')
            backend_allowed = raw == 'backend' or (raw.startswith('backend/') and path.suffix in ('.py', '.html', '.json', '.txt'))
            wheel_allowed = raw == 'runtime-wheels' or (raw.startswith('runtime-wheels/') and path.suffix == '.whl' and len(path.parts) == 2)
            if not (raw == 'dist' or raw.startswith('dist/') or backend_allowed or wheel_allowed or raw in allowed_deploy or raw == 'REVISION'):
                raise SystemExit('Unexpected content in archive.')
            seen.add(raw)
        required = {'dist/index.html', 'dist/404.html', 'dist/reader/index.html', 'backend/app.py', 'backend/run.py', 'backend/seed.json', 'backend/requirements.txt', 'deploy/nginx.conf', 'deploy/robot-blog.service', 'deploy/robot-blog-api.service', 'REVISION'}
        if not required.issubset(seen):
            raise SystemExit('Build or deployment files are missing.')
        for member in members:
            output = target / member.name
            if member.isdir():
                output.mkdir(mode=0o755, parents=True, exist_ok=True)
            else:
                output.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
                with package.extractfile(member) as incoming, output.open('xb') as outgoing:
                    shutil.copyfileobj(incoming, outgoing)
                output.chmod(0o644)
if (target / 'REVISION').read_text(encoding='utf-8').strip() != revision:
    raise SystemExit('Release identifier does not match archive.')
PY

if [[ -e "$BASE" || -L "$BASE" ]]; then
    [[ -d "$BASE" && ! -L "$BASE" ]] || fail 'Installation path is not a managed directory.'
    [[ -f "$BASE/.managed-by-robot-blog" && ! -L "$BASE/.managed-by-robot-blog" ]] || fail 'Refusing to overwrite an unrelated directory.'
    [[ "$(cat "$BASE/.managed-by-robot-blog")" == "$MARKER" ]] || fail 'Installation ownership marker does not match.'
    [[ "$(stat -c %u "$BASE")" == 0 && "$(stat -c %u "$BASE/.managed-by-robot-blog")" == 0 ]] || fail 'Installation ownership is unexpected.'
    [[ -f "$UNIT" && ! -L "$UNIT" ]] || fail 'Managed service unit is missing or unexpected.'
    # Only our own configuration is migrated. Keep rollback copies first.
    cp "$BASE/nginx.conf" "$stage/previous-nginx.conf"
    cp "$UNIT" "$stage/previous-unit"
    if [[ -f "$API_UNIT" ]]; then
        [[ ! -L "$API_UNIT" ]] || fail 'API unit is an unexpected symlink.'
        grep -q '/opt/robot-blog/app-current/backend/run.py' "$API_UNIT" || fail 'API unit belongs to another application.'
        cp "$API_UNIT" "$stage/previous-api-unit"
    elif [[ "$(systemctl show "$API_SERVICE" --property=LoadState --value)" != not-found ]]; then
        fail 'API service name belongs to another application.'
    fi
    managed_service=true
    if [[ -e "$BASE/current" || -L "$BASE/current" ]]; then
        [[ -L "$BASE/current" ]] || fail 'Current release is not a symlink.'
        previous_target=$(readlink -f -- "$BASE/current")
        [[ "$previous_target" == "$BASE/releases/"* && -f "$previous_target/index.html" ]] || fail 'Previous release is outside the managed directory.'
    fi
    if systemctl is-active --quiet "$SERVICE"; then previous_active=true; fi
    if systemctl is-active --quiet "$API_SERVICE"; then api_previous_active=true; fi
    if [[ -L "$BASE/app-current" ]]; then
        previous_app_target=$(readlink -f -- "$BASE/app-current")
        [[ "$previous_app_target" == "$BASE/app-releases/"* ]] || fail 'Previous API release is outside the managed directory.'
    fi
    # Any existing listener on 8088 must belong to this service.
    listener_pids=$(ss -H -lntp '( sport = :8088 )' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)
    for listener_pid in $listener_pids; do
        grep -q '/robot-blog.service$' "/proc/$listener_pid/cgroup" || fail 'Port 8088 is owned by another process.'
    done
    api_listener_pids=$(ss -H -lntp '( sport = :18088 )' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)
    for listener_pid in $api_listener_pids; do
        grep -q '/robot-blog-api.service$' "/proc/$listener_pid/cgroup" || fail 'Internal API port 18088 is owned by another process.'
    done
    for certificate_unit in robot-blog-cert.service robot-blog-cert.timer; do
        certificate_unit_path="/etc/systemd/system/$certificate_unit"
        if [[ -e "$certificate_unit_path" || -L "$certificate_unit_path" ]]; then
            [[ -f "$certificate_unit_path" && ! -L "$certificate_unit_path" ]] || fail 'Certificate unit path is unexpected.'
            grep -q 'blog' "$certificate_unit_path" || fail 'Certificate unit belongs to another application.'
        elif [[ "$(systemctl show "$certificate_unit" --property=LoadState --value)" != not-found ]]; then
            fail 'Certificate unit name belongs to another application.'
        fi
    done
else
    new_install=true
    [[ ! -e "$UNIT" && ! -L "$UNIT" ]] || fail 'Refusing to overwrite an existing service unit.'
    [[ "$(systemctl show "$SERVICE" --property=LoadState --value)" == not-found ]] || fail 'A service with this name already exists.'
    [[ -z "$(ss -H -lnt '( sport = :8088 )')" ]] || fail 'Port 8088 is already in use.'
    [[ ! -e /run/robot-blog ]] || fail 'Runtime directory already exists.'
fi
[[ ! -e "$BASE/releases/$revision" ]] || fail 'This release identifier already exists.'
[[ -f /var/lib/robot-blog-tls/fullchain.crt && -f /var/lib/robot-blog-tls/private.key ]] || fail 'Provision the isolated blog HTTPS certificate first.'
openssl x509 -in /var/lib/robot-blog-tls/fullchain.crt -noout -checkip 152.136.191.171 || fail 'Certificate does not cover the blog IP.'
openssl x509 -in /var/lib/robot-blog-tls/fullchain.crt -noout -checkend 86400 || fail 'Certificate is expiring too soon.'
assert_existing_unchanged || fail 'Existing services changed before installation; no deployment is allowed.'

if [[ "$new_install" == true ]]; then
    install -d -m 0755 "$BASE" "$BASE/releases"
    printf '%s\n' "$MARKER" > "$BASE/.managed-by-robot-blog"
    install -m 0644 "$stage/package/deploy/nginx.conf" "$BASE/nginx.conf"
    install -m 0644 "$stage/package/deploy/robot-blog.service" "$UNIT"
    managed_service=true
    unit_installed=true
fi
if [[ "$new_install" != true ]]; then config_changed=true; fi
install -m 0644 "$stage/package/deploy/nginx.conf" "$BASE/nginx.conf"
install -m 0644 "$stage/package/deploy/robot-blog.service" "$UNIT"
install -m 0644 "$stage/package/deploy/robot-blog-api.service" "$API_UNIT"
install -m 0644 "$stage/package/deploy/robot-blog-cert.service" /etc/systemd/system/robot-blog-cert.service
install -m 0644 "$stage/package/deploy/robot-blog-cert.timer" /etc/systemd/system/robot-blog-cert.timer
install -m 0755 "$stage/package/deploy/renew-certificate.sh" "$BASE/renew-certificate.sh"
if [[ -e /var/lib/robot-blog || -L /var/lib/robot-blog ]]; then
    [[ -d /var/lib/robot-blog && ! -L /var/lib/robot-blog ]] || fail 'Blog data directory is an unexpected path.'
    [[ -f /var/lib/robot-blog/.managed-by-robot-blog && ! -L /var/lib/robot-blog/.managed-by-robot-blog ]] || fail 'Refusing to overwrite an unrelated data directory.'
    [[ "$(cat /var/lib/robot-blog/.managed-by-robot-blog)" == "$MARKER" ]] || fail 'Data directory ownership marker does not match.'
fi
install -d -o www-data -g www-data -m 0700 /var/lib/robot-blog
printf '%s\n' "$MARKER" > /var/lib/robot-blog/.managed-by-robot-blog
chown root:root /var/lib/robot-blog/.managed-by-robot-blog
chmod 0644 /var/lib/robot-blog/.managed-by-robot-blog
install -d -m 0755 "$BASE/app-releases/$revision"
cp -a "$stage/package/backend" "$BASE/app-releases/$revision/backend"
python3 -m pip install --no-index --find-links "$stage/package/runtime-wheels" --target "$BASE/app-releases/$revision/vendor" --no-compile --disable-pip-version-check -r "$BASE/app-releases/$revision/backend/requirements.txt"
chown -R root:root "$BASE/app-releases/$revision"
find "$BASE/app-releases/$revision" -type d -exec chmod 0755 {} +
find "$BASE/app-releases/$revision" -type f -exec chmod 0644 {} +
if [[ -f /var/lib/robot-blog/blog.sqlite3 ]]; then
    install -d -m 0700 "$BASE/database-backups"
    python3 - "$BASE/database-backups/$revision.sqlite3" <<'PY'
import sqlite3, sys
with sqlite3.connect('/var/lib/robot-blog/blog.sqlite3') as source, sqlite3.connect(sys.argv[1]) as target:
    source.backup(target)
PY
    chmod 0600 "$BASE/database-backups/$revision.sqlite3"
fi
ln -s -- "$BASE/app-releases/$revision" "$BASE/.next-app-$revision"
mv -Tf -- "$BASE/.next-app-$revision" "$BASE/app-current"
install -d -m 0755 "$BASE/releases/$revision"
cp -a "$stage/package/dist/." "$BASE/releases/$revision/"
chown -R root:root "$BASE/releases/$revision"
find "$BASE/releases/$revision" -type d -exec chmod 0755 {} +
find "$BASE/releases/$revision" -type f -exec chmod 0644 {} +
ln -s -- "$BASE/releases/$revision" "$BASE/.next-$revision"
mv -Tf -- "$BASE/.next-$revision" "$BASE/current"
switched=true

# Re-read our unit files. Do not reload or restart the global nginx daemon.
systemctl daemon-reload
api_touched=true
systemctl restart "$API_SERVICE"
for attempt in 1 2 3 4 5; do
    if [[ "$(capture_http http://127.0.0.1:18088/api/health)" == 200 ]]; then break; fi
    sleep 1
done
[[ "$(capture_http http://127.0.0.1:18088/api/health)" == 200 ]] || fail 'Publishing API health check failed.'
service_touched=true
systemctl restart "$SERVICE"
for attempt in 1 2 3 4 5; do
    if systemctl is-active --quiet "$SERVICE" && [[ "$(capture_http https://127.0.0.1:8088/)" == 200 ]]; then break; fi
    sleep 1
done
systemctl is-active --quiet "$SERVICE" || fail 'Independent blog service failed to start.'
[[ "$(capture_http https://127.0.0.1:8088/)" == 200 ]] || fail 'Blog homepage health check failed.'
[[ "$(capture_http https://127.0.0.1:8088/api/health)" == 200 ]] || fail 'Public API proxy health check failed.'
[[ "$(capture_http http://127.0.0.1:8088/)" == 308 ]] || fail 'Plain HTTP must redirect to HTTPS.'
[[ "$(capture_http https://127.0.0.1:8088/__robot_blog_missing_page__)" == 404 ]] || fail 'Unknown paths must return a true 404.'
[[ "$(capture_http https://127.0.0.1:8088/.managed-by-robot-blog)" == 404 ]] || fail 'Hidden files must not be accessible.'
assert_existing_unchanged || fail 'Existing service regression detected; the blog will be stopped.'

if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
    if ! ufw status | grep -Eq '^8088/tcp[[:space:]]+ALLOW'; then
        firewall_added=true
        ufw allow 8088/tcp comment 'robot-blog'
    fi
fi
assert_existing_unchanged || fail 'Existing service regression detected after opening the blog port.'
if ! systemctl is-enabled --quiet "$SERVICE"; then
    enabled_by_run=true
    systemctl enable "$SERVICE"
fi
assert_existing_unchanged || fail 'Existing service regression detected after enabling the blog.'
if ! systemctl is-enabled --quiet "$API_SERVICE"; then api_enabled_by_run=true; systemctl enable "$API_SERVICE"; fi
if ! systemctl is-enabled --quiet robot-blog-cert.timer; then timer_enabled_by_run=true; systemctl enable robot-blog-cert.timer; fi
systemctl start robot-blog-cert.timer
assert_existing_unchanged || fail 'Existing service regression detected after enabling independent API and certificate checks.'
rm -- "$archive"
success=true
printf 'Deployed release %s on port 8088. Existing service checks are unchanged.\n' "$revision"
