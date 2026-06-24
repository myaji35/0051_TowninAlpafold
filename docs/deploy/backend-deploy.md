# 백엔드(FastAPI) 배포 경로 — Vultr nginx 프록시 + systemd

> 작성일: 2026-06-24 · 서버: `158.247.235.31` (towninalpafold.158.247.235.31.nip.io)
> 기존 정적 배포(`deploy-vultr.sh deploy`)에 **백엔드 API 배포 경로를 추가**한 것.

## 구조

```
[클라이언트] ──https──> [호스트 nginx :443]
                          ├─ /            → /var/www/towninalpafold (정적, 기존)
                          ├─ /api/  ──proxy──> [uvicorn 127.0.0.1:8000]  (FastAPI)
                          └─ /saas/ ──proxy──> [uvicorn 127.0.0.1:8000]
                                                  └─ systemd: towninalpafold-api.service
                                                     SQLite: /opt/towninalpafold/backend/data/
```

- 정적과 백엔드가 **같은 도메인**이라 CORS 단순(동일 출처). nginx가 경로로 분기.
- uvicorn은 `127.0.0.1:8000`만 바인딩(외부 비노출) → nginx만 프록시.
- 코드 위치: `/opt/towninalpafold` (정적 `/var/www/towninalpafold`와 분리).

## 산출물

| 파일 | 역할 |
|---|---|
| `deploy/towninalpafold-api.service` | systemd 유닛 (uvicorn 데몬, www-data, 2 workers) |
| `deploy/nginx-towninalpafold.conf` | `/api`,`/saas`,`/api/health` 프록시 추가 (정적 location 보존) |
| `deploy-vultr.sh setup-api/deploy-api/verify-api` | 배포 명령 |

## 배포 절차 (대표님 — SSH 접속 T2)

> ⚠️ 프로덕션 서버 SSH 접속이므로 **대표님이 직접 실행**합니다.
> `! ` 프리픽스로 이 세션에서 실행하시거나 터미널에서 실행.

### 1회 셋업 (최초만)
```bash
./deploy-vultr.sh setup-api
```
→ venv 생성 + 의존성 설치 + systemd 등록·기동 + nginx 프록시 반영 + `.env` 템플릿 생성.

### 셋업 후 필수 — 서버 .env 실값 기입
```bash
ssh root@158.247.235.31
nano /opt/towninalpafold/.env
#   API_TOKEN=<실토큰>          ← 보호 엔드포인트 인증
#   SAAS_ADMIN_SECRET=<실시크릿>  ← SaaS 테넌트 발급용
#   DATA_GO_KR_KEY=<공공API키>   ← V2/V3 건축물대장·실거래 (선택)
systemctl restart towninalpafold-api
```

### 코드 갱신 배포 (이후 반복)
```bash
./deploy-vultr.sh deploy-api   # backend/ rsync + 의존성 + 재시작 (DB 보존)
```

### 검증
```bash
./deploy-vultr.sh verify-api
#   200  /api/health
#   200/401  /api/v1/npl/portfolio/summary  (인증 필요시 401 정상)
```

## 주의

- **DB 보존**: `deploy-api`는 `--exclude data/`로 SQLite를 덮어쓰지 않음. 셋업 시 빈 DB 생성, 이후 보존.
- **lifespan init_db**: 앱 부팅 시 `init_db()`가 테이블 생성(멱등). npl_assets/saas_* 테이블 자동 생성.
- **데이터 적재**: 배포 후 2.5만건 배치(`npl_batch_score.py`)는 서버에서 별도 1회 실행하거나 CSV 임포트 API로 주입.
- **T2 항목**: SSH 접속·프로덕션 반영은 EXTERNAL. CI 자동배포 원하면 `.github/workflows/`에 deploy-api 잡 추가(시크릿 등록 필요).
