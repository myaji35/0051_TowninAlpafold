#!/usr/bin/env python3
"""
TowninGraph 부분 통합 ETL — Tier 1 카카오 + SGIS

목적: simula_data.json의 가상 좌표를 실제 SGIS 행정경계 + 카카오 POI로 교체
출력:
  - data_raw/sgis_seoul_dongs.geojson  (서울 행정동 폴리곤)
  - data_raw/kakao_pois_sample.json    (카페·음식점 POI 샘플)
  - simula_data_real.json              (시뮬 + 실데이터 머지본)

사용법:
  1. .env 파일에 카카오/SGIS 키 작성
  2. python3 etl_real_data.py --step sgis      # SGIS 폴리곤만
  3. python3 etl_real_data.py --step kakao     # 카카오 POI만
  4. python3 etl_real_data.py --step merge     # simula_data와 병합
  5. python3 etl_real_data.py                  # 전체 (1~3 순차)
"""
import os
import sys
import json
import time
import argparse
from pathlib import Path
from urllib.parse import quote

# ─────────────────────────────────────────────
# 환경 설정
# ─────────────────────────────────────────────
BASE_DIR = Path(__file__).parent
DATA_RAW = BASE_DIR / 'data_raw'
DATA_RAW.mkdir(exist_ok=True)

# .env 로딩
ENV = {}
env_file = BASE_DIR / '.env'
if env_file.exists():
    for line in env_file.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            ENV[k.strip()] = v.strip()

KAKAO_KEY = ENV.get('KAKAO_REST_API_KEY', '')
SGIS_KEY = ENV.get('SGIS_CONSUMER_KEY', '')
SGIS_SECRET = ENV.get('SGIS_CONSUMER_SECRET', '')


def check_env(need_kakao=False, need_sgis=False):
    missing = []
    if need_kakao and not KAKAO_KEY:
        missing.append('KAKAO_REST_API_KEY')
    if need_sgis and (not SGIS_KEY or not SGIS_SECRET):
        missing.append('SGIS_CONSUMER_KEY/SECRET')
    if missing:
        print(f'❌ .env에 다음 키가 비어있음: {", ".join(missing)}')
        print('   docs/API_KEYS_GUIDE.md 참조')
        sys.exit(1)


# ─────────────────────────────────────────────
# 의존성 체크
# ─────────────────────────────────────────────
try:
    import requests
except ImportError:
    print('❌ requests 라이브러리 필요: pip install requests')
    sys.exit(1)


# ═════════════════════════════════════════════
# SGIS Plus API
# ═════════════════════════════════════════════
SGIS_BASE = 'https://sgisapi.kostat.go.kr/OpenAPI3'
_sgis_token = None


def sgis_authenticate():
    """SGIS OAuth — accessToken 발급 (1시간 유효)"""
    global _sgis_token
    if _sgis_token:
        return _sgis_token
    url = f'{SGIS_BASE}/auth/authentication.json'
    params = {'consumer_key': SGIS_KEY, 'consumer_secret': SGIS_SECRET}
    resp = requests.get(url, params=params, timeout=10)
    data = resp.json()
    if data.get('errCd') != 0:
        raise RuntimeError(f'SGIS 인증 실패: {data}')
    _sgis_token = data['result']['accessToken']
    print(f'✅ SGIS 인증 성공 (token: {_sgis_token[:20]}...)')
    return _sgis_token


# 서울 25개 자치구 행정코드 (앞 2자리 11)
SEOUL_GU_CODES = [
    '11110', '11140', '11170', '11200', '11215', '11230', '11260', '11290', '11305',
    '11320', '11350', '11380', '11410', '11440', '11470', '11500', '11530', '11545',
    '11560', '11590', '11620', '11650', '11680', '11710', '11740',
]


def sgis_fetch_dong_polygons():
    """서울 25개 구의 행정동 폴리곤을 GeoJSON으로 수집"""
    token = sgis_authenticate()
    output_file = DATA_RAW / 'sgis_seoul_dongs.geojson'

    print(f'📡 SGIS 행정동 폴리곤 수집 시작 (서울 25개 구)')
    features = []

    # API: hadmarea (행정동 경계)
    # year=2024, adm_cd=서울 11* 패턴
    for gu_code in SEOUL_GU_CODES:
        try:
            url = f'{SGIS_BASE}/boundary/hadmarea.geojson'
            params = {
                'accessToken': token,
                'year': '2024',
                'adm_cd': gu_code,  # 시군구 코드 (이 구의 모든 행정동 반환)
                'low_search': '1',  # 하위(행정동) 포함
            }
            resp = requests.get(url, params=params, timeout=15)
            data = resp.json()
            if 'features' in data:
                features.extend(data['features'])
                print(f'  ✓ {gu_code}: {len(data["features"])} 동')
            else:
                print(f'  ⚠️ {gu_code}: features 없음 — {data.get("errMsg", "unknown")}')
            time.sleep(0.3)  # rate limit 보호
        except Exception as e:
            print(f'  ❌ {gu_code}: {e}')

    geojson = {
        'type': 'FeatureCollection',
        'features': features,
        'meta': {
            'source': 'SGIS Plus API · hadmarea',
            'year': '2024',
            'count': len(features),
            'fetched_at': time.strftime('%Y-%m-%d %H:%M:%S'),
        }
    }

    output_file.write_text(json.dumps(geojson, ensure_ascii=False), encoding='utf-8')
    print(f'\n✅ {len(features)}개 행정동 폴리곤 저장 → {output_file}')
    return output_file


def sgis_fetch_population():
    """서울 행정동별 인구통계 (성별·연령) 수집"""
    token = sgis_authenticate()
    output_file = DATA_RAW / 'sgis_seoul_population.json'

    print(f'📡 SGIS 인구통계 수집 시작')
    results = []

    for gu_code in SEOUL_GU_CODES:
        try:
            url = f'{SGIS_BASE}/stats/searchpopulation.json'
            params = {
                'accessToken': token,
                'year': '2023',
                'adm_cd': gu_code,
                'low_search': '1',
            }
            resp = requests.get(url, params=params, timeout=10)
            data = resp.json()
            if data.get('result'):
                results.extend(data['result'])
                print(f'  ✓ {gu_code}: {len(data["result"])} 동')
            time.sleep(0.3)
        except Exception as e:
            print(f'  ❌ {gu_code}: {e}')

    output_file.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'\n✅ {len(results)}개 인구통계 → {output_file}')
    return output_file


# ═════════════════════════════════════════════
# 카카오 로컬 API
# ═════════════════════════════════════════════
KAKAO_BASE = 'https://dapi.kakao.com/v2/local'


def kakao_search_category(category_group, lng, lat, radius=500):
    """카카오 카테고리 검색 — 좌표 기준 반경 내 POI"""
    url = f'{KAKAO_BASE}/search/category.json'
    headers = {'Authorization': f'KakaoAK {KAKAO_KEY}'}
    params = {
        'category_group_code': category_group,  # CE7=카페, FD6=음식점
        'x': lng, 'y': lat, 'radius': radius,
        'size': 15,  # 페이지당 최대
    }
    resp = requests.get(url, headers=headers, params=params, timeout=10)
    data = resp.json()
    return data.get('documents', [])


def kakao_fetch_pois_sample():
    """130개 동 중 샘플 6개에 대해 주변 POI 수집 (테스트)"""
    output_file = DATA_RAW / 'kakao_pois_sample.json'

    # simula_data.json에서 동 좌표 로드
    sim = json.loads((BASE_DIR / 'simula_data.json').read_text(encoding='utf-8'))
    sample_dongs = [d for d in sim['dongs'] if '성수1가1' in d['name']
                    or '강남' in d['name'] or '마포' in d['name']
                    or '부산' in d['name']][:6]

    print(f'📡 카카오 POI 수집 (샘플 {len(sample_dongs)}개 동)')
    results = {}

    for d in sample_dongs:
        cafes = kakao_search_category('CE7', d['lng'], d['lat'])
        time.sleep(0.2)
        restaurants = kakao_search_category('FD6', d['lng'], d['lat'])
        time.sleep(0.2)
        results[d['code']] = {
            'name': d['name'],
            'lng': d['lng'], 'lat': d['lat'],
            'cafes': [{'name': p['place_name'], 'addr': p['road_address_name'],
                       'lng': float(p['x']), 'lat': float(p['y'])} for p in cafes],
            'restaurants': [{'name': p['place_name'], 'addr': p['road_address_name'],
                            'lng': float(p['x']), 'lat': float(p['y'])} for p in restaurants],
        }
        print(f'  ✓ {d["name"]}: 카페 {len(cafes)}, 음식점 {len(restaurants)}')

    output_file.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'\n✅ {output_file}')
    return output_file


# ═════════════════════════════════════════════
# 병합: simula_data.json + 실데이터 → simula_data_real.json
# ═════════════════════════════════════════════
def merge_real_into_simula():
    """SGIS 폴리곤·POI를 simula_data.json에 attach"""
    sim_file = BASE_DIR / 'simula_data.json'
    sgis_file = DATA_RAW / 'sgis_seoul_dongs.geojson'
    poi_file = DATA_RAW / 'kakao_pois_sample.json'
    output_file = BASE_DIR / 'simula_data_real.json'

    sim = json.loads(sim_file.read_text(encoding='utf-8'))

    # 1) SGIS 폴리곤 attach
    if sgis_file.exists():
        geo = json.loads(sgis_file.read_text(encoding='utf-8'))
        # adm_cd → polygon 매핑
        polygon_map = {}
        for f in geo['features']:
            adm_cd = f['properties'].get('adm_cd')
            if adm_cd:
                polygon_map[adm_cd] = f['geometry']
        # simula 130 동 중 매칭되는 것에 polygon 부착
        attached = 0
        for d in sim['dongs']:
            # 코드 앞 5자리(시군구) 매칭으로 폴백
            for adm_cd, geom in polygon_map.items():
                if str(d.get('code', ''))[:5] == adm_cd[:5]:
                    d['polygon_geo'] = geom
                    d['real_data_attached'] = True
                    attached += 1
                    break
        print(f'✅ SGIS 폴리곤 {attached}/{len(sim["dongs"])}개 동에 부착')
    else:
        print(f'⚠️ {sgis_file} 없음 — SGIS step 먼저 실행 필요')

    # 2) 카카오 POI attach
    if poi_file.exists():
        pois = json.loads(poi_file.read_text(encoding='utf-8'))
        attached = 0
        for d in sim['dongs']:
            if d['code'] in pois:
                d['real_pois'] = pois[d['code']]
                attached += 1
        print(f'✅ 카카오 POI {attached}/{len(sim["dongs"])}개 동에 부착')

    # 메타 갱신
    sim['meta']['version'] = 'v0.7-partial-real'
    sim['meta']['real_data_sources'] = []
    if sgis_file.exists(): sim['meta']['real_data_sources'].append('SGIS Plus')
    if poi_file.exists(): sim['meta']['real_data_sources'].append('Kakao Local')

    output_file.write_text(json.dumps(sim, ensure_ascii=False), encoding='utf-8')
    size_kb = output_file.stat().st_size / 1024
    print(f'\n✅ 병합 완료 → {output_file} ({size_kb:.1f} KB)')


# ═════════════════════════════════════════════
# CLI
# ═════════════════════════════════════════════
def main():
    parser = argparse.ArgumentParser(description='TowninGraph 부분 통합 ETL')
    parser.add_argument('--step', choices=['sgis', 'kakao', 'merge', 'all'],
                        default='all', help='실행할 단계')
    args = parser.parse_args()

    if args.step in ('sgis', 'all'):
        check_env(need_sgis=True)
        sgis_fetch_dong_polygons()
        sgis_fetch_population()

    if args.step in ('kakao', 'all'):
        check_env(need_kakao=True)
        kakao_fetch_pois_sample()

    if args.step in ('merge', 'all'):
        merge_real_into_simula()


if __name__ == '__main__':
    main()
