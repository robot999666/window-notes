#!/usr/bin/env bash
# Read existing, automatically renewed IP certificate; reload only the blog.
set -Eeuo pipefail
umask 077
[[ "$EUID" -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
mode=${1:-renew}
[[ "$mode" == renew || "$mode" == provision ]] || exit 1
BASE=/opt/robot-blog
[[ -d "$BASE" && ! -L "$BASE" && "$(cat "$BASE/.managed-by-robot-blog")" == robot-blog-managed-v1 ]] || exit 1
exec 9>/run/robot-blog-deploy.lock
flock -n 9 || exit 0
snapshot() {
    for unit in nginx.service als-bci.service mysql.service; do systemctl show "$unit" -p ActiveState -p SubState -p MainPID; done
    find /etc/nginx -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum
    curl -k -s --max-time 8 -o /dev/null -w '%{http_code}' https://127.0.0.1:9443/
}
before=$(snapshot)
[[ "$(curl -k -s --max-time 8 -o /dev/null -w '%{http_code}' https://127.0.0.1:9443/)" == 200 ]] || { echo 'Existing 9443 service is unhealthy; certificate sync stopped.' >&2; exit 1; }
check_existing() {
    [[ "$before" == "$(snapshot)" ]] || { systemctl stop robot-blog.service robot-blog-api.service || true; echo 'Existing service changed: blog stopped.' >&2; exit 1; }
}
source=/etc/letsencrypt/live/152.136.191.171
[[ -r "$source/fullchain.pem" && -r "$source/privkey.pem" ]] || exit 1
openssl x509 -in "$source/fullchain.pem" -noout -checkip 152.136.191.171
openssl x509 -in "$source/fullchain.pem" -noout -checkend 43200
cert_public=$(openssl x509 -in "$source/fullchain.pem" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum | cut -d' ' -f1)
key_public=$(openssl pkey -in "$source/privkey.pem" -pubout -outform DER | sha256sum | cut -d' ' -f1)
[[ "$cert_public" == "$key_public" ]] || { echo 'Certificate and key do not match; sync stopped.' >&2; exit 1; }
[[ ! -L /var/lib/robot-blog-tls ]] || exit 1
install -d -o root -g www-data -m 0750 /var/lib/robot-blog-tls
if ! cmp -s "$source/fullchain.pem" /var/lib/robot-blog-tls/fullchain.crt; then
    install -o root -g www-data -m 0640 "$source/privkey.pem" /var/lib/robot-blog-tls/private.key.next
    install -o root -g www-data -m 0644 "$source/fullchain.pem" /var/lib/robot-blog-tls/fullchain.crt.next
    mv -f /var/lib/robot-blog-tls/private.key.next /var/lib/robot-blog-tls/private.key
    mv -f /var/lib/robot-blog-tls/fullchain.crt.next /var/lib/robot-blog-tls/fullchain.crt
    check_existing
    if [[ "$mode" == renew ]] && systemctl is-active --quiet robot-blog.service; then systemctl reload robot-blog.service; fi
fi
check_existing
echo 'Blog certificate synchronized; existing services unchanged.'
