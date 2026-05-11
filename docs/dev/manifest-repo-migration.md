# Manifest 저장소 3단계 전환 가이드

## Phase 0 (현재) — JSONManifestRepo
- 파일: `data_raw/_progress/manifest.json`
- 잠금: fcntl LOCK_EX/LOCK_SH (`/tmp/towninalpafold-manifest-locks/`)
- 한계: 1,000동 × 10 데이터셋 = 약 10MB JSON, 매 갱신 전체 read/write
- 트리거 임계: dongs ≥ 1,000 OR active_datasets ≥ 10

## Phase 1 — SQLiteManifestRepo
- DB: `data_raw/_progress/manifest.sqlite`
- 테이블: regions / sigungu / dongs / datasets_per_dong / aggregates_cache
- 인덱스: adm_cd (PK), dataset_key, last_updated
- 환경변수: `MANIFEST_BACKEND=sqlite`
- 마이그레이션: `scripts/migrate_json_to_sqlite.py` (Phase 1 이슈에서 작성)

## Phase 2 — PostgresManifestRepo
- 트리거: Enterprise 계약 + multi-tenant (brand_id 외래키)
- 분리: 동 마스터 = 공유 / 카탈로그 = 테넌트별
- 환경변수: `MANIFEST_BACKEND=postgres`, `DATABASE_URL=postgresql://...`

## 호출자 변경 0
모든 ETL/UI/PDF는 `get_manifest_repo()` 만 호출 → 구현체 교체 시 코드 변경 0.
