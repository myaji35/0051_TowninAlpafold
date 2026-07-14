// tests/km-curve.test.mjs — Kaplan-Meier / Greenwood / log-rank 검증 (UI_BENCHMARK_KM_CURVE-001)
// node tests/km-curve.test.mjs
import fs from 'fs';

const globalRoot = { document: undefined };
const code = fs.readFileSync('viz/plugins/km-curve.js', 'utf8');
new Function('window', code + '\n;return window;')(globalRoot);
const KM = globalRoot.KMCurve;

let fails = 0;
function assert(name, cond, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? '  — ' + extra : ''));
  if (!cond) fails++;
}

// 1. KM S(12) — cafe baseline hazard 코호트 → Python 리포트와 동일 구간(~62%)
const CAFE = 0.38, mBase = 1 - Math.pow(1 - CAFE, 1 / 12);
let alive = 100, durations = [], events = [];
for (let m = 1; m <= 12; m++) { const died = Math.round(alive * mBase); for (let k = 0; k < died; k++) { durations.push(m); events.push(1); } alive -= died; }
for (let k = 0; k < alive; k++) { durations.push(12); events.push(0); }
const at = KM.kaplanMeierAt(durations, events, 12);
assert('KM S(12) in [55%,70%] (cafe baseline)', at.S > 0.55 && at.S < 0.70, (at.S * 100).toFixed(1) + '%');
assert('Greenwood 95% CI 비퇴화 + [0,1] 클램프', at.lo < at.S && at.hi > at.S && at.lo >= 0 && at.hi <= 1,
  '[' + (at.lo * 100).toFixed(1) + ',' + (at.hi * 100).toFixed(1) + ']');

// 2. 곡선 단조 비증가
const curve = KM.kaplanMeierCurve(durations, events, 12);
let mono = true;
for (let i = 1; i < curve.points.length; i++) if (curve.points[i].survival > curve.points[i - 1].survival + 1e-9) mono = false;
assert('생존곡선 단조 비증가', mono, curve.points.length + ' points');

// 3. 결과 스키마 {t, survival, ci_low, ci_high, at_risk, events}
const p = curve.points[curve.points.length - 1];
assert('point 스키마 키 완비', ['t', 'survival', 'ci_low', 'ci_high', 'at_risk', 'events'].every(k => k in p), Object.keys(p).join(','));

// 4. log-rank — 동일 군 → χ²≈0, p≈1
const lrSame = KM.logRank({ durations, events }, { durations, events });
assert('log-rank 동일군 χ²≈0', lrSame.chi2 < 0.01, 'χ²=' + lrSame.chi2.toFixed(4));
assert('log-rank 동일군 p≈1', lrSame.p > 0.9, 'p=' + lrSame.p.toFixed(3));

// 5. log-rank — 극단 차이 → 유의(p<0.05)
const a2 = { durations: [], events: [] }, b2 = { durations: [], events: [] };
for (let i = 0; i < 60; i++) { a2.durations.push(2); a2.events.push(1); }
for (let i = 0; i < 60; i++) { b2.durations.push(12); b2.events.push(0); }
const lrDiff = KM.logRank(a2, b2);
assert('log-rank 극단차이 유의 (p<0.05)', lrDiff.p < 0.05, 'χ²=' + lrDiff.chi2.toFixed(2) + ' p=' + (lrDiff.p < 0.001 ? '<0.001' : lrDiff.p.toFixed(4)));

// 6. 코사인 유사도 (0~1)
const cos = KM.cosineSimilarity([0.64, 0.9], [0.58, 0.8]);
assert('코사인 유사도 [0,1]', cos > 0 && cos <= 1, cos.toFixed(4));
assert('동일 벡터 코사인=1', Math.abs(KM.cosineSimilarity([1, 2], [1, 2]) - 1) < 1e-9);

console.log('\n' + (fails === 0 ? 'ALL PASS' : fails + ' FAIL'));
process.exit(fails === 0 ? 0 : 1);
