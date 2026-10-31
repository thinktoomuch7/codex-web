#!/bin/bash
set -eu
sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
printf '%s\n' 'kernel.apparmor_restrict_unprivileged_userns=0' > /etc/sysctl.d/99-codex-userns.conf
/usr/local/sbin/ops-log "allowed unprivileged user namespaces so Codex bubblewrap can start"
cp /opt/codex-web/deploy/codex-web.service /etc/systemd/system/codex-web.service
systemctl daemon-reload
systemctl stop codex-app-server.service || true
systemctl reset-failed codex-web.service || true
systemctl restart codex-web.service
sleep 3
systemctl is-active codex-web.service
ss -ltn | grep 8787 || echo no-8787
journalctl -u codex-web -n 20 --no-pager
