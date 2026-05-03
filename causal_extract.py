#!/usr/bin/env python3
"""
[C-5] 정량 인과 추출 — Pearson 상관계수 + Granger 인과성 검정

목적: LlamaIndex Property Graph 대신 SQL/통계로 인과 사슬 추출
출력: causal.json
  - dong-level: 동 내부 5종 레이어 간 인과 (성수1가1동의 카페 → 유동?)
  - cross-dong: 동 간 영향 (성수1가1 카페 → 인접동 카페?)

압축 로드맵 v2 Tier 2 — 무료 baseline (LlamaIndex Phase 4 연기)

사용법:
  python3 causal_extract.py
"""
import json, sys, os, time, warnings
from pathlib import Path
from datetime import datetime
import argparse

warnings.filterwarnings('ignore')
os.environ['MPLBACKEND'] = 'Agg'

BASE = Path(__file__).parent
SRC = BASE / 'simula_data_real.json'
OUT = BASE / 'causal.json'

# 의존성
try:
    import numpy as np
    import pandas as pd
    from scipy.stats import pearsonr
    from statsmodels.tsa.stattools import grangercausalitytests
except ImportError as e:
    print(f'❌ 의존성 누락: {e}')
    print('   .venv/bin/pip install statsmodels scipy pandas numpy')
    sys.exit(1)

# ─────────────────────────────────────────────
# 핵심 5개 레이어 (Prophet과 동일)
# ─────────────────────────────────────────────
CORE_LAYERS = [
    'visitors_total',   # 유동인구
    'land_price',       # 공시지가
    'biz_count',        # 소상공인 수
    'biz_cafe',         # 카페
    'tx_volume',        # 거래량
]

LAYER_LABEL = {
    'visitors_total': '유동',
    'land_price': '지가',
    'biz_count': '소상공',
    'biz_cafe': '카페',
    'tx_volume': '거래',
}

# Pearson 임계치 (의미 있는 상관)
PEARSON_THRESHOLD = 0.5
# Granger p-value 임계치
GRANGER_PVAL = 0.05
# Granger 시차 (월 단위, 1~6 검토)
MAX_LAG = 6


def pearson_layers(layers_dict):
    """단일 동 내부 5종 레이어 간 Pearson 상관"""
    series_map = {l: np.array(layers_dict[l], dtype=float) for l in CORE_LAYERS}
    n = len(CORE_LAYERS)
    correlations = []
    for i, a in enumerate(CORE_LAYERS):
        for j, b in enumerate(CORE_LAYERS):
            if i >= j: continue
            r, p = pearsonr(series_map[a], series_map[b])
            if abs(r) >= PEARSON_THRESHOLD and p < 0.05:
                correlations.append({
                    'a': a, 'b': b,
                    'r': round(float(r), 3),
                    'p': round(float(p), 4),
                })
    return correlations


def granger_layers(layers_dict):
    """단일 동 내부 5종 레이어 간 Granger 인과성
       (a 시차 → b 예측 향상이면 a -> b)"""
    series_map = {l: np.array(layers_dict[l], dtype=float) for l in CORE_LAYERS}
    causations = []
    for cause in CORE_LAYERS:
        for effect in CORE_LAYERS:
            if cause == effect: continue
            try:
                # statsmodels는 [effect, cause] 순서로 받음 (effect <- cause 검정)
                df = pd.DataFrame({'effect': series_map[effect], 'cause': series_map[cause]})
                res = grangercausalitytests(df[['effect', 'cause']], maxlag=MAX_LAG, verbose=False)
                # 가장 유의한 시차 찾기
                best_lag = None; best_p = 1.0
                for lag in range(1, MAX_LAG + 1):
                    pval = res[lag][0]['ssr_ftest'][1]
                    if pval < best_p:
                        best_p = pval; best_lag = lag
                if best_p < GRANGER_PVAL and best_lag:
                    causations.append({
                        'cause': cause, 'effect': effect,
                        'lag': best_lag,
                        'p': round(float(best_p), 4),
                    })
            except Exception:
                pass
    return causations


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sample', type=int, default=None, help='개발용: N개 동만 처리')
    args = parser.parse_args()

    print(f'📡 [C-5] 정량 인과 추출 시작')
    print(f'   입력: {SRC}')
    if not SRC.exists():
        print(f'❌ {SRC} 없음 — extract_polygons.py 먼저 실행')
        return

    data = json.loads(SRC.read_text(encoding='utf-8'))
    dongs = data['dongs']
    if args.sample:
        dongs = dongs[:args.sample]
    print(f'   대상: {len(dongs)} 동 × {len(CORE_LAYERS)} 레이어')
    print(f'   Pearson |r| ≥ {PEARSON_THRESHOLD}, Granger p < {GRANGER_PVAL}, max_lag = {MAX_LAG}')
    print()

    results = {}
    start = time.time()
    pearson_total = 0
    granger_total = 0

    for i, d in enumerate(dongs):
        code = d['code']
        try:
            pcorr = pearson_layers(d['layers'])
            gcaus = granger_layers(d['layers'])
            results[code] = {
                'name': d['name'],
                'pearson': pcorr,
                'granger': gcaus,
            }
            pearson_total += len(pcorr)
            granger_total += len(gcaus)
        except Exception as e:
            results[code] = {'name': d['name'], 'error': str(e)[:120]}

        elapsed = time.time() - start
        rate = (i + 1) / elapsed if elapsed > 0 else 0
        eta = (len(dongs) - i - 1) / rate if rate > 0 else 0
        sys.stdout.write(
            f'\r  [{i+1:3d}/{len(dongs)}] {d["name"][:18]:18s}  '
            f'p={pearson_total:4d} g={granger_total:4d}  '
            f'{rate:.1f} 동/초  ETA {eta:.0f}s'
        )
        sys.stdout.flush()

    print()
    print(f'\n✅ 추출 완료 ({time.time() - start:.1f}s)')
    print(f'   Pearson 상관 (|r|≥{PEARSON_THRESHOLD}): 총 {pearson_total} 쌍')
    print(f'   Granger 인과 (p<{GRANGER_PVAL}): 총 {granger_total} 트리플렛')

    # ─────────────────────────────────────────────
    # 전국 집계 인과 (130 동에서 가장 자주 등장한 인과 패턴 Top N)
    # ─────────────────────────────────────────────
    from collections import Counter
    causation_freq = Counter()
    for r in results.values():
        for g in r.get('granger', []):
            key = (g['cause'], g['effect'], g['lag'])
            causation_freq[key] += 1

    top_causations = [
        {
            'cause': k[0], 'effect': k[1], 'lag': k[2],
            'support_count': v,
            'support_rate': round(v / len(results), 3),
        }
        for k, v in causation_freq.most_common(20)
    ]

    output = {
        'meta': {
            'generated_at': datetime.now().isoformat(),
            'method': 'Pearson + Granger (statsmodels)',
            'tier': 'Tier 2 — LlamaIndex Phase 4 대체',
            'pearson_threshold': PEARSON_THRESHOLD,
            'granger_pval': GRANGER_PVAL,
            'max_lag': MAX_LAG,
            'layers': CORE_LAYERS,
            'layer_label': LAYER_LABEL,
            'dong_count': len(results),
            'pearson_total': pearson_total,
            'granger_total': granger_total,
        },
        'dongs': results,
        'top_causations': top_causations,
    }

    OUT.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    size_kb = OUT.stat().st_size / 1024
    print(f'💾 저장: {OUT} ({size_kb:.0f} KB)')

    # 샘플 출력
    print(f'\n=== 전국 Top 5 인과 패턴 ===')
    for c in top_causations[:5]:
        print(f'  {LAYER_LABEL[c["cause"]]:6s} → {LAYER_LABEL[c["effect"]]:6s}  '
              f'(lag {c["lag"]}mo, {c["support_count"]}개 동에서 발견 = {c["support_rate"]*100:.0f}%)')

    if results:
        first_code = list(results.keys())[0]
        first = results[first_code]
        print(f'\n=== 샘플: {first["name"]} ({first_code}) ===')
        print(f'  Pearson 상관 {len(first.get("pearson", []))}쌍')
        for p in first.get('pearson', [])[:3]:
            print(f'    {LAYER_LABEL[p["a"]]} ↔ {LAYER_LABEL[p["b"]]}  r={p["r"]}  p={p["p"]}')
        print(f'  Granger 인과 {len(first.get("granger", []))}쌍')
        for g in first.get('granger', [])[:3]:
            print(f'    {LAYER_LABEL[g["cause"]]} → {LAYER_LABEL[g["effect"]]}  lag={g["lag"]}mo  p={g["p"]}')


if __name__ == '__main__':
    main()
