#!/bin/bash
# FK 무결성 검증 — git commit 전 실행
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/../.."

# 카탈로그 파일이 staged 됐는지 확인
if git diff --cached --name-only | grep -qE 'data_raw/(_registry|_models|_brands|_progress|_master)/.*\.json$'; then
    echo "[fk-validate] 카탈로그 변경 감지 → 외래키 검증"
    if ! python3 "$ROOT/scripts/validate_catalogs.py"; then
        echo "FK validation 실패 — commit 중단"
        echo "수정 후 다시 commit 또는 --no-verify (비권장)"
        exit 1
    fi
    echo "[fk-validate] 통과"
fi
