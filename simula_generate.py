#!/usr/bin/env python3
"""
TowninGraph Simula v2 — 서울 25개 구 × 5개 동 = 125개 + 부산 비교 5개 = 130개
60개월(2020-01~2024-12) × 27 레이어
"""
import json, math, random
from datetime import datetime

random.seed(42)

# ─────────────────────────────────────────────
# 서울 25개 구 (실제 좌표)
# ─────────────────────────────────────────────
GU_INFO = [
    # name, code, center_lng, center_lat, vibe
    ("강남구",   "11680", 127.0473, 37.5172, "premium"),
    ("강동구",   "11740", 127.1238, 37.5301, "stable"),
    ("강북구",   "11305", 127.0256, 37.6396, "traditional"),
    ("강서구",   "11500", 126.8495, 37.5509, "developing"),
    ("관악구",   "11620", 126.9514, 37.4784, "youth"),
    ("광진구",   "11215", 127.0823, 37.5384, "rising"),
    ("구로구",   "11530", 126.8874, 37.4954, "industrial"),
    ("금천구",   "11545", 126.8957, 37.4517, "industrial"),
    ("노원구",   "11350", 127.0568, 37.6543, "residential"),
    ("도봉구",   "11320", 127.0470, 37.6688, "residential"),
    ("동대문구", "11230", 127.0398, 37.5744, "traditional"),
    ("동작구",   "11590", 126.9518, 37.5124, "residential"),
    ("마포구",   "11440", 126.9087, 37.5663, "rising"),
    ("서대문구", "11410", 126.9368, 37.5791, "youth"),
    ("서초구",   "11650", 127.0327, 37.4837, "premium"),
    ("성동구",   "11200", 127.0410, 37.5634, "rising_star"),  # ★ 성수
    ("성북구",   "11290", 127.0167, 37.5894, "youth"),
    ("송파구",   "11710", 127.1059, 37.5145, "premium"),
    ("양천구",   "11470", 126.8665, 37.5170, "residential"),
    ("영등포구", "11560", 126.8963, 37.5264, "rising"),
    ("용산구",   "11170", 126.9904, 37.5326, "premium"),
    ("은평구",   "11380", 126.9290, 37.6027, "developing"),
    ("종로구",   "11110", 126.9784, 37.5735, "traditional"),
    ("중구",     "11140", 126.9979, 37.5641, "traditional"),
    ("중랑구",   "11260", 127.0926, 37.6065, "stable"),
]

# 자치구별 대표 5개 동 + 시나리오 매핑
DONG_TEMPLATES = {
    "premium":     ["A1동", "A2동", "A3동", "A4동", "A5동"],
    "rising_star": ["성수1가1동", "성수1가2동", "성수2가1동", "성수2가3동", "송정동"],
    "rising":      ["B1동", "B2동", "B3동", "B4동", "B5동"],
    "youth":       ["C1동", "C2동", "C3동", "C4동", "C5동"],
    "stable":      ["D1동", "D2동", "D3동", "D4동", "D5동"],
    "traditional": ["E1동", "E2동", "E3동", "E4동", "E5동"],
    "developing":  ["F1동", "F2동", "F3동", "F4동", "F5동"],
    "industrial":  ["G1동", "G2동", "G3동", "G4동", "G5동"],
    "residential": ["H1동", "H2동", "H3동", "H4동", "H5동"],
}

# 시나리오별 성장 패턴
SCENARIOS = {
    "premium":     {"price_g": 0.012, "tx_g": 0.008, "visit_g": 0.005, "biz_g": 0.005,  "noise": 0.025, "base_pop": 25000, "base_price": 8500000},
    "rising_star": {"price_g": 0.020, "tx_g": 0.024, "visit_g": 0.028, "biz_g": 0.032,  "noise": 0.045, "base_pop": 19500, "base_price": 4800000},
    "rising":      {"price_g": 0.015, "tx_g": 0.017, "visit_g": 0.018, "biz_g": 0.020,  "noise": 0.040, "base_pop": 22000, "base_price": 4500000},
    "youth":       {"price_g": 0.010, "tx_g": 0.012, "visit_g": 0.020, "biz_g": 0.018,  "noise": 0.045, "base_pop": 21000, "base_price": 3800000},
    "stable":      {"price_g": 0.005, "tx_g": 0.003, "visit_g": 0.004, "biz_g": 0.002,  "noise": 0.025, "base_pop": 28000, "base_price": 4200000},
    "traditional": {"price_g": 0.002, "tx_g": -0.002,"visit_g": -0.001,"biz_g": -0.005, "noise": 0.040, "base_pop": 21500, "base_price": 4000000},
    "developing":  {"price_g": 0.013, "tx_g": 0.014, "visit_g": 0.011, "biz_g": 0.012,  "noise": 0.045, "base_pop": 20000, "base_price": 3500000},
    "industrial":  {"price_g": 0.006, "tx_g": 0.005, "visit_g": -0.002,"biz_g": -0.003, "noise": 0.035, "base_pop": 17500, "base_price": 3200000},
    "residential": {"price_g": 0.007, "tx_g": 0.004, "visit_g": 0.002, "biz_g": 0.003,  "noise": 0.025, "base_pop": 26000, "base_price": 4200000},
    "rising_twin": {"price_g": 0.018, "tx_g": 0.022, "visit_g": 0.024, "biz_g": 0.029,  "noise": 0.048, "base_pop": 19000, "base_price": 3500000},
}

# ─────────────────────────────────────────────
# 시간축
# ─────────────────────────────────────────────
def month_iter():
    cur = datetime(2020, 1, 1)
    last = datetime(2024, 12, 1)
    while cur <= last:
        yield cur.strftime("%Y-%m")
        cur = cur.replace(year=cur.year+1, month=1) if cur.month == 12 else cur.replace(month=cur.month+1)
MONTHS = list(month_iter())
T = len(MONTHS)

SHOCKS = [
    {"month_idx": 3,  "type": "covid_start",  "magnitude": -0.25, "sigma": 4},
    {"month_idx": 18, "type": "covid_easing", "magnitude": +0.10, "sigma": 6},
    {"month_idx": 28, "type": "rate_hike",    "magnitude": -0.08, "sigma": 5},
    {"month_idx": 42, "type": "policy_relax", "magnitude": +0.06, "sigma": 4},
    {"month_idx": 50, "type": "trend_shift",  "magnitude": +0.12, "sigma": 8},
]

def shock_factor(t, sensitivity=1.0):
    return sum(sh["magnitude"] * sensitivity * math.exp(-((t - sh["month_idx"])**2) / (2 * sh["sigma"]**2)) for sh in SHOCKS)

def smooth_walk(n, drift, noise, accel_end=0.3, sensitivity=1.0):
    x, val = [], 1.0
    for t in range(n):
        seasonal = 0.025 * math.sin(2 * math.pi * t / 12)
        sh = shock_factor(t, sensitivity)
        accel = 1.0 + (t / n) * accel_end
        val *= (1 + drift * accel + seasonal + sh + random.gauss(0, noise))
        val = max(val, 0.3)
        x.append(val)
    return x

# ─────────────────────────────────────────────
# 한 동의 27 레이어 + pLDDT 생성
# ─────────────────────────────────────────────
def gen_dong(name, code, lng, lat, scenario, dong_idx_in_gu):
    p = SCENARIOS[scenario]
    # 동마다 미세하게 다른 파라미터
    drift_jitter = random.gauss(0, 0.003)
    base_pop = p["base_pop"] + random.randint(-3000, 3000)
    base_price = p["base_price"] * (1 + random.gauss(0, 0.05))

    price_idx = smooth_walk(T, p["price_g"] + drift_jitter, p["noise"])
    tx_idx    = smooth_walk(T, p["tx_g"] + drift_jitter, p["noise"]*1.4)
    visit_idx = smooth_walk(T, p["visit_g"] + drift_jitter, p["noise"])
    biz_idx   = smooth_walk(T, p["biz_g"] + drift_jitter, p["noise"]*0.8)

    visitor_20s = [v * (1 + (p["visit_g"]+0.005)*i*0.02 + random.gauss(0, 0.03)) for i, v in enumerate(visit_idx)]
    visitor_30s = [v * (1 + p["visit_g"]*i*0.012 + random.gauss(0, 0.03)) for i, v in enumerate(visit_idx)]
    visitor_40s = [v * (1 + p["visit_g"]*0.5*i*0.008 + random.gauss(0, 0.03)) for i, v in enumerate(visit_idx)]
    visitor_50p = [v * (1 - p["visit_g"]*0.3*i*0.008 + random.gauss(0, 0.03)) for i, v in enumerate(visit_idx)]
    cafe        = [b * (1 + p["biz_g"]*1.5*i*0.012 + random.gauss(0, 0.04)) for i, b in enumerate(biz_idx)]
    restaurant  = [b * (1 + p["biz_g"]*0.8*i*0.008 + random.gauss(0, 0.03)) for i, b in enumerate(biz_idx)]
    retail      = [b * (1 + p["biz_g"]*0.3*i*0.005 + random.gauss(0, 0.03)) for i, b in enumerate(biz_idx)]
    service     = [b * (1 + p["biz_g"]*0.6*i*0.008 + random.gauss(0, 0.03)) for i, b in enumerate(biz_idx)]

    # ─ Townin 내부 데이터 4종 (마스터가 진짜 보고싶은 것) ─
    # 파트너 활동: 가입·이탈·활동량
    partner_idx = smooth_walk(T, p["biz_g"]*0.7 + drift_jitter, p["noise"]*0.9)
    partner_signups = [round(max(0, pi * (p["biz_g"]+0.015) * 30), 0) for pi in partner_idx]
    partner_active  = [round(pi * (base_pop * 0.0035), 0) for pi in partner_idx]
    partner_churn   = [round(max(0, (1.0/pi) * (-p["biz_g"]*0.4 + 0.018) * 25), 0) for pi in partner_idx]
    # 소상공인 매출 (Townin 결제 기반)
    sales_idx   = smooth_walk(T, p["tx_g"]*0.6 + drift_jitter, p["noise"]*1.1)
    townin_sales_monthly = [round(s * (base_pop * 12000), 0) for s in sales_idx]
    townin_orders        = [round(s * (base_pop * 0.18), 0) for s in sales_idx]
    townin_aov           = [round(townin_sales_monthly[i] / max(1, townin_orders[i]), 0) for i in range(T)]
    # 유저 행동
    user_idx    = smooth_walk(T, p["visit_g"]*0.8 + drift_jitter, p["noise"])
    townin_dau          = [round(u * (base_pop * 0.22), 0) for u in user_idx]
    townin_searches     = [round(u * (base_pop * 1.6), 0) for u in user_idx]
    townin_conversions  = [round(u * (base_pop * 0.045), 0) for u in user_idx]
    # 광고/프로모션
    ad_intensity = smooth_walk(T, 0.005 + drift_jitter, p["noise"]*1.2, accel_end=0.1)
    townin_ad_impr    = [round(a * (base_pop * 14), 0) for a in ad_intensity]
    townin_ad_clicks  = [round(a * (base_pop * 0.42), 0) for a in ad_intensity]
    townin_ad_spend   = [round(a * 380000, 0) for a in ad_intensity]
    townin_ad_roas    = [round((townin_sales_monthly[i] * 0.08) / max(1, townin_ad_spend[i]) * 100, 1) for i in range(T)]

    layers = {
        "land_price":        [round(pi * base_price, 0) for pi in price_idx],
        "land_price_apt":    [round(pi * base_price * 1.07, 0) for pi in price_idx],
        "land_price_house":  [round(pi * base_price * 0.85, 0) for pi in price_idx],
        "rent_price":        [round(pi * base_price * 0.0055, 0) for pi in price_idx],
        "tx_volume":         [round(tv * 45, 1) for tv in tx_idx],
        "tx_apt_count":      [round(tv * 32, 1) for tv in tx_idx],
        "tx_house_count":    [round(tv * 13, 1) for tv in tx_idx],
        "visitors_total":    [round(v * base_pop * 1.5, 0) for v in visit_idx],
        "visitors_20s":      [round(v * base_pop * 0.30, 0) for v in visitor_20s],
        "visitors_30s":      [round(v * base_pop * 0.35, 0) for v in visitor_30s],
        "visitors_40s":      [round(v * base_pop * 0.25, 0) for v in visitor_40s],
        "visitors_50plus":   [round(v * base_pop * 0.40, 0) for v in visitor_50p],
        "visitors_male":     [round(v * base_pop * 0.70, 0) for v in visit_idx],
        "visitors_female":   [round(v * base_pop * 0.80, 0) for v in visit_idx],
        "visitors_local":    [round(v * base_pop * 0.90, 0) for v in visit_idx],
        "visitors_inflow":   [round(v * base_pop * 0.60, 0) for v in visit_idx],
        "biz_count":         [round(b * (base_pop * 0.025), 0) for b in biz_idx],
        "biz_cafe":          [round(c * (base_pop * 0.008), 0) for c in cafe],
        "biz_restaurant":    [round(r * (base_pop * 0.012), 0) for r in restaurant],
        "biz_retail":        [round(r * (base_pop * 0.015), 0) for r in retail],
        "biz_service":       [round(s * (base_pop * 0.010), 0) for s in service],
        "biz_new":           [round(max(0, bi * (p["biz_g"] + random.gauss(0.02, 0.008)) * 50), 0) for bi in biz_idx],
        "biz_closed":        [round(max(0, bi * (-p["biz_g"]*0.4 + random.gauss(0.015, 0.006)) * 50), 0) for bi in biz_idx],
        "transit_score":     [round(70 + (15 if scenario in ("rising_star","rising","premium") else 0) + random.gauss(0,1), 1) for _ in range(T)],
        "walkability":       [round(65 + (15 if scenario in ("rising_star","traditional","youth") else 0) + random.gauss(0,1), 1) for _ in range(T)],
        "subway_distance_m": [round(450 + random.gauss(0, 30), 0) for _ in range(T)],
        "bus_stop_density":  [round(28 + random.gauss(0, 2), 1) for _ in range(T)],
        # Townin 내부 데이터 (마스터 전용)
        "tw_partner_active":  partner_active,
        "tw_partner_signups": partner_signups,
        "tw_partner_churn":   partner_churn,
        "tw_sales_monthly":   townin_sales_monthly,
        "tw_orders":          townin_orders,
        "tw_aov":              townin_aov,
        "tw_dau":              townin_dau,
        "tw_searches":         townin_searches,
        "tw_conversions":      townin_conversions,
        "tw_ad_impressions":   townin_ad_impr,
        "tw_ad_clicks":        townin_ad_clicks,
        "tw_ad_spend":         townin_ad_spend,
        "tw_ad_roas":          townin_ad_roas,
    }

    plddt = []
    for t in range(T):
        base = 88
        sh = abs(shock_factor(t)) * 90
        plddt.append(round(max(35, min(98, base - sh - random.uniform(0, 4))), 1))

    return {"name": name, "code": code, "lng": lng, "lat": lat,
            "scenario": scenario, "base_population": base_pop, "layers": layers, "plddt": plddt}

# ─────────────────────────────────────────────
# 동 좌표 분산 (구 중심 주변 5개 동 → 약간 흩뿌림)
# ─────────────────────────────────────────────
def jitter_around(lng, lat, idx):
    # 구 중심 주변 약 1.5km 반경에 5개 동 분산
    angle = (idx / 5) * 2 * math.pi + random.uniform(-0.3, 0.3)
    dist = 0.012 + random.uniform(-0.003, 0.003)  # ~1.3km
    return lng + math.cos(angle) * dist, lat + math.sin(angle) * dist

dongs_data = []
gu_summary = []
for gu_name, gu_code, lng, lat, vibe in GU_INFO:
    template = DONG_TEMPLATES.get(vibe, DONG_TEMPLATES["stable"])
    # 자치구 안에 5개 동 — 첫 번째는 vibe 그대로, 나머지는 약간 다른 시나리오 섞기
    for i, dong_short in enumerate(template):
        if vibe == "rising_star":
            scenario = ["rising_star","rising_star","rising_adjacent","rising_adjacent","stable"][i] if i < 5 else vibe
            scenario = vibe if scenario == "rising_adjacent" else scenario  # rising_adjacent도 rising으로 매핑
        else:
            scenario = vibe
        if scenario == "rising_adjacent": scenario = "rising"
        if scenario not in SCENARIOS: scenario = "stable"

        d_lng, d_lat = jitter_around(lng, lat, i)
        dong_full_name = f"{gu_name} {dong_short}" if vibe != "rising_star" else dong_short
        dong_code = f"{gu_code}{500+i*10}"
        dongs_data.append(gen_dong(dong_full_name, dong_code, d_lng, d_lat, scenario, i))
    gu_summary.append({"name": gu_name, "code": gu_code, "lng": lng, "lat": lat, "vibe": vibe})

# 부산 비교용 5개 동 (전포1동 등 — 성수와 비교)
BUSAN = [
    ("부산_전포1동",  "26230", 129.0653, 35.1559, "rising_twin"),
    ("부산_전포2동",  "26231", 129.0680, 35.1530, "rising_twin"),
    ("부산_부전1동",  "26232", 129.0590, 35.1610, "rising"),
    ("부산_광안1동",  "26233", 129.1180, 35.1525, "rising"),
    ("부산_해운대1동","26234", 129.1638, 35.1631, "premium"),
]
for n, c, lng, lat, sc in BUSAN:
    dongs_data.append(gen_dong(n, c, lng, lat, sc, 0))
gu_summary.append({"name": "부산_부산진구·해운대구", "code": "26230", "lng": 129.07, "lat": 35.16, "vibe": "rising_twin"})

# ─────────────────────────────────────────────
# Output
# ─────────────────────────────────────────────
data = {
    "meta": {
        "generated_at": datetime.now().isoformat(),
        "months": MONTHS,
        "total_months": T,
        "shocks": SHOCKS,
        "layer_categories": {
            "land": ["land_price", "land_price_apt", "land_price_house", "rent_price"],
            "transaction": ["tx_volume", "tx_apt_count", "tx_house_count"],
            "visitors": ["visitors_total", "visitors_20s", "visitors_30s", "visitors_40s",
                         "visitors_50plus", "visitors_male", "visitors_female",
                         "visitors_local", "visitors_inflow"],
            "business": ["biz_count", "biz_cafe", "biz_restaurant", "biz_retail",
                         "biz_service", "biz_new", "biz_closed"],
            "location": ["transit_score", "walkability", "subway_distance_m", "bus_stop_density"],
            "townin_partner": ["tw_partner_active", "tw_partner_signups", "tw_partner_churn"],
            "townin_sales":   ["tw_sales_monthly", "tw_orders", "tw_aov"],
            "townin_user":    ["tw_dau", "tw_searches", "tw_conversions"],
            "townin_ad":      ["tw_ad_impressions", "tw_ad_clicks", "tw_ad_spend", "tw_ad_roas"],
        }
    },
    "gu_list": gu_summary,
    "dongs": dongs_data
}

with open("simula_data.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

import os
print(f"✅ Simula v2 데이터 생성 완료")
print(f"   동: {len(dongs_data)}개 (서울 25구×5동 + 부산 5동)")
print(f"   기간: {MONTHS[0]} ~ {MONTHS[-1]} ({T}개월)")
print(f"   레이어: {len(dongs_data[0]['layers'])}개")
print(f"   파일 크기: {os.path.getsize('simula_data.json')/1024:.1f} KB")
