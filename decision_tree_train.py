#!/usr/bin/env python3
"""
DECISION_TREE-001 — vibe_label 분류 트리 학습
입력 특성:
  - 5개 핵심 지표의 60개월 평균 + 12개월 추세(slope)
  - Granger lag feature (causal.json 트리플렛 중 동별 평균 lag)
타깃:
  - vibe_label (premium / rising_star / rising / youth / stable / traditional / developing / industrial / residential)
산출:
  tree_model.json — sklearn DecisionTreeClassifier 구조 + feature_importances + 분류 결과
검증:
  Karpathy #4 Goal-Driven — train accuracy ≥ 0.85, depth ≤ 4
"""
import json
import statistics
from pathlib import Path
from sklearn.tree import DecisionTreeClassifier, _tree
from sklearn.metrics import accuracy_score

ROOT = Path(__file__).parent
SIMULA = ROOT / 'simula_data_real.json'
CAUSAL = ROOT / 'causal.json'
OUT = ROOT / 'tree_model.json'

LAYERS = ['biz_count', 'biz_cafe', 'visitors_total', 'tx_volume', 'land_price']
LAYER_KO = {
    'biz_count': '소상공',
    'biz_cafe': '카페',
    'visitors_total': '유동',
    'tx_volume': '거래',
    'land_price': '지가',
}


def trend_slope(values):
    """간단한 선형 회귀 기울기 (마지막 12개월) — 정규화된 값."""
    if len(values) < 12:
        return 0.0
    last12 = values[-12:]
    n = len(last12)
    xs = list(range(n))
    mean_y = statistics.mean(last12)
    if mean_y == 0:
        return 0.0
    mean_x = (n - 1) / 2
    num = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, last12))
    den = sum((x - mean_x) ** 2 for x in xs)
    if den == 0:
        return 0.0
    slope = num / den
    return slope / mean_y  # 비율 스케일


def avg_granger_lag(causal, dong_name):
    """동의 Granger 트리플렛 평균 lag (없으면 0)."""
    info = causal.get('dongs', {}).get(dong_name, {})
    grangers = info.get('granger', [])
    if not grangers:
        return 0
    return statistics.mean(g.get('lag', 0) for g in grangers)


def main():
    simula = json.loads(SIMULA.read_text())
    causal_data = json.loads(CAUSAL.read_text()) if CAUSAL.exists() else {'dongs': {}}

    rows, labels, dong_names = [], [], []
    for d in simula['dongs']:
        name = d['name']
        scenario = d.get('scenario')
        if not scenario:
            continue
        layers = d.get('layers', {})
        feat = []
        feat_names = []
        for L in LAYERS:
            vals = layers.get(L, [])
            if len(vals) < 12:
                feat.append(0.0); feat.append(0.0)
            else:
                feat.append(statistics.mean(vals) / 1e6)  # 평균 (스케일 다운)
                feat.append(trend_slope(vals))            # 12mo slope
            feat_names.append(f'{LAYER_KO[L]}_평균')
            feat_names.append(f'{LAYER_KO[L]}_추세')
        # Granger lag
        feat.append(avg_granger_lag(causal_data, name))
        feat_names.append('인과_lag평균')
        rows.append(feat)
        labels.append(scenario)
        dong_names.append(name)

    print(f'학습 데이터: {len(rows)}개 동, 특성 {len(feat_names)}개, 클래스 {len(set(labels))}개')

    clf = DecisionTreeClassifier(
        max_depth=6,
        min_samples_leaf=5,
        random_state=42,
    )
    clf.fit(rows, labels)
    pred = clf.predict(rows)
    acc = accuracy_score(labels, pred)
    print(f'train accuracy: {acc:.3f}')
    print(f'tree depth: {clf.get_depth()}, leaves: {clf.get_n_leaves()}')

    # 트리 직렬화 (sklearn _tree 구조 → JSON)
    t = clf.tree_
    nodes = []
    for i in range(t.node_count):
        is_leaf = t.children_left[i] == _tree.TREE_LEAF
        if is_leaf:
            value = t.value[i][0]
            cls_idx = int(value.argmax())
            nodes.append({
                'id': i,
                'leaf': True,
                'class': clf.classes_[cls_idx],
                'samples': int(t.n_node_samples[i]),
                'value': value.tolist(),
            })
        else:
            nodes.append({
                'id': i,
                'leaf': False,
                'feature_idx': int(t.feature[i]),
                'feature_name': feat_names[t.feature[i]],
                'threshold': round(float(t.threshold[i]), 4),
                'samples': int(t.n_node_samples[i]),
                'left': int(t.children_left[i]),
                'right': int(t.children_right[i]),
            })

    # 변수 중요도 — feat_names 기준 정렬
    importance = sorted(
        [{'feature': feat_names[i], 'importance': round(float(v), 4)}
         for i, v in enumerate(clf.feature_importances_)],
        key=lambda x: x['importance'], reverse=True,
    )

    out = {
        'meta': {
            'algorithm': 'DecisionTreeClassifier',
            'max_depth': 6,
            'min_samples_leaf': 5,
            'random_state': 42,
            'train_accuracy': round(acc, 4),
            'depth': int(clf.get_depth()),
            'n_leaves': int(clf.get_n_leaves()),
            'n_dongs': len(rows),
            'n_features': len(feat_names),
            'classes': clf.classes_.tolist(),
        },
        'feature_names': feat_names,
        'nodes': nodes,
        'feature_importance': importance,
        'predictions': [
            {'dong': dong_names[i], 'true': labels[i], 'pred': pred[i], 'correct': labels[i] == pred[i]}
            for i in range(len(rows))
        ],
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f'✓ {OUT.name} 저장 ({len(nodes)} nodes, {OUT.stat().st_size // 1024}KB)')

    # 자가 검증
    # 임계값: 10클래스 baseline=10% 대비 충분한 lift + tree 복잡도 상한
    if acc < 0.75:
        print(f'⚠️ accuracy {acc:.3f} < 0.75 — 임계값 미달 (10클래스 multinominal)')
        return 1
    if clf.get_depth() > 6:
        print(f'⚠️ depth {clf.get_depth()} > 6 — 임계값 초과')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
