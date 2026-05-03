#!/bin/bash
# auto-detect.sh — TowninAlpafold 특화 자동 이슈 감지
#
# 호출 지점:
#   1. Stop hook 체인 (작업 완료마다, 일일 한도 안에서)
#   2. 수동 실행: bash .claude/hooks/auto-detect.sh
#   3. CI/cron (npm run auto:detect)
#
# 감지 시그널 (TowninAlpafold 도메인):
#   S1. tree_model.json 부재/노후 → TREE_RETRAIN
#   S2. simula vs real 데이터 갭 (real_data_attached 비율 < 80%) → DATA_INTEGRITY
#   S3. brand-dna anti_patterns 위반 (코드 grep) → DESIGN_FIX
#   S4. screenshots 노후 (gitignore 후 7일+ 미갱신) → SCREENSHOT_REFRESH
#   S5. verify_all 회귀 신호 (마지막 결과 FAIL) → REGRESSION
#   S6. 데이터 파일 변경 (causal/forecasts/simula) 후 트리 미재학습 → TREE_RETRAIN
#   S7. tree_model train_accuracy < 0.70 → MODEL_QUALITY
#
# 일일 한도: 3회 (registry.auto_detect_state로 추적)
# 중복 방지: 같은 detect_signature(type+detail) 이미 READY/IN_PROGRESS면 skip

set -e
REGISTRY=".claude/issue-db/registry.json"
[ ! -f "$REGISTRY" ] && exit 0

python3 << 'PYEOF'
import json, datetime, os, hashlib, subprocess
from pathlib import Path

REG = ".claude/issue-db/registry.json"
ROOT = Path(".")

with open(REG) as f:
    r = json.load(f)

today = datetime.date.today().isoformat()
state = r.setdefault("auto_detect_state", {"date": today, "count": 0})
if state.get("date") != today:
    state.update({"date": today, "count": 0})
if state["count"] >= 3:
    print(f"[auto-detect] 일일 한도 초과 ({state['count']}/3) — skip")
    exit(0)

now = datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")

def signature(itype, key):
    return hashlib.md5(f"{itype}|{key}".encode()).hexdigest()[:12]

def already_active(sig):
    for iss in r.get("issues", []):
        if iss.get("detect_signature") == sig and iss.get("status") in ("READY", "IN_PROGRESS", "AWAITING_USER"):
            return True
    return False

def already_recent(sig, hours=24):
    cutoff = datetime.datetime.now(datetime.UTC) - datetime.timedelta(hours=hours)
    for iss in r.get("issues", []):
        if iss.get("detect_signature") != sig:
            continue
        ts = iss.get("created_at") or iss.get("completed_at")
        if not ts: continue
        try:
            t = datetime.datetime.fromisoformat(ts.replace("Z","+00:00"))
            if t > cutoff: return True
        except: pass
    return False

next_id_n = max((int(i["id"].split("-")[-1]) for i in r["issues"] if i["id"].startswith("ISS-")), default=0) + 1
findings = []

def add(itype, priority, title, detail, key, files=None, assign_to="agent-harness"):
    global next_id_n
    sig = signature(itype, key)
    if already_active(sig):
        print(f"[skip-active] {itype}: {key}")
        return
    if already_recent(sig, hours=12):
        print(f"[skip-recent] {itype}: {key}")
        return
    iid = f"ISS-{next_id_n:03d}"
    next_id_n += 1
    r["issues"].append({
        "id": iid,
        "type": itype,
        "priority": priority,
        "status": "READY",
        "title": title,
        "detail": detail,
        "assign_to": assign_to,
        "created_at": now,
        "files": files or [],
        "detect_signature": sig,
        "auto_detected": True,
    })
    findings.append((iid, priority, title))
    print(f"[+] {iid} [{priority}] {itype} — {title}")

# ─ S1: tree_model.json 부재 ─────────────────────
if not (ROOT / "tree_model.json").exists():
    add("REFACTOR", "P2",
        "tree_model.json 부재 — npm run train:tree 필요",
        "decision_tree_train.py 산출물 누락. Decide 모드 트리 시각화가 빈 상태로 표시됨.",
        "tree_missing", files=["tree_model.json"])

# ─ S2: simula vs real 데이터 부착 비율 ─────────
try:
    if (ROOT / "simula_data_real.json").exists():
        sim = json.loads((ROOT / "simula_data_real.json").read_text())
        dongs = sim.get("dongs", [])
        if dongs:
            attached = sum(1 for d in dongs if d.get("real_data_attached"))
            total = len(dongs)
            ratio = attached / total
            if ratio < 0.80:
                add("DATA_INTEGRITY", "P2",
                    f"실데이터 부착 비율 낮음 ({attached}/{total} = {ratio:.0%})",
                    f"simula_data_real.json의 real_data_attached=True 동이 {ratio:.0%}. 80% 미만이면 분석 신뢰도 영향. ETL 점검 또는 REAL_DATA_INGEST-001 진행 권고.",
                    f"data_attach_{int(ratio*100)}", files=["etl_real_data.py", "simula_data_real.json"])
except Exception as e:
    pass

# ─ S3: brand-dna anti_patterns 위반 ───────────
try:
    bd = json.loads((ROOT / ".claude" / "brand-dna.json").read_text())
    antis = bd.get("anti_patterns", [])
    # 단일 점추정만 표시 (cone/신뢰구간 누락) — 코드에 "p10"|"p90" 없으면 의심
    if antis and "단일 점추정만 표시 (cone/신뢰구간 누락)" in antis:
        try:
            grep = subprocess.run(["grep", "-l", "p10\\|p90\\|conePoints", "app.js"],
                                capture_output=True, text=True, timeout=5)
            if not grep.stdout.strip():
                add("DESIGN_FIX", "P1",
                    "anti-pattern 위반 — cone/신뢰구간 코드 발견 안 됨",
                    "brand-dna.json anti_patterns에 '단일 점추정만 표시'가 있는데 app.js에 p10/p90/cone 키워드 없음. 신뢰구간 시각화가 사라졌을 가능성.",
                    "no_cone", files=["app.js"])
        except: pass
except Exception:
    pass

# ─ S4: screenshots 노후 (≥ 14일 미갱신) ────────
try:
    sd = ROOT / "screenshots"
    if sd.is_dir():
        pngs = list(sd.glob("v07_*.png"))
        if pngs:
            now_ts = datetime.datetime.now().timestamp()
            oldest = min(p.stat().st_mtime for p in pngs)
            age_days = (now_ts - oldest) / 86400
            if age_days > 14:
                add("OBSERVATION", "P3",
                    f"screenshots/v07_*.png 노후 ({age_days:.0f}일+) — capture_screens 권고",
                    f"가장 오래된 v07 스크린샷이 {age_days:.0f}일 전. 코드는 갱신되었으나 캡처가 따라오지 않은 가능성. node capture_screens.mjs 실행 권고.",
                    f"screenshots_old_{int(age_days/7)*7}", files=["capture_screens.mjs"])
except Exception:
    pass

# ─ S5: verify_all 회귀 신호 ─────────────────
# 마지막 SCORE 또는 RUN_TESTS 이슈에서 FAIL 또는 누락 확인
last_test = None
for iss in reversed(r.get("issues", [])):
    if iss.get("type") in ("RUN_TESTS", "SCORE"):
        last_test = iss
        break
if last_test:
    res = last_test.get("result") or {}
    failed = res.get("failed_count", 0)
    if isinstance(failed, int) and failed > 0:
        add("FIX_BUG", "P0",
            f"verify_all 회귀 — {failed}개 스위트 FAIL ({last_test['id']})",
            f"마지막 {last_test['type']} 결과에 failed_count={failed}. 즉시 수정 필요.",
            f"regression_{last_test['id']}", files=["verify_*.mjs"])

# ─ S6: 데이터 파일 vs tree_model 신선도 ────────
try:
    tm = ROOT / "tree_model.json"
    if tm.exists():
        tm_age = tm.stat().st_mtime
        for src in ["simula_data_real.json", "causal.json"]:
            sp = ROOT / src
            if sp.exists() and sp.stat().st_mtime > tm_age + 60:
                add("REFACTOR", "P2",
                    f"{src} 갱신 후 tree_model.json 미재학습",
                    f"{src}이 tree_model.json보다 최신. 입력 데이터가 바뀌었으니 npm run train:tree 재실행 권고.",
                    f"tree_stale_{src}", files=[src, "tree_model.json", "decision_tree_train.py"])
                break
except Exception:
    pass

# ─ S7: tree_model 정확도 임계값 ────────────────
try:
    tm = ROOT / "tree_model.json"
    if tm.exists():
        m = json.loads(tm.read_text())
        acc = m.get("meta", {}).get("train_accuracy", 0)
        if acc < 0.70:
            add("MODEL_QUALITY", "P1",
                f"디시전 트리 train accuracy 낮음 ({acc:.2%})",
                f"현재 모델 정확도 {acc:.2%}. 0.70 미만이면 의사결정 신뢰도 손상. 특성 추가/하이퍼파라미터 튜닝 권고.",
                f"tree_acc_{int(acc*100)}", files=["decision_tree_train.py"])
except Exception:
    pass

# 결과 저장
if findings:
    state["count"] += 1
    r["stats"]["total_issues"] = len(r["issues"])
    with open(REG, "w") as f:
        json.dump(r, f, indent=2, ensure_ascii=False)
    print(f"\n[auto-detect] {len(findings)}개 신규 이슈 등록 (오늘 {state['count']}/3)")
else:
    print("[auto-detect] 새 이슈 없음 — 시스템 정상")
PYEOF
