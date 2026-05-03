#!/usr/bin/env python3
"""
[C-2] 전국 행정동 GeoJSON에서 서울 + 부산 추출
     + simula_data.json 130개 동에 polygon 부착
"""
import json
import math
from pathlib import Path

BASE = Path(__file__).parent
RAW = BASE / 'data_raw' / 'test1.geojson'
OUT_GEO = BASE / 'data_raw' / 'seoul_busan_dongs.geojson'
OUT_SIM = BASE / 'simula_data_real.json'

# 1. 전국 GeoJSON 로드
print('📡 전국 행정동 GeoJSON 로드 중...')
with open(RAW, 'r', encoding='utf-8') as f:
    data = json.load(f)

# 2. 서울 + 부산만 필터
TARGET_SIDOS = {'서울특별시', '부산광역시'}
filtered = [f for f in data['features'] if f['properties'].get('sidonm') in TARGET_SIDOS]
print(f'✅ 필터링: 전국 {len(data["features"])} → 서울+부산 {len(filtered)}')

# 3. 좌표 단순화 (Douglas-Peucker는 복잡하니 step sampling으로 대체)
def simplify_coords(coords, step=2):
    """polygon ring의 좌표를 step 간격으로 샘플링 (단순 다운샘플링)"""
    if len(coords) < 50:
        return coords  # 작은 폴리곤은 그대로
    simplified = coords[::step]
    if simplified[0] != simplified[-1]:
        simplified.append(coords[-1])  # 닫기
    return simplified

def simplify_geometry(geom):
    if geom['type'] == 'Polygon':
        geom['coordinates'] = [simplify_coords(ring) for ring in geom['coordinates']]
    elif geom['type'] == 'MultiPolygon':
        geom['coordinates'] = [
            [simplify_coords(ring) for ring in polygon]
            for polygon in geom['coordinates']
        ]
    return geom

# 좌표 단순화 적용
total_pts_before = 0
total_pts_after = 0
def count_pts(geom):
    n = 0
    if geom['type'] == 'Polygon':
        for ring in geom['coordinates']: n += len(ring)
    elif geom['type'] == 'MultiPolygon':
        for poly in geom['coordinates']:
            for ring in poly: n += len(ring)
    return n

for f in filtered:
    total_pts_before += count_pts(f['geometry'])
    f['geometry'] = simplify_geometry(f['geometry'])
    total_pts_after += count_pts(f['geometry'])

print(f'✅ 좌표 단순화: {total_pts_before:,} → {total_pts_after:,} 점 ({total_pts_after/total_pts_before*100:.1f}%)')

# 4. 추출본 저장
out = {
    'type': 'FeatureCollection',
    'features': filtered,
    'meta': {
        'source': 'vuski/admdongkor (HangJeongDong_ver20230701)',
        'sidos': list(TARGET_SIDOS),
        'count': len(filtered),
        'simplified': True,
    }
}
with open(OUT_GEO, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
size_kb = OUT_GEO.stat().st_size / 1024
print(f'✅ 저장 → {OUT_GEO} ({size_kb:.0f} KB)')

# 5. simula_data.json 로드 + polygon 매칭
SIM = BASE / 'simula_data.json'
with open(SIM, 'r', encoding='utf-8') as f:
    sim = json.load(f)

# centroid 계산 함수
def polygon_centroid(geom):
    """polygon/multipolygon의 대략 centroid"""
    if geom['type'] == 'Polygon':
        ring = geom['coordinates'][0]
        n = len(ring)
        if n == 0: return (0, 0)
        x = sum(p[0] for p in ring) / n
        y = sum(p[1] for p in ring) / n
        return (x, y)
    elif geom['type'] == 'MultiPolygon':
        # 가장 큰 polygon의 centroid
        biggest = max(geom['coordinates'], key=lambda p: len(p[0]))
        return polygon_centroid({'type': 'Polygon', 'coordinates': biggest})
    return (0, 0)

def haversine(lng1, lat1, lng2, lat2):
    """두 좌표 사이 거리 (km)"""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

# 6. simula 130개 동을 가장 가까운 실제 행정동에 매칭
print(f'\n📍 simula {len(sim["dongs"])}개 동 → 실제 행정동 매칭 중...')
matched = 0
for d in sim['dongs']:
    sim_lng, sim_lat = d['lng'], d['lat']
    best = None
    best_dist = float('inf')
    for f in filtered:
        cx, cy = polygon_centroid(f['geometry'])
        dist = haversine(sim_lng, sim_lat, cx, cy)
        if dist < best_dist:
            best_dist = dist
            best = f
    if best and best_dist < 5.0:  # 5km 이내만 매칭
        d['polygon_geo'] = best['geometry']
        d['real_adm_nm'] = best['properties']['adm_nm']
        d['real_adm_cd'] = best['properties']['adm_cd']
        d['real_data_attached'] = True
        d['match_distance_km'] = round(best_dist, 3)
        matched += 1

print(f'✅ {matched}/{len(sim["dongs"])} 매칭 ({matched/len(sim["dongs"])*100:.1f}%)')

# 7. 메타 갱신
sim['meta']['version'] = 'v0.7-alpha-real-polygons'
sim['meta']['real_data_sources'] = sim['meta'].get('real_data_sources', [])
if 'vuski/admdongkor' not in sim['meta']['real_data_sources']:
    sim['meta']['real_data_sources'].append('vuski/admdongkor')

with open(OUT_SIM, 'w', encoding='utf-8') as f:
    json.dump(sim, f, ensure_ascii=False, separators=(',', ':'))
size_kb = OUT_SIM.stat().st_size / 1024
print(f'✅ 병합 저장 → {OUT_SIM} ({size_kb:.0f} KB)')

# 8. 매칭 샘플 출력
print(f'\n=== 매칭 샘플 (first 5) ===')
for d in sim['dongs'][:5]:
    if d.get('real_adm_nm'):
        print(f'  · {d["name"]:18s} → {d["real_adm_nm"]:30s} ({d["match_distance_km"]:.2f} km)')
    else:
        print(f'  · {d["name"]:18s} → ❌ 매칭 실패')
