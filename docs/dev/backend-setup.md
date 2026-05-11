# Backend Phase 1 — 로컬 실행 + Vultr 배포

## 로컬 실행

```bash
# 1. 가상환경 (선택)
python3 -m venv .venv-backend
source .venv-backend/bin/activate

# 2. 의존성 설치
pip install -r backend/requirements.txt

# 3. .env 설정
cp backend/.env.example backend/.env
# backend/.env 수정 — API_TOKEN을 강력한 값으로

# 4. 실행
uvicorn backend.main:app --reload --port 8000

# 5. 헬스 체크
curl http://localhost:8000/health
```

## API 사용 예시

```bash
TOKEN="$(grep API_TOKEN backend/.env | cut -d= -f2)"

# 데이터셋 등록
curl -X POST http://localhost:8000/api/v1/datasets \
  -H "X-API-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"kosis_living_pop","ko":"생활인구","source_org":"KOSIS"}'

# 데이터셋 목록
curl http://localhost:8000/api/v1/datasets -H "X-API-Token: $TOKEN"
```

## Vultr 배포 (Phase 1)

이미 `docs/deploy/vultr-nipio-plan.md` 작성됨. 추가 사항:

1. Vultr 2GB 서버 + Caddy 정적 사이트 + uvicorn 백엔드
2. systemd 서비스: `/etc/systemd/system/towninalpafold-backend.service`
3. Caddy 라우팅: `/api/*` → uvicorn:8000, 그 외 → 정적
4. 비용: Vultr 2GB $12/월 + 도메인 (nip.io 무료)

## 다음 단계 (Phase 2)

- JWT 인증 (단일 토큰 → 사용자별)
- BATCH_QUEUE_INFRA-001 — RQ + Redis
- TEST_INFRA_DATA_SAAS-001 — pytest CI
- MODEL_REVIEW_QUEUE UI — React/Vue 또는 vanilla JS

## 안전 장치

- API_TOKEN은 .env (gitignore)
- CORS는 정적 사이트 도메인 + nip.io 만 허용
- SQLite WAL 모드 (write 동시성)
- 모든 DB 변경은 atomic transaction
