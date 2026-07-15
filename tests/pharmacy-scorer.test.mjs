// tests/pharmacy-scorer.test.mjs
// [RUN_TESTS_PHARMACY_DEVELOP-001] 약국 점포개발 Scorer 단위 테스트
// 검증 대상: viz/plugins/pharmacy-scorer.js
// 명세: docs/stories/pharmacy-develop.md B절(AC-7) / D절(가중치) / D-1절(정규화)
//
// scorer는 브라우저용 IIFE(window 전역)이므로 Node에서 최소 window 셰임을 주입해 로드한다.
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const src = readFileSync(new URL('../viz/plugins/pharmacy-scorer.js', import.meta.url), 'utf-8');
const win = {};
new Function('window', 'console', src)(win, console);
const S = win.PharmacyScorer;

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
    console.log(`✅ ${name}`);
  } catch (e) {
    results.push({ name, pass: false, err: e.message });
    console.log(`❌ ${name}\n   ${e.message}`);
  }
}

// ── 0. 로드 ──
test('0. window.PharmacyScorer 전역 노출 (evaluateByDong/computeScore/topDrivers/WEIGHTS)', () => {
  assert.ok(S, 'PharmacyScorer 미노출');
  ['evaluate', 'evaluateByDong', 'computeScore', 'topDrivers'].forEach((k) => {
    assert.equal(typeof S[k], 'function', `${k} 누락`);
  });
  assert.ok(S.WEIGHTS && S.DEMO_DONGS.length >= 6, 'WEIGHTS/DEMO_DONGS 누락');
});

// ── 1. 가중치 합 = 1.0 (명세 D절) ──
test('1. 가중치 절대값 합 = 1.00 (D절 명세)', () => {
  const sum = Object.values(S.WEIGHTS).reduce((s, w) => s + Math.abs(w), 0);
  assert.ok(Math.abs(sum - 1.0) < 0.001, `abs-sum = ${sum} (expect 1.00)`);
});

test('1b. 가중치 7개 요인 + 부호 방향 (경쟁약국/임대료만 음수)', () => {
  const w = S.WEIGHTS;
  assert.equal(Object.keys(w).length, 7, '요인 7개가 아님');
  assert.ok(w.competitor_pharmacies_within_500m < 0, '경쟁약국 가중치는 음수여야 함');
  assert.ok(w.rent_ratio < 0, '임대료 가중치는 음수여야 함');
  ['population_density', 'elderly_ratio', 'clinics_within_500m', 'income_quantile', 'visitors_total']
    .forEach((k) => assert.ok(w[k] > 0, `${k} 가중치는 양수여야 함`));
});

// ── 2. score 경계값 → grade 4분기 매핑 (명세 E절) ──
// scorer 내부 scoreToGradeLabel은 비공개 → evaluateByDong의 grade.label로 간접 검증하되,
// 경계값 자체는 등급 규칙(>=90 / >=70 / >=50 / <50)을 직접 재현해 대조한다.
function gradeOf(score) {
  if (score >= 90) return 'very_high';
  if (score >= 70) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}
test('2. score 경계값 0/49/50/69/70/89/90/100 → grade 4분기 매핑', () => {
  const cases = [
    [0, 'low'], [49, 'low'],
    [50, 'medium'], [69, 'medium'],
    [70, 'high'], [89, 'high'],
    [90, 'very_high'], [100, 'very_high'],
  ];
  cases.forEach(([score, expected]) => {
    assert.equal(gradeOf(score), expected, `score ${score} → ${gradeOf(score)} (expect ${expected})`);
  });
});

test('2b. 실제 데모 동에서 grade 4분기가 모두 발생 (등급 변별력)', () => {
  const grades = new Set(S.DEMO_DONGS.map((d) => S.evaluateByDong(d).dong_grade.label));
  ['very_high', 'high', 'medium', 'low'].forEach((g) => {
    assert.ok(grades.has(g), `grade '${g}'가 데모 동에서 발생하지 않음 (발생: ${[...grades].join(',')})`);
  });
});

// ── 3. score 범위 = 0~100 정수 ──
test('3. score는 항상 0~100 정수 (극단 입력 clamp 포함)', () => {
  const extremes = [
    {}, // 전부 결측
    { population_density: 1e9, elderly_ratio: 9, clinics_within_500m: 1e6, income_quantile: 7.5, competitor_pharmacies_within_500m: 0, rent_ratio: 0, visitors_total: 1e9 }, // 최대
    { population_density: -100, elderly_ratio: -1, clinics_within_500m: -50, competitor_pharmacies_within_500m: 1e6, rent_ratio: 1e6, income_quantile: 0, visitors_total: -1 }, // 최소/음수
    { population_density: null, elderly_ratio: undefined, clinics_within_500m: NaN, competitor_pharmacies_within_500m: null, income_quantile: null, rent_ratio: null, visitors_total: NaN },
  ];
  extremes.forEach((f, i) => {
    const { score } = S.computeScore(f);
    assert.ok(Number.isInteger(score), `case${i}: score=${score} 정수 아님`);
    assert.ok(score >= 0 && score <= 100, `case${i}: score=${score} 범위 밖`);
  });
});

// ── 4. top_drivers 정렬 정확성 (|contribution| 내림차순, 상위 3개) ──
test('4. top_drivers = |contribution| 상위 3개, 내림차순 정렬', () => {
  const f = S.evaluateByDong('강남구 역삼1동');
  const contribs = S.computeScore({
    population_density: 42.0, elderly_ratio: 0.09,
    clinics_within_500m: 48, competitor_pharmacies_within_500m: 24,
    income_quantile: 9, rent_ratio: 2.20, visitors_total: 980_000,
  }).contributions;
  const drivers = S.topDrivers(contribs, 3);
  assert.equal(drivers.length, 3, 'top_drivers 3개가 아님');
  for (let i = 0; i < drivers.length - 1; i++) {
    assert.ok(
      Math.abs(drivers[i].contribution) >= Math.abs(drivers[i + 1].contribution),
      `정렬 위반: [${i}]=${drivers[i].contribution} < [${i + 1}]=${drivers[i + 1].contribution}`
    );
  }
  // 전체 요인 중 실제 상위 3개와 일치하는지 대조
  const expected = Object.entries(contribs)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3).map(([k]) => k);
  assert.deepEqual(drivers.map((d) => d.factor), expected, 'top_drivers 구성이 전체 정렬 상위 3개와 불일치');
  // 동 요약의 dong_drivers는 동 공통 요인 상위 3개 (매물 카드는 별도 계약 — 테스트 4c 참조)
  assert.equal(f.dong_drivers.length, 3, 'dong_drivers 3개 아님');
});

test('4b. top_drivers sign이 contribution 부호와 일치 (positive/negative direction 명시)', () => {
  const contribs = S.computeScore(S.DEMO_PROPERTIES_BY_DONG ? {
    population_density: 45, elderly_ratio: 0.28, clinics_within_500m: 48,
    competitor_pharmacies_within_500m: 2, income_quantile: 8, rent_ratio: 0.4, visitors_total: 900_000,
  } : {}).contributions;
  S.topDrivers(contribs, 7).forEach((d) => {
    const expected = d.contribution >= 0 ? '+' : '-';
    assert.equal(d.sign, expected, `${d.factor}: sign=${d.sign} but contribution=${d.contribution}`);
    assert.ok(d.label && d.label !== d.factor, `${d.factor}: 한글 라벨 누락`);
  });
});

// ── 5. AC-7 결정성 — 동일 input → 동일 output ──
test('5. AC-7 결정성 — 동일 동 2회 평가 시 score ±0 + 매물 순서 동일', () => {
  S.DEMO_DONGS.forEach((dong) => {
    const a = S.evaluateByDong(dong);
    const b = S.evaluateByDong(dong);
    assert.equal(a.dong_score, b.dong_score, `${dong}: dong_score 불일치 ${a.dong_score} vs ${b.dong_score}`);
    assert.deepEqual(
      a.properties.map((p) => [p.id, p.score]),
      b.properties.map((p) => [p.id, p.score]),
      `${dong}: 매물 점수/순서 비결정적`
    );
  });
});

test('5b. AC-7 결정성 — computeScore 100회 반복 동일 (부동소수 안정성)', () => {
  const f = { population_density: 28.0, elderly_ratio: 0.18, clinics_within_500m: 14,
    competitor_pharmacies_within_500m: 6, income_quantile: 6, rent_ratio: 1.05, visitors_total: 480_000 };
  const first = S.computeScore(f).score;
  for (let i = 0; i < 100; i++) {
    assert.equal(S.computeScore(f).score, first, `${i}번째 반복에서 score 변동`);
  }
});

// ── 6. PIVOT — evaluateByDong 매물 중심 계약 ──
test('6. PIVOT: 동 입력 → 매물 리스트 반환 (적합도순 내림차순)', () => {
  const r = S.evaluateByDong('의정부시 금오동');
  assert.ok(r && Array.isArray(r.properties), 'properties 배열 아님');
  assert.equal(r.property_count, r.properties.length, 'property_count 불일치');
  assert.ok(r.properties.length >= 1, '매물 0건');
  for (let i = 0; i < r.properties.length - 1; i++) {
    const [a, b] = [r.properties[i], r.properties[i + 1]];
    assert.ok(a.score >= b.score, `적합도순 위반: #${i + 1}(${a.score}) < #${i + 2}(${b.score})`);
    if (a.score === b.score) {
      assert.ok(a.rent_man <= b.rent_man, `동점 시 임대료 낮은 순 위반: ${a.rent_man} > ${b.rent_man}`);
    }
  }
});

test('6b. PIVOT: 매물 카드 필수 필드 (score/grade/top_drivers/fit_reason/주소/평형/임대가)', () => {
  const r = S.evaluateByDong('의정부시 금오동');
  r.properties.forEach((p) => {
    assert.ok(Number.isInteger(p.score) && p.score >= 0 && p.score <= 100, `${p.id}: score 이상 (${p.score})`);
    assert.ok(p.grade && p.grade.label && p.grade.color && p.grade.actionLabel, `${p.id}: grade 필드 누락`);
    assert.equal(p.grade.label, gradeOf(p.score), `${p.id}: grade 라벨이 score와 불일치`);
    // FIX_BUG_PHARMACY_DEVELOP_DRIVERS-001: 매물 카드는 '동 대비 delta 근거'만 노출 →
    // 개수는 매물마다 1~3개로 가변 (3개 고정 패딩은 동 공통 요인을 다시 끌어들이므로 금지)
    assert.ok(Array.isArray(p.top_drivers) && p.top_drivers.length >= 1 && p.top_drivers.length <= 3,
      `${p.id}: top_drivers ${p.top_drivers.length}개 (1~3 기대)`);
    assert.ok(typeof p.fit_reason === 'string' && p.fit_reason.length > 0, `${p.id}: fit_reason 없음`);
    ['id', 'address', 'area_pyeong', 'rent_man', 'deposit_man', 'floor', 'available_from', 'listing_source']
      .forEach((k) => assert.ok(p[k] != null, `${p.id}: ${k} 누락`));
  });
});

test('6c. PIVOT: 매물별 임대료 차등이 score에 반영 (동일 동 내 고임대 매물 < 저임대 매물)', () => {
  const r = S.evaluateByDong('의정부시 금오동');
  const cheapest = r.properties.reduce((m, p) => (p.rent_man < m.rent_man ? p : m));
  const priciest = r.properties.reduce((m, p) => (p.rent_man > m.rent_man ? p : m));
  assert.ok(cheapest.score > priciest.score,
    `임대료 패널티 미반영: 저임대(${cheapest.rent_man}만/${cheapest.score}점) <= 고임대(${priciest.rent_man}만/${priciest.score}점)`);
});

// ── 6d. 근거 변별력 회귀 가드 (FIX_BUG_PHARMACY_DEVELOP_DRIVERS-001) ──
test('6d. 매물 카드 근거가 카드별로 고유 — 점수 차이의 원인이 근거에 노출', () => {
  const r = S.evaluateByDong('의정부시 금오동');
  const combos = r.properties.map((p) => JSON.stringify(p.top_drivers));
  const distinct = new Set(combos);
  const scores = new Set(r.properties.map((p) => p.score));
  assert.ok(scores.size > 1, '전제 실패: 매물 점수가 모두 동일');
  assert.equal(distinct.size, r.properties.length,
    `근거 조합 ${distinct.size}종 / 매물 ${r.properties.length}건 — 카드 간 근거 중복 (변별력 상실)`);
  // 점수 차이의 실제 원인(임대료)이 각 카드 근거에 등장해야 함
  r.properties.forEach((p) => {
    const hasRent = p.top_drivers.some((d) => d.text.includes('임대료'));
    assert.ok(hasRent, `${p.id}: 근거에 임대료 없음 — 점수 차이의 원인이 설명되지 않음`);
  });
});

test('6e. dong_drivers(동 공통) ↔ 매물 top_drivers(delta) 관심사 분리', () => {
  const r = S.evaluateByDong('의정부시 금오동');
  const dongTexts = new Set(r.dong_drivers.map((d) => d.text));
  r.properties.forEach((p) => {
    p.top_drivers.forEach((d) => {
      assert.ok(!dongTexts.has(d.text),
        `${p.id}: 동 공통 근거 '${d.text}'가 매물 카드에 중복 노출 (변별 정보 아님)`);
    });
  });
});

// ── 7. 엣지 — 미등록 동 ──
test('7. 미등록 동 → null 반환 (UI가 DONG_NOT_FOUND 처리)', () => {
  assert.equal(S.evaluateByDong('존재하지않는동'), null);
  assert.equal(S.evaluateByDong(''), null);
  assert.equal(S.evaluateByDong(undefined), null);
});

// ── 8. 도메인 회귀 가드 (FIX_BUG_PHARMACY_SCORER_NORMALIZER-001) ──
test('8. 도메인 회귀 가드 — 금오동(저경쟁·저임대) > 역삼1동(포화·고임대)', () => {
  const geumo = S.evaluateByDong('의정부시 금오동').dong_score;
  const yeoksam = S.evaluateByDong('강남구 역삼1동').dong_score;
  assert.ok(geumo > yeoksam,
    `D-2절 도메인 해석 위배: 금오동 ${geumo} <= 역삼1동 ${yeoksam}`);
});

// BIZ_FIX_PHARMACY_SCORER_CLINIC_ZERO-001 (2026-07-15):
//   기존 8b는 AC-5 이름을 달고 `기여도 == 0`을 단언해 AC-5 위반 상태를 고정하고 있었다.
//   AC-5는 `contribution < 0` + direction:negative + 약점 최상단 노출을 요구한다.
//   → 단언 방향을 명세에 맞춰 뒤집는다 (테스트 계약 변경).
test('8b. 의원 0개 동은 clinics 기여도가 음수 + 약점 최상단 (AC-5 — 처방원 부재)', () => {
  const noClinic = S.computeScore({
    population_density: 30, elderly_ratio: 0.2, clinics_within_500m: 0,
    competitor_pharmacies_within_500m: 0, income_quantile: 7.5, rent_ratio: 1.0, visitors_total: 500_000,
  });
  assert.ok(noClinic.contributions.clinics_within_500m < 0,
    `AC-5 위반: 의원 0개인데 clinics 기여도 = ${noClinic.contributions.clinics_within_500m} (음수 기대)`);

  // AC-5: top_drivers에 negative direction으로 포함 + 약점 섹션 최상단
  const drivers = S.topDrivers(noClinic.contributions, 3);
  const top = drivers[0];
  assert.equal(top.factor, 'clinics_within_500m',
    `AC-5 위반: 처방원 부재가 top_drivers 최상단이 아님 (실제 최상단: ${top.factor})`);
  assert.equal(top.sign, '-', 'AC-5 위반: direction이 negative가 아님');

  // 기준선(BASE=10) 미만은 약점, 초과는 강점 — centered 정규화 계약
  const atBase = S.computeScore({
    population_density: 30, elderly_ratio: 0.2, clinics_within_500m: 10,
    competitor_pharmacies_within_500m: 0, income_quantile: 7.5, rent_ratio: 1.0, visitors_total: 500_000,
  });
  assert.ok(Math.abs(atBase.contributions.clinics_within_500m) < 0.001,
    `기준선(10개)은 중립(0) 기대, 실제 ${atBase.contributions.clinics_within_500m}`);

  const withClinic = S.computeScore({
    population_density: 30, elderly_ratio: 0.2, clinics_within_500m: 20,
    competitor_pharmacies_within_500m: 0, income_quantile: 7.5, rent_ratio: 1.0, visitors_total: 500_000,
  });
  assert.ok(withClinic.contributions.clinics_within_500m > 0, '기준선 초과인데 강점(양수) 아님');
  assert.ok(withClinic.score > noClinic.score, '의원 존재가 점수에 반영되지 않음');
});

test('8c. clinics centered 정규화 회귀 가드 — 4단계 grade 분포 유지 (BASE=10 전환)', () => {
  // BIZ_FIX_PHARMACY_SCORER_CLINIC_ZERO-001 regression_guard:
  //   정규화 전환이 6개 데모 동의 점수 분포를 흔들지 않았는지 확인.
  const byGrade = {};
  S.DEMO_DONGS.forEach((d) => {
    const g = S.evaluateByDong(d).dong_grade.label;
    byGrade[g] = (byGrade[g] || 0) + 1;
  });
  ['very_high', 'high', 'medium', 'low'].forEach((g) => {
    assert.ok(byGrade[g] >= 1, `grade '${g}' 소멸 — 분포: ${JSON.stringify(byGrade)}`);
  });
});

// ── 9. 임대료 미입력 중립 (BIZ_FIX_PHARMACY_SCORER_RENT_NULL-001) ──
test('9. rent_ratio 미입력(null)은 동 평균과 동일한 중립 — 최저임대료로 가산되지 않음', () => {
  const base = {
    population_density: 28, elderly_ratio: 0.18, clinics_within_500m: 14,
    competitor_pharmacies_within_500m: 6, income_quantile: 6, visitors_total: 480_000,
  };
  const omitted = S.computeScore({ ...base, rent_ratio: null });
  const dongAvg = S.computeScore({ ...base, rent_ratio: 1.0 });
  assert.equal(omitted.contributions.rent_ratio, dongAvg.contributions.rent_ratio,
    `미입력이 중립이 아님: null=${omitted.contributions.rent_ratio} vs 동평균=${dongAvg.contributions.rent_ratio}`);
  assert.equal(omitted.score, dongAvg.score, `미입력 score ${omitted.score} != 동평균 score ${dongAvg.score}`);

  // 미입력이 최저임대료(0배)보다 불리해야 한다 — 0배는 실제 감점 0이므로 만점 가산
  const cheapest = S.computeScore({ ...base, rent_ratio: 0 });
  assert.ok(omitted.score < cheapest.score,
    `미입력(${omitted.score})이 최저임대료(${cheapest.score})와 동일하게 가산됨 — null=0 버그 재발`);
});

// ── 결과 요약 ──
const failed = results.filter((r) => !r.pass);
console.log(`\n━━━ pharmacy-scorer 단위 테스트 ━━━`);
console.log(`총 ${results.length} · 통과 ${results.length - failed.length} · 실패 ${failed.length}`);
if (failed.length) {
  failed.forEach((f) => console.log(`  ❌ ${f.name}: ${f.err}`));
  process.exit(1);
}
