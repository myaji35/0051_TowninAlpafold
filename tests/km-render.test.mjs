// tests/km-render.test.mjs — KMCurve.mount() 렌더 계약 검증 (곡선+log-rank+유사동 한 화면)
// DOM 미니 셰임 — innerHTML 세팅/조회만 사용하는 mount 경로를 검증.
import fs from 'fs';

let fails = 0;
function assert(name, cond, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? '  — ' + extra : ''));
  if (!cond) fails++;
}

// 최소 DOM 셰임: getElementById + innerHTML
function makeEl() {
  return { _html: '', set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; } };
}
const target = makeEl();
const win = {
  document: { getElementById: (id) => (id === 'km-mount' ? target : null) },
  VizTokens: null, // 폴백 팔레트 경로 강제
};
const code = fs.readFileSync('viz/plugins/km-curve.js', 'utf8');
new Function('window', code + '\n;return window;')(win);
const KM = win.KMCurve;

// pharmacy-close 가 만드는 것과 동일한 2곡선 데이터
function synthGroup(s12, n) {
  const mh = 1 - Math.pow(Math.max(0.01, Math.min(0.99, s12)), 1 / 12);
  const durations = [], events = []; let alive = n;
  for (let m = 1; m <= 12; m++) { const d = Math.round(alive * mh); for (let k = 0; k < d; k++) { durations.push(m); events.push(1); } alive -= d; }
  for (let k = 0; k < alive; k++) { durations.push(12); events.push(0); }
  return { durations, events };
}
const tg = synthGroup(0.64, 50), ag = synthGroup(0.78, 130);
const tCurve = KM.kaplanMeierCurve(tg.durations, tg.events, 12);
const aCurve = KM.kaplanMeierCurve(ag.durations, ag.events, 12);
const lr = KM.logRank(tg, ag);
const peers = [
  { rank: 1, dong: '의정부 호원동', survival_12m: 0.58, similarity: KM.cosineSimilarity([0.64, 1], [0.58, 0.9]) },
  { rank: 2, dong: '의정부 낙양동', survival_12m: 0.64, similarity: KM.cosineSimilarity([0.64, 1], [0.64, 0.8]) },
];

const res = KM.mount('km-mount', {
  series: [
    { label: '의정부시 금오동', points: tCurve.points },
    { label: '의정부 평균', points: aCurve.points },
  ],
  logrank: lr,
  peers: peers,
});

const html = target.innerHTML;
assert('mount 성공 (rendered)', res && res.rendered);
assert('2개 시리즈 렌더', res.series === 2, res.series + ' series');
// 곡선 2개: 스텝 라인 path(stroke-width 1.8) 2개
const strokeLines = (html.match(/stroke-width="1\.8"/g) || []).length;
assert('생존곡선 라인 2개', strokeLines === 2, strokeLines + '개');
// CI 띠: fill-opacity 0.14 밴드 2개
const bands = (html.match(/fill-opacity="0\.14"/g) || []).length;
assert('CI 띠 2개', bands === 2, bands + '개');
// log-rank χ² + p
assert('log-rank χ² 표기', /χ²\(1\) =/.test(html), lr.chi2.toFixed(2));
assert('log-rank p 표기', /p = /.test(html));
// 유사동 표 + 유사도 열
assert('유사동 표 렌더', /km-peers-table/.test(html));
assert('코사인 유사도 열', /코사인 유사도/.test(html));
assert('유사동 행 2개', (html.match(/<tr>/g) || []).length >= 3, '헤더+2행');
// provenance (SIL CI Mandate)
assert('provenance 방법론 표기', /Kaplan-Meier/.test(html) && /Greenwood/.test(html) && /Log-rank/.test(html));
// 곡선 + 표 동일 컨테이너 (한 화면)
assert('곡선+log-rank+표 단일 블록', /km-curve-block/.test(html) && html.indexOf('km-svg') < html.indexOf('km-peers-table'));

console.log('\n' + (fails === 0 ? 'ALL PASS' : fails + ' FAIL'));
process.exit(fails === 0 ? 0 : 1);
