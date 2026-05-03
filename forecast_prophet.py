#!/usr/bin/env python3
"""
[C-4] Prophet 시계열 예측 — 130 동 × 5 핵심 레이어 → 12개월 forecast

입력:  simula_data_real.json (130 동 × 40 레이어 × 60 개월)
출력:  forecasts.json (130 × 5 layer × 12 month × {p10, p50, p90})
시간:  130 × 5 = 650 fit, 약 2~5분

사용법:
  python3 forecast_prophet.py
  python3 forecast_prophet.py --sample 6  (개발용 — 6개 동만)

압축 로드맵 v2 Tier 2 — 무료 baseline
TimeGPT는 Prophet 정확도 부족 시에만 도입
"""
import json
import sys
import os
import time
import warnings
from pathlib import Path
from datetime import datetime
from collections import defaultdict
import argparse

warnings.filterwarnings('ignore')

# matplotlib을 import 단계에서 차단 (locale 한국어 인코딩 충돌 회피)
# Prophet은 forecaster.py에서 자동으로 prophet.plot을 import하지만 plot 안 쓰면 불필요
os.environ['MPLBACKEND'] = 'Agg'
sys.modules.setdefault('matplotlib', type(sys)('matplotlib'))
sys.modules.setdefault('matplotlib.pyplot', type(sys)('matplotlib.pyplot'))

BASE = Path(__file__).parent
SRC = BASE / 'simula_data_real.json'
OUT = BASE / 'forecasts.json'

# ─────────────────────────────────────────────
# 의존성 체크
# ─────────────────────────────────────────────
try:
    import pandas as pd
    from prophet import Prophet
    import logging
    logging.getLogger('prophet').setLevel(logging.WARNING)
    logging.getLogger('cmdstanpy').setLevel(logging.WARNING)
except ImportError as e:
    print(f'❌ 의존성 누락: {e}')
    print('   .venv/bin/pip install prophet pandas')
    sys.exit(1)

# ─────────────────────────────────────────────
# 핵심 5개 레이어 (시그니처 시각화 대상)
# ─────────────────────────────────────────────
CORE_LAYERS = [
    'visitors_total',   # 유동인구
    'land_price',       # 공시지가
    'biz_count',        # 소상공인 수
    'biz_cafe',         # 카페
    'tx_volume',        # 거래량
]

HORIZON = 12  # 12개월 예측

# ─────────────────────────────────────────────
# Prophet fit + forecast (단일 시계열)
# ─────────────────────────────────────────────
def fit_and_forecast(values, months, horizon=HORIZON):
    """
    values: 60개월 값 list
    months: ['2020-01', '2020-02', ...] list
    return: dict { ds: [...], p10/p50/p90: [...], history_p50: [...] }
    """
    df = pd.DataFrame({
        'ds': pd.to_datetime([m + '-01' for m in months]),
        'y': values,
    })
    model = Prophet(
        yearly_seasonality=True,
        weekly_seasonality=False,
        daily_seasonality=False,
        interval_width=0.8,    # 80% CI = p10~p90
        seasonality_mode='multiplicative',
    )
    model.fit(df)
    future = model.make_future_dataframe(periods=horizon, freq='MS')
    fcst = model.predict(future)

    last_n = len(values) + horizon
    last_horizon = fcst.tail(horizon)
    history = fcst.head(last_n - horizon)

    return {
        'history_ds': [d.strftime('%Y-%m') for d in history['ds']],
        'history_p50': [round(float(v), 2) for v in history['yhat']],
        'horizon_ds': [d.strftime('%Y-%m') for d in last_horizon['ds']],
        'horizon_p10': [round(float(v), 2) for v in last_horizon['yhat_lower']],
        'horizon_p50': [round(float(v), 2) for v in last_horizon['yhat']],
        'horizon_p90': [round(float(v), 2) for v in last_horizon['yhat_upper']],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sample', type=int, default=None, help='개발용: N개 동만 처리')
    args = parser.parse_args()

    print(f'📡 Prophet 시계열 예측 시작')
    print(f'   입력: {SRC}')
    if not SRC.exists():
        print(f'❌ {SRC} 없음 — extract_polygons.py 먼저 실행')
        return

    data = json.loads(SRC.read_text(encoding='utf-8'))
    months = data['meta']['months']
    dongs = data['dongs']
    if args.sample:
        dongs = dongs[:args.sample]
    print(f'   대상: {len(dongs)} 동 × {len(CORE_LAYERS)} 레이어 = {len(dongs) * len(CORE_LAYERS)} 시계열')
    print(f'   horizon: {HORIZON}개월')
    print()

    forecasts = {}  # { dong_code: { layer: forecast } }
    fail_count = 0
    start = time.time()

    for i, d in enumerate(dongs):
        code = d['code']
        forecasts[code] = {}
        for layer in CORE_LAYERS:
            try:
                values = d['layers'][layer]
                result = fit_and_forecast(values, months)
                forecasts[code][layer] = {
                    # 메모리 절약 — history_ds는 meta.months와 동일하므로 생략 가능
                    'horizon_ds': result['horizon_ds'],
                    'horizon_p10': result['horizon_p10'],
                    'horizon_p50': result['horizon_p50'],
                    'horizon_p90': result['horizon_p90'],
                }
            except Exception as e:
                fail_count += 1

        # 진행률
        elapsed = time.time() - start
        rate = (i + 1) / elapsed if elapsed > 0 else 0
        eta = (len(dongs) - i - 1) / rate if rate > 0 else 0
        sys.stdout.write(
            f'\r  [{i+1:3d}/{len(dongs)}] {d["name"][:20]:20s}  '
            f'{rate:.1f} 동/초  ETA {eta:.0f}s  실패 {fail_count}'
        )
        sys.stdout.flush()

    print()
    print(f'\n✅ 예측 완료 ({time.time() - start:.1f}s)')

    # 출력
    output = {
        'meta': {
            'generated_at': datetime.now().isoformat(),
            'model': 'Prophet (Meta)',
            'horizon_months': HORIZON,
            'layers': CORE_LAYERS,
            'dong_count': len(forecasts),
            'tier': 'Tier 2 baseline (압축 로드맵 v2)',
            'failures': fail_count,
        },
        'forecasts': forecasts,
    }

    OUT.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    size_kb = OUT.stat().st_size / 1024
    print(f'💾 저장: {OUT} ({size_kb:.0f} KB)')

    # 샘플 출력
    if forecasts:
        first_code = list(forecasts.keys())[0]
        first_layer = CORE_LAYERS[0]
        sample = forecasts[first_code][first_layer]
        print(f'\n=== 샘플 (코드 {first_code}, 레이어 {first_layer}) ===')
        print(f'  horizon ds : {sample["horizon_ds"][:3]}...')
        print(f'  horizon p10: {sample["horizon_p10"][:3]}...')
        print(f'  horizon p50: {sample["horizon_p50"][:3]}...')
        print(f'  horizon p90: {sample["horizon_p90"][:3]}...')


if __name__ == '__main__':
    main()
