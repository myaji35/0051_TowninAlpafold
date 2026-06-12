#!/usr/bin/env bash
# TowninAlpafold — Vultr 정적 배포 (호스트 nginx + Certbot 패턴)
# 서버 158.247.235.31는 호스트 nginx가 80/443 종단 + Certbot SSL.
# 정적 사이트는 /var/www/towninalpafold 에 rsync, nginx 사이트로 서빙.
# 사용:
#   ./deploy-vultr.sh stage     — _site/ 스테이징
#   ./deploy-vultr.sh deploy    — rsync + 권한 + nginx reload
#   ./deploy-vultr.sh setup     — nginx 사이트 + certbot SSL (1회)
# 참조: docs/deploy/vultr-nipio-plan.md
set -euo pipefail

IP="${VULTR_IP:-158.247.235.31}"
KEY="${VULTR_SSH_KEY:-$HOME/.ssh/id_rsa}"
DOMAIN="towninalpafold.${IP}.nip.io"
WEBROOT="/var/www/towninalpafold"
SSH="ssh -i $KEY -o StrictHostKeyChecking=no root@$IP"
CMD="${1:-deploy}"

stage() {
  rm -rf _site && mkdir -p _site
  cp index.html app.js manual.html _site/
  [ -f report_v07_alpha.html ] && cp report_v07_alpha.html _site/
  for j in simula_data_real.json simula_data.json forecasts.json causal.json tree_model.json; do
    [ -f "$j" ] && cp "$j" _site/ || true
  done
  for d in components css utils viz docs screenshots; do [ -d "$d" ] && cp -r "$d" "_site/$d" || true; done
  du -sh _site
}

case "$CMD" in
  stage) stage ;;

  deploy)
    stage
    $SSH "mkdir -p $WEBROOT"
    rsync -az --delete -e "ssh -i $KEY -o StrictHostKeyChecking=no" _site/ "root@$IP:$WEBROOT/"
    # nginx(www-data)가 읽도록 권한 (rsync는 root 소유로 복사됨)
    $SSH "chown -R www-data:www-data $WEBROOT && chmod -R a+rX $WEBROOT && systemctl reload nginx"
    echo "✓ 배포 완료 → https://$DOMAIN/"
    ;;

  setup)
    # nginx 사이트 + certbot SSL (1회). 이미 적용됨 — 재해 복구용.
    $SSH "ln -sf /etc/nginx/sites-available/towninalpafold /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx"
    $SSH "certbot --nginx -d $DOMAIN --non-interactive --agree-tos --redirect -m socialdoctors35@gmail.com"
    echo "✓ SSL 발급 완료"
    ;;

  verify)
    for p in / /app.js /healthz; do
      code=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN$p")
      echo "  $code  $p"
    done
    ;;

  *) echo "사용법: $0 {stage|deploy|setup|verify}" >&2; exit 1 ;;
esac
