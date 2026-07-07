#!/usr/bin/env bash
# TowninAlpafold — Vultr 정적 배포 (호스트 nginx + Certbot 패턴)
# 서버 158.247.235.31는 호스트 nginx가 80/443 종단 + Certbot SSL.
# 정적 사이트는 /var/www/towninalpafold 에 rsync, nginx 사이트로 서빙.
# 사용 (정적):
#   ./deploy-vultr.sh stage     — _site/ 스테이징
#   ./deploy-vultr.sh deploy    — rsync + 권한 + nginx reload
#   ./deploy-vultr.sh setup     — nginx 사이트 + certbot SSL (1회)
# 사용 (백엔드 FastAPI):
#   ./deploy-vultr.sh setup-api — venv + systemd 서비스 + nginx 프록시 (1회)
#   ./deploy-vultr.sh deploy-api— backend/ rsync + 의존성 + 서비스 재시작
#   ./deploy-vultr.sh verify-api— /api/health 응답 확인
# 참조: docs/deploy/vultr-nipio-plan.md
set -euo pipefail

IP="${VULTR_IP:-158.247.235.31}"
KEY="${VULTR_SSH_KEY:-$HOME/.ssh/id_rsa}"
DOMAIN="towninalpafold.${IP}.nip.io"
WEBROOT="/var/www/towninalpafold"
APIROOT="/opt/towninalpafold"
SSH="ssh -i $KEY -o StrictHostKeyChecking=no root@$IP"
CMD="${1:-deploy}"

stage() {
  rm -rf _site && mkdir -p _site
  cp index.html app.js manual.html _site/
  [ -f report_v07_alpha.html ] && cp report_v07_alpha.html _site/
  for j in simula_data_real.json simula_data.json forecasts.json causal.json tree_model.json; do
    [ -f "$j" ] && cp "$j" _site/ || true
  done
  for d in components css utils viz docs screenshots data_raw reports; do [ -d "$d" ] && cp -r "$d" "_site/$d" || true; done
  # 사이드바/브랜드가 fetch하는 메타 (categories.json 등) — data_raw에 포함됨
  # brand-dna.json (디자인 토큰만, 민감정보 없음) — 사이드바가 fetch
  if [ -f .claude/brand-dna.json ]; then mkdir -p _site/.claude && cp .claude/brand-dna.json _site/.claude/; fi
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

  # ─── 백엔드 FastAPI 배포 ───
  setup-api)
    # 1회: Python venv + systemd 서비스 + nginx 프록시 적용
    $SSH "apt-get install -y python3-venv >/dev/null 2>&1 || true"
    $SSH "mkdir -p $APIROOT/backend/data"
    rsync -az -e "ssh -i $KEY -o StrictHostKeyChecking=no" backend/ "root@$IP:$APIROOT/backend/"
    # main.py가 from utils.* 를 import → utils/ 패키지도 함께 배포
    rsync -az -e "ssh -i $KEY -o StrictHostKeyChecking=no" utils/ "root@$IP:$APIROOT/utils/"
    $SSH "cd $APIROOT && python3 -m venv venv && venv/bin/pip install -q -U pip && venv/bin/pip install -q -r backend/requirements.txt"
    # .env 템플릿 (서버에서 대표님이 실토큰 기입)
    $SSH "test -f $APIROOT/.env || printf 'API_TOKEN=change-me-%s\nSAAS_ADMIN_SECRET=change-me-%s\n# DATA_GO_KR_KEY=\n' \$(openssl rand -hex 8) \$(openssl rand -hex 8) > $APIROOT/.env"
    scp -i "$KEY" -o StrictHostKeyChecking=no deploy/towninalpafold-api.service "root@$IP:/etc/systemd/system/towninalpafold-api.service"
    $SSH "chown -R www-data:www-data $APIROOT && systemctl daemon-reload && systemctl enable --now towninalpafold-api"
    scp -i "$KEY" -o StrictHostKeyChecking=no deploy/nginx-towninalpafold.conf "root@$IP:/etc/nginx/sites-available/towninalpafold"
    $SSH "nginx -t && systemctl reload nginx"
    echo "✓ 백엔드 셋업 완료 → https://$DOMAIN/api/health"
    echo "  ⚠️ 서버 $APIROOT/.env 의 API_TOKEN/ADMIN_SECRET 을 실값으로 교체하세요."
    ;;
  deploy-api)
    # 코드 갱신 (data/ DB 보존) + 의존성 + 서비스 재시작
    rsync -az -e "ssh -i $KEY -o StrictHostKeyChecking=no" --exclude 'data/' --exclude '__pycache__/' backend/ "root@$IP:$APIROOT/backend/"
    rsync -az -e "ssh -i $KEY -o StrictHostKeyChecking=no" --exclude '__pycache__/' utils/ "root@$IP:$APIROOT/utils/"
    $SSH "cd $APIROOT && venv/bin/pip install -q -r backend/requirements.txt"
    $SSH "chown -R www-data:www-data $APIROOT && systemctl restart towninalpafold-api"
    sleep 2
    code=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/api/health")
    echo "✓ 백엔드 배포 완료 → /api/health = $code"
    ;;
  verify-api)
    for p in /api/health /api/v1/npl/portfolio/summary /saas/v1/usage; do
      code=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN$p")
      echo "  $code  $p"
    done
    ;;

  *) echo "사용법: $0 {stage|deploy|setup|verify|setup-api|deploy-api|verify-api}" >&2; exit 1 ;;
esac
