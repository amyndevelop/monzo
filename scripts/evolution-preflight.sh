#!/usr/bin/env bash
# Read-only inventory. Does not print environment variables, keys or full Nginx configs.
set -eu
printf 'Architecture: '
uname -m
free -h
df -h /
printf '\nCompose package candidate:\n'
apt-cache policy docker-compose-v2
printf '\nContainer status:\n'
sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
printf '\nCompose version (absence is expected before installation):\n'
sudo docker compose version || true
printf '\nListeners for TLS and the proposed private gateway:\n'
sudo ss -lntp '( sport = :80 or sport = :443 or sport = :18085 )'
printf '\nExisting domain declarations (no complete configuration or keys):\n'
sudo rg -n 'server_name.*onlineboosty[.]com[.]ar' /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null || sudo grep -R -n 'server_name.*onlineboosty[.]com[.]ar' /etc/nginx/sites-enabled /etc/nginx/conf.d || true
printf '\nDomain IPv4 addresses:\n'
getent ahostsv4 onlineboosty.com.ar || true
printf '\nDomain IPv6 addresses (remove or correct stale AAAA before TLS):\n'
getent ahostsv6 onlineboosty.com.ar || true
printf '\nConfirmed virtual host target:\n'
readlink -f /etc/nginx/sites-enabled/renovar-onlineboosty || true
printf '\nCertificate identity and validity (no private key is read):\n'
sudo openssl x509 -in /etc/letsencrypt/live/onlineboosty.com.ar/fullchain.pem -noout -dates -checkhost onlineboosty.com.ar -checkend 604800 || true
printf '\nCertbot renewal method and ACME webroot:\n'
sudo grep -nE '^(authenticator|installer|webroot_path)[[:space:]]*=' /etc/letsencrypt/renewal/onlineboosty.com.ar.conf || true
printf '\nCertbot version:\n'
certbot --version || true
printf '\nPackage simulation only (review removals and upgrades before installation):\n'
apt-get -s install --no-install-recommends docker-compose-v2
