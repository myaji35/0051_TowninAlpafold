# 배포 수정 계획 — `TowninAlpafold.<VULTR_IP>.nip.io`

> 작성일: 2026-05-04 / 참조: `0030_OmniVibePro/{deploy-vultr.sh, docker-compose.vultr.yml, VULTR_QUICK_START.md, nginx/}`
> 사용자 요청: "TowninAlpafold.00.00....io 형식으로 수정계획 잡아줘" — `nip.io` 와일드카드 DNS 패턴

## 1. 결정 — 도메인 형식

| 형식 | 예시 | 도메인 비용 | 선택 |
|---|---|---|---|
| nip.io 와일드카드 | `towninalpafold.158.247.235.31.nip.io` | 무료 | ✅ Wave 1 |
| 자체 도메인 | `towninalpafold.io` 또는 `townin.gagahoho.com` | 유료/별도 | Wave 2 후순위 |

**근거**: OmniVibePro 동일 패턴 (`omnivibepro.158.247.235.31.nip.io`). nip.io는 IP만 있으면 즉시 사용 가능. SSL은 Let's Encrypt가 nip.io subdomain 발급을 지원함.

## 2. 현재 vs 목표 구조

### 현재
```
[GitHub main] ─push─> [GitHub Actions] ─> [GitHub Pages]
                                            └─ socialdoctors35.github.io/0051_TowninAlpafold/
```
정적 사이트(.html + .js + .json) — Python ETL은 로컬에서 사전 실행 후 결과 JSON만 커밋.

### 목표 (vultr 추가 — GitHub Pages 보존)
```
[GitHub main] ─push─> [GitHub Actions]
                       ├─> [GitHub Pages]   (백업 / 무료 호스팅)
                       └─> [Vultr deploy]   (주력 — towninalpafold.<IP>.nip.io)
                              └─ Caddy 단일 컨테이너 + 정적 파일
```

## 3. Vultr 서버 사양 (OmniVibePro 패턴 차용)

| 항목 | 값 | 근거 |
|---|---|---|
| Type | Cloud Compute | OmniVibePro 동일 |
| Location | Seoul (한국) | 한국 사용자 latency |
| Image | Ubuntu 22.04 LTS | OmniVibePro 동일 |
| Plan | **2GB RAM ($12/월)** | TowninAlpafold는 정적 사이트 — OmniVibePro의 8GB($48) 불필요 |
| SSH Key | 기존 키 등록 | 자율 실행 가능 |
| 예상 IP | `<VULTR_IP>` (배포 시 확정) | nip.io이므로 IP만 결정되면 도메인 즉시 결정 |

## 4. 단계별 배포 계획

### Phase 0 — 사전 결정 (T2 사용자 컨펌 필수)
| 항목 | 기본값 | 컨펌 |
|---|---|---|
| Vultr 결제 카드 등록 | — | ✅ EXTERNAL/BUDGET (월 $12) |
| 기존 OmniVibePro 인스턴스(158.247.235.31) 재사용 vs 신규 | 신규 권장 (포트/도메인 충돌 방지) | ✅ DIRECTION |
| nip.io 형식 vs 자체 도메인 | nip.io 우선 | T0 (사용자 명시) |
| ETL 동시 호스팅 | OFF (1차는 정적만, ETL은 로컬) | T0 |

### Phase 1 — Vultr 서버 프로비저닝
1. Vultr 콘솔 → Deploy New Server (Seoul, Ubuntu 22.04, 2GB)
2. IP 확보 → 도메인 즉시 결정: `towninalpafold.<IP>.nip.io`
3. SSH 접속(root) → 자동 setup:
   - apt update/upgrade
   - Docker + docker-compose-plugin
   - deploy 사용자 + sudo,docker 그룹
   - UFW: 22, 80, 443 open
4. OmniVibePro 인스턴스 재사용 시: TowninAlpafold는 80/443만 사용 → 포트 충돌 없으나 Caddy 인스턴스 분리 필요

### Phase 2 — Caddy 단일 컨테이너 (최소 스택)
OmniVibePro는 docker-compose 6개 서비스이지만 TowninAlpafold는 **Caddy 1개로 충분**. SSL 자동 발급(Let's Encrypt) + 정적 파일 서빙 + gzip.

신규 파일:
- `Caddyfile` (정적 라우팅 + 자동 HTTPS)
- `docker-compose.vultr.yml` (Caddy 단일)
- `deploy-vultr.sh` (OmniVibePro 차용 — 단순화)
- `.github/workflows/deploy-vultr.yml` (CI 자동 배포)

`Caddyfile` 초안:
```
towninalpafold.{$VULTR_IP}.nip.io {
    root * /srv
    file_server
    encode gzip
    log {
        output file /var/log/caddy/access.log
        format json
    }
    @data path *.json
    header @data Cache-Control "public, max-age=300"
    @html path *.html
    header @html Cache-Control "public, max-age=60"
}
```

`docker-compose.vultr.yml` 초안:
```yaml
version: '3.8'
services:
  caddy:
    image: caddy:2-alpine
    container_name: townin-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    environment:
      VULTR_IP: ${VULTR_IP}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./_site:/srv:ro
      - caddy-data:/data
      - caddy-config:/config
volumes:
  caddy-data:
  caddy-config:
```

### Phase 3 — CI/CD 통합
신규 워크플로우 `.github/workflows/deploy-vultr.yml`:
1. Trigger: push to main + manual dispatch
2. Steps:
   - checkout
   - 정적 자산 stage (`_site/`) — 기존 deploy.yml의 stage 재사용 가능
   - rsync `_site/` → `deploy@<IP>:/home/deploy/towninalpafold/_site/`
   - SSH로 `docker compose -f docker-compose.vultr.yml up -d` (재시작)
3. GitHub Secrets:
   - `VULTR_IP`
   - `VULTR_SSH_KEY` (deploy 사용자 PEM)
   - `VULTR_DEPLOY_USER` (=deploy)

### Phase 4 — 검증 (캐릭터 저니)
- HTTPS: `https://towninalpafold.<IP>.nip.io/` → HTTP 200
- 모드: gallery / explore / analyze / decide / meongbun + 약국 점포개발 wedge(완성 시)
- SSL 자동 발급 + 90일 자동 갱신
- gzip 응답 헤더 확인
- `verify_all.mjs` BASE_URL 환경변수로 vultr URL 지정해 실행

### Phase 5 — 모니터링 (최소)
- Vultr 대시보드 (CPU/Mem/Bandwidth)
- Caddy access log: `/var/log/caddy/access.log`
- 매주 1회 `docker logs townin-caddy --since 7d | grep -i error`

## 5. 비용 추정

| 항목 | 월 비용 |
|---|---|
| Vultr 2GB 인스턴스 (Seoul) | $12 |
| nip.io 도메인 | $0 |
| Let's Encrypt SSL | $0 (Caddy 자동) |
| GitHub Actions (퍼블릭 repo) | $0 |
| **합계** | **$12/월** |

OmniVibePro 인스턴스 재사용 시: **$0 추가** (포트/Caddy 분리 필요).

## 6. 리스크

| 리스크 | 영향 | 완화 |
|---|---|---|
| Vultr IP 변경 → nip.io 도메인 변경 | 북마크 깨짐 | Reserved IP ($3/월) 추가 권장 |
| SSL 인증서 발급 실패 (nip.io rate limit) | HTTPS 미동작 | Caddy 재시도 + 수동 certbot fallback |
| 동일 IP 재사용 시 SSL 인증서 경쟁 | 발급 실패 | 인스턴스 분리 or SAN 통합 |
| 데이터 JSON 폭증 → 대역폭 한도 | 추가 과금 | gzip + Cache-Control (Caddyfile 포함) |
| ETL 데이터 갱신 시 매번 재배포 | DevOps 부담 | `_site/data/` 만 별도 rsync (Caddy 재시작 불요) |

## 7. Wave 적용

본 배포 계획은 **wedge 결정(Wave 1 = pharmacy.develop)** 과 무관하게 진행 가능. 단:
- Wave 1 완성 시점 = vultr 첫 검증 시점
- 명분 사슬 7섹션 + 약국 점포개발 모두 vultr URL로 시연 가능 시 = 첫 데모 컷

## 8. 자가 검증 체크리스트

- [ ] Vultr 결제 카드 등록 (T2 컨펌 후)
- [ ] 신규 인스턴스 vs OmniVibePro 재사용 결정 (T2 컨펌 후)
- [ ] IP 확보 → GitHub Secret + Caddyfile에 주입
- [ ] Caddyfile + docker-compose.vultr.yml + deploy-vultr.sh 작성
- [ ] .github/workflows/deploy-vultr.yml 작성
- [ ] GitHub Secrets 등록 (VULTR_IP / VULTR_SSH_KEY / VULTR_DEPLOY_USER)
- [ ] 첫 배포 → `https://towninalpafold.<IP>.nip.io/` HTTP 200
- [ ] 캐릭터 저니 (5모드 + 약국) PASS
- [ ] SSL 자동 갱신 확인 (90일 후)
- [ ] GitHub Pages 백업 동시 유지

## 9. 다음 사이클 — 등록할 이슈

| ID | Type | Priority | Status | Title |
|---|---|---|---|---|
| `DEPLOY_VULTR_PLAN-001` | DEPLOY_PLAN | P1 | DONE | [배포 계획] vultr nip.io 패턴 (본 문서) |
| `DEPLOY_VULTR_T2_CONFIRM-001` | SCOPE_REVIEW | P0 | AWAITING_USER | [T2 컨펌] Vultr 인스턴스 신규 vs OmniVibePro 재사용 / 결제 |
| `DEPLOY_VULTR_PROVISION-001` | DEPLOY_READY | P1 | BLOCKED (T2) | Vultr 서버 프로비저닝 + Docker/UFW |
| `DEPLOY_VULTR_CADDY-001` | GENERATE_CODE | P1 | BLOCKED | Caddyfile + docker-compose.vultr.yml + deploy-vultr.sh |
| `DEPLOY_VULTR_CICD-001` | GENERATE_CODE | P1 | BLOCKED | .github/workflows/deploy-vultr.yml + Secrets 가이드 |
| `DEPLOY_VULTR_VERIFY-001` | RUN_TESTS | P1 | BLOCKED | Playwright 캐릭터 저니 + SSL 검증 + 5모드 vultr URL |
| `DEPLOY_VULTR_MONITOR-001` | DEPLOY_READY | P2 | BLOCKED | 액세스 로그 + 대시보드 모니터링 가이드 |

## 10. 한 줄 요약

> 사용자 요청 `TowninAlpafold.00.00....io` = **`towninalpafold.<VULTR_IP>.nip.io`** (OmniVibePro와 동일 패턴, 도메인 무료). Caddy 단일 컨테이너 (월 $12, OmniVibePro 인스턴스 재사용 시 $0 추가) + GitHub Actions 자동 배포 + GitHub Pages 백업 유지. T2 컨펌 2건(결제 + 인스턴스 결정) 후 6개 이슈 분해 진행.
