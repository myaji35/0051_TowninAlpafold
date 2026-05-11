#!/usr/bin/env python3
"""
ISS-218 — 자연어 처방 변환: whatif 시나리오 JSON → 한국어 비즈니스 권고문

사용:
  python reverse_whatif_narrate.py --result whatif_result_tx.json
  python reverse_whatif_narrate.py --result whatif_scenarios_tx.json
  python reverse_whatif_narrate.py --result whatif_result.json --out narration.txt

지원 타깃: tx_volume, visitors_total, tx_per_visitor, tx_delta_6m
출력: narration_<suffix>.txt (또는 --out 지정)
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent

# ── 타깃 메타 ──────────────────────────────────────────────────────────────
TARGET_META = {
    "tx_volume": {
        "label": "부동산 거래량",
        "unit": "건",
        "scale": 1.0,
        "goal_verb": "증가",
    },
    "visitors_total": {
        "label": "월 유동인구",
        "unit": "명",
        "scale": 1.0,
        "goal_verb": "증가",
    },
    "tx_per_visitor": {
        "label": "방문자당 거래율",
        "unit": "건/천명",
        "scale": 1.0,
        "goal_verb": "향상",
    },
    "tx_delta_6m": {
        "label": "거래량 6개월 모멘텀",
        "unit": "건 변화",
        "scale": 1.0,
        "goal_verb": "개선",
    },
}

# 특성명 → 한국어 설명 + 단위 (표시용)
FEAT_DISPLAY = {
    "소상공_평균": ("소상공인 사업체 수",  "개"),
    "카페_평균":   ("카페·음료점 수",       "개"),
    "유동_평균":   ("월 유동인구",           "명"),
    "거래_평균":   ("거래량 평균",           "건"),
    "지가_평균":   ("공시지가 평균",         "만원/m²"),
    "소상공_추세": ("소상공인 증가 추세",    ""),
    "카페_추세":   ("카페 증가 추세",        ""),
    "유동_추세":   ("유동인구 증가 추세",    ""),
    "거래_추세":   ("거래량 추세",           ""),
    "지가_추세":   ("지가 추세",             ""),
}

STRATEGY_LABEL = {
    "minimum_change": "최소 변화 전략",
    "balanced":        "균형 전략",
    "high_efficiency": "고효율 전략",
}


def _format_change(feat: str, delta: float) -> str:
    """특성별 변화량을 자연어 문장으로."""
    display, unit = FEAT_DISPLAY.get(feat, (feat, ""))
    direction = "증가" if delta > 0 else "감소"
    abs_delta = abs(delta)

    # 지가는 원/m² 단위로 저장 → 만원으로 표시
    if "지가" in feat and "추세" not in feat:
        abs_delta_disp = abs_delta / 10000  # 원/m² → 만원/m²
        return f"{display} {abs_delta_disp:.1f}만원/m² {direction}"
    elif unit:
        return f"{display} {abs_delta:.1f}{unit} {direction}"
    else:
        return f"{display} {direction} ({delta:+.3f})"


def _achievement_phrase(pct: float) -> str:
    if pct >= 90:
        return "목표를 충분히 달성할 수 있습니다"
    elif pct >= 60:
        return f"목표의 {pct:.0f}%를 달성할 수 있습니다"
    elif pct >= 30:
        return f"목표의 {pct:.0f}% 수준의 효과를 기대할 수 있습니다"
    else:
        return f"목표 달성이 어렵습니다 (예상 달성률 {pct:.0f}%)"


def narrate_scenario(scenario_name: str, sc: dict, target: str, goal_pct: float,
                     current_y: float | None, target_y: float | None) -> str:
    """시나리오 1개 → 한국어 권고문 1~3문장."""
    meta = TARGET_META.get(target, {
        "label": target, "unit": "", "scale": 1.0, "goal_verb": "증가"
    })

    achievement = sc.get("achievement_pct", 0.0) or 0.0
    changes = sc.get("changes") or {}
    note = sc.get("note", "")
    strategy = sc.get("strategy", scenario_name)
    strategy_label = STRATEGY_LABEL.get(strategy, scenario_name)

    # 변화량이 있는 특성만 추출 (절댓값 0.01 이상)
    meaningful = {f: v for f, v in changes.items() if abs(v) >= 0.01}

    lines = []

    # 1문장: 목표 + 전략 소개
    goal_line = (
        f"[{scenario_name} / {strategy_label}] "
        f"{meta['label']} {goal_pct:.0f}% {meta['goal_verb']} 목표 — "
        f"{_achievement_phrase(achievement)}."
    )
    lines.append(goal_line)

    # 2문장: 필요 조치 (변화가 있는 경우만)
    if meaningful:
        change_parts = [_format_change(f, v) for f, v in meaningful.items()]
        if len(change_parts) == 1:
            action_line = f"필요 조치: {change_parts[0]}."
        elif len(change_parts) == 2:
            action_line = f"필요 조치: {change_parts[0]}, {change_parts[1]}."
        else:
            joined = ", ".join(change_parts[:-1])
            action_line = f"필요 조치: {joined}, 그리고 {change_parts[-1]}."
        lines.append(action_line)
    elif note:
        lines.append(f"참고: {note}")
    else:
        lines.append("현재 수준 유지로도 일정 효과가 기대됩니다.")

    # 3문장: 현재→목표 수치 (가용한 경우)
    if current_y is not None and target_y is not None:
        scale = meta["scale"]
        unit = meta["unit"]
        curr_disp = current_y * scale
        tgt_disp = target_y * scale
        if scale >= 1e5:  # 대규모 수치는 반올림
            curr_str = f"{curr_disp:,.0f}{unit}"
            tgt_str = f"{tgt_disp:,.0f}{unit}"
        else:
            curr_str = f"{curr_disp:.2f}{unit}"
            tgt_str = f"{tgt_disp:.2f}{unit}"
        lines.append(f"현재 {curr_str} → 목표 {tgt_str}.")

    return " ".join(lines)


def narrate_all(data: dict) -> str:
    """whatif 결과 전체 → 문서 형식 출력."""
    target = data.get("target", "unknown")
    dong = data.get("dong", "")
    goal_pct = data.get("goal_pct", 15.0)
    current_y = data.get("current_y")
    target_y = data.get("target_y")
    scenarios = data.get("scenarios") or {}

    # scenarios가 list 형식인 경우 dict로 변환 (하위 호환)
    if isinstance(scenarios, list):
        scenarios = {s.get("label", s.get("scenario", f"시나리오{i}")): s
                     for i, s in enumerate(scenarios)}

    meta = TARGET_META.get(target, {"label": target, "goal_verb": "개선"})

    lines = [
        f"=== {dong} | {meta['label']} 역방향 처방 ({goal_pct:.0f}% 목표) ===",
        "",
    ]

    if not scenarios:
        lines.append("시나리오 데이터가 없습니다.")
        return "\n".join(lines)

    for sc_name, sc in scenarios.items():
        text = narrate_scenario(sc_name, sc, target, goal_pct, current_y, target_y)
        lines.append(text)
        lines.append("")

    return "\n".join(lines).rstrip()


def _suffix_from_target(target: str) -> str:
    return {"tx_volume": "tx", "visitors_total": "vis",
            "tx_per_visitor": "tpv", "tx_delta_6m": "tdelta"}.get(target, target)


def main():
    parser = argparse.ArgumentParser(description="Reverse What-If 시나리오 → 한국어 처방문")
    parser.add_argument(
        "--result", required=True,
        help="whatif 결과 JSON 파일 (whatif_result_tx.json 또는 whatif_scenarios_tx.json 등)"
    )
    parser.add_argument(
        "--out", default=None,
        help="출력 텍스트 파일 (기본: narration_<suffix>.txt)"
    )
    args = parser.parse_args()

    result_path = Path(args.result)
    if not result_path.is_absolute():
        result_path = ROOT / result_path
    if not result_path.exists():
        print(f"[ERROR] 파일 없음: {result_path}", file=sys.stderr)
        sys.exit(1)

    data = json.loads(result_path.read_text())

    # whatif_result.json 형식: 최상위에 scenarios 키
    # whatif_scenarios_tx.json 형식: 동일 (scenarios 키)
    target = data.get("target", "tx_volume")

    narration = narrate_all(data)
    print(narration)

    # 출력 파일 저장
    if args.out:
        out_path = ROOT / args.out
    else:
        suffix = _suffix_from_target(target)
        out_path = ROOT / f"narration_{suffix}.txt"

    out_path.write_text(narration, encoding="utf-8")
    print(f"\n[narrate] 저장: {out_path.name}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
