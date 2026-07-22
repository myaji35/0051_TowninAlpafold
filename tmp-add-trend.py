import json

p = '.claude/issue-db/registry.json'
r = json.load(open(p))
new_id = 'FIX_TREE_TREND_MISSING-001'
if not any(i['id'] == new_id for i in r['issues']):
    r['issues'].append({
        'id': new_id,
        'type': 'FIX_BUG',
        'priority': 'P1',
        'status': 'IN_PROGRESS',
        'title': '[분류경로] _추세/인과 결측이 val=0(중립)으로 위장되어 좌측 고정 분기 — "실제 트리 결과"로 표시',
        'payload': {
            'source_issue': 'ISS-253',
            'files': ['app.js'],
            'scope_dir': '.',
            'evidence': 'app.js:1566-1575 (_추세: mean<=0 또는 last12<2면 val=0 잔류) / 1555-1559 (인과_lag평균: CAUSAL 미로드면 val=0 잔류) / 1578 (val<=threshold면 좌측)',
            'risk': 'MAJOR',
            'why': ('FIX_TREE_FEATURE_UNMAPPED-001과 동일 부류의 결함. 데이터 결측이 "추세 0(횡보)"이라는 '
                    '실제 값으로 위장되어 좌측 고정 분기를 만들고, 그 경로가 UI에 "실제 학습 트리 통과 결과"로 '
                    '고지된다(app.js:5246). 근거 신뢰성을 깨뜨린다.'),
            'ac': [
                'AC-1: _추세 계산 불가(mean<=0 또는 표본<2) 시 val=0으로 분기하지 않는다',
                'AC-2: 인과_lag평균에서 CAUSAL 데이터 부재 시 val=0으로 분기하지 않는다',
                'AC-3: 결측 시 경고를 남기고 분기 경로를 생성하지 않는다',
                'AC-4: 정상 데이터의 추세 값이 실제로 0인 경우는 정상 분기한다 (결측과 구분)',
                'AC-5: verify_recommendation_trace.mjs 5/5 + verify_tree_feature_unmapped.mjs 4/4 유지',
            ],
        },
        'result': None,
    })
    json.dump(r, open(p, 'w'), ensure_ascii=False, indent=2)
    print(new_id, '-> created IN_PROGRESS')
else:
    print(new_id, 'exists')
