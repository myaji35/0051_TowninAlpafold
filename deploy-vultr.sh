#!/usr/bin/env bash
# TowninAlpafold — Vultr 서버 초기 프로비저닝 (1회 실행)
# 사용: VULTR_IP=158.x.x.x ./deploy-vultr.sh provision
#       VULTR_IP=158.x.x.x ./deploy-vultr.sh deploy   (수동 배포 — 평소엔 GitHub Actions가 처리)
# 참조: docs/deploy/vultr-nipio-plan.md
set -euo pipefail

: "${VULTR_IP:?VULTR_IP 환경변수 필요 (예: VULTR_IP=158.247.235.31)}"
DEPLOY_USER="${VULTR_DEPLOY_USER:-deploy}"
CMD="${1:-deploy}"
APP_DIR="/home/$DEPLOY_USER/towninalpafold"

case "$CMD" in
  provision)
    echo "▶ Vultr 서버 프로비저닝 시작 ($VULTR_IP)"
    ssh "root@$VULTR_IP" bash -s <<'REMOTE'
set -euo pipefail
apt-get update -y && apt-get upgrade -y
# Docker
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
# deploy 사용자
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
usermod -aG docker,sudo deploy
mkdir -p /home/deploy/towninalpafold/_site /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys 2>/dev/null || true
chown -R deploy:deploy /home/deploy/.ssh /home/deploy/towninalpafold
chmod 700 /home/deploy/.ssh
# UFW
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable
echo "✓ 프로비저닝 완료"
REMOTE
    echo "✓ 다음: GitHub Secrets 등록 (VULTR_IP / VULTR_SSH_KEY / VULTR_DEPLOY_USER)"
    ;;

  deploy)
    echo "▶ 수동 배포 ($VULTR_IP) — 평소엔 GitHub Actions 사용 권장"
    rsync -az --delete -e ssh _site/ "$DEPLOY_USER@$VULTR_IP:$APP_DIR/_site/"
    rsync -az -e ssh Caddyfile docker-compose.vultr.yml "$DEPLOY_USER@$VULTR_IP:$APP_DIR/"
    ssh "$DEPLOY_USER@$VULTR_IP" "cd $APP_DIR && docker compose -f docker-compose.vultr.yml up -d"
    # kamal-proxy에 host 라우팅 등록 (멱등 — 이미 있으면 갱신)
    ssh "$DEPLOY_USER@$VULTR_IP" "docker exec kamal-proxy kamal-proxy deploy townin \
      --target townin-caddy:8080 --host towninalpafold.$VULTR_IP.nip.io \
      --tls --health-check-path /healthz" || echo '⚠️ kamal-proxy 라우팅 등록 실패 — 수동 확인 필요'
    echo "✓ 배포 완료 → https://towninalpafold.$VULTR_IP.nip.io/"
    ;;

  *)
    echo "사용법: $0 {provision|deploy}" >&2; exit 1 ;;
esac
