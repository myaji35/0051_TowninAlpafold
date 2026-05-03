// TowninGraph Master Console v0.3
// 4 modes: Gallery | Explore | Analyze | Decide

let DATA = null;
let currentMonth = 59; // 기본 마지막 시점
let selectedDong = null;
let playInterval = null;
let currentMode = 'gallery';
let analyzeMap = null, analyzeOverlay = null;
let exploreMap = null, exploreOverlay = null;

const PLDDT = {
  high: [0,82,155,230], mid: [91,192,235,230],
  low:  [254,215,102,230], poor: [201,72,91,230],
};
const plddtColor = p => p>=90?PLDDT.high : p>=70?PLDDT.mid : p>=50?PLDDT.low : PLDDT.poor;
const plddtHex   = p => p>=90?'#00529B' : p>=70?'#5BC0EB' : p>=50?'#FED766' : '#C9485B';

const VIBE_LABEL = {
  premium:'프리미엄', rising_star:'성수형 급상승', rising:'상승세',
  youth:'청년 상권', stable:'안정', traditional:'전통 상권',
  developing:'개발 중', industrial:'산업', residential:'주거',
  rising_twin:'부산 비교 (Twin)'
};

// ─────────────────────────────────────────────
// 12개 주제 갤러리 프리셋
// ─────────────────────────────────────────────
const GALLERY = [
  { id:'sungsu_rise',   icon:'🔥', cat:'트렌드', title:'성수동 부상 스토리',
    desc:'2024년 트렌드 시프트 시점에 어떻게 솟아올랐나',
    mode:'analyze', mapping:{height:'biz_new', color:'biz_cafe', mode:'columns'}, dongFocus:'성수1가1동' },
  { id:'covid_shock',   icon:'📉', cat:'트렌드', title:'코로나 충격 분석',
    desc:'2020-04 시점에 모든 단백질이 동시에 짧아지는 모습',
    mode:'analyze', mapping:{height:'tx_volume', color:'biz_closed', mode:'columns'}, jumpMonth:3 },
  { id:'cafe_boom',     icon:'☕', cat:'트렌드', title:'카페 폭증 핫스팟',
    desc:'어디에서 카페가 가장 빠르게 늘어났나',
    mode:'analyze', mapping:{height:'biz_cafe', color:'visitors_20s', mode:'heat'} },
  { id:'youth_inflow',  icon:'👥', cat:'트렌드', title:'20대 청년 유입',
    desc:'20대 유동인구가 집중되는 동',
    mode:'analyze', mapping:{height:'visitors_20s', color:'biz_cafe', mode:'columns'} },
  { id:'closure_alert', icon:'⚠️', cat:'이상탐지', title:'폐업 급증 동',
    desc:'폐업률이 급격히 오르는 동 자동 탐지',
    mode:'explore', anomalyFilter:'biz_closed' },
  { id:'plddt_drop',    icon:'🌫️', cat:'이상탐지', title:'pLDDT 하락 경고',
    desc:'예측 신뢰도가 떨어지는 불안정 지역',
    mode:'explore', anomalyFilter:'plddt' },
  { id:'visit_drop',    icon:'📊', cat:'이상탐지', title:'유동 이탈 동',
    desc:'유동인구 6개월 연속 하락한 동',
    mode:'explore', anomalyFilter:'visitor_decline' },
  { id:'partner_recruit',icon:'🤝', cat:'파트너', title:'파트너 모집 후보지',
    desc:'카페 부족 vs 20대 유동 풍부한 동',
    mode:'analyze', mapping:{height:'visitors_20s', color:'biz_cafe', mode:'columns'} },
  { id:'sales_alert',   icon:'💰', cat:'파트너', title:'소상공인 매출 위험',
    desc:'거래량/유동 대비 폐업 늘어나는 동',
    mode:'analyze', mapping:{height:'biz_closed', color:'tx_volume', mode:'columns'} },
  { id:'ad_target',     icon:'🎯', cat:'파트너', title:'광고 집중 후보',
    desc:'잠재 수요 높고 경쟁 적은 동',
    mode:'analyze', mapping:{height:'visitors_total', color:'biz_count', mode:'hex'} },
  { id:'twin_seoul',    icon:'🌐', cat:'비교', title:'성수 ↔ 부산 전포 Twin',
    desc:'서울 성수와 부산 전포의 구조적 유사도',
    mode:'analyze', mapping:{height:'visitors_total', color:'biz_cafe', mode:'columns'},
    twinA:'성수1가1동', twinB:'부산_전포1동' },
  { id:'gangnam_compare',icon:'🏙️', cat:'비교', title:'강남 vs 성수 vs 마포',
    desc:'세 지역의 27 레이어 프로필 비교',
    mode:'analyze', mapping:{height:'land_price', color:'biz_cafe', mode:'columns'} },
];

// ─────────────────────────────────────────────
// LOAD
// ─────────────────────────────────────────────
// v0.7: 실데이터 우선 로드 (없으면 simula 폴백)
const DATA_SOURCES = {
  real: 'simula_data_real.json',
  simula: 'simula_data.json',
};
let DATA_MODE = 'real';  // 'real' | 'simula'
let FORECASTS = null;    // [C-4] Prophet 예측 결과 (선택적 — 없어도 작동)

function loadData(mode) {
  const url = DATA_SOURCES[mode] || DATA_SOURCES.simula;
  return fetch(url).then(r => {
    if (!r.ok) throw new Error(`${url} ${r.status}`);
    return r.json();
  });
}

// 메인 데이터 로드
loadData('real')
  .then(d => { DATA_MODE = 'real'; DATA = d; init(); })
  .catch(err1 => {
    console.warn('real 데이터 로드 실패, simula 폴백:', err1.message);
    return loadData('simula').then(d => { DATA_MODE = 'simula'; DATA = d; init(); });
  })
  .catch(err => {
    document.body.insertAdjacentHTML('afterbegin',
      `<div class="bg-red-600 text-white p-4">데이터 로드 실패: ${err.message} (서버 실행 필요)</div>`);
  });

// Prophet 예측 (선택적 — 없어도 본 앱은 정상 작동)
fetch('forecasts.json')
  .then(r => r.ok ? r.json() : null)
  .then(f => {
    if (f && f.forecasts) {
      FORECASTS = f;
      console.log(`✅ Prophet 예측 로드: ${f.meta.dong_count} 동 × ${f.meta.layers.length} 레이어 × ${f.meta.horizon_months}개월`);
      // [D] FORECASTS 도착 후 현재 모드별 cone 표시 갱신
      if (typeof DATA !== 'undefined' && DATA) {
        if (currentMode === 'explore' && selectedDong) drawExploreTrace();
        if (currentMode === 'decide') renderDecide();
        if (currentMode === 'gallery') renderGallery();
      }
    }
  })
  .catch(() => { /* forecasts.json 없으면 조용히 무시 */ });

// [C-5] Pearson + Granger 인과 추출 결과 (선택적)
let CAUSAL = null;
fetch('causal.json')
  .then(r => r.ok ? r.json() : null)
  .then(c => {
    if (c && c.dongs) {
      CAUSAL = c;
      console.log(`✅ 인과 추출 로드: ${c.meta.dong_count}동, Pearson ${c.meta.pearson_total}쌍, Granger ${c.meta.granger_total}트리플렛`);
      if (typeof DATA !== 'undefined' && DATA && currentMode === 'explore' && selectedDong) {
        writeAutoComment();  // 자동 코멘트에 인과 추가
      }
    }
  })
  .catch(() => { /* causal.json 없으면 조용히 무시 */ });

// [DECISION_TREE-001] 트리 모델 — 선택적 로드
let TREE_MODEL = null;
fetch('tree_model.json')
  .then(r => r.ok ? r.json() : null)
  .then(t => {
    if (t && t.nodes) {
      TREE_MODEL = t;
      console.log(`✅ 디시전 트리 로드: ${t.meta.n_dongs}동, depth=${t.meta.depth}, acc=${t.meta.train_accuracy}`);
      if (typeof DATA !== 'undefined' && DATA && currentMode === 'decide') renderDecide();
    }
  })
  .catch(() => { /* tree_model.json 없으면 조용히 무시 */ });

function init() {
  // v0.7: 데이터 모드 + 실데이터 부착 비율 표시 (ISS-018: 진실 라벨)
  const realCount = DATA.dongs.filter(d => d.real_data_attached || d.polygon_geo).length;
  const total = DATA.dongs.length;
  const layerCount = DATA.dongs[0] && DATA.dongs[0].layers ? Object.keys(DATA.dongs[0].layers).length : 0;
  // 부착 비율 기반 정직 라벨
  let modeBadge;
  if (realCount >= total * 0.8) {
    modeBadge = `<span style="color:#5BC0EB; font-weight:700" title="실데이터 부착 ${realCount}/${total}동">REAL POLY</span>`;
  } else if (realCount > 0) {
    modeBadge = `<span style="color:#FED766; font-weight:700" title="부분 실데이터 ${realCount}/${total}동, 80% 미달">PARTIAL REAL</span>`;
  } else {
    // simula 또는 real 파일이지만 부착 0% — 사실은 합성
    modeBadge = `<span style="color:#C9485B; font-weight:700" title="실데이터 부착 0/${total}동 (ISS-018) — 합성 데이터로 운영 중">SIMULA · 0% real</span>`;
  }
  document.getElementById('meta-info').innerHTML = `${modeBadge} · ${total} dongs · 60mo · ${layerCount} layers`;
  selectedDong = DATA.dongs.find(d => d.name.includes('성수1가1')) || DATA.dongs[0];

  // dong selectors
  ['dong-a','dong-b'].forEach(id => {
    const sel = document.getElementById(id);
    DATA.dongs.forEach((d,i) => sel.insertAdjacentHTML('beforeend', `<option value="${i}">${d.name}</option>`));
  });
  document.getElementById('dong-a').value = DATA.dongs.findIndex(d=>d.name.includes('성수1가1'));
  document.getElementById('dong-b').value = DATA.dongs.findIndex(d=>d.name.includes('전포1'));

  // mode buttons
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => switchMode(btn.dataset.mode));
  });

  renderGallery();
  bindAnalyzeControls();
  bindExploreControls();
  bindCommandPalette();
  // initial render
  switchMode('gallery');
}

// ─────────────────────────────────────────────
// COMMAND PALETTE (⌘K)
// ─────────────────────────────────────────────
let cmdSelectedIdx = 0;
let cmdResults = [];

function bindCommandPalette() {
  const palette = document.getElementById('cmd-palette');
  const input = document.getElementById('cmd-input');

  // ⌘K / Ctrl+K 토글
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      openCmdPalette();
    } else if (e.key === 'Escape' && !palette.classList.contains('hidden')) {
      closeCmdPalette();
    }
  });

  // 배경 클릭으로 닫기
  palette.addEventListener('click', (e) => { if (e.target === palette) closeCmdPalette(); });

  input.addEventListener('input', () => updateCmdResults());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); cmdSelectedIdx = Math.min(cmdResults.length - 1, cmdSelectedIdx + 1); renderCmdHighlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cmdSelectedIdx = Math.max(0, cmdSelectedIdx - 1); renderCmdHighlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); executeCmd(cmdSelectedIdx); }
  });
}

function openCmdPalette() {
  const palette = document.getElementById('cmd-palette');
  palette.classList.remove('hidden');
  const input = document.getElementById('cmd-input');
  input.value = ''; cmdSelectedIdx = 0;
  setTimeout(() => input.focus(), 50);
  updateCmdResults();
}

function closeCmdPalette() {
  document.getElementById('cmd-palette').classList.add('hidden');
}

function buildCmdItems() {
  const items = [];
  // 모드 전환
  [
    { mode:'gallery', icon:'🎨', label:'주제 갤러리' },
    { mode:'explore', icon:'🧬', label:'Explore — 자동 인사이트' },
    { mode:'analyze', icon:'📊', label:'Analyze — 자유 매핑' },
    { mode:'decide',  icon:'🎯', label:'Decide — KPI 대시보드' },
    { mode:'datastudio', icon:'🗄️', label:'Data Studio — 데이터 구축' },
    { mode:'workflow', icon:'🧩', label:'Workflow — 노드 그래프' },
  ].forEach(m => items.push({
    type:'mode', icon:m.icon, label:m.label, kbd:'MODE',
    action: () => switchMode(m.mode),
  }));
  // 12개 갤러리 주제
  GALLERY.forEach(g => items.push({
    type:'theme', icon:g.icon, label:g.title, hint:g.cat, kbd:'THEME',
    action: () => applyGallery(g),
  }));
  // 동 (130개 중 검색)
  DATA.dongs.forEach(d => items.push({
    type:'dong', icon:'📍', label:d.name, hint:VIBE_LABEL[d.scenario]||d.scenario, kbd:'DONG',
    action: () => {
      selectedDong = d;
      switchMode('explore');
      setTimeout(() => {
        if (exploreMap) exploreMap.flyTo({ center:[d.lng, d.lat], zoom:11, duration:600 });
        updateExplore();
      }, 200);
    },
  }));
  return items;
}

function updateCmdResults() {
  const q = document.getElementById('cmd-input').value.trim().toLowerCase();
  const all = buildCmdItems();
  cmdResults = q ? all.filter(it =>
    it.label.toLowerCase().includes(q) ||
    (it.hint && it.hint.toLowerCase().includes(q)) ||
    it.kbd.toLowerCase().includes(q)
  ).slice(0, 10) : all.slice(0, 10);
  cmdSelectedIdx = 0;

  const c = document.getElementById('cmd-results');
  c.innerHTML = '';
  if (cmdResults.length === 0) {
    c.innerHTML = '<div class="p-6 text-center text-gray-500 text-sm">검색 결과 없음</div>';
    return;
  }

  // 그룹별 헤더
  let lastType = null;
  cmdResults.forEach((it, i) => {
    if (it.type !== lastType) {
      const TYPE_LABEL = { mode:'모드 전환', theme:'분석 주제', dong:'동 (130)' };
      c.insertAdjacentHTML('beforeend',
        `<div class="px-4 py-1.5 text-[9px] mono text-gray-500 uppercase tracking-wider">${TYPE_LABEL[it.type]}</div>`);
      lastType = it.type;
    }
    c.insertAdjacentHTML('beforeend', `
      <div class="cmd-item flex items-center gap-3 px-4 py-2.5 cursor-pointer ${i === cmdSelectedIdx ? 'cmd-active' : ''}" data-idx="${i}">
        <span class="text-base">${it.icon}</span>
        <div class="flex-1 min-w-0">
          <div class="text-[12px] text-white truncate">${it.label}</div>
          ${it.hint ? `<div class="text-[10px] text-gray-400">${it.hint}</div>` : ''}
        </div>
        <span class="text-[9px] mono text-gray-500 px-1.5 py-0.5 rounded bg-white/5">${it.kbd}</span>
      </div>
    `);
  });
  c.querySelectorAll('.cmd-item').forEach(el => {
    el.onclick = () => executeCmd(+el.dataset.idx);
    el.onmouseenter = () => { cmdSelectedIdx = +el.dataset.idx; renderCmdHighlight(); };
  });
  renderCmdHighlight();
}

function renderCmdHighlight() {
  document.querySelectorAll('.cmd-item').forEach((el, i) => {
    el.classList.toggle('cmd-active', i === cmdSelectedIdx);
  });
  // 스크롤 보장
  const active = document.querySelector('.cmd-active');
  if (active) active.scrollIntoView({ block:'nearest' });
}

function executeCmd(idx) {
  const it = cmdResults[idx];
  if (!it) return;
  closeCmdPalette();
  setTimeout(() => it.action(), 80);
}

// ─────────────────────────────────────────────
// MODE SWITCHER
// ─────────────────────────────────────────────
function switchMode(mode) {
  currentMode = mode;
  document.querySelectorAll('[data-mode]').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  ['gallery','explore','analyze','decide','datastudio','workflow'].forEach(m => {
    const el = document.getElementById(`view-${m}`);
    if (el) {
      el.classList.toggle('hidden', m !== mode);
      el.classList.toggle('block', m === mode);
    }
  });

  if (mode === 'analyze') {
    if (!analyzeMap) initAnalyzeMap();
    setTimeout(() => { if (analyzeMap) analyzeMap.resize(); updateAnalyze(); renderWheel(); }, 100);
  } else if (mode === 'explore') {
    if (!exploreMap) initExploreMap();
    setTimeout(() => { if (exploreMap) exploreMap.resize(); updateExplore(); renderAutoLists(); }, 100);
  } else if (mode === 'decide') {
    renderDecide();
  } else if (mode === 'datastudio') {
    renderDataStudio();
  } else if (mode === 'workflow') {
    renderWorkflow();
  }
}

// ─────────────────────────────────────────────
// GALLERY
// ─────────────────────────────────────────────
function renderGallery() {
  const grid = document.getElementById('gallery-grid');
  grid.innerHTML = '';

  // 빌트인 + 사용자 워크플로 카드 통합 리스트
  const allCards = [...GALLERY];
  const userWorkflows = loadUserWorkflows();
  Object.entries(userWorkflows).forEach(([id, wf]) => {
    allCards.push({
      id, icon:'📁', cat:'📁 내 워크플로',
      title: wf.title,
      desc: wf.explain || '마스터가 직접 만든 워크플로',
      mode: 'workflow',
      isUser: true,
      nodeCount: wf.nodes.length,
      edgeCount: wf.edges.length,
    });
  });

  allCards.forEach(g => {
    const isUser = g.isUser === true;
    const previewType = isUser ? 'graph' : 'sparkline';
    grid.insertAdjacentHTML('beforeend', `
      <div class="theme-card rounded-lg p-4 relative" data-id="${g.id}">
        <div class="flex items-start justify-between mb-3">
          <div class="text-3xl">${g.icon}</div>
          <div class="flex flex-col items-end gap-1">
            <span class="text-[9px] mono text-gray-400">${g.cat}</span>
            ${isUser ? `<span class="text-[8px] mono px-1.5 py-0.5 rounded" style="background:#FED76622;color:#FED766">USER</span>` : ''}
          </div>
        </div>
        <h3 class="text-sm font-bold text-white mb-1">${g.title}</h3>
        <p class="text-[11px] text-gray-400 leading-relaxed mb-3" style="min-height:32px">${g.desc.length > 70 ? g.desc.substring(0,70) + '…' : g.desc}</p>
        <svg class="mini-preview" width="100%" height="36" viewBox="0 0 200 36"></svg>
        <div class="mt-2 flex items-center justify-between text-[9px] mono">
          <span class="text-gray-500">
            ${isUser ? `🧩 ${g.nodeCount} 노드 · ${g.edgeCount} 엣지` : (g.mode === 'explore' ? '🧬 Explore' : '📊 Analyze')}
          </span>
          <span class="text-cyan-300">→ 열기</span>
        </div>
      </div>
    `);
  });

  grid.querySelectorAll('.theme-card').forEach((card, idx) => {
    const g = allCards[idx];
    const svg = card.querySelector('.mini-preview');
    if (g.isUser) {
      drawMiniWorkflowPreview(svg, g.id);
    } else {
      drawMiniPreview(svg, g);
    }
    card.addEventListener('click', () => {
      if (g.isUser) {
        activeWorkflowId = g.id;
        switchMode('workflow');
        setTimeout(() => {
          document.getElementById('wf-select').value = g.id;
          drawWorkflowGraph();
        }, 100);
      } else {
        applyGallery(g);
      }
    });
  });

  // 카테고리 카운트 갱신
  updateGalleryCategoryCounts(allCards);
}

function drawMiniWorkflowPreview(svgEl, wfId) {
  const wf = WORKFLOWS[wfId];
  if (!wf || wf.nodes.length === 0) {
    const s = d3.select(svgEl); s.selectAll('*').remove();
    s.append('text').attr('x',100).attr('y',22).attr('text-anchor','middle')
      .attr('fill','rgba(255,255,255,0.3)').attr('font-size',9).attr('font-family','JetBrains Mono')
      .text('(빈 워크플로)');
    return;
  }
  const s = d3.select(svgEl); s.selectAll('*').remove();
  const W = 200, H = 36;
  const xs = wf.nodes.map(n => n.x);
  const ys = wf.nodes.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const sx = (x) => 6 + (x - minX) / Math.max(1, maxX - minX) * (W - 12);
  const sy = (y) => 4 + (y - minY) / Math.max(1, maxY - minY) * (H - 8);
  // 엣지
  wf.edges.forEach(([f, t]) => {
    const A = wf.nodes.find(n => n.id === f);
    const B = wf.nodes.find(n => n.id === t);
    if (!A || !B) return;
    s.append('line').attr('x1', sx(A.x)).attr('y1', sy(A.y))
      .attr('x2', sx(B.x)).attr('y2', sy(B.y))
      .attr('stroke','rgba(91,192,235,0.5)').attr('stroke-width',0.8);
  });
  // 노드
  wf.nodes.forEach(n => {
    const lib = NODE_BY_ID[n.lib_id];
    const color = lib ? NODE_CATS[lib.cat].color : '#5BC0EB';
    s.append('circle').attr('cx', sx(n.x)).attr('cy', sy(n.y)).attr('r', 2.5)
      .attr('fill', color).attr('opacity', 0.9);
  });
}

function updateGalleryCategoryCounts(allCards) {
  const totalEl = document.querySelector('#view-gallery button[style*="00A1E0"]');
  if (totalEl) totalEl.textContent = `전체 (${allCards.length})`;
}

function drawMiniPreview(svg, g) {
  // 미니 sparkline — Simula 데이터 기반 대표 동의 5종 평균 + Prophet cone (있을 때)
  const sample = DATA.dongs[0];
  const layers = ['land_price','tx_volume','visitors_total','biz_count','biz_cafe'];
  const colors = ['#00A1E0','#FED766','#5BC0EB','#B5E853','#FF8FB1'];

  // [D-2] Prophet cone 표시 — 카드 작은 영역이라 첫 레이어만 cone 그림
  const fcst = (FORECASTS && FORECASTS.forecasts && FORECASTS.forecasts[sample.code]) || null;
  const horizon = fcst ? FORECASTS.meta.horizon_months : 0;
  const TOTAL = 60 + horizon;

  const W=200, H=36;
  const s = d3.select(svg);
  s.selectAll('*').remove();
  const x = d3.scaleLinear().domain([0, TOTAL - 1]).range([0, W]);

  // 미래 영역 배경 (있을 때)
  if (horizon > 0) {
    s.append('rect')
      .attr('x', x(60)).attr('y', 0)
      .attr('width', W - x(60)).attr('height', H)
      .attr('fill', 'rgba(91,192,235,0.06)');
  }

  layers.forEach((lyr, i) => {
    const vals = sample.layers[lyr];
    const layerForecast = fcst ? fcst[lyr] : null;
    const allVals = [...vals];
    if (layerForecast) {
      allVals.push(...layerForecast.horizon_p10, ...layerForecast.horizon_p90);
    }
    const max = Math.max(...allVals), min = Math.min(...allVals);
    const y = d3.scaleLinear().domain([min, max]).range([H-2, 2]);

    // 과거 라인
    const line = d3.line().x((_,j)=>x(j)).y(d=>y(d)).curve(d3.curveMonotoneX);
    s.append('path').attr('d', line(vals)).attr('fill','none')
      .attr('stroke',colors[i]).attr('stroke-width',1).attr('opacity',0.75);

    // [D-2] Prophet cone — 1번째 레이어(land_price)만 그려서 카드 깔끔 유지
    if (layerForecast && i === 0) {
      const conePoints = [];
      for (let k = 0; k < horizon; k++) conePoints.push([x(60 + k), y(layerForecast.horizon_p90[k])]);
      for (let k = horizon - 1; k >= 0; k--) conePoints.push([x(60 + k), y(layerForecast.horizon_p10[k])]);
      s.append('path')
        .attr('d', 'M' + conePoints.map(p => p.join(',')).join('L') + 'Z')
        .attr('fill', colors[i]).attr('opacity', 0.18);
      // 중앙 예측선 (점선)
      const futurePts = layerForecast.horizon_p50.map((v, k) => [x(60 + k), y(v)]);
      s.append('path')
        .attr('d', 'M' + futurePts.map(p => p.join(',')).join('L'))
        .attr('fill', 'none').attr('stroke', colors[i])
        .attr('stroke-width', 0.8).attr('stroke-dasharray', '2,2').attr('opacity', 0.85);
    }
  });
}

function applyGallery(g) {
  if (g.mode === 'analyze') {
    switchMode('analyze');
    setTimeout(() => {
      if (g.mapping) {
        if (g.mapping.height) document.getElementById('m-height').value = g.mapping.height;
        if (g.mapping.color)  document.getElementById('m-color').value = g.mapping.color;
        if (g.mapping.mode)   document.getElementById('m-mode').value = g.mapping.mode;
      }
      if (g.jumpMonth !== undefined) {
        currentMonth = g.jumpMonth;
        document.getElementById('time-slider').value = currentMonth;
      }
      if (g.dongFocus) {
        const idx = DATA.dongs.findIndex(d => d.name.includes(g.dongFocus));
        if (idx >= 0) selectedDong = DATA.dongs[idx];
      }
      if (g.twinA && g.twinB) {
        document.getElementById('dong-a').value = DATA.dongs.findIndex(d=>d.name.includes(g.twinA));
        document.getElementById('dong-b').value = DATA.dongs.findIndex(d=>d.name.includes(g.twinB));
      }
      updateAnalyze(); renderWheel();
    }, 200);
  } else if (g.mode === 'explore') {
    switchMode('explore');
  }
}

// ─────────────────────────────────────────────
// ANALYZE MAP
// ─────────────────────────────────────────────
function initAnalyzeMap() {
  analyzeMap = makeMap('map');
  analyzeMap.on('load', () => {
    analyzeOverlay = new deck.MapboxOverlay({ layers: buildAnalyzeLayers(), interleaved:false });
    analyzeMap.addControl(analyzeOverlay);
  });
}

function makeMap(containerId) {
  return new maplibregl.Map({
    container: containerId,
    style: {
      version: 8,
      sources: {
        'carto-dark': {
          type:'raster',
          tiles:[
            'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
            'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
            'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
            'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
          ],
          tileSize: 256,
          attribution: '© OSM © CARTO',
        },
      },
      layers: [
        { id:'bg', type:'background', paint:{'background-color':'#07101F'} },
        { id:'carto-dark', type:'raster', source:'carto-dark', paint:{'raster-opacity':0.95,'raster-saturation':-0.1} },
      ],
    },
    center: [127.0, 37.55], zoom: 9.8, pitch: 45, bearing: -12,
    attributionControl:{compact:true},
  });
}

function colorGrad(v) {
  const t = Math.max(0, Math.min(1, v));
  if (t < 0.33) {
    const k = t/0.33;
    return [Math.round(0+k*0), Math.round(82+k*110), Math.round(155+k*80), 220];
  } else if (t < 0.66) {
    const k = (t-0.33)/0.33;
    return [Math.round(0+k*254), Math.round(192+k*23), Math.round(235-k*133), 230];
  } else {
    const k = (t-0.66)/0.34;
    return [Math.round(254-k*53), Math.round(215-k*143), Math.round(102-k*11), 240];
  }
}

function filterDongs(filterMode) {
  if (filterMode === 'seoul') return DATA.dongs.filter(d => !d.name.startsWith('부산'));
  if (filterMode === 'busan') return DATA.dongs.filter(d => d.name.startsWith('부산'));
  if (filterMode === 'rising') return DATA.dongs.filter(d => ['rising_star','rising','rising_twin'].includes(d.scenario));
  return DATA.dongs;
}

function buildAnalyzeLayers() {
  const heightLayer = document.getElementById('m-height').value;
  const colorLayer = document.getElementById('m-color').value;
  const mode = document.getElementById('m-mode').value;
  const filter = document.getElementById('m-filter').value;
  const dongs = filterDongs(filter);

  const allH = dongs.flatMap(d => d.layers[heightLayer]);
  const maxH = Math.max(...allH);
  const allC = dongs.flatMap(d => d.layers[colorLayer]);
  const maxC = Math.max(...allC), minC = Math.min(...allC);

  const points = dongs.map(d => ({
    code: d.code, name: d.name, scenario: d.scenario,
    coordinates: [d.lng, d.lat],
    height: d.layers[heightLayer][currentMonth] / (maxH + 1e-9),
    colorVal: (d.layers[colorLayer][currentMonth] - minC) / (maxC - minC + 1e-9),
    plddt: d.plddt[currentMonth],
    // v0.7: 실데이터 폴리곤
    polygon: d.polygon_geo || null,
    real_adm_nm: d.real_adm_nm || null,
  }));

  const layers = [];
  if (mode === 'columns') {
    // v0.7: 실제 행정동 폴리곤 (GeoJsonLayer) — 점 → 영역 시각화
    const polygonFeatures = points
      .filter(p => p.polygon)
      .map(p => ({
        type: 'Feature',
        properties: { code: p.code, name: p.name, colorVal: p.colorVal,
                      plddt: p.plddt, real_adm_nm: p.real_adm_nm },
        geometry: p.polygon,
      }));

    if (polygonFeatures.length > 0) {
      layers.push(new deck.GeoJsonLayer({
        id: 'analyze-real-polygons',
        data: { type: 'FeatureCollection', features: polygonFeatures },
        pickable: true,
        stroked: true,
        filled: true,
        lineWidthMinPixels: 0.6,
        getFillColor: f => {
          const c = colorGrad(f.properties.colorVal);
          return [c[0], c[1], c[2], 90];  // 반투명 채움
        },
        getLineColor: [255, 255, 255, 70],
        onClick: handlePickAnalyzeFromGeo,
      }));
    } else {
      // 폴리곤 없는 동(simula 폴백) — 기존 원형 영역
      layers.push(new deck.ScatterplotLayer({
        id:'analyze-area', data:points, filled:true, stroked:true, lineWidthMinPixels:0.5,
        radiusUnits:'meters', getRadius:600,
        getPosition:d=>d.coordinates,
        getFillColor:d=>{const c=colorGrad(d.colorVal); return [c[0],c[1],c[2],60];},
        getLineColor:[255,255,255,40],
      }));
    }
    layers.push(new deck.ColumnLayer({
      id:'analyze-cols', data:points, diskResolution:24, radius:320,
      extruded:true, pickable:true, elevationScale:1,
      getPosition:d=>d.coordinates, getElevation:d=>d.height*4500,
      getFillColor:d=>colorGrad(d.colorVal),
      getLineColor:[255,255,255,100], lineWidthMinPixels:1,
      onClick:onPickAnalyze,
    }));
    if (selectedDong) {
      const sel = points.find(p => p.code === selectedDong.code);
      if (sel) {
        layers.push(new deck.ScatterplotLayer({
          id:'analyze-ring', data:[sel], stroked:true, filled:false,
          lineWidthMinPixels:3, radiusUnits:'meters', getRadius:800,
          getPosition:d=>d.coordinates, getLineColor:d=>plddtColor(d.plddt),
        }));
      }
    }
  } else if (mode === 'heat') {
    layers.push(new deck.HeatmapLayer({
      id:'analyze-heat', data:points, getPosition:d=>d.coordinates, getWeight:d=>d.height,
      radiusPixels:60, intensity:1.4, threshold:0.04,
      colorRange:[[0,82,155,80],[91,192,235,140],[254,215,102,200],[254,153,102,230],[201,72,91,250]],
    }));
    layers.push(new deck.ScatterplotLayer({
      id:'analyze-pts', data:points, pickable:true, stroked:true, filled:true,
      lineWidthMinPixels:1, radiusUnits:'meters', getRadius:200,
      getPosition:d=>d.coordinates, getFillColor:d=>colorGrad(d.colorVal),
      getLineColor:[255,255,255,120], onClick:onPickAnalyze,
    }));
  } else {
    layers.push(new deck.HexagonLayer({
      id:'analyze-hex', data:points, pickable:true, extruded:true,
      radius:800, elevationScale:8, coverage:0.85,
      getPosition:d=>d.coordinates, getElevationWeight:d=>d.height, getColorWeight:d=>d.colorVal,
      colorRange:[[0,82,155],[91,192,235],[127,216,229],[254,215,102],[254,153,102],[201,72,91]],
      onClick:onPickAnalyze,
    }));
  }
  return layers;
}

// v0.7: GeoJsonLayer (Feature) → 동 코드 추출 후 onPickAnalyze 위임
function handlePickAnalyzeFromGeo(info) {
  if (info && info.object && info.object.properties && info.object.properties.code) {
    const code = info.object.properties.code;
    onPickAnalyze({ object: { code } });
  }
}

function onPickAnalyze(info) {
  if (info && info.object && info.object.code) {
    selectedDong = DATA.dongs.find(d => d.code === info.object.code) || selectedDong;
    if (analyzeMap) analyzeMap.flyTo({ center:[selectedDong.lng, selectedDong.lat], zoom:11, duration:600 });
    updateAnalyze();
  }
}

function updateAnalyze() {
  if (analyzeOverlay) analyzeOverlay.setProps({ layers: buildAnalyzeLayers() });
  document.getElementById('m-time-current').textContent = DATA.meta.months[currentMonth];

  if (selectedDong) {
    document.getElementById('selected-name').textContent = selectedDong.name;
    document.getElementById('selected-vibe').innerHTML =
      `<span class="vibe-pill vibe-${selectedDong.scenario}">${VIBE_LABEL[selectedDong.scenario]||selectedDong.scenario}</span>`;
    document.getElementById('kpi-visitors').textContent = selectedDong.layers.visitors_total[currentMonth].toLocaleString();
    document.getElementById('kpi-price').textContent = '₩' + (selectedDong.layers.land_price[currentMonth]/10000).toFixed(0) + '만/㎡';
    document.getElementById('kpi-cafe').textContent = selectedDong.layers.biz_cafe[currentMonth].toFixed(0);
    const pl = selectedDong.plddt[currentMonth];
    const k = document.getElementById('kpi-plddt');
    k.textContent = pl.toFixed(1); k.style.color = plddtHex(pl);
  }
}

function bindAnalyzeControls() {
  ['m-height','m-color','m-mode','m-filter'].forEach(id => {
    document.getElementById(id).addEventListener('change', updateAnalyze);
  });
  document.getElementById('time-slider').addEventListener('input', e => {
    currentMonth = +e.target.value;
    updateAnalyze();
  });
  document.getElementById('play-btn').addEventListener('click', () => togglePlay('analyze'));
  document.getElementById('play-speed').addEventListener('change', () => {
    if (playInterval) { clearInterval(playInterval); playInterval = null; togglePlay('analyze'); }
  });
  document.getElementById('dong-a').addEventListener('change', renderWheel);
  document.getElementById('dong-b').addEventListener('change', renderWheel);
  document.getElementById('find-twin').addEventListener('click', () => {
    const aIdx = +document.getElementById('dong-a').value;
    const bIdx = findMostSimilar(aIdx);
    document.getElementById('dong-b').value = bIdx;
    renderWheel();
  });
}

function togglePlay(mode) {
  const speed = +(document.getElementById('play-speed')||{value:200}).value;
  const btn = mode === 'explore' ? document.getElementById('explore-play') : document.getElementById('play-btn');
  const slider = mode === 'explore' ? document.getElementById('explore-slider') : document.getElementById('time-slider');
  if (playInterval) {
    clearInterval(playInterval); playInterval = null;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>';
  } else {
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="white"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>';
    playInterval = setInterval(() => {
      currentMonth = (currentMonth + 1) % 60;
      slider.value = currentMonth;
      if (mode === 'explore') updateExplore(); else updateAnalyze();
    }, speed);
  }
}

// ─────────────────────────────────────────────
// PROFILE WHEEL
// ─────────────────────────────────────────────
function renderWheel() {
  const aIdx = +document.getElementById('dong-a').value;
  const bIdx = +document.getElementById('dong-b').value;
  const A = DATA.dongs[aIdx], B = DATA.dongs[bIdx];
  const layerNames = Object.keys(A.layers);
  const normA=[], normB=[];
  layerNames.forEach(lyr => {
    const all = DATA.dongs.flatMap(d => d.layers[lyr]);
    const max = Math.max(...all), min = Math.min(...all), range = max-min+1e-9;
    normA.push((A.layers[lyr][59]-min)/range);
    normB.push((B.layers[lyr][59]-min)/range);
  });
  const dot = normA.reduce((s,v,i)=>s+v*normB[i], 0);
  const ma = Math.sqrt(normA.reduce((s,v)=>s+v*v,0));
  const mb = Math.sqrt(normB.reduce((s,v)=>s+v*v,0));
  const score = Math.round((dot/(ma*mb+1e-9))*100);
  document.getElementById('twin-score').textContent = score;

  const svg = d3.select('#wheel'); svg.selectAll('*').remove();
  const W=280, H=280, cx=W/2, cy=H/2, Rmin=15, Rmax=110;
  const N = layerNames.length;
  [0.5, 1].forEach(r => {
    svg.append('circle').attr('cx',cx).attr('cy',cy).attr('r',Rmin+(Rmax-Rmin)*r)
      .attr('fill','none').attr('stroke','rgba(255,255,255,0.06)').attr('stroke-dasharray','2,3');
  });
  const angle = i => (i/N)*Math.PI*2 - Math.PI/2;
  const toPts = vals => vals.map((v,i)=>{
    const a = angle(i), r = Rmin+(Rmax-Rmin)*Math.max(0.02, v);
    return [cx+Math.cos(a)*r, cy+Math.sin(a)*r];
  });
  const pA = toPts(normA), pB = toPts(normB);
  svg.append('path').attr('d','M'+pB.map(p=>p.join(',')).join('L')+'Z')
    .attr('fill','rgba(255,143,177,0.15)').attr('stroke','#FF8FB1').attr('stroke-width',1.2);
  svg.append('path').attr('d','M'+pA.map(p=>p.join(',')).join('L')+'Z')
    .attr('fill','rgba(91,192,235,0.18)').attr('stroke','#5BC0EB').attr('stroke-width',1.6);
  pA.forEach(p=>svg.append('circle').attr('cx',p[0]).attr('cy',p[1]).attr('r',1.6).attr('fill','#5BC0EB'));
  pB.forEach(p=>svg.append('circle').attr('cx',p[0]).attr('cy',p[1]).attr('r',1.6).attr('fill','#FF8FB1'));
}

function findMostSimilar(aIdx) {
  const A = DATA.dongs[aIdx];
  const layerNames = Object.keys(A.layers);
  const norm = (d) => layerNames.map(l => {
    const all = DATA.dongs.flatMap(x => x.layers[l]);
    const max = Math.max(...all), min = Math.min(...all);
    return (d.layers[l][59]-min)/(max-min+1e-9);
  });
  const va = norm(A), ma = Math.sqrt(va.reduce((s,v)=>s+v*v,0));
  let best=-1, bs=-1;
  DATA.dongs.forEach((d,i)=>{
    if (i===aIdx) return;
    const vb = norm(d), mb = Math.sqrt(vb.reduce((s,v)=>s+v*v,0));
    const dot = va.reduce((s,v,j)=>s+v*vb[j],0);
    const sc = dot/(ma*mb+1e-9);
    if (sc>bs) { bs=sc; best=i; }
  });
  return best;
}

// ─────────────────────────────────────────────
// EXPLORE MODE
// ─────────────────────────────────────────────
function initExploreMap() {
  exploreMap = makeMap('map-explore');
  exploreMap.on('load', () => {
    exploreOverlay = new deck.MapboxOverlay({ layers: buildExploreLayers(), interleaved:false });
    exploreMap.addControl(exploreOverlay);
  });
}

function buildExploreLayers() {
  const allH = DATA.dongs.flatMap(d => d.layers.visitors_total);
  const maxH = Math.max(...allH);
  const allC = DATA.dongs.flatMap(d => d.layers.biz_cafe);
  const maxC = Math.max(...allC), minC = Math.min(...allC);

  const points = DATA.dongs.map(d => ({
    code:d.code, name:d.name, scenario:d.scenario, coordinates:[d.lng, d.lat],
    height: d.layers.visitors_total[currentMonth]/maxH,
    colorVal: (d.layers.biz_cafe[currentMonth]-minC)/(maxC-minC+1e-9),
    plddt: d.plddt[currentMonth],
  }));

  const layers = [
    new deck.ColumnLayer({
      id:'explore-cols', data:points, diskResolution:24, radius:320,
      extruded:true, pickable:true, getPosition:d=>d.coordinates,
      getElevation:d=>d.height*4500, getFillColor:d=>colorGrad(d.colorVal),
      getLineColor:[255,255,255,100], lineWidthMinPixels:1,
      onClick:onPickExplore,
    })
  ];
  if (selectedDong) {
    const sel = points.find(p=>p.code===selectedDong.code);
    if (sel) layers.push(new deck.ScatterplotLayer({
      id:'explore-ring', data:[sel], stroked:true, filled:false,
      lineWidthMinPixels:3, radiusUnits:'meters', getRadius:800,
      getPosition:d=>d.coordinates, getLineColor:d=>plddtColor(d.plddt),
    }));
  }
  return layers;
}

function onPickExplore(info) {
  if (info && info.object && info.object.code) {
    selectedDong = DATA.dongs.find(d => d.code === info.object.code) || selectedDong;
    if (exploreMap) exploreMap.flyTo({ center:[selectedDong.lng, selectedDong.lat], zoom:11, duration:600 });
    updateExplore();
  }
}

function updateExplore() {
  if (exploreOverlay) exploreOverlay.setProps({ layers: buildExploreLayers() });
  document.getElementById('explore-month').textContent = DATA.meta.months[currentMonth];
  document.getElementById('explore-month-mini').textContent = DATA.meta.months[currentMonth];
  document.getElementById('explore-slider').value = currentMonth;

  if (selectedDong) {
    document.getElementById('explore-selected-name').textContent = selectedDong.name;
    document.getElementById('explore-selected-vibe').innerHTML =
      `<span class="vibe-pill vibe-${selectedDong.scenario}">${VIBE_LABEL[selectedDong.scenario]||selectedDong.scenario}</span>`;
    document.getElementById('ex-kpi-visitors').textContent = selectedDong.layers.visitors_total[currentMonth].toLocaleString();
    document.getElementById('ex-kpi-price').textContent = '₩' + (selectedDong.layers.land_price[currentMonth]/10000).toFixed(0) + '만';
    document.getElementById('ex-kpi-cafe').textContent = selectedDong.layers.biz_cafe[currentMonth].toFixed(0);
    const pl = selectedDong.plddt[currentMonth];
    const k = document.getElementById('ex-kpi-plddt');
    k.textContent = pl.toFixed(1); k.style.color = plddtHex(pl);
    drawExploreTrace();
    writeAutoComment();
  }
}

function drawExploreTrace() {
  const svg = d3.select('#explore-trace'); svg.selectAll('*').remove();
  const layers = ['land_price','tx_volume','visitors_total','biz_count','biz_cafe'];
  const colors = ['#00A1E0','#FED766','#5BC0EB','#B5E853','#FF8FB1'];

  // [C-4] Prophet 예측 있으면 horizon 만큼 가로축 확장
  const fcst = (FORECASTS && FORECASTS.forecasts && FORECASTS.forecasts[selectedDong.code]) || null;
  const horizon = fcst ? FORECASTS.meta.horizon_months : 0;
  const TOTAL_MONTHS = 60 + horizon;  // 과거 60 + 미래 12

  // (C) 호흡 차트 확대 — 360×160 viewBox로 시인성 ↑
  const W=360, H=160;
  // 과거 영역과 미래 영역 분할 — 가로축 60:12 비율
  const x = d3.scaleLinear().domain([0, TOTAL_MONTHS - 1]).range([0, W]);
  const futureX0 = x(60);

  // 미래 영역 배경 (반투명)
  if (horizon > 0) {
    svg.append('rect')
      .attr('x', futureX0).attr('y', 0)
      .attr('width', W - futureX0).attr('height', H)
      .attr('fill', 'rgba(91,192,235,0.06)');
    svg.append('line')
      .attr('x1', futureX0).attr('x2', futureX0)
      .attr('y1', 0).attr('y2', H)
      .attr('stroke', 'rgba(91,192,235,0.4)').attr('stroke-dasharray', '2,3').attr('stroke-width', 0.8);
  }

  layers.forEach((lyr, i) => {
    const vals = selectedDong.layers[lyr];
    const layerForecast = fcst ? fcst[lyr] : null;

    // 전체 범위 (과거 + 미래) min/max
    const allVals = [...vals];
    if (layerForecast) {
      allVals.push(...layerForecast.horizon_p10, ...layerForecast.horizon_p90);
    }
    const max = Math.max(...allVals), min = Math.min(...allVals);
    const y = d3.scaleLinear().domain([min, max]).range([H-4, 4]);

    // 과거 라인 (실선) — 더 두꺼움
    const line = d3.line().x((_,j)=>x(j)).y(d=>y(d)).curve(d3.curveMonotoneX);
    svg.append('path').attr('d',line(vals)).attr('fill','none')
      .attr('stroke',colors[i]).attr('stroke-width',1.6).attr('opacity',0.92);

    // [C-4] 미래 cone (p10~p90 영역) + 중앙선
    if (layerForecast) {
      const p10 = layerForecast.horizon_p10;
      const p50 = layerForecast.horizon_p50;
      const p90 = layerForecast.horizon_p90;
      // cone (p10 위 + p90 아래) — 진하게
      const conePoints = [];
      for (let k = 0; k < horizon; k++) conePoints.push([x(60 + k), y(p90[k])]);
      for (let k = horizon - 1; k >= 0; k--) conePoints.push([x(60 + k), y(p10[k])]);
      svg.append('path')
        .attr('d', 'M' + conePoints.map(p => p.join(',')).join('L') + 'Z')
        .attr('fill', colors[i]).attr('opacity', 0.18);
      // 중앙 예측선 (점선) — 더 두꺼움
      const futurePts = p50.map((v, k) => [x(60 + k), y(v)]);
      svg.append('path')
        .attr('d', 'M' + futurePts.map(p => p.join(',')).join('L'))
        .attr('fill', 'none').attr('stroke', colors[i])
        .attr('stroke-width', 1.4).attr('stroke-dasharray', '3,3').attr('opacity', 0.95);
    }
  });

  // 현재 시점 인디케이터 — 더 진하게
  svg.append('line').attr('x1',x(currentMonth)).attr('x2',x(currentMonth))
    .attr('y1',0).attr('y2',H).attr('stroke','#fff').attr('stroke-width',1.2).attr('opacity',0.75);

  // 시간축 라벨 (확대된 캔버스에 추가)
  if (DATA && DATA.meta && DATA.meta.months) {
    [0, 12, 24, 36, 48, 59].forEach(idx => {
      svg.append('text')
        .attr('x', x(idx)).attr('y', H - 2)
        .attr('text-anchor', 'middle')
        .attr('fill', 'rgba(255,255,255,0.35)').attr('font-size', 7).attr('font-family', 'JetBrains Mono')
        .text(DATA.meta.months[idx].substring(2));  // YY-MM 단축
    });
    if (horizon > 0) {
      svg.append('text')
        .attr('x', x(60 + horizon - 1)).attr('y', H - 2)
        .attr('text-anchor', 'middle')
        .attr('fill', 'rgba(91,192,235,0.65)').attr('font-size', 7).attr('font-family', 'JetBrains Mono')
        .text('+12mo');
    }
  }
}

function writeAutoComment() {
  // 단순 규칙 기반 코멘트
  const d = selectedDong;
  const v0 = d.layers.visitors_total[0], vN = d.layers.visitors_total[currentMonth];
  const growthV = ((vN/v0)-1)*100;
  const c0 = d.layers.biz_cafe[0], cN = d.layers.biz_cafe[currentMonth];
  const growthC = ((cN/c0)-1)*100;
  const cl0 = d.layers.biz_closed.slice(0,12).reduce((s,v)=>s+v,0);
  const clN = d.layers.biz_closed.slice(-12).reduce((s,v)=>s+v,0);
  const closureTrend = clN - cl0;
  const pl = d.plddt[currentMonth];

  const verdict = growthV > 30 ? '🔥 급상승' : growthV > 10 ? '📈 상승세' : growthV < -10 ? '📉 하락' : '➡️ 안정';
  const closureNote = closureTrend > 5 ? '· ⚠️ 폐업 증가 추세' : '';
  const plNote = pl < 60 ? '· 🌫️ 신뢰도 낮음 (구조 불안정)' : '';

  // [C-5] 인과 사슬 정보 추가 (CAUSAL 있을 때)
  let causalHtml = '';
  if (CAUSAL && CAUSAL.dongs && CAUSAL.dongs[d.code]) {
    const dc = CAUSAL.dongs[d.code];
    const labels = CAUSAL.meta.layer_label || {};
    const grangers = (dc.granger || [])
      .sort((a, b) => a.p - b.p)  // p값 작은(유의한) 순
      .slice(0, 3);
    const pearsons = (dc.pearson || [])
      .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
      .slice(0, 2);
    if (grangers.length > 0) {
      causalHtml = `
        <div class="mt-2 pt-2 border-t border-white/10">
          <div class="text-[9px] mono mb-1" style="color:#A78BFA">🧬 인과 사슬 (Granger)</div>
          ${grangers.map(g => `
            <div class="text-[10px] text-gray-300 leading-tight">
              <span style="color:#FED766">${labels[g.cause]||g.cause}</span>
              <span class="text-gray-500 mx-0.5">→ ${g.lag}mo →</span>
              <span style="color:#5BC0EB">${labels[g.effect]||g.effect}</span>
              <span class="text-gray-600 mono text-[9px]"> p=${g.p}</span>
            </div>
          `).join('')}
        </div>
      `;
      if (pearsons.length > 0) {
        causalHtml += `
          <div class="mt-1.5">
            <div class="text-[9px] mono mb-0.5" style="color:#B5E853">↔ 강한 상관 (Pearson)</div>
            ${pearsons.map(p => `
              <div class="text-[10px] text-gray-400 leading-tight">
                ${labels[p.a]||p.a} ↔ ${labels[p.b]||p.b}
                <span class="mono" style="color:#B5E853">r=${p.r}</span>
              </div>
            `).join('')}
          </div>
        `;
      }
    }
  }

  document.getElementById('auto-comment').innerHTML = `
    <div class="space-y-1.5">
      <div><b class="text-cyan-300">${verdict}</b> · 유동인구 5년 ${growthV>=0?'+':''}${growthV.toFixed(1)}%</div>
      <div class="text-gray-400">카페 수 ${growthC>=0?'+':''}${growthC.toFixed(1)}% ${closureNote}</div>
      <div class="text-gray-400">현재 pLDDT ${pl.toFixed(1)} ${plNote}</div>
    </div>
    ${causalHtml}
  `;
}

function bindExploreControls() {
  document.getElementById('explore-slider').addEventListener('input', e => {
    currentMonth = +e.target.value;
    updateExplore();
  });
  document.getElementById('explore-play').addEventListener('click', () => togglePlay('explore'));
}

// ─────────────────────────────────────────────
// AUTO INSIGHT LISTS (이상 탐지 + 급상승)
// ─────────────────────────────────────────────
function renderAutoLists() {
  // 이상 탐지: 최근 6개월 폐업률 평균 / 5년 평균 비율 Top
  const anom = DATA.dongs.map(d => {
    const recent = d.layers.biz_closed.slice(-6).reduce((s,v)=>s+v,0)/6;
    const all = d.layers.biz_closed.reduce((s,v)=>s+v,0)/60;
    return { name:d.name, ratio: recent/(all+1e-9), recent, scenario:d.scenario, code:d.code };
  }).sort((a,b)=>b.ratio-a.ratio).slice(0,5);
  const anomEl = document.getElementById('anomaly-list');
  anomEl.innerHTML = '';
  anom.forEach(a => {
    anomEl.insertAdjacentHTML('beforeend', `
      <div class="insight-card insight-alert rounded-md p-2 cursor-pointer" data-code="${a.code}">
        <div class="text-[11px] font-semibold text-white">${a.name}</div>
        <div class="text-[9px] text-gray-400 mt-0.5">최근 폐업 ${(a.ratio*100).toFixed(0)}% (vs 평균)</div>
      </div>
    `);
  });
  anomEl.querySelectorAll('[data-code]').forEach(el => {
    el.addEventListener('click', () => {
      selectedDong = DATA.dongs.find(d=>d.code===el.dataset.code);
      if (exploreMap) exploreMap.flyTo({ center:[selectedDong.lng, selectedDong.lat], zoom:11, duration:600 });
      updateExplore();
    });
  });

  // 급상승: 5년 유동 성장률 Top
  const rising = DATA.dongs.map(d => {
    const v0 = d.layers.visitors_total[0], vN = d.layers.visitors_total[59];
    return { name:d.name, growth:(vN/v0-1)*100, scenario:d.scenario, code:d.code };
  }).sort((a,b)=>b.growth-a.growth).slice(0,5);
  const riseEl = document.getElementById('rising-list');
  riseEl.innerHTML = '';
  rising.forEach(r => {
    riseEl.insertAdjacentHTML('beforeend', `
      <div class="insight-card insight-positive rounded-md p-2 cursor-pointer" data-code="${r.code}">
        <div class="text-[11px] font-semibold text-white">${r.name}</div>
        <div class="text-[9px] text-gray-400 mt-0.5">5년 유동 +${r.growth.toFixed(1)}%</div>
      </div>
    `);
  });
  riseEl.querySelectorAll('[data-code]').forEach(el => {
    el.addEventListener('click', () => {
      selectedDong = DATA.dongs.find(d=>d.code===el.dataset.code);
      if (exploreMap) exploreMap.flyTo({ center:[selectedDong.lng, selectedDong.lat], zoom:11, duration:600 });
      updateExplore();
    });
  });
}

// ─────────────────────────────────────────────
// DECIDE MODE
// ─────────────────────────────────────────────
function renderDecide() {
  // KPIs
  const last = 59;
  const seoulOnly = DATA.dongs.filter(d=>!d.name.startsWith('부산'));
  const avgV = seoulOnly.reduce((s,d)=>s+d.layers.visitors_total[last],0)/seoulOnly.length;
  const avgP = seoulOnly.reduce((s,d)=>s+d.layers.land_price[last],0)/seoulOnly.length;
  const avgN = seoulOnly.reduce((s,d)=>s+d.layers.biz_new[last],0)/seoulOnly.length;
  const avgPl= seoulOnly.reduce((s,d)=>s+d.plddt[last],0)/seoulOnly.length;
  document.getElementById('d-visitors').textContent = (avgV/1000).toFixed(0)+'k';
  document.getElementById('d-price').textContent = '₩'+(avgP/10000).toFixed(0)+'만';
  document.getElementById('d-newbiz').textContent = avgN.toFixed(0);
  const dpl = document.getElementById('d-plddt');
  dpl.textContent = avgPl.toFixed(1); dpl.style.color = plddtHex(avgPl);

  // chart: 5종 평균 시계열
  const layers = ['land_price','tx_volume','visitors_total','biz_count','biz_cafe'];
  const colors = ['#00A1E0','#FED766','#5BC0EB','#B5E853','#FF8FB1'];
  const names = ['공시지가','거래','유동','소상공인','카페'];

  // [D-1] Prophet 평균 cone 계산 (Decide는 서울 전체 평균이므로 동별 예측 평균)
  const horizon = (FORECASTS && FORECASTS.meta) ? FORECASTS.meta.horizon_months : 0;
  const hasForecast = horizon > 0;
  const TOTAL_T = 60 + (hasForecast ? horizon : 0);

  const W=720, H=280, M={l:40,r:40,t:20,b:30};
  const svg = d3.select('#d-chart'); svg.selectAll('*').remove();
  const x = d3.scaleLinear().domain([0, TOTAL_T - 1]).range([M.l, W-M.r]);

  // x축 ticks (과거 + 미래 끝)
  const tickIdx = hasForecast
    ? [0, 12, 24, 36, 48, 59, 60 + horizon - 1]
    : [0, 12, 24, 36, 48, 59];
  const xAxis = d3.axisBottom(x).tickValues(tickIdx).tickFormat(d => {
    if (d <= 59) return DATA.meta.months[d];
    if (FORECASTS && FORECASTS.forecasts) {
      const firstCode = Object.keys(FORECASTS.forecasts)[0];
      return FORECASTS.forecasts[firstCode][layers[0]].horizon_ds[d - 60] || '';
    }
    return '';
  });
  svg.append('g').attr('transform', `translate(0,${H-M.b})`).call(xAxis)
    .selectAll('text').attr('fill','#9CA3AF').attr('font-size',10).attr('font-family','JetBrains Mono');
  svg.selectAll('.domain, .tick line').attr('stroke','rgba(255,255,255,0.1)');

  // 미래 영역 배경 (반투명) + 구분선
  if (hasForecast) {
    svg.append('rect')
      .attr('x', x(60)).attr('y', M.t)
      .attr('width', x(TOTAL_T - 1) - x(60) + 4).attr('height', H - M.t - M.b)
      .attr('fill', 'rgba(91,192,235,0.04)');
    svg.append('line')
      .attr('x1', x(60)).attr('x2', x(60))
      .attr('y1', M.t).attr('y2', H - M.b)
      .attr('stroke', 'rgba(91,192,235,0.3)').attr('stroke-dasharray', '3,3');
    // 미래 라벨
    svg.append('text').attr('x', x(60) + 6).attr('y', M.t + 14)
      .attr('fill', '#5BC0EB').attr('font-size', 10)
      .attr('font-family', 'JetBrains Mono').attr('font-weight', 600)
      .text('▶ Prophet ' + horizon + 'mo (서울 평균)');
  }

  layers.forEach((lyr, i) => {
    // seoul 평균 historical
    const series = [];
    for (let t=0; t<60; t++) {
      const avg = seoulOnly.reduce((s,d)=>s+d.layers[lyr][t],0)/seoulOnly.length;
      series.push(avg);
    }

    // [D-1] seoul 평균 cone (각 동의 p10/p50/p90을 평균)
    let avgP10 = null, avgP50 = null, avgP90 = null;
    if (hasForecast && FORECASTS.forecasts) {
      avgP10 = new Array(horizon).fill(0);
      avgP50 = new Array(horizon).fill(0);
      avgP90 = new Array(horizon).fill(0);
      let n = 0;
      seoulOnly.forEach(d => {
        const f = FORECASTS.forecasts[d.code];
        if (f && f[lyr]) {
          for (let k = 0; k < horizon; k++) {
            avgP10[k] += f[lyr].horizon_p10[k];
            avgP50[k] += f[lyr].horizon_p50[k];
            avgP90[k] += f[lyr].horizon_p90[k];
          }
          n++;
        }
      });
      if (n > 0) {
        for (let k = 0; k < horizon; k++) {
          avgP10[k] /= n; avgP50[k] /= n; avgP90[k] /= n;
        }
      } else {
        avgP10 = avgP50 = avgP90 = null;
      }
    }

    // 전체 도메인 (과거 + 예측)
    const allVals = [...series];
    if (avgP90) allVals.push(...avgP10, ...avgP90);
    const max = Math.max(...allVals), min = Math.min(...allVals);
    const y = d3.scaleLinear().domain([min, max]).range([H-M.b-5, M.t+5]);

    // 과거 라인
    const line = d3.line().x((_,j)=>x(j)).y(d=>y(d)).curve(d3.curveMonotoneX);
    svg.append('path').attr('d',line(series)).attr('fill','none')
      .attr('stroke',colors[i]).attr('stroke-width',1.8).attr('opacity',0.92);

    // [D-1] 미래 cone + 중앙선
    if (avgP90) {
      const conePoints = [];
      for (let k = 0; k < horizon; k++) conePoints.push([x(60 + k), y(avgP90[k])]);
      for (let k = horizon - 1; k >= 0; k--) conePoints.push([x(60 + k), y(avgP10[k])]);
      svg.append('path')
        .attr('d', 'M' + conePoints.map(p => p.join(',')).join('L') + 'Z')
        .attr('fill', colors[i]).attr('opacity', 0.15);
      const futurePts = avgP50.map((v, k) => [x(60 + k), y(v)]);
      svg.append('path')
        .attr('d', 'M' + futurePts.map(p => p.join(',')).join('L'))
        .attr('fill', 'none').attr('stroke', colors[i])
        .attr('stroke-width', 1.5).attr('stroke-dasharray', '4,3').attr('opacity', 0.95);
    }
  });

  // shocks (과거 영역에만)
  DATA.meta.shocks.forEach(sh => {
    svg.append('line').attr('x1',x(sh.month_idx)).attr('x2',x(sh.month_idx))
      .attr('y1',M.t).attr('y2',H-M.b)
      .attr('stroke', sh.magnitude>0?'#5BC0EB':'#C9485B').attr('stroke-width',0.5).attr('opacity',0.4).attr('stroke-dasharray','3,3');
    svg.append('text').attr('x',x(sh.month_idx)).attr('y',M.t+10)
      .attr('fill', sh.magnitude>0?'#5BC0EB':'#C9485B').attr('font-size',9).attr('text-anchor','middle')
      .attr('font-family','JetBrains Mono').text(sh.type);
  });

  // Top 5 growth
  const growth = DATA.dongs.map(d => {
    const v0 = d.layers.visitors_total[0]+d.layers.biz_new[0]+d.layers.biz_cafe[0];
    const vN = d.layers.visitors_total[59]+d.layers.biz_new[59]+d.layers.biz_cafe[59];
    return { name:d.name, score:vN/v0-1 };
  }).sort((a,b)=>b.score-a.score).slice(0,5);
  const tg = document.getElementById('d-top-growth');
  tg.innerHTML = '';
  growth.forEach((g,i) => {
    tg.insertAdjacentHTML('beforeend', `
      <div class="flex items-center justify-between">
        <span><span class="text-gray-500 mr-1.5 mono">${i+1}.</span>${g.name}</span>
        <span class="font-bold mono" style="color:#5BC0EB">+${(g.score*100).toFixed(1)}%</span>
      </div>
    `);
  });

  // shocks list
  const sh = document.getElementById('d-shocks'); sh.innerHTML = '';
  DATA.meta.shocks.forEach(s => {
    const color = s.magnitude>0?'#5BC0EB':'#C9485B';
    const sign = s.magnitude>0?'+':'';
    sh.insertAdjacentHTML('beforeend', `
      <div class="flex items-center justify-between">
        <span class="text-gray-300">${DATA.meta.months[s.month_idx]} · ${s.type}</span>
        <span style="color:${color}">${sign}${(s.magnitude*100).toFixed(0)}%</span>
      </div>
    `);
  });

  // [C-5] 전국 Top 인과 패턴
  const causalEl = document.getElementById('d-top-causal');
  const causalMetaEl = document.getElementById('d-causal-meta');
  if (causalEl && CAUSAL && CAUSAL.top_causations) {
    const labels = CAUSAL.meta.layer_label || {};
    causalEl.innerHTML = '';
    CAUSAL.top_causations.slice(0, 5).forEach((c, i) => {
      const pctColor = c.support_rate >= 0.3 ? '#A78BFA' : c.support_rate >= 0.2 ? '#FED766' : '#9CA3AF';
      causalEl.insertAdjacentHTML('beforeend', `
        <div class="flex items-center justify-between gap-2 px-1.5 py-1 rounded hover:bg-white/5">
          <span class="text-gray-500 mono text-[9px] w-3">${i+1}.</span>
          <span class="flex-1 text-[10px]">
            <span style="color:#FED766">${labels[c.cause]||c.cause}</span>
            <span class="text-gray-500 mx-0.5">→${c.lag}mo→</span>
            <span style="color:#5BC0EB">${labels[c.effect]||c.effect}</span>
          </span>
          <span class="mono font-bold text-[10px]" style="color:${pctColor}">${(c.support_rate*100).toFixed(0)}%</span>
        </div>
      `);
    });
    causalMetaEl.textContent = `${CAUSAL.meta.dong_count}개 동 분석 · Granger ${CAUSAL.meta.granger_total}건 · 지지율 = 패턴 발견 동 비율`;
  } else if (causalEl) {
    causalEl.innerHTML = '<div class="text-[10px] text-gray-500">causal.json 미로드</div>';
    if (causalMetaEl) causalMetaEl.textContent = '인과 추출 결과 없음';
  }

  // [DECISION_TREE-001] 트리 + 변수 중요도 렌더
  renderDecisionTree();
  renderFeatureImportance();
}

// ─────────────────────────────────────────────
// [DECISION_TREE-001] 분류 트리 시각화
// ─────────────────────────────────────────────
const VIBE_COLOR = {
  premium: '#A78BFA', rising_star: '#FF8FB1', rising: '#5BC0EB',
  youth: '#B5E853', stable: '#9CA3AF', traditional: '#FED766',
  developing: '#FCA5A5', industrial: '#6B7280', residential: '#7DD3FC',
  rising_twin: '#F472B6',
};

function _treeLayout(model) {
  // 간단한 BFS 위치 계산 — 깊이별 등간격 + 형제 간 균등
  const nodes = model.nodes;
  const byId = {};
  nodes.forEach(n => { byId[n.id] = { ...n, x: 0, y: 0, depth: 0 }; });
  // 깊이 계산
  function setDepth(id, d) {
    const n = byId[id];
    if (!n) return;
    n.depth = d;
    if (!n.leaf) { setDepth(n.left, d+1); setDepth(n.right, d+1); }
  }
  setDepth(0, 0);
  // 잎 카운트로 x 위치
  let leafIdx = 0;
  function place(id) {
    const n = byId[id];
    if (n.leaf) { n.x = leafIdx++; return; }
    place(n.left); place(n.right);
    n.x = (byId[n.left].x + byId[n.right].x) / 2;
  }
  place(0);
  return byId;
}

function _classifyDong(model, layout, dong) {
  // dong의 특성을 트리에 통과시켜 분기 경로 반환 (node id 배열)
  if (!dong || !dong.layers) return [];
  const path = [0];
  let cur = 0;
  while (true) {
    const n = layout[cur];
    if (n.leaf) break;
    const fname = n.feature_name;
    let val = 0;
    // feat_name 패턴: "{ko}_평균" or "{ko}_추세" or "인과_lag평균"
    const ko2en = { '소상공': 'biz_count', '카페': 'biz_cafe', '유동': 'visitors_total', '거래': 'tx_volume', '지가': 'land_price' };
    if (fname === '인과_lag평균') {
      const dc = (typeof CAUSAL !== 'undefined' && CAUSAL && CAUSAL.dongs && CAUSAL.dongs[dong.name]) || null;
      if (dc && dc.granger && dc.granger.length) {
        val = dc.granger.reduce((s, g) => s + (g.lag || 0), 0) / dc.granger.length;
      }
    } else {
      const [ko, kind] = fname.split('_');
      const layer = ko2en[ko];
      const arr = dong.layers[layer] || [];
      if (kind === '평균') {
        val = (arr.reduce((s,v)=>s+v,0) / Math.max(1,arr.length)) / 1e6;
      } else if (kind === '추세') {
        const last12 = arr.slice(-12);
        const mean = last12.reduce((s,v)=>s+v,0) / Math.max(1,last12.length);
        if (mean > 0 && last12.length >= 2) {
          const xs = last12.map((_,i)=>i);
          const mx = (last12.length-1)/2;
          const num = xs.reduce((s,x,i)=>s+(x-mx)*(last12[i]-mean),0);
          const den = xs.reduce((s,x)=>s+(x-mx)**2,0);
          val = den ? (num/den)/mean : 0;
        }
      }
    }
    cur = val <= n.threshold ? n.left : n.right;
    path.push(cur);
  }
  return path;
}

function renderDecisionTree() {
  const svg = document.getElementById('d-tree-canvas');
  const meta = document.getElementById('d-tree-meta');
  if (!svg) return;
  if (!TREE_MODEL) {
    svg.innerHTML = '<text x="360" y="160" text-anchor="middle" fill="#9CA3AF" font-size="12" font-family="JetBrains Mono">tree_model.json 미로드 — python decision_tree_train.py 먼저 실행</text>';
    if (meta) meta.textContent = '—';
    return;
  }
  const layout = _treeLayout(TREE_MODEL);
  const allNodes = Object.values(layout);
  const maxDepth = Math.max(...allNodes.map(n=>n.depth));
  const leafNodes = allNodes.filter(n=>n.leaf);
  const nLeaves = leafNodes.length;
  // 좌표 정규화
  const W = 720, H = 320;
  const padX = 40, padY = 28;
  const innerW = W - padX*2, innerH = H - padY*2;
  allNodes.forEach(n => {
    n.px = padX + (n.x / Math.max(1, nLeaves - 1)) * innerW;
    n.py = padY + (n.depth / Math.max(1, maxDepth)) * innerH;
  });
  // 선택된 동의 분기 경로
  const dong = (typeof selectedDong !== 'undefined' && selectedDong) ? selectedDong : null;
  const path = dong ? _classifyDong(TREE_MODEL, layout, dong) : [];
  const onPath = new Set(path);

  let s = '';
  // 엣지
  allNodes.forEach(n => {
    if (n.leaf) return;
    const left = layout[n.left], right = layout[n.right];
    const onL = onPath.has(n.id) && onPath.has(n.left);
    const onR = onPath.has(n.id) && onPath.has(n.right);
    const stroke = (onL || onR) ? '#5BC0EB' : '#2A3445';
    const sw = (onL || onR) ? 2 : 1;
    s += `<path d="M${n.px},${n.py}L${left.px},${left.py}" stroke="${onL?'#5BC0EB':stroke}" stroke-width="${onL?2.5:sw}" fill="none" />`;
    s += `<path d="M${n.px},${n.py}L${right.px},${right.py}" stroke="${onR?'#5BC0EB':stroke}" stroke-width="${onR?2.5:sw}" fill="none" />`;
  });
  // 노드
  allNodes.forEach(n => {
    const isOn = onPath.has(n.id);
    if (n.leaf) {
      const color = VIBE_COLOR[n.class] || '#9CA3AF';
      s += `<rect x="${n.px-30}" y="${n.py-10}" width="60" height="20" rx="4" fill="${color}" stroke="${isOn?'#fff':'#2A3445'}" stroke-width="${isOn?2:0.5}"/>`;
      s += `<text x="${n.px}" y="${n.py+3}" text-anchor="middle" fill="#0F1419" font-size="9" font-family="ui-sans-serif" font-weight="700">${n.class}</text>`;
      s += `<text x="${n.px}" y="${n.py+18}" text-anchor="middle" fill="#A4B0C0" font-size="8" font-family="ui-monospace">n=${n.samples}</text>`;
    } else {
      const fill = isOn ? '#5BC0EB' : '#1A2330';
      const txtColor = isOn ? '#0F1419' : '#E8EEF6';
      s += `<circle cx="${n.px}" cy="${n.py}" r="4.5" fill="${fill}" stroke="#2A3445" stroke-width="1"/>`;
      // 분기 라벨
      const fmtThr = (Math.abs(n.threshold) >= 100) ? n.threshold.toFixed(0) : n.threshold.toFixed(2);
      s += `<text x="${n.px}" y="${n.py-8}" text-anchor="middle" fill="${txtColor}" font-size="8" font-family="ui-monospace">${n.feature_name} ≤ ${fmtThr}</text>`;
    }
  });
  svg.innerHTML = s;

  if (meta) {
    const acc = TREE_MODEL.meta.train_accuracy;
    meta.textContent = `acc=${(acc*100).toFixed(1)}% · depth=${TREE_MODEL.meta.depth} · 잎 ${TREE_MODEL.meta.n_leaves}` + (dong ? ` · 선택: ${dong.name}` : '');
  }
}

function renderFeatureImportance() {
  const svg = document.getElementById('d-tree-importance');
  if (!svg) return;
  if (!TREE_MODEL) {
    svg.innerHTML = '<text x="120" y="100" text-anchor="middle" fill="#9CA3AF" font-size="11" font-family="JetBrains Mono">데이터 없음</text>';
    return;
  }
  const items = TREE_MODEL.feature_importance.filter(f => f.importance > 0).slice(0, 8);
  const W = 240, H = 200;
  const padL = 80, padR = 8, padT = 6, padB = 6;
  const innerW = W - padL - padR;
  const rowH = (H - padT - padB) / Math.max(1, items.length);
  let s = '';
  items.forEach((it, i) => {
    const y = padT + i * rowH;
    const w = it.importance * innerW;
    const color = it.importance >= 0.3 ? '#00529B' : it.importance >= 0.1 ? '#5BC0EB' : it.importance >= 0.05 ? '#FED766' : '#C9485B';
    s += `<text x="${padL-4}" y="${y + rowH/2 + 3}" text-anchor="end" fill="#A4B0C0" font-size="9" font-family="ui-sans-serif">${it.feature}</text>`;
    s += `<rect x="${padL}" y="${y+2}" width="${w}" height="${rowH-4}" rx="2" fill="${color}"/>`;
    s += `<text x="${padL + w + 3}" y="${y + rowH/2 + 3}" fill="#A4B0C0" font-size="8" font-family="ui-monospace">${(it.importance*100).toFixed(1)}%</text>`;
  });
  svg.innerHTML = s;
}

// ─────────────────────────────────────────────
// DATA STUDIO
// ─────────────────────────────────────────────
const DS_PUBLIC_SOURCES = [
  { id:'vworld',  name:'V World',                  desc:'전국 행정구역/지번 폴리곤',         status:'connected', last:'2026-04-28', cycle:'분기', layers:4 },
  { id:'klis',    name:'KLIS 공시지가',            desc:'국토부 토지가격비준표 API',         status:'warning',   last:'2026-04-27', cycle:'연 1회', layers:4 },
  { id:'molit',   name:'국토부 실거래가',          desc:'아파트·연립·단독 매매/전월세',     status:'connected', last:'2026-04-30', cycle:'월',     layers:3 },
  { id:'sgis',    name:'SGIS 통계청',              desc:'행정동 인구·세대·연령',             status:'failed',    last:'2026-04-22', cycle:'월',     layers:5 },
  { id:'odcloud', name:'서울 열린데이터광장',      desc:'지하철·버스 승하차',                status:'connected', last:'2026-05-01', cycle:'일',     layers:4 },
  { id:'biz',     name:'공공데이터 상가업소',      desc:'사업자 등록·업종·주소',             status:'connected', last:'2026-04-29', cycle:'분기', layers:7 },
];
const DS_TOWNIN_SOURCES = [
  { id:'tw_partner', name:'파트너 DB',         desc:'가입·이탈·활동 로그',         status:'connected', last:'2026-05-01 03:00', cycle:'일', layers:3 },
  { id:'tw_pay',     name:'결제 시스템',        desc:'주문·매출·환불',               status:'connected', last:'2026-05-01 03:00', cycle:'시간', layers:3 },
  { id:'tw_user',    name:'유저 행동 로그',     desc:'DAU·검색·전환',                status:'connected', last:'2026-05-01 03:00', cycle:'시간', layers:3 },
  { id:'tw_ad',      name:'광고/프로모션',      desc:'노출·클릭·지출·ROAS',          status:'pending',   last:'-',                cycle:'일', layers:4 },
];

const STATUS_STYLE = {
  connected: { color:'#5BC0EB', label:'연결됨', icon:'●' },
  warning:   { color:'#FED766', label:'경고',   icon:'▲' },
  failed:    { color:'#C9485B', label:'실패',   icon:'✕' },
  pending:   { color:'#9CA3AF', label:'대기',   icon:'○' },
};

let dsActiveTab = 'sources';

function renderDataStudio() {
  // sub-tab buttons
  document.querySelectorAll('[data-ds]').forEach(btn => {
    btn.onclick = () => { dsActiveTab = btn.dataset.ds; switchDsPane(); };
  });
  switchDsPane();
}

function switchDsPane() {
  ['sources','etl','quality','catalog','ai','causal','stack'].forEach(t => {
    const tab = document.querySelector(`[data-ds="${t}"]`);
    const pane = document.getElementById(`ds-${t}`);
    if (tab) {
      tab.classList.toggle('text-white', t === dsActiveTab);
      tab.classList.toggle('text-gray-300', t !== dsActiveTab);
      tab.style.background = t === dsActiveTab ? '#00A1E0' : '';
    }
    if (pane) {
      pane.classList.toggle('hidden', t !== dsActiveTab);
      pane.classList.toggle('block', t === dsActiveTab);
    }
  });
  if (dsActiveTab === 'sources') renderDsSources();
  else if (dsActiveTab === 'etl') renderDsEtl();
  else if (dsActiveTab === 'quality') renderDsQuality();
  else if (dsActiveTab === 'catalog') renderDsCatalog();
  else if (dsActiveTab === 'ai') renderDsAi();
  else if (dsActiveTab === 'causal') renderDsCausal();
  else if (dsActiveTab === 'stack') renderDsStack();
}

// ─────────────────────────────────────────────
// 6개월 솔루션 STACK DAG
// ─────────────────────────────────────────────
const STACK_NODES = [
  // ───── Tier 1 (Month 1-2) — 핵심 ─────
  { id:'st_pg',     x:120, y:80,  label:'PostgreSQL+PostGIS', month:'M1-2', type:'infra',   color:'#5BC0EB',
    tier:1,
    desc:'자체 운영 RDB + PostGIS 공간 (TimescaleDB는 폐기됨 — 일반 PG로 충분)',
    cost:'$30/월 (VPS)', diff:'중', license:'PostgreSQL License (자유)', status:'TIER 1 ✅',
    role:'데이터 마스터 — 모든 시계열·공간·메타 데이터의 단일 진실 원본',
    alt:'Supabase ($25, 벤더 종속) — 거부 / TimescaleDB — 폐기 (312k row는 일반 PG로 충분)' },
  { id:'st_kakao',  x:120, y:220, label:'카카오 로컬 API',     month:'M1-2', type:'infra',   color:'#5BC0EB',
    tier:1,
    desc:'주소↔좌표 변환 + POI 검색',
    cost:'무료 (일 30만)', diff:'하', license:'상업 사용 명시', status:'TIER 1 ✅',
    role:'실시간 좌표 변환, POI 데이터 보강',
    alt:'V World (한도 약함, 승인 대기), 네이버 지도 (라이선스 모호)' },
  { id:'st_sgis',   x:120, y:360, label:'SGIS Plus API',       month:'M1-2', type:'infra',   color:'#5BC0EB',
    tier:1,
    desc:'통계청 공식 행정경계 + 인구통계',
    cost:'무료', diff:'하', license:'공공데이터 (자유)', status:'TIER 1 ✅',
    role:'행정동 폴리곤 + 80개 인구 항목 (성별/연령/세대)',
    alt:'V World (행정경계만), KOSIS (CSV 수동)' },

  // ───── Tier 2 (Month 3) — 부분 ─────
  { id:'st_prophet',x:340, y:100, label:'Prophet (1차)',       month:'M3',   type:'predict', color:'#FF8FB1',
    tier:2,
    desc:'Meta Prophet — 무료 시계열 baseline',
    cost:'무료', diff:'하', license:'MIT', status:'TIER 2 ✅',
    role:'130 동 × 40 레이어 시계열 baseline 예측 + 정확도 측정',
    alt:'AutoARIMA, Statsforecast (Nixtla 무료)' },
  { id:'st_timegpt',x:340, y:200, label:'TimeGPT (조건부)',    month:'M3',   type:'predict', color:'#FF8FB1',
    tier:2,
    desc:'Prophet 정확도 부족 시에만 도입',
    cost:'$99/월 starter (3~4개월만)', diff:'하', license:'Commercial API', status:'조건부',
    role:'Prophet baseline 미달 시 Foundation Model 보강',
    alt:'TimesFM 2.5 (Vertex AI 비용), Chronos-2 (GPU 필요)' },

  // Month 4 — 인과 (Pearson + Granger로 대체, LlamaIndex 연기)
  { id:'st_pearson',x:560, y:200, label:'Pearson + Granger',   month:'M4',   type:'reason',  color:'#FED766',
    tier:2,
    desc:'PostgreSQL SQL + statsmodels로 정량 인과 추출',
    cost:'무료', diff:'중', license:'Open Source', status:'TIER 2 ✅',
    role:'상관계수 + 시차 인과성 검정 → 자체 SVG 워크플로 그래프',
    alt:'LlamaIndex Property Graph ($200~500, Phase 4 연기), MS GraphRAG ($5K~15K, 폐기)' },

  // ───── Tier 3 (연기/폐기) ─────
  { id:'st_llama',  x:560, y:380, label:'LlamaIndex (Phase 4)', month:'M7+', type:'reason', color:'#94A3B8',
    tier:3, deferred: true,
    desc:'⏸ 연기 — Pearson+Granger 한계 명확해질 때 재검토',
    cost:'$50~150/월 + $200~500 인덱싱', diff:'중', license:'Apache 2.0', status:'PHASE 4 연기',
    role:'고급 인과 추출 (LLM 기반) — Phase 4 (Month 7+)',
    alt:'-' },

  // Month 5 — 시각화 (ECharts 보류, d3 유지)
  { id:'st_d3',     x:760, y:200, label:'d3 + Deck.gl 유지',   month:'M5',   type:'viz',     color:'#B5E853',
    tier:1,
    desc:'현재 95점 호평 받은 시각화 그대로 유지 + 학술 PNG export 보강',
    cost:'무료', diff:'하', license:'BSD/MIT', status:'TIER 1 ✅ (유지)',
    role:'Decide/Explore/Workflow 모드 + 학술 보고서 정적 차트',
    alt:'ECharts (분산 위험), Vega-Lite (학습 곡선)' },
  { id:'st_echarts',x:760, y:380, label:'ECharts (Month5 재평가)', month:'M5', type:'viz', color:'#94A3B8',
    tier:3, deferred: true,
    desc:'⏸ 보류 — 시연 청중 피드백 후 필요성 재판단',
    cost:'무료', diff:'하', license:'Apache 2.0', status:'M5 재평가',
    role:'학술 보고서 차트 (필요 시)',
    alt:'-' },

  // Month 6 — 시연 (wkhtmltopdf 유지, Quarto 폐기)
  { id:'st_wkhtml', x:910, y:200, label:'wkhtmltopdf 유지',    month:'M6',   type:'output',  color:'#A78BFA',
    tier:1,
    desc:'기존 파이프라인 유지 — 매뉴얼 22p PDF 검증 완료',
    cost:'무료', diff:'하', license:'GPL/LGPL', status:'TIER 1 ✅ (유지)',
    role:'학술/공공/투자자 보고서 PDF 자동 생성 (CLAUDE.md 표준)',
    alt:'pandoc/weasyprint/reportlab (4단 fallback)' },
  { id:'st_quarto', x:910, y:380, label:'Quarto (폐기)',       month:'-',    type:'output',  color:'#94A3B8',
    tier:3, deferred: true,
    desc:'❌ 폐기 — wkhtmltopdf로 충분, R/Python+LaTeX 학습 부담',
    cost:'-', diff:'-', license:'-', status:'폐기',
    role:'-',
    alt:'-' },

  // 산출물
  { id:'st_alpha',  x:910, y:80,  label:'🎯 작동 알파',         month:'M6',   type:'output',  color:'#00A1E0',
    tier:1,
    desc:'학술/공공 시연 가능한 SaaS Alpha',
    cost:'-', diff:'-', license:'-', status:'목표',
    role:'130개 동 실데이터 + Prophet 예측 + 정량 인과 + 학술 PDF',
    alt:'-' },
];

const STACK_EDGES = [
  // Tier 1 인프라 → Tier 2 예측
  ['st_kakao', 'st_pg'],
  ['st_sgis', 'st_pg'],
  ['st_pg', 'st_prophet'],
  ['st_pg', 'st_timegpt'],
  // Prophet 부족 시 TimeGPT (조건부)
  ['st_prophet', 'st_timegpt'],
  // 예측 → 인과 (Pearson+Granger)
  ['st_pg', 'st_pearson'],
  ['st_prophet', 'st_pearson'],
  // 인과 → 시각화 → 산출물
  ['st_pearson', 'st_d3'],
  ['st_prophet', 'st_d3'],
  ['st_d3', 'st_wkhtml'],
  ['st_pg', 'st_alpha'],
  ['st_d3', 'st_alpha'],
  ['st_wkhtml', 'st_alpha'],
];

const STACK_TYPE_LABEL = {
  infra: 'INFRA', predict: 'PREDICT', reason: 'REASON',
  viz: 'VIZ', output: 'OUTPUT'
};

let stackCostVisible = false;

function renderDsStack() {
  drawStackDag();

  const closeBtn = document.getElementById('stack-detail-close');
  if (closeBtn) closeBtn.onclick = () => document.getElementById('stack-node-detail').style.display = 'none';

  const playBtn = document.getElementById('stack-play');
  if (playBtn) playBtn.onclick = () => animateStackTimeline();

  const costBtn = document.getElementById('stack-cost-toggle');
  if (costBtn) costBtn.onclick = () => {
    stackCostVisible = !stackCostVisible;
    costBtn.style.background = stackCostVisible ? '#FED766' : '';
    costBtn.style.color = stackCostVisible ? '#07101F' : '';
    drawStackDag();
  };
}

function drawStackDag() {
  const svg = d3.select('#stack-dag');
  svg.selectAll('*').remove();
  const W = 880, H = 480;

  // 6개월 컬럼 헤더 (압축 v2 — 4개 핵심 + 보류 표시)
  const COLS = [
    { label:'M1-2 · TIER 1', sub:'인프라 (필수)',     x:120 },
    { label:'M3 · TIER 2',   sub:'예측 (Prophet→TimeGPT)', x:340 },
    { label:'M4 · TIER 2',   sub:'인과 (Pearson+Granger)', x:560 },
    { label:'M5 · 시각화',   sub:'d3 유지 / ECharts 보류', x:760 },
    { label:'M6 · 시연',     sub:'wkhtmltopdf 유지',    x:910 },
  ];
  COLS.forEach(c => {
    svg.append('text').attr('x', c.x).attr('y', 18)
      .attr('text-anchor', 'middle').attr('fill', '#5BC0EB')
      .attr('font-size', 11).attr('font-family', 'JetBrains Mono').attr('font-weight', 700)
      .text(c.label);
    svg.append('text').attr('x', c.x).attr('y', 32)
      .attr('text-anchor', 'middle').attr('fill', 'rgba(230,237,243,0.5)')
      .attr('font-size', 9).attr('font-family', 'Inter').text(c.sub);
  });

  // 6개월 시간축 라인 (점선)
  svg.append('line').attr('x1', 60).attr('x2', W-40).attr('y1', 50).attr('y2', 50)
    .attr('stroke', 'rgba(91,192,235,0.2)').attr('stroke-dasharray', '4,4');

  const nodeMap = Object.fromEntries(STACK_NODES.map(n => [n.id, n]));

  // 엣지 (베지어)
  STACK_EDGES.forEach(([a, b]) => {
    const A = nodeMap[a], B = nodeMap[b];
    if (!A || !B) return;
    svg.append('path')
      .attr('d', `M${A.x+60},${A.y} C${(A.x+B.x)/2+30},${A.y} ${(A.x+B.x)/2-30},${B.y} ${B.x-60},${B.y}`)
      .attr('fill', 'none').attr('stroke', `${A.color}55`).attr('stroke-width', 1.4)
      .attr('stroke-dasharray', '4,3').attr('opacity', 0.7);
  });

  // 노드
  STACK_NODES.forEach(n => {
    const W_NODE = 130, H_NODE = 50;
    const g = svg.append('g').attr('transform', `translate(${n.x},${n.y})`).style('cursor', 'pointer').attr('data-stack-id', n.id);

    // body
    const rect = g.append('rect')
      .attr('x', -W_NODE/2).attr('y', -H_NODE/2).attr('width', W_NODE).attr('height', H_NODE)
      .attr('rx', 7)
      .attr('fill', `${n.color}1a`)
      .attr('stroke', n.color).attr('stroke-width', 1.4);

    // header bar (월/타입)
    g.append('rect')
      .attr('x', -W_NODE/2).attr('y', -H_NODE/2).attr('width', W_NODE).attr('height', 14)
      .attr('rx', 7).attr('fill', `${n.color}40`);
    g.append('text').attr('x', -W_NODE/2 + 6).attr('y', -H_NODE/2 + 10)
      .attr('fill', n.color).attr('font-size', 8.5)
      .attr('font-family', 'JetBrains Mono').attr('font-weight', 600)
      .text(`${STACK_TYPE_LABEL[n.type]} · ${n.month}`);

    // title
    g.append('text').attr('x', 0).attr('y', 6)
      .attr('text-anchor', 'middle').attr('fill', '#E8EDF3')
      .attr('font-size', 10.5).attr('font-family', 'Inter').attr('font-weight', 600)
      .text(n.label);

    // 비용 표시 (토글 시)
    if (stackCostVisible && n.cost && n.cost !== '-') {
      g.append('text').attr('x', 0).attr('y', 19)
        .attr('text-anchor', 'middle').attr('fill', 'rgba(254,215,102,0.85)')
        .attr('font-size', 9).attr('font-family', 'JetBrains Mono')
        .text(n.cost);
    }

    // pulse dot
    g.append('circle').attr('cx', W_NODE/2 - 8).attr('cy', -H_NODE/2 + 7).attr('r', 1.8)
      .attr('fill', n.color)
      .style('animation', 'pulse-r 2.4s ease-in-out infinite');

    // 인터랙션
    g.on('mouseenter', () => rect.attr('stroke-width', 2.6));
    g.on('mouseleave', () => rect.attr('stroke-width', 1.4));
    g.on('click', () => showStackNodeDetail(n));
  });

  // 결정 변경/압축 마커
  const changes = [
    { x: 120, y: 80,  text: '⚠️ Supabase에서 변경', color: '#FED766' },
    { x: 560, y: 200, text: '⚠️ LlamaIndex 대체', color: '#5BC0EB' },
    { x: 760, y: 200, text: '✅ 95점 유지', color: '#B5E853' },
    { x: 910, y: 200, text: '✅ 매뉴얼 검증', color: '#B5E853' },
  ];
  changes.forEach(c => {
    svg.append('text').attr('x', c.x).attr('y', c.y - 38)
      .attr('text-anchor', 'middle').attr('fill', c.color)
      .attr('font-size', 8).attr('font-family', 'JetBrains Mono')
      .text(c.text);
  });

  // 연기/폐기 노드 흐리게
  STACK_NODES.filter(n => n.deferred).forEach(n => {
    svg.select(`[data-stack-id="${n.id}"]`)
      .attr('opacity', 0.45);
  });
}

function showStackNodeDetail(n) {
  const panel = document.getElementById('stack-node-detail');
  panel.style.display = 'block';
  panel.style.borderColor = n.color + '66';

  document.getElementById('stack-detail-month').textContent = `${STACK_TYPE_LABEL[n.type]} · ${n.month}`;
  document.getElementById('stack-detail-month').style.color = n.color;
  document.getElementById('stack-detail-name').textContent = n.label;
  document.getElementById('stack-detail-desc').textContent = n.desc;
  document.getElementById('stack-detail-cost').textContent = n.cost;
  document.getElementById('stack-detail-diff').textContent = n.diff;
  document.getElementById('stack-detail-license').textContent = n.license;
  const stEl = document.getElementById('stack-detail-status');
  stEl.textContent = n.status;
  stEl.style.color = n.status === '목표' ? '#5BC0EB' : '#FED766';
  document.getElementById('stack-detail-role').textContent = n.role;
  document.getElementById('stack-detail-alt').textContent = n.alt;
}

function animateStackTimeline() {
  const svg = d3.select('#stack-dag');
  // 위상 정렬
  const adj = {}, indeg = {}, nodeMap = {};
  STACK_NODES.forEach(n => { adj[n.id] = []; indeg[n.id] = 0; nodeMap[n.id] = n; });
  STACK_EDGES.forEach(([f,t]) => { adj[f].push(t); indeg[t]++; });
  const order = [];
  const queue = STACK_NODES.filter(n => indeg[n.id] === 0).map(n => n.id);
  while (queue.length) {
    const cur = queue.shift();
    order.push(cur);
    adj[cur].forEach(nx => { indeg[nx]--; if (indeg[nx] === 0) queue.push(nx); });
  }

  order.forEach((nid, i) => {
    setTimeout(() => {
      const g = svg.select(`[data-stack-id="${nid}"]`);
      if (!g.empty()) {
        const rect = g.select('rect:first-of-type');
        const node = nodeMap[nid];
        rect.transition().duration(200).attr('stroke-width', 5)
          .style('filter', `drop-shadow(0 0 12px ${node.color})`)
          .transition().duration(550).attr('stroke-width', 1.4)
          .style('filter', 'none');

        // Month 라벨 표시
        const lbl = svg.append('text')
          .attr('x', node.x).attr('y', node.y - 38)
          .attr('text-anchor', 'middle').attr('fill', node.color)
          .attr('font-size', 11).attr('font-family', 'JetBrains Mono').attr('font-weight', 700)
          .attr('opacity', 0).text(`✓ ${node.month}`);
        lbl.transition().duration(200).attr('opacity', 1)
          .transition().delay(900).duration(400).attr('opacity', 0)
          .on('end', () => lbl.remove());
      }
    }, i * 380);

    // 파티클 발사
    setTimeout(() => {
      const outs = STACK_EDGES.filter(([f]) => f === nid);
      outs.forEach(([f,t]) => emitStackParticle(f, t, nodeMap));
    }, i * 380 + 250);
  });
}

function emitStackParticle(fromId, toId, nodeMap) {
  const svg = d3.select('#stack-dag');
  const A = nodeMap[fromId], B = nodeMap[toId];
  if (!A || !B) return;
  const ax = A.x + 60, ay = A.y;
  const bx = B.x - 60, by = B.y;
  const tmpPath = svg.append('path')
    .attr('d', `M${ax},${ay} C${(ax+bx)/2+30},${ay} ${(ax+bx)/2-30},${by} ${bx},${by}`)
    .attr('fill','none').attr('stroke','none');
  const node = tmpPath.node();
  const len = node.getTotalLength();
  const color = A.color;
  const particle = svg.append('circle').attr('r', 3).attr('fill', color)
    .style('filter', `drop-shadow(0 0 6px ${color})`).attr('opacity', 0.95);
  const start = performance.now();
  const dur = 720;
  const step = (now) => {
    const t = (now - start) / dur;
    if (t > 1) { particle.remove(); tmpPath.remove(); return; }
    const pt = node.getPointAtLength(len * t);
    particle.attr('cx', pt.x).attr('cy', pt.y);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ─────────────────────────────────────────────
// AI Pipeline DAG (TimesFM → GraphRAG → Insights → Action)
// ─────────────────────────────────────────────
function renderDsAi() {
  const svg = d3.select('#ai-dag');
  svg.selectAll('*').remove();
  const W = 880, H = 420;

  // 5단계: Input → Preprocess → Model → Reasoning → Output
  const nodes = [
    // Input
    { id:'a_in1', x:60,  y:60,  label:'40 Layers',          type:'input',     color:'#00A1E0' },
    { id:'a_in2', x:60,  y:140, label:'130 Dongs',          type:'input',     color:'#00A1E0' },
    { id:'a_in3', x:60,  y:220, label:'60mo Series',        type:'input',     color:'#00A1E0' },
    { id:'a_in4', x:60,  y:300, label:'Townin Internal',    type:'input',     color:'#00A1E0' },
    // Preprocess
    { id:'a_pre1', x:230, y:100, label:'Normalize',         type:'preprocess', color:'#B5E853' },
    { id:'a_pre2', x:230, y:200, label:'Window 12mo',       type:'preprocess', color:'#B5E853' },
    { id:'a_pre3', x:230, y:300, label:'Cov. Inject (XReg)',type:'preprocess', color:'#B5E853' },
    // Model
    { id:'a_m1', x:420, y:80,  label:'TimesFM 2.5',         type:'model',      color:'#FF8FB1' },
    { id:'a_m2', x:420, y:180, label:'LoRA Adapter',        type:'model',      color:'#FF8FB1' },
    { id:'a_m3', x:420, y:280, label:'Anomaly (IsolationFR)',type:'model',     color:'#FF8FB1' },
    { id:'a_m4', x:420, y:360, label:'GraphRAG (Causal)',   type:'model',      color:'#FF8FB1' },
    // Reasoning
    { id:'a_r1', x:610, y:120, label:'Forecast (p10/50/90)',type:'reasoning',  color:'#FED766' },
    { id:'a_r2', x:610, y:240, label:'pLDDT (0~100)',       type:'reasoning',  color:'#FED766' },
    { id:'a_r3', x:610, y:360, label:'Causal Facts',        type:'reasoning',  color:'#FED766' },
    // Output
    { id:'a_o1', x:790, y:140, label:'🔥 Insight Cards',    type:'output',     color:'#5BC0EB' },
    { id:'a_o2', x:790, y:240, label:'⚠️ Anomaly Alerts',   type:'output',     color:'#5BC0EB' },
    { id:'a_o3', x:790, y:340, label:'🧠 Auto Comment',     type:'output',     color:'#5BC0EB' },
  ];
  const edges = [
    ['a_in1','a_pre1'],['a_in2','a_pre1'],['a_in3','a_pre2'],['a_in4','a_pre3'],
    ['a_pre1','a_m1'],['a_pre1','a_m2'],['a_pre2','a_m1'],['a_pre2','a_m3'],
    ['a_pre3','a_m1'],['a_pre3','a_m4'],
    ['a_m1','a_r1'],['a_m2','a_r1'],['a_m1','a_r2'],['a_m3','a_r2'],['a_m4','a_r3'],
    ['a_r1','a_o1'],['a_r2','a_o1'],['a_r2','a_o2'],['a_r1','a_o2'],['a_r3','a_o3'],['a_r1','a_o3'],
  ];
  const nodeMap = Object.fromEntries(nodes.map(n=>[n.id,n]));

  // edges (베지어)
  edges.forEach(([a,b]) => {
    const A = nodeMap[a], B = nodeMap[b];
    svg.append('path')
      .attr('d', `M${A.x+50},${A.y} C${(A.x+B.x)/2+30},${A.y} ${(A.x+B.x)/2-30},${B.y} ${B.x-50},${B.y}`)
      .attr('fill','none').attr('stroke','rgba(255,143,177,0.25)').attr('stroke-width',1);
  });

  // nodes
  nodes.forEach(n => {
    const g = svg.append('g').attr('transform', `translate(${n.x},${n.y})`).style('cursor','pointer').attr('data-ai-node-id', n.id);
    const rect = g.append('rect').attr('x',-50).attr('y',-15).attr('width',100).attr('height',30)
      .attr('rx',6).attr('fill', `${n.color}22`).attr('stroke', n.color).attr('stroke-width',1.2);
    g.append('text').attr('text-anchor','middle').attr('alignment-baseline','middle').attr('y',1)
      .attr('fill','#E8EDF3').attr('font-size',10).attr('font-family','Inter').attr('font-weight',600).text(n.label);
    g.append('circle').attr('cx',45).attr('cy',-12).attr('r',2.5).attr('fill', n.color)
      .style('animation','pulse-r 2s ease-in-out infinite');
    g.on('click', () => showAiNodeDetail(n));
    g.on('mouseenter', () => rect.attr('stroke-width', 2.5));
    g.on('mouseleave', () => rect.attr('stroke-width', 1.2));
  });

  // 5단계 컬럼 헤더
  ['Input','Preprocess','Model','Reasoning','Output'].forEach((label, i) => {
    const xs = [60, 230, 420, 610, 790];
    svg.append('text').attr('x', xs[i]).attr('y', 18)
      .attr('text-anchor','middle').attr('fill','#9CA3AF')
      .attr('font-size',10).attr('font-family','JetBrains Mono').text(label);
  });

  // close 버튼
  const closeBtn = document.getElementById('ai-detail-close');
  if (closeBtn) closeBtn.onclick = () => document.getElementById('ai-node-detail').style.display = 'none';

  // 추론 시뮬 버튼
  const runBtn = document.getElementById('ai-run-all');
  if (runBtn) runBtn.onclick = () => animateAiPipeline(nodes, edges, nodeMap);
}

function showAiNodeDetail(n) {
  const panel = document.getElementById('ai-node-detail');
  panel.style.display = 'block';
  panel.style.borderColor = n.color + '66';

  const META = {
    a_in1: { desc:'40개 시계열 레이어 입력 (5종 카테고리)', model:'-', acc:'-', time:'-', params:'shape=(130,40,60)', status:'OK' },
    a_in2: { desc:'서울 25구 × 5동 + 부산 5동 = 130개 단백질', model:'-', acc:'-', time:'-', params:'count=130 · area=Seoul+Busan', status:'OK' },
    a_in3: { desc:'2020-01 ~ 2024-12 월 단위 시계열', model:'-', acc:'-', time:'-', params:'start=2020-01 · end=2024-12 · grain=month', status:'OK' },
    a_in4: { desc:'Townin 내부 4종 (파트너/매출/유저/광고) 13 레이어', model:'-', acc:'-', time:'-', params:'tw_partner|sales|user|ad', status:'OK' },
    a_pre1:{ desc:'전국 percentile 기반 0~1 정규화', model:'sklearn StandardScaler', acc:'-', time:'1.2s', params:'method=robust · clip=[0.01, 0.99]', status:'OK' },
    a_pre2:{ desc:'12개월 rolling window로 트렌드/계절성 분리', model:'STL Decomposition', acc:'-', time:'2.8s', params:'window=12 · seasonal=12', status:'OK' },
    a_pre3:{ desc:'명절·정책 충격 등 외생변수 주입 (TimesFM XReg)', model:'-', acc:'-', time:'0.4s', params:'covariates=[holiday, policy_shock]', status:'OK' },
    a_m1:  { desc:'Google TimesFM 2.5 (200M, decoder-only Transformer)', model:'timesfm-2.5-200m-pytorch', acc:'MASE 0.82', time:'62.8s', params:'horizon=60 · context=1024 · quantiles=[0.1,0.5,0.9]', status:'OK' },
    a_m2:  { desc:'한국 데이터 LoRA 파인튜닝 (성수·강남·부산 학습)', model:'PEFT LoRA r=16', acc:'+12% vs zero-shot', time:'18.4s', params:'rank=16 · alpha=32 · dropout=0.05', status:'OK' },
    a_m3:  { desc:'예측 신뢰구간(p10~p90) 이탈 동 자동 탐지', model:'IsolationForest + Quantile Breach', acc:'F1 0.78', time:'4.2s', params:'contamination=0.05 · n_estimators=120', status:'OK' },
    a_m4:  { desc:'GraphRAG로 경제 사슬 인과 관계 추출 (LLM + Vector Store)', model:'MS GraphRAG + Claude', acc:'precision 0.71', time:'24.6s', params:'depth=2 · community=leiden · llm=claude-haiku', status:'BETA' },
    a_r1:  { desc:'각 동·레이어별 5년 horizon 예측 (10/50/90 percentile)', model:'-', acc:'-', time:'1.1s', params:'rows=126,000 · 3 quantiles', status:'OK' },
    a_r2:  { desc:'AlphaFold pLDDT 동일 스케일 (0~100) 예측 신뢰도', model:'-', acc:'-', time:'0.8s', params:'bins=[<50, 50-70, 70-90, 90+]', status:'OK' },
    a_r3:  { desc:'(원인→결과) 형식의 인과 사실 트리플렛 추출', model:'-', acc:'-', time:'2.1s', params:'facts=428 · communities=14', status:'OK' },
    a_o1:  { desc:'갤러리·Explore에 표시되는 자동 인사이트 카드', model:'-', acc:'-', time:'0.3s', params:'top_k=10 · refresh=daily', status:'OK' },
    a_o2:  { desc:'Slack/이메일로 발화되는 알람 카드', model:'-', acc:'-', time:'0.4s', params:'channel=master_team · severity≥P2', status:'OK' },
    a_o3:  { desc:'Explore 모드에서 동 클릭 시 자동 생성 코멘트', model:'-', acc:'-', time:'0.5s', params:'template=auto · llm=haiku', status:'OK' },
  };
  const m = META[n.id] || {desc:'(미정)', model:'-', acc:'-', time:'-', params:'-', status:'-'};
  document.getElementById('ai-detail-cat').textContent = n.type.toUpperCase();
  document.getElementById('ai-detail-cat').style.color = n.color;
  document.getElementById('ai-detail-name').textContent = n.label;
  document.getElementById('ai-detail-desc').textContent = m.desc;
  document.getElementById('ai-detail-model').textContent = m.model;
  document.getElementById('ai-detail-acc').textContent = m.acc;
  document.getElementById('ai-detail-time').textContent = m.time;
  document.getElementById('ai-detail-status').textContent = m.status;
  document.getElementById('ai-detail-params').textContent = m.params;
}

function animateAiPipeline(nodes, edges, nodeMap) {
  // 위상 정렬
  const adj = {}, indeg = {};
  nodes.forEach(n => { adj[n.id] = []; indeg[n.id] = 0; });
  edges.forEach(([f,t]) => { adj[f].push(t); indeg[t]++; });
  const order = [];
  const queue = nodes.filter(n => indeg[n.id] === 0).map(n => n.id);
  while (queue.length) {
    const cur = queue.shift();
    order.push(cur);
    adj[cur].forEach(nx => { indeg[nx]--; if (indeg[nx] === 0) queue.push(nx); });
  }

  const svg = d3.select('#ai-dag');
  order.forEach((nid, i) => {
    setTimeout(() => {
      const g = svg.select(`[data-ai-node-id="${nid}"]`);
      if (!g.empty()) {
        const rect = g.select('rect:first-of-type');
        const node = nodeMap[nid];
        rect.transition().duration(180).attr('stroke-width', 5)
          .style('filter', `drop-shadow(0 0 10px ${node.color})`)
          .transition().duration(520).attr('stroke-width', 1.2)
          .style('filter', 'none');
      }
    }, i * 220);

    // 파티클 발사
    setTimeout(() => {
      const outs = edges.filter(([f]) => f === nid);
      outs.forEach(([f,t]) => emitAiParticle(f, t, nodeMap));
    }, i * 220 + 150);
  });
}

function emitAiParticle(fromId, toId, nodeMap) {
  const svg = d3.select('#ai-dag');
  const A = nodeMap[fromId], B = nodeMap[toId];
  if (!A || !B) return;
  const ax = A.x + 50, ay = A.y;
  const bx = B.x - 50, by = B.y;
  const tmpPath = svg.append('path')
    .attr('d', `M${ax},${ay} C${(ax+bx)/2+30},${ay} ${(ax+bx)/2-30},${by} ${bx},${by}`)
    .attr('fill','none').attr('stroke','none');
  const node = tmpPath.node();
  const len = node.getTotalLength();
  const color = A.color;

  const particle = svg.append('circle').attr('r', 2.6).attr('fill', color)
    .style('filter', `drop-shadow(0 0 4px ${color})`).attr('opacity', 0.95);
  const start = performance.now();
  const dur = 600;
  const step = (now) => {
    const t = (now - start) / dur;
    if (t > 1) { particle.remove(); tmpPath.remove(); return; }
    const pt = node.getPointAtLength(len * t);
    particle.attr('cx', pt.x).attr('cy', pt.y);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderDsSources() {
  const renderList = (el, items) => {
    el.innerHTML = '';
    items.forEach(s => {
      const st = STATUS_STYLE[s.status];
      el.insertAdjacentHTML('beforeend', `
        <div class="flex items-center gap-3 p-2.5 rounded-md hover:bg-white/5 transition cursor-pointer">
          <span class="text-base mono" style="color:${st.color}">${st.icon}</span>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-[12px] font-semibold text-white truncate">${s.name}</span>
              <span class="text-[9px] mono px-1.5 py-0.5 rounded" style="background:${st.color}22;color:${st.color}">${st.label}</span>
            </div>
            <div class="text-[10px] text-gray-400 truncate">${s.desc}</div>
          </div>
          <div class="text-right text-[9px] mono text-gray-400 whitespace-nowrap">
            <div>${s.cycle}</div>
            <div>${s.layers} layers</div>
          </div>
          <button class="text-[10px] mono text-cyan-300 hover:text-white px-2">▶ 갱신</button>
        </div>
      `);
    });
  };
  renderList(document.getElementById('public-sources'), DS_PUBLIC_SOURCES);
  renderList(document.getElementById('townin-sources'), DS_TOWNIN_SOURCES);

  // schedule strip — 24시간 timeline
  const sc = document.getElementById('schedule-strip');
  sc.innerHTML = '';
  const slots = [];
  for (let h=0; h<24; h++) slots.push(h);
  // 가상 스케줄
  const events = [
    { h:3,  src:'Townin 결제',   color:'#00A1E0' },
    { h:3,  src:'유저 행동',     color:'#5BC0EB' },
    { h:6,  src:'서울 지하철',   color:'#B5E853' },
    { h:9,  src:'국토부 거래',   color:'#FED766' },
    { h:12, src:'파트너 DB',     color:'#00A1E0' },
    { h:15, src:'V World',       color:'#FF8FB1' },
    { h:18, src:'공공 상가',     color:'#FED766' },
    { h:21, src:'KLIS 재시도',   color:'#FED766' },
  ];
  const eventsByHour = {};
  events.forEach(e => { (eventsByHour[e.h] ||= []).push(e); });
  let html = '<div class="grid grid-cols-24 gap-0.5" style="grid-template-columns:repeat(24,1fr)">';
  slots.forEach(h => {
    const evs = eventsByHour[h] || [];
    const has = evs.length > 0;
    html += `
      <div class="relative" style="height:42px">
        <div class="absolute inset-x-0 bottom-0 rounded-sm" style="height:${has?'70%':'15%'}; background:${has?evs[0].color:'rgba(255,255,255,0.05)'}; opacity:${has?0.85:1}"></div>
        <div class="absolute inset-x-0 -bottom-4 text-center text-[8px] mono text-gray-500">${h.toString().padStart(2,'0')}</div>
        ${has ? `<div class="absolute inset-x-0 -top-4 text-center text-[8px] mono" style="color:${evs[0].color}">${evs[0].src}</div>` : ''}
      </div>
    `;
  });
  html += '</div>';
  sc.innerHTML = html;
}

function renderDsEtl() {
  const svg = d3.select('#etl-dag');
  svg.selectAll('*').remove();
  const W = 880, H = 380;

  // DAG nodes — 5단계 파이프라인
  const nodes = [
    // raw sources (col 0)
    { id:'s1', x:60,  y:50,  label:'V World',         type:'source', color:'#5BC0EB' },
    { id:'s2', x:60,  y:110, label:'KLIS',            type:'source', color:'#FED766' },
    { id:'s3', x:60,  y:170, label:'국토부 거래',     type:'source', color:'#5BC0EB' },
    { id:'s4', x:60,  y:230, label:'서울 지하철',     type:'source', color:'#5BC0EB' },
    { id:'s5', x:60,  y:290, label:'공공 상가',       type:'source', color:'#5BC0EB' },
    { id:'s6', x:60,  y:350, label:'Townin 내부 4종', type:'source', color:'#00A1E0' },
    // ingest (col 1)
    { id:'i1', x:240, y:80,  label:'정규화',          type:'transform', color:'#B5E853' },
    { id:'i2', x:240, y:200, label:'좌표/매핑',       type:'transform', color:'#B5E853' },
    { id:'i3', x:240, y:320, label:'시계열 정렬',     type:'transform', color:'#B5E853' },
    // enrich (col 2)
    { id:'e1', x:420, y:120, label:'레이어 결합',     type:'enrich',   color:'#FED766' },
    { id:'e2', x:420, y:260, label:'공간 보간',       type:'enrich',   color:'#FED766' },
    // model (col 3)
    { id:'m1', x:600, y:120, label:'TimesFM 추론',    type:'model',    color:'#FF8FB1' },
    { id:'m2', x:600, y:260, label:'pLDDT 산출',      type:'model',    color:'#FF8FB1' },
    // sink (col 4)
    { id:'k1', x:790, y:190, label:'SQLite + Cache',  type:'sink',     color:'#00A1E0' },
  ];
  const edges = [
    ['s1','i2'],['s2','i1'],['s3','i1'],['s4','i3'],['s5','i1'],['s6','i1'],['s6','i3'],
    ['i1','e1'],['i2','e1'],['i2','e2'],['i3','e1'],['i3','e2'],
    ['e1','m1'],['e2','m1'],['e1','m2'],['e2','m2'],
    ['m1','k1'],['m2','k1']
  ];
  const nodeMap = Object.fromEntries(nodes.map(n=>[n.id,n]));

  // edges
  edges.forEach(([a,b]) => {
    const A = nodeMap[a], B = nodeMap[b];
    svg.append('path')
      .attr('d', `M${A.x+50},${A.y} C${(A.x+B.x)/2+30},${A.y} ${(A.x+B.x)/2-30},${B.y} ${B.x-50},${B.y}`)
      .attr('fill','none').attr('stroke','rgba(91,192,235,0.25)').attr('stroke-width',1);
  });

  // nodes
  nodes.forEach(n => {
    const g = svg.append('g').attr('transform', `translate(${n.x},${n.y})`).style('cursor','pointer');
    const rect = g.append('rect').attr('x',-50).attr('y',-15).attr('width',100).attr('height',30)
      .attr('rx',6).attr('fill', `${n.color}22`).attr('stroke', n.color).attr('stroke-width',1.2);
    g.append('text').attr('text-anchor','middle').attr('alignment-baseline','middle').attr('y',1)
      .attr('fill','#E8EDF3').attr('font-size',10).attr('font-family','Inter').attr('font-weight',600).text(n.label);
    g.append('circle').attr('cx',45).attr('cy',-12).attr('r',2.5).attr('fill', n.color)
      .style('animation','pulse-r 2s ease-in-out infinite');
    g.on('click', () => showEtlNodeDetail(n));
    g.on('mouseenter', () => rect.attr('stroke-width', 2.5));
    g.on('mouseleave', () => rect.attr('stroke-width', 1.2));
  });

  // node detail close
  const closeBtn = document.getElementById('etl-detail-close');
  if (closeBtn) closeBtn.onclick = () => document.getElementById('etl-node-detail').style.display = 'none';
}

function showEtlNodeDetail(n) {
  const panel = document.getElementById('etl-node-detail');
  panel.style.display = 'block';
  panel.style.borderColor = n.color + '66';

  // 가상 메타데이터
  const META = {
    s1: { desc:'전국 행정구역/지번 폴리곤', runtime:'2.3s', rows:'3,500', last:'2026-04-28', status:'OK',
          params:'fmt=geojson · simplify=0.001', logs:['04-28 03:14 ✓ 3,500 dongs','04-25 03:14 ✓ 3,500','04-22 03:14 ✓ 3,498','04-19 03:14 ✓ 3,500','04-16 03:14 ✓ 3,500'] },
    s2: { desc:'국토부 토지가격비준표 API', runtime:'12.4s', rows:'3,500', last:'2026-04-27', status:'WARN',
          params:'year=2025 · gu=ALL', logs:['04-27 03:18 ⚠ 3,500 (rate-limit)','04-26 03:18 ✓ 3,500','04-25 03:18 ✓ 3,500','04-24 03:18 ✓ 3,500','04-23 03:18 ✓ 3,500'] },
    s3: { desc:'아파트·연립·단독 매매/전월세', runtime:'45.2s', rows:'180,000', last:'2026-04-30', status:'OK',
          params:'period=2024-01..2024-12', logs:['04-30 03:22 ✓ 180k','04-29 03:22 ✓ 178k','04-28 03:22 ✓ 181k','04-27 03:22 ✓ 179k','04-26 03:22 ✓ 180k'] },
    s4: { desc:'서울 지하철 일별 승하차', runtime:'8.1s', rows:'1,200', last:'2026-05-01', status:'OK',
          params:'station=ALL · date=daily', logs:['05-01 03:00 ✓ 1,200','04-30 03:00 ✓ 1,200','04-29 03:00 ✓ 1,200','04-28 03:00 ✓ 1,196','04-27 03:00 ✓ 1,200'] },
    s5: { desc:'사업자 등록·업종·주소 (분기)', runtime:'92.5s', rows:'2,800,000', last:'2026-04-29', status:'OK',
          params:'quarter=2025Q1', logs:['04-29 04:00 ✓ 2.8M','04-22 04:00 ✓ 2.8M','04-15 04:00 ✓ 2.8M','04-08 04:00 ✓ 2.8M','04-01 04:00 ✓ 2.8M'] },
    s6: { desc:'Townin 4종 (파트너/매출/유저/광고)', runtime:'18.7s', rows:'520,000', last:'2026-05-01', status:'OK',
          params:'realtime=true · interval=1h', logs:['05-01 03:00 ✓ 520k','05-01 02:00 ✓ 519k','05-01 01:00 ✓ 521k','05-01 00:00 ✓ 520k','04-30 23:00 ✓ 520k'] },
    i1: { desc:'필드 매핑·타입 변환·결측 처리', runtime:'3.8s', rows:'2,983,500', last:'2026-05-01', status:'OK',
          params:'schema_v=3.1 · null_strategy=interpolate', logs:['05-01 03:05 ✓ 2.98M','04-30 03:05 ✓ 2.95M','04-29 03:05 ✓ 2.97M','04-28 03:05 ✓ 2.96M','04-27 03:05 ✓ 2.98M'] },
    i2: { desc:'좌표계 변환 (EPSG:5179 → 4326) + 동 매핑', runtime:'2.1s', rows:'3,500', last:'2026-05-01', status:'OK',
          params:'src_epsg=5179 · dst_epsg=4326', logs:['05-01 03:08 ✓ 3,500','04-30 03:08 ✓ 3,500','04-29 03:08 ✓ 3,500','04-28 03:08 ✓ 3,498','04-27 03:08 ✓ 3,500'] },
    i3: { desc:'시간 grain 정렬 (월/일/시간)', runtime:'1.5s', rows:'210,000', last:'2026-05-01', status:'OK',
          params:'granularity=auto', logs:['05-01 03:10 ✓ 210k','04-30 03:10 ✓ 209k','04-29 03:10 ✓ 211k','04-28 03:10 ✓ 210k','04-27 03:10 ✓ 210k'] },
    e1: { desc:'40개 레이어를 동×시점 매트릭스로 결합', runtime:'5.2s', rows:'8,400,000', last:'2026-05-01', status:'OK',
          params:'layers=40 · join=full_outer', logs:['05-01 03:13 ✓ 8.4M','04-30 03:13 ✓ 8.3M','04-29 03:13 ✓ 8.4M','04-28 03:13 ✓ 8.4M','04-27 03:13 ✓ 8.4M'] },
    e2: { desc:'정류장→영역 가중 평균 + Kriging 보간', runtime:'14.3s', rows:'3,500', last:'2026-05-01', status:'OK',
          params:'method=ordinary_kriging · range=1500m', logs:['05-01 03:18 ✓ 3,500','04-30 03:18 ✓ 3,500','04-29 03:18 ✓ 3,500','04-28 03:18 ✓ 3,498','04-27 03:18 ✓ 3,500'] },
    m1: { desc:'TimesFM 2.5 5년 horizon 예측 (LoRA 파인튜닝)', runtime:'62.8s', rows:'126,000', last:'2026-05-01', status:'OK',
          params:'model=timesfm-2.5-200m · horizon=60mo · quantiles=[0.1,0.5,0.9]', logs:['05-01 03:32 ✓ 126k forecasts','04-30 03:32 ✓ 126k','04-29 03:32 ✓ 126k','04-28 03:32 ✓ 126k','04-27 03:32 ✓ 126k'] },
    m2: { desc:'예측 신뢰도 산출 (AlphaFold pLDDT 동일 스케일 0~100)', runtime:'4.7s', rows:'210,000', last:'2026-05-01', status:'OK',
          params:'scale=alphafold · bins=[<50, 50-70, 70-90, 90+]', logs:['05-01 03:33 ✓ 210k','04-30 03:33 ✓ 209k','04-29 03:33 ✓ 211k','04-28 03:33 ✓ 210k','04-27 03:33 ✓ 210k'] },
    k1: { desc:'SQLite WAL + Litestream 백업 + 캐시 워밍', runtime:'8.9s', rows:'8,400,000', last:'2026-05-01', status:'OK',
          params:'db=towningraph.db · wal=true · cache_warmup=true', logs:['05-01 03:42 ✓ 8.4M (32MB)','04-30 03:42 ✓ 8.3M','04-29 03:42 ✓ 8.4M','04-28 03:42 ✓ 8.4M','04-27 03:42 ✓ 8.4M'] },
  };
  const m = META[n.id] || {desc:'(미정)', runtime:'-', rows:'-', last:'-', status:'-', params:'-', logs:[]};

  document.getElementById('etl-detail-cat').textContent = n.type.toUpperCase();
  document.getElementById('etl-detail-cat').style.color = n.color;
  document.getElementById('etl-detail-name').textContent = n.label;
  document.getElementById('etl-detail-desc').textContent = m.desc;
  document.getElementById('etl-detail-runtime').textContent = m.runtime;
  document.getElementById('etl-detail-rows').textContent = m.rows;
  document.getElementById('etl-detail-last').textContent = m.last;
  const stEl = document.getElementById('etl-detail-status');
  stEl.textContent = m.status;
  stEl.style.color = m.status === 'OK' ? '#5BC0EB' : m.status === 'WARN' ? '#FED766' : '#FF8FB1';
  document.getElementById('etl-detail-params').textContent = m.params;

  const log = document.getElementById('etl-detail-log');
  log.innerHTML = '';
  m.logs.forEach(l => log.insertAdjacentHTML('beforeend', `<div class="text-[10px] mono text-gray-400">${l}</div>`));

  // column labels
  ['Sources','Ingest','Enrich','Model','Sink'].forEach((label, i) => {
    svg.append('text')
      .attr('x', [60, 240, 420, 600, 790][i]).attr('y', 18)
      .attr('text-anchor','middle').attr('fill','#9CA3AF')
      .attr('font-size',10).attr('font-family','JetBrains Mono').text(label);
  });
}

function renderDsQuality() {
  // 1) pLDDT bar chart per layer category
  const svgB = d3.select('#quality-plddt-bars');
  svgB.selectAll('*').remove();
  const W=380, H=320, M={l:120, r:20, t:10, b:20};
  const cats = Object.entries(DATA.meta.layer_categories);
  // 카테고리별 평균 pLDDT (가상값)
  const catScores = cats.map(([k]) => {
    const isInternal = k.startsWith('townin');
    const score = isInternal ? 88 + Math.random()*8 : 72 + Math.random()*16;
    return { name:k, score:+score.toFixed(1), internal:isInternal };
  }).sort((a,b)=>b.score-a.score);

  const x = d3.scaleLinear().domain([0,100]).range([M.l, W-M.r]);
  const y = d3.scaleBand().domain(catScores.map(d=>d.name)).range([M.t, H-M.b]).padding(0.25);

  catScores.forEach(c => {
    svgB.append('rect').attr('x',M.l).attr('y',y(c.name))
      .attr('width', x(c.score)-M.l).attr('height', y.bandwidth())
      .attr('fill', plddtHex(c.score)).attr('rx',2);
    svgB.append('text').attr('x',M.l-8).attr('y', y(c.name)+y.bandwidth()/2)
      .attr('text-anchor','end').attr('alignment-baseline','middle')
      .attr('fill','#E8EDF3').attr('font-size',10).attr('font-family','JetBrains Mono')
      .text(c.name);
    svgB.append('text').attr('x', x(c.score)+4).attr('y', y(c.name)+y.bandwidth()/2)
      .attr('alignment-baseline','middle').attr('fill','#9CA3AF').attr('font-size',9)
      .attr('font-family','JetBrains Mono').text(c.score);
  });

  // 2) heatmap — 30 dongs x 60 months (sample)
  const svgH = d3.select('#quality-heatmap');
  svgH.selectAll('*').remove();
  const HW=720, HH=320;
  const sampleDongs = DATA.dongs.slice(0, 30);
  const cellW = HW / 60;
  const cellH = (HH - 30) / sampleDongs.length;
  sampleDongs.forEach((d, i) => {
    d.plddt.forEach((p, j) => {
      svgH.append('rect').attr('x', j*cellW).attr('y', 25 + i*cellH)
        .attr('width', cellW-0.3).attr('height', cellH-0.3)
        .attr('fill', plddtHex(p)).attr('opacity', 0.85);
    });
    if (i % 3 === 0) {
      svgH.append('text').attr('x', -2).attr('y', 25 + i*cellH + cellH/2 + 3)
        .attr('text-anchor','end').attr('fill','#9CA3AF').attr('font-size',7).attr('font-family','JetBrains Mono')
        .text(d.name.split(' ')[0]||d.name);
    }
  });
  [0,12,24,36,48,59].forEach(t => {
    svgH.append('text').attr('x', t*cellW).attr('y', 18)
      .attr('text-anchor','middle').attr('fill','#9CA3AF').attr('font-size',8).attr('font-family','JetBrains Mono')
      .text(DATA.meta.months[t]);
  });

  // 3) alarms
  const al = document.getElementById('quality-alarms');
  al.innerHTML = '';
  const alarms = [
    { type:'alert', title:'KLIS 갱신 지연', msg:'마지막 갱신 6일 전 — 정상 1일 주기 위반', layer:'land_price' },
    { type:'warning', title:'SGIS 결측 비율 ↑', msg:'성북구 일부 동에서 인구 데이터 8% 결측', layer:'visitors_total' },
    { type:'warning', title:'pLDDT 평균 하락', msg:'최근 30일 -3.2pt — 모델 재학습 검토', layer:'전체' },
    { type:'positive', title:'Townin 결제 안정', msg:'30일 무중단 ETL · pLDDT 95+', layer:'tw_sales_monthly' },
    { type:'alert', title:'이상 outlier 12건', msg:'특정 동의 거래량이 정규분포 4σ 이탈', layer:'tx_volume' },
    { type:'positive', title:'전체 갱신 정상', msg:'9개 소스 중 8개 정상 운영', layer:'-' },
  ];
  alarms.forEach(a => {
    const cls = a.type === 'alert' ? 'insight-alert' : a.type === 'warning' ? 'insight-warning' : 'insight-positive';
    al.insertAdjacentHTML('beforeend', `
      <div class="insight-card ${cls} rounded-md p-3">
        <div class="text-[11px] font-semibold text-white mb-1">${a.title}</div>
        <div class="text-[10px] text-gray-400 leading-relaxed">${a.msg}</div>
        <div class="text-[9px] mono text-cyan-300 mt-1.5">📚 ${a.layer}</div>
      </div>
    `);
  });
}

function renderDsCatalog() {
  // 카테고리 사이드바
  const cats = Object.entries(DATA.meta.layer_categories);
  const catEl = document.getElementById('catalog-cats');
  catEl.innerHTML = '<div class="text-[11px] mono text-cyan-300 cursor-pointer mb-1.5 px-2 py-1 rounded bg-white/5" data-cat="all">▸ 전체 (40)</div>';
  cats.forEach(([name, layers]) => {
    catEl.insertAdjacentHTML('beforeend',
      `<div class="text-[11px] mono text-gray-300 cursor-pointer hover:text-white px-2 py-1 rounded hover:bg-white/5" data-cat="${name}">▸ ${name} (${layers.length})</div>`);
  });

  // metadata for each layer
  const LAYER_META = {
    land_price:        { unit:'원/㎡', source:'KLIS', cycle:'연 1회' },
    land_price_apt:    { unit:'원/㎡', source:'KLIS', cycle:'연 1회' },
    land_price_house:  { unit:'원/㎡', source:'KLIS', cycle:'연 1회' },
    rent_price:        { unit:'원/㎡', source:'KLIS', cycle:'월' },
    tx_volume:         { unit:'건',    source:'국토부', cycle:'월' },
    tx_apt_count:      { unit:'건',    source:'국토부', cycle:'월' },
    tx_house_count:    { unit:'건',    source:'국토부', cycle:'월' },
    visitors_total:    { unit:'명',    source:'서울 OD', cycle:'일' },
    visitors_20s:      { unit:'명',    source:'서울 OD', cycle:'일' },
    visitors_30s:      { unit:'명',    source:'서울 OD', cycle:'일' },
    visitors_40s:      { unit:'명',    source:'서울 OD', cycle:'일' },
    visitors_50plus:   { unit:'명',    source:'서울 OD', cycle:'일' },
    visitors_male:     { unit:'명',    source:'서울 OD', cycle:'일' },
    visitors_female:   { unit:'명',    source:'서울 OD', cycle:'일' },
    visitors_local:    { unit:'명',    source:'서울 OD', cycle:'일' },
    visitors_inflow:   { unit:'명',    source:'서울 OD', cycle:'일' },
    biz_count:         { unit:'곳',    source:'공공 상가', cycle:'분기' },
    biz_cafe:          { unit:'곳',    source:'공공 상가', cycle:'분기' },
    biz_restaurant:    { unit:'곳',    source:'공공 상가', cycle:'분기' },
    biz_retail:        { unit:'곳',    source:'공공 상가', cycle:'분기' },
    biz_service:       { unit:'곳',    source:'공공 상가', cycle:'분기' },
    biz_new:           { unit:'건',    source:'공공 상가', cycle:'월' },
    biz_closed:        { unit:'건',    source:'공공 상가', cycle:'월' },
    transit_score:     { unit:'점',    source:'V World+', cycle:'분기' },
    walkability:       { unit:'점',    source:'V World+', cycle:'분기' },
    subway_distance_m: { unit:'m',     source:'V World',  cycle:'분기' },
    bus_stop_density:  { unit:'개/km²',source:'V World',  cycle:'분기' },
    tw_partner_active:  { unit:'명',   source:'Townin DB', cycle:'일' },
    tw_partner_signups: { unit:'명',   source:'Townin DB', cycle:'일' },
    tw_partner_churn:   { unit:'명',   source:'Townin DB', cycle:'일' },
    tw_sales_monthly:   { unit:'원',   source:'Townin Pay',cycle:'시간' },
    tw_orders:          { unit:'건',   source:'Townin Pay',cycle:'시간' },
    tw_aov:             { unit:'원',   source:'Townin Pay',cycle:'시간' },
    tw_dau:             { unit:'명',   source:'Townin Log',cycle:'시간' },
    tw_searches:        { unit:'건',   source:'Townin Log',cycle:'시간' },
    tw_conversions:     { unit:'건',   source:'Townin Log',cycle:'시간' },
    tw_ad_impressions:  { unit:'회',   source:'Townin Ad', cycle:'일' },
    tw_ad_clicks:       { unit:'회',   source:'Townin Ad', cycle:'일' },
    tw_ad_spend:        { unit:'원',   source:'Townin Ad', cycle:'일' },
    tw_ad_roas:         { unit:'%',    source:'Townin Ad', cycle:'일' },
  };

  // table render
  const renderTable = (filter='all', search='') => {
    const tbody = document.getElementById('catalog-tbody'); tbody.innerHTML = '';
    let count = 0;
    cats.forEach(([catName, layers]) => {
      if (filter !== 'all' && filter !== catName) return;
      layers.forEach(l => {
        if (search && !l.toLowerCase().includes(search.toLowerCase())) return;
        const meta = LAYER_META[l] || {unit:'-', source:'-', cycle:'-'};
        // pseudo pLDDT
        const score = catName.startsWith('townin') ? 88+Math.random()*8 : 70+Math.random()*22;
        const pl = score.toFixed(1);
        count++;
        tbody.insertAdjacentHTML('beforeend', `
          <tr class="border-b border-white/5 hover:bg-white/5">
            <td class="p-2 mono text-cyan-300">${l}</td>
            <td class="p-2 text-gray-400 text-[10px]">${catName}</td>
            <td class="p-2 mono text-gray-300">${meta.unit}</td>
            <td class="p-2 text-gray-300">${meta.source}</td>
            <td class="p-2 text-gray-400 text-[10px]">${meta.cycle}</td>
            <td class="p-2 text-right mono font-bold" style="color:${plddtHex(+pl)}">${pl}</td>
          </tr>
        `);
      });
    });
    document.getElementById('catalog-count').textContent = `${count} layers`;
  };
  renderTable();

  // category click
  catEl.querySelectorAll('[data-cat]').forEach(el => {
    el.onclick = () => {
      catEl.querySelectorAll('[data-cat]').forEach(x => {
        x.classList.remove('text-cyan-300','bg-white/5');
        x.classList.add('text-gray-300');
      });
      el.classList.add('text-cyan-300','bg-white/5');
      el.classList.remove('text-gray-300');
      renderTable(el.dataset.cat, document.getElementById('catalog-search').value);
    };
  });
  // search
  document.getElementById('catalog-search').oninput = e => {
    const active = catEl.querySelector('.text-cyan-300');
    renderTable(active ? active.dataset.cat : 'all', e.target.value);
  };
}

// ─────────────────────────────────────────────
// WORKFLOW (ComfyUI-style preview)
// ─────────────────────────────────────────────

// 7개 노드 카테고리 (ComfyUI식)
const NODE_CATS = {
  source:   { label:'📥 Source',    color:'#00A1E0', desc:'데이터 소스' },
  filter:   { label:'🔍 Filter',    color:'#B5E853', desc:'조건 필터' },
  transform:{ label:'🔄 Transform', color:'#FED766', desc:'정규화·집계' },
  model:    { label:'🤖 Model',     color:'#FF8FB1', desc:'TimesFM·GraphRAG' },
  compare:  { label:'🆚 Compare',   color:'#A78BFA', desc:'Twin·Delta' },
  visualize:{ label:'🎨 Visualize', color:'#5BC0EB', desc:'지도·차트·휠' },
  export:   { label:'📤 Export',    color:'#9CA3AF', desc:'CSV·PDF·공유' },
};

// 노드 라이브러리 (palette)
const NODE_LIBRARY = [
  // source
  { id:'src_dong',     cat:'source',    name:'동 선택',         desc:'1개 또는 여러 읍면동 선택', in:[], out:['dongs'] },
  { id:'src_layer',    cat:'source',    name:'레이어 선택',     desc:'40개 레이어 중 분석 대상', in:[], out:['layer'] },
  { id:'src_time',     cat:'source',    name:'시간 범위',       desc:'시작~끝 + grain (월/일/시간)', in:[], out:['time'] },
  { id:'src_all',      cat:'source',    name:'전국 동',         desc:'130개 동 전체 데이터', in:[], out:['dongs'] },
  // filter
  { id:'flt_threshold',cat:'filter',    name:'임계치 필터',     desc:'레이어 값 ≥ 임계치인 동만', in:['dongs','layer'], out:['dongs'] },
  { id:'flt_period',   cat:'filter',    name:'기간 필터',       desc:'특정 시점/기간만 추출', in:['time'], out:['time'] },
  { id:'flt_scenario', cat:'filter',    name:'시나리오 매칭',   desc:'rising_star, premium 등', in:['dongs'], out:['dongs'] },
  // transform
  { id:'trf_norm',     cat:'transform', name:'정규화',          desc:'전국 percentile 0~1', in:['layer'], out:['layer'] },
  { id:'trf_diff',     cat:'transform', name:'차분',            desc:'전기 대비 변화량', in:['layer','time'], out:['layer'] },
  { id:'trf_window',   cat:'transform', name:'이동 평균',       desc:'12개월 rolling mean', in:['layer'], out:['layer'] },
  { id:'trf_aggregate',cat:'transform', name:'동→구 집계',      desc:'자치구 평균 산출', in:['dongs'], out:['gus'] },
  // model
  { id:'mdl_timesfm',  cat:'model',     name:'TimesFM 예측',    desc:'5년 horizon · p10/50/90', in:['layer','time'], out:['forecast'] },
  { id:'mdl_anomaly',  cat:'model',     name:'이상 탐지',       desc:'예측 신뢰구간 이탈 동', in:['forecast','layer'], out:['anomalies'] },
  { id:'mdl_graph',    cat:'model',     name:'GraphRAG 인과',   desc:'경제 사슬 인과 추출', in:['dongs','layer'], out:['causal'] },
  { id:'mdl_plddt',    cat:'model',     name:'pLDDT 산출',      desc:'예측 신뢰도 0~100', in:['forecast'], out:['plddt'] },
  // compare
  { id:'cmp_twin',     cat:'compare',   name:'Twin Search',     desc:'코사인 유사도 Top N', in:['dongs','layer'], out:['twins'] },
  { id:'cmp_delta',    cat:'compare',   name:'Delta',           desc:'두 동의 레이어 차이', in:['dongs'], out:['delta'] },
  { id:'cmp_ab',       cat:'compare',   name:'A/B 비교',        desc:'시점 A vs B', in:['time','layer'], out:['delta'] },
  // visualize
  { id:'viz_map',      cat:'visualize', name:'3D 지도',         desc:'Time-Folding columns', in:['dongs','layer'], out:['view'] },
  { id:'viz_heat',     cat:'visualize', name:'히트맵',          desc:'전국 가중 분포', in:['dongs','layer'], out:['view'] },
  { id:'viz_wheel',    cat:'visualize', name:'Profile Wheel',   desc:'27축 방사형 비교', in:['dongs'], out:['view'] },
  { id:'viz_timeline', cat:'visualize', name:'시계열 차트',     desc:'5종 라인 + shocks', in:['layer','time'], out:['view'] },
  { id:'viz_alert',    cat:'visualize', name:'알람 카드',       desc:'이상 탐지 리스트', in:['anomalies'], out:['view'] },
  // export
  { id:'exp_csv',      cat:'export',    name:'CSV 다운로드',    desc:'결과 테이블 추출', in:['view'], out:[] },
  { id:'exp_pdf',      cat:'export',    name:'PDF 보고서',      desc:'표지+요약+차트', in:['view'], out:[] },
  { id:'exp_share',    cat:'export',    name:'공유 링크',       desc:'고정 URL 생성', in:['view'], out:[] },
];

const NODE_BY_ID = Object.fromEntries(NODE_LIBRARY.map(n => [n.id, n]));

// 12개 갤러리 주제 → 워크플로 그래프
// 각 노드는 {id, lib_id, x, y, params}, edges는 [from_node, to_node]
const WORKFLOWS = {
  sungsu_rise: {
    title:'성수동 부상 스토리',
    cat:'🔥 트렌드',
    explain:'2020 코로나 바닥에서 2024 트렌드 시프트까지, 성수1가1동의 신규 창업 + 카페 수가 어떻게 솟아올랐는지를 시간 재생으로 추적합니다. 외부 충격(코로나/금리) 시점에 pLDDT가 어떻게 하락하는지도 함께 보입니다.',
    runtime:'0.42s', outputs:'3D 지도 · 호흡 차트',
    nodes: [
      { id:'n1', lib_id:'src_dong',    x:80,  y:120, params:{select:'성수1가1동', scope:'성동구 5동 + 비교 5동'} },
      { id:'n2', lib_id:'src_time',    x:80,  y:230, params:{from:'2020-01', to:'2024-12', grain:'month'} },
      { id:'n3', lib_id:'src_layer',   x:80,  y:340, params:{height:'biz_new', color:'biz_cafe'} },
      { id:'n4', lib_id:'trf_norm',    x:300, y:340, params:{method:'p0_p1_minmax'} },
      { id:'n5', lib_id:'mdl_plddt',   x:300, y:230, params:{scale:'alphafold'} },
      { id:'n6', lib_id:'viz_map',     x:560, y:200, params:{mode:'columns', pitch:50, animate:true} },
      { id:'n7', lib_id:'viz_timeline',x:560, y:380, params:{layers:5, overlay_shocks:true} },
      { id:'n8', lib_id:'exp_pdf',     x:850, y:280, params:{template:'sungsu_rise'} },
    ],
    edges: [['n1','n6'],['n2','n5'],['n2','n6'],['n2','n7'],['n3','n4'],['n4','n6'],['n4','n7'],['n5','n6'],['n6','n8'],['n7','n8']],
    sample_results: [
      {label:'5년 신규 창업', value:'+127%', color:'#5BC0EB'},
      {label:'카페 수 증가', value:'+92%', color:'#5BC0EB'},
      {label:'평균 pLDDT', value:'87.4', color:'#5BC0EB'},
    ],
  },
  covid_shock: {
    title:'코로나 충격 분석',
    cat:'🔥 트렌드',
    explain:'2020-04 코로나 시점에 모든 130개 단백질이 동시에 unfold되는 모습을 시각화. 회복기(2021-07)와 비교하여 어느 동이 빠르게 회복했고 어느 동이 영구 손상을 입었는지 파악합니다.',
    runtime:'0.38s', outputs:'A/B 지도 · Delta 표',
    nodes: [
      { id:'n1', lib_id:'src_all',     x:80,  y:120, params:{count:130} },
      { id:'n2', lib_id:'src_layer',   x:80,  y:230, params:{height:'tx_volume', color:'biz_closed'} },
      { id:'n3', lib_id:'src_time',    x:80,  y:340, params:{points:['2020-01','2020-04','2021-07']} },
      { id:'n4', lib_id:'flt_period',  x:300, y:340, params:{filter:'shock_window'} },
      { id:'n5', lib_id:'cmp_ab',      x:540, y:230, params:{a:'2020-04', b:'2021-07'} },
      { id:'n6', lib_id:'viz_map',     x:540, y:90,  params:{mode:'columns'} },
      { id:'n7', lib_id:'viz_map',     x:540, y:380, params:{mode:'columns', label:'회복기'} },
      { id:'n8', lib_id:'viz_alert',   x:830, y:230, params:{by:'damage_score'} },
    ],
    edges: [['n1','n5'],['n1','n6'],['n1','n7'],['n2','n5'],['n2','n6'],['n2','n7'],['n3','n4'],['n4','n5'],['n5','n8']],
    sample_results: [
      {label:'코로나 충격', value:'-25%', color:'#FF8FB1'},
      {label:'1년 회복률', value:'+10%', color:'#5BC0EB'},
      {label:'영구 손상 동', value:'18개', color:'#FED766'},
    ],
  },
  cafe_boom: {
    title:'카페 폭증 핫스팟',
    cat:'🔥 트렌드',
    explain:'어느 동에서 카페가 가장 빠르게 늘어났나. 히트맵으로 전국 트렌드를 한눈에 + 20대 유동인구와의 상관관계까지.',
    runtime:'0.31s', outputs:'히트맵 · 산점도',
    nodes: [
      { id:'n1', lib_id:'src_all',     x:80,  y:140, params:{} },
      { id:'n2', lib_id:'src_layer',   x:80,  y:260, params:{primary:'biz_cafe', secondary:'visitors_20s'} },
      { id:'n3', lib_id:'trf_diff',    x:300, y:260, params:{period:'5y', method:'pct_change'} },
      { id:'n4', lib_id:'flt_threshold',x:520, y:200, params:{layer:'biz_cafe_diff', op:'>', value:'p80'} },
      { id:'n5', lib_id:'viz_heat',    x:760, y:140, params:{intensity:1.4} },
      { id:'n6', lib_id:'viz_alert',   x:760, y:340, params:{title:'카페 폭증 Top 10'} },
    ],
    edges: [['n1','n4'],['n2','n3'],['n3','n4'],['n4','n5'],['n4','n6']],
    sample_results: [
      {label:'Top 동: 성수1가1동', value:'+162%', color:'#5BC0EB'},
      {label:'Top 5 평균', value:'+127%', color:'#5BC0EB'},
      {label:'20대 유동 상관', value:'r=0.81', color:'#B5E853'},
    ],
  },
  youth_inflow: {
    title:'20대 청년 유입',
    cat:'🔥 트렌드',
    explain:'20대 유동인구가 집중되는 동 + 그 주변에 카페·서비스업이 어떻게 따라 자라는지의 사슬 분석.',
    runtime:'0.35s', outputs:'3D 지도 · 인과 트레이스',
    nodes: [
      { id:'n1', lib_id:'src_all',     x:80,  y:140, params:{} },
      { id:'n2', lib_id:'src_layer',   x:80,  y:260, params:{height:'visitors_20s', color:'biz_cafe'} },
      { id:'n3', lib_id:'trf_norm',    x:300, y:260, params:{} },
      { id:'n4', lib_id:'mdl_graph',   x:540, y:200, params:{depth:2, kind:'causal'} },
      { id:'n5', lib_id:'viz_map',     x:780, y:120, params:{mode:'columns'} },
      { id:'n6', lib_id:'viz_timeline',x:780, y:340, params:{} },
    ],
    edges: [['n1','n4'],['n2','n3'],['n3','n4'],['n3','n5'],['n4','n5'],['n4','n6']],
    sample_results: [
      {label:'20대 핫스팟 5동', value:'성수·연남·합정...', color:'#5BC0EB'},
      {label:'카페 follow', value:'18~24개월 후', color:'#FED766'},
    ],
  },
  closure_alert: {
    title:'폐업 급증 동 (이상탐지)',
    cat:'⚠️ 이상탐지',
    explain:'TimesFM이 예측한 폐업률 신뢰구간을 실측이 벗어난 동을 자동으로 알람. 마스터가 즉시 대응할 위험 신호.',
    runtime:'0.52s', outputs:'알람 카드 리스트',
    nodes: [
      { id:'n1', lib_id:'src_all',     x:80,  y:160, params:{} },
      { id:'n2', lib_id:'src_layer',   x:80,  y:280, params:{layer:'biz_closed'} },
      { id:'n3', lib_id:'src_time',    x:80,  y:400, params:{from:'2020-01', to:'2024-12'} },
      { id:'n4', lib_id:'mdl_timesfm', x:340, y:280, params:{horizon:12, quantile:'p10_p90'} },
      { id:'n5', lib_id:'mdl_anomaly', x:600, y:280, params:{method:'quantile_breach'} },
      { id:'n6', lib_id:'viz_alert',   x:860, y:200, params:{} },
      { id:'n7', lib_id:'exp_share',   x:860, y:380, params:{format:'slack_dm'} },
    ],
    edges: [['n1','n4'],['n2','n4'],['n3','n4'],['n2','n5'],['n4','n5'],['n5','n6'],['n5','n7']],
    sample_results: [
      {label:'알람 동', value:'12개', color:'#FF8FB1'},
      {label:'최고 위험', value:'중구 D3동', color:'#C9485B'},
    ],
  },
  plddt_drop: {
    title:'pLDDT 하락 경고',
    cat:'⚠️ 이상탐지',
    explain:'예측 신뢰도가 떨어지는 동 = 모델이 그 동의 미래를 잘 못 맞춤. 데이터 수집 강화 또는 모델 재학습이 필요한 영역.',
    runtime:'0.28s', outputs:'pLDDT 히트맵 + 알람',
    nodes: [
      { id:'n1', lib_id:'src_all',     x:80,  y:180, params:{} },
      { id:'n2', lib_id:'mdl_plddt',   x:340, y:180, params:{} },
      { id:'n3', lib_id:'trf_window',  x:600, y:180, params:{window:6, op:'mean'} },
      { id:'n4', lib_id:'flt_threshold',x:600, y:340, params:{layer:'plddt_avg', op:'<', value:65} },
      { id:'n5', lib_id:'viz_heat',    x:860, y:120, params:{by:'plddt'} },
      { id:'n6', lib_id:'viz_alert',   x:860, y:340, params:{} },
    ],
    edges: [['n1','n2'],['n2','n3'],['n2','n4'],['n3','n5'],['n4','n6']],
    sample_results: [
      {label:'위험 동', value:'9개', color:'#FED766'},
      {label:'평균 하락폭', value:'-12pt', color:'#FF8FB1'},
    ],
  },
  visit_drop: {
    title:'유동 이탈 동',
    cat:'⚠️ 이상탐지',
    explain:'유동인구가 6개월 연속 하락한 동을 자동으로 식별 + 같은 시기에 폐업률이 함께 오르는지 cross-check.',
    runtime:'0.33s', outputs:'알람 + 시계열',
    nodes: [
      { id:'n1', lib_id:'src_all',     x:80,  y:160, params:{} },
      { id:'n2', lib_id:'src_layer',   x:80,  y:280, params:{layers:['visitors_total','biz_closed']} },
      { id:'n3', lib_id:'trf_diff',    x:340, y:280, params:{period:'6m'} },
      { id:'n4', lib_id:'flt_threshold',x:600, y:200, params:{op:'<', value:0, count_consecutive:6} },
      { id:'n5', lib_id:'cmp_delta',   x:600, y:360, params:{} },
      { id:'n6', lib_id:'viz_alert',   x:860, y:280, params:{} },
    ],
    edges: [['n1','n4'],['n1','n5'],['n2','n3'],['n3','n4'],['n3','n5'],['n4','n6'],['n5','n6']],
    sample_results: [
      {label:'이탈 동', value:'7개', color:'#FED766'},
      {label:'폐업 동조', value:'5/7', color:'#FF8FB1'},
    ],
  },
  partner_recruit: {
    title:'파트너 모집 후보지',
    cat:'🤝 파트너',
    explain:'카페가 부족한데 20대 유동이 풍부한 동 = 파트너 모집 골든 스팟. Townin 마스터의 일상 의사결정 화면.',
    runtime:'0.29s', outputs:'순위표 · 지도',
    nodes: [
      { id:'n1', lib_id:'src_all',     x:80,  y:160, params:{} },
      { id:'n2', lib_id:'src_layer',   x:80,  y:280, params:{a:'visitors_20s', b:'biz_cafe'} },
      { id:'n3', lib_id:'trf_norm',    x:340, y:280, params:{} },
      { id:'n4', lib_id:'cmp_delta',   x:600, y:280, params:{formula:'a - b', label:'Gap Score'} },
      { id:'n5', lib_id:'flt_threshold',x:600, y:420, params:{op:'>', value:'p70'} },
      { id:'n6', lib_id:'viz_map',     x:860, y:200, params:{mode:'columns', height_layer:'gap_score'} },
      { id:'n7', lib_id:'viz_alert',   x:860, y:380, params:{title:'후보 Top 10'} },
    ],
    edges: [['n1','n4'],['n2','n3'],['n3','n4'],['n4','n5'],['n4','n6'],['n5','n7']],
    sample_results: [
      {label:'후보 동 Top 1', value:'마포구 B1동', color:'#5BC0EB'},
      {label:'Gap Score', value:'+0.72', color:'#5BC0EB'},
    ],
  },
  sales_alert: {
    title:'소상공인 매출 위험',
    cat:'🤝 파트너',
    explain:'거래량/유동 대비 폐업이 늘어나는 동을 식별. Townin 결제 데이터(tw_sales_monthly)와 결합해 매출 하락 파트너를 미리 발견.',
    runtime:'0.36s', outputs:'위험 리스트',
    nodes: [
      { id:'n1', lib_id:'src_all',     x:80,  y:160, params:{} },
      { id:'n2', lib_id:'src_layer',   x:80,  y:280, params:{layers:['biz_closed','tx_volume','tw_sales_monthly']} },
      { id:'n3', lib_id:'trf_window',  x:340, y:280, params:{window:3} },
      { id:'n4', lib_id:'mdl_anomaly', x:600, y:280, params:{} },
      { id:'n5', lib_id:'viz_alert',   x:860, y:200, params:{} },
      { id:'n6', lib_id:'exp_share',   x:860, y:380, params:{format:'partner_team'} },
    ],
    edges: [['n1','n4'],['n2','n3'],['n3','n4'],['n4','n5'],['n4','n6']],
    sample_results: [
      {label:'위험 파트너', value:'34곳', color:'#FF8FB1'},
      {label:'평균 매출 하락', value:'-18%', color:'#FED766'},
    ],
  },
  ad_target: {
    title:'광고 집중 후보',
    cat:'🤝 파트너',
    explain:'잠재 수요(유동) 높고 경쟁(소상공인) 적은 동 = 광고 ROAS 높을 가능성. tw_ad_roas 시계열로 검증.',
    runtime:'0.30s', outputs:'육각 지도',
    nodes: [
      { id:'n1', lib_id:'src_all',     x:80,  y:160, params:{} },
      { id:'n2', lib_id:'src_layer',   x:80,  y:280, params:{a:'visitors_total', b:'biz_count', c:'tw_ad_roas'} },
      { id:'n3', lib_id:'trf_norm',    x:340, y:280, params:{} },
      { id:'n4', lib_id:'cmp_delta',   x:600, y:280, params:{formula:'a/b * c'} },
      { id:'n5', lib_id:'viz_heat',    x:860, y:160, params:{mode:'hex'} },
      { id:'n6', lib_id:'viz_alert',   x:860, y:380, params:{title:'ROAS Top'} },
    ],
    edges: [['n1','n4'],['n2','n3'],['n3','n4'],['n4','n5'],['n4','n6']],
    sample_results: [
      {label:'예상 ROAS', value:'380%', color:'#5BC0EB'},
      {label:'후보 동 수', value:'18개', color:'#B5E853'},
    ],
  },
  twin_seoul: {
    title:'성수 ↔ 부산 전포 Twin',
    cat:'🌐 비교',
    explain:'서울 성수1가1동과 부산 전포1동의 27개 레이어 구조를 겹쳐서 코사인 유사도 산출. 인접 영역 확장 전략의 근거.',
    runtime:'0.24s', outputs:'Profile Wheel · Twin Score',
    nodes: [
      { id:'n1', lib_id:'src_dong',    x:80,  y:160, params:{select:'성수1가1동'} },
      { id:'n2', lib_id:'src_dong',    x:80,  y:300, params:{select:'부산_전포1동'} },
      { id:'n3', lib_id:'src_layer',   x:80,  y:440, params:{count:27} },
      { id:'n4', lib_id:'trf_norm',    x:340, y:300, params:{} },
      { id:'n5', lib_id:'cmp_twin',    x:600, y:300, params:{method:'cosine'} },
      { id:'n6', lib_id:'viz_wheel',   x:860, y:200, params:{} },
      { id:'n7', lib_id:'cmp_delta',   x:860, y:400, params:{} },
    ],
    edges: [['n1','n4'],['n2','n4'],['n3','n4'],['n4','n5'],['n5','n6'],['n5','n7']],
    sample_results: [
      {label:'Twin Score', value:'89/100', color:'#5BC0EB'},
      {label:'유사 레이어', value:'21/27', color:'#5BC0EB'},
    ],
  },
  gangnam_compare: {
    title:'강남 vs 성수 vs 마포',
    cat:'🌐 비교',
    explain:'세 핫플레이스의 27 레이어 프로필을 동시에 겹쳐서 "프리미엄(강남) / 트렌드(성수) / 청년(마포)"의 구조 차이 시각화.',
    runtime:'0.27s', outputs:'3-way Wheel · 산점도',
    nodes: [
      { id:'n1', lib_id:'src_dong',    x:80,  y:120, params:{select:'강남구 A1동'} },
      { id:'n2', lib_id:'src_dong',    x:80,  y:240, params:{select:'성수1가1동'} },
      { id:'n3', lib_id:'src_dong',    x:80,  y:360, params:{select:'마포구 B1동'} },
      { id:'n4', lib_id:'src_layer',   x:80,  y:480, params:{count:27} },
      { id:'n5', lib_id:'trf_norm',    x:340, y:300, params:{} },
      { id:'n6', lib_id:'viz_wheel',   x:600, y:240, params:{overlay:3} },
      { id:'n7', lib_id:'viz_timeline',x:600, y:420, params:{} },
      { id:'n8', lib_id:'exp_pdf',     x:860, y:300, params:{template:'three_way_compare'} },
    ],
    edges: [['n1','n5'],['n2','n5'],['n3','n5'],['n4','n5'],['n5','n6'],['n5','n7'],['n6','n8'],['n7','n8']],
    sample_results: [
      {label:'강남 vs 성수', value:'67/100', color:'#FED766'},
      {label:'성수 vs 마포', value:'82/100', color:'#5BC0EB'},
    ],
  },
};

let activeWorkflowId = 'sungsu_rise';
let wfZoom = 1;
let wfEditMode = false;
let wfDirty = false;        // 변경된 워크플로 (저장 필요)
let wfDraggingPalette = null; // {libId} during palette drag
let wfDraggingNode = null;    // {nodeId, offsetX, offsetY}
let wfConnecting = null;      // {fromNodeId, fromX, fromY} during edge draw
let wfSelectedNodeId = null;
let wfNextNodeIdCounter = 1000;

// 사용자 워크플로 저장소 키
const WF_STORAGE_KEY = 'towningraph_user_workflows';

function loadUserWorkflows() {
  try {
    const raw = localStorage.getItem(WF_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveUserWorkflows(obj) {
  localStorage.setItem(WF_STORAGE_KEY, JSON.stringify(obj));
}

function renderWorkflow() {
  // populate selector (built-in + user workflows)
  refreshWfSelect();

  // palette
  renderWfPalette();
  bindPaletteDrag();

  // controls
  document.getElementById('wf-zoom-in').onclick = () => { wfZoom = Math.min(2.0, wfZoom * 1.2); applyWfZoom(); };
  document.getElementById('wf-zoom-out').onclick = () => { wfZoom = Math.max(0.5, wfZoom / 1.2); applyWfZoom(); };
  document.getElementById('wf-zoom-reset').onclick = () => { wfZoom = 1; applyWfZoom(); };
  document.getElementById('wf-run').onclick = () => animateWfRun();
  document.getElementById('wf-insp-close').onclick = () => document.getElementById('wf-node-inspector').style.display = 'none';
  document.getElementById('wf-apply-analyze').onclick = () => applyWfToAnalyze();
  const wfExploreBtn = document.getElementById('wf-apply-explore');
  if (wfExploreBtn) wfExploreBtn.onclick = () => applyWfToMode('explore');
  const wfDecideBtn = document.getElementById('wf-apply-decide');
  if (wfDecideBtn) wfDecideBtn.onclick = () => applyWfToMode('decide');

  // Editor mode toggles
  document.getElementById('wf-mode-preview').onclick = () => setWfMode(false);
  document.getElementById('wf-mode-edit').onclick = () => setWfMode(true);
  document.getElementById('wf-new').onclick = () => createNewWorkflow();
  document.getElementById('wf-save').onclick = () => saveCurrentWorkflow();

  // Canvas drop target (for palette drag)
  bindCanvasDropTarget();
  // Keyboard shortcuts
  bindWfKeyboard();
  // Context menu
  bindWfContextMenu();

  drawWorkflowGraph();
  refreshUserWorkflowList();
}

function refreshWfSelect() {
  const sel = document.getElementById('wf-select');
  sel.innerHTML = '';
  // built-in
  const builtinGroup = document.createElement('optgroup');
  builtinGroup.label = '🎨 빌트인 (12)';
  GALLERY.forEach(g => {
    if (WORKFLOWS[g.id]) {
      const opt = document.createElement('option');
      opt.value = g.id; opt.textContent = `${g.icon} ${g.title}`;
      builtinGroup.appendChild(opt);
    }
  });
  sel.appendChild(builtinGroup);
  // user
  const user = loadUserWorkflows();
  const userIds = Object.keys(user);
  if (userIds.length > 0) {
    const userGroup = document.createElement('optgroup');
    userGroup.label = '📁 내 워크플로';
    userIds.forEach(id => {
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = `📁 ${user[id].title}`;
      userGroup.appendChild(opt);
    });
    sel.appendChild(userGroup);
  }
  sel.value = activeWorkflowId;
  sel.onchange = () => {
    if (wfDirty && !confirm('변경사항이 저장되지 않았습니다. 무시하고 이동할까요?')) {
      sel.value = activeWorkflowId;
      return;
    }
    activeWorkflowId = sel.value;
    wfDirty = false;
    updateSaveBtnVisibility();
    drawWorkflowGraph();
  };
}

function refreshUserWorkflowList() {
  const list = document.getElementById('wf-user-list');
  const items = document.getElementById('wf-user-items');
  const user = loadUserWorkflows();
  const ids = Object.keys(user);
  if (ids.length === 0) { list.classList.add('hidden'); return; }
  list.classList.remove('hidden');
  items.innerHTML = '';
  ids.forEach(id => {
    const wf = user[id];
    const div = document.createElement('div');
    div.className = 'flex items-center justify-between text-[10px] mono group';
    div.innerHTML = `
      <span class="cursor-pointer hover:text-cyan-300 truncate flex-1" data-id="${id}">📁 ${wf.title}</span>
      <button class="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 px-1" data-del="${id}">✕</button>
    `;
    div.querySelector('[data-id]').onclick = () => {
      activeWorkflowId = id;
      document.getElementById('wf-select').value = id;
      wfDirty = false;
      updateSaveBtnVisibility();
      drawWorkflowGraph();
    };
    div.querySelector('[data-del]').onclick = (e) => {
      e.stopPropagation();
      if (confirm(`"${wf.title}" 삭제하시겠습니까?`)) {
        const all = loadUserWorkflows();
        delete all[id];
        saveUserWorkflows(all);
        delete WORKFLOWS[id];
        if (activeWorkflowId === id) activeWorkflowId = 'sungsu_rise';
        refreshWfSelect();
        refreshUserWorkflowList();
        renderGallery();
        drawWorkflowGraph();
      }
    };
    items.appendChild(div);
  });
  // 부팅 시 사용자 워크플로를 WORKFLOWS에 머지
  Object.entries(user).forEach(([id, wf]) => { WORKFLOWS[id] = wf; });
}

function setWfMode(edit) {
  wfEditMode = edit;
  document.getElementById('wf-mode-preview').style.background = edit ? '' : '#00A1E0';
  document.getElementById('wf-mode-preview').classList.toggle('text-white', !edit);
  document.getElementById('wf-mode-preview').classList.toggle('text-gray-300', edit);
  document.getElementById('wf-mode-edit').style.background = edit ? '#FED766' : '';
  document.getElementById('wf-mode-edit').style.color = edit ? '#07101F' : '';
  document.getElementById('wf-mode-edit').classList.toggle('text-gray-300', !edit);
  document.getElementById('wf-edit-badge').classList.toggle('hidden', !edit);
  document.getElementById('wf-edit-hint').classList.toggle('hidden', !edit);
  document.getElementById('wf-palette-hint').classList.toggle('hidden', !edit);
  // palette items become draggable visual cue
  document.querySelectorAll('#wf-palette [data-lib-id]').forEach(el => {
    el.style.cursor = edit ? 'grab' : 'default';
    el.style.opacity = edit ? '1' : '0.85';
  });
  drawWorkflowGraph();
  updateSaveBtnVisibility();
}

function updateSaveBtnVisibility() {
  document.getElementById('wf-save').classList.toggle('hidden', !(wfEditMode && wfDirty));
}

function createNewWorkflow() {
  const id = 'user_' + Date.now();
  const title = prompt('새 워크플로 제목:', '새 워크플로');
  if (!title) return;
  WORKFLOWS[id] = {
    title, cat:'📁 내 워크플로',
    explain:'마스터가 직접 만든 워크플로',
    runtime:'-', outputs:'-',
    nodes: [],
    edges: [],
    sample_results: [],
    isUser: true,
  };
  activeWorkflowId = id;
  wfDirty = true;
  setWfMode(true);
  refreshWfSelect();
  drawWorkflowGraph();
}

function saveCurrentWorkflow() {
  const wf = WORKFLOWS[activeWorkflowId];
  if (!wf) return;
  const all = loadUserWorkflows();
  // 빌트인 ID로 저장하면 사용자 ID로 복제
  let saveId = activeWorkflowId;
  if (!saveId.startsWith('user_')) {
    saveId = 'user_' + Date.now();
    const newTitle = prompt('빌트인 워크플로는 새 이름으로 저장됩니다:', wf.title + ' (복사본)');
    if (!newTitle) return;
    WORKFLOWS[saveId] = { ...JSON.parse(JSON.stringify(wf)), title:newTitle, isUser:true };
    activeWorkflowId = saveId;
  }
  all[saveId] = JSON.parse(JSON.stringify(WORKFLOWS[saveId]));
  saveUserWorkflows(all);
  wfDirty = false;
  updateSaveBtnVisibility();
  refreshWfSelect();
  refreshUserWorkflowList();
  renderGallery();  // 갤러리 카드 자동 갱신
  // 잠깐 토스트
  showWfToast('💾 저장됨');
}

function showWfToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'fixed top-20 right-6 z-[200] glass rounded-md px-4 py-2 text-[12px] mono text-white';
  toast.style.border = '1px solid rgba(91,192,235,0.4)';
  toast.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.style.opacity = '0', 1400);
  setTimeout(() => toast.remove(), 1700);
}

function renderWfPalette() {
  const pal = document.getElementById('wf-palette');
  pal.innerHTML = '';
  Object.entries(NODE_CATS).forEach(([k, c]) => {
    const items = NODE_LIBRARY.filter(n => n.cat === k);
    pal.insertAdjacentHTML('beforeend', `
      <div>
        <div class="text-[10px] mono mb-1.5" style="color:${c.color}">${c.label} <span class="text-gray-500">(${items.length})</span></div>
        <div class="space-y-1">
          ${items.map(n => `
            <div class="text-[10px] mono px-2 py-1 rounded select-none" data-lib-id="${n.id}"
                 style="background:${c.color}10;border:1px solid ${c.color}25;color:#E8EDF3">
              ${n.name}
            </div>
          `).join('')}
        </div>
      </div>
    `);
  });
}

function bindPaletteDrag() {
  document.querySelectorAll('#wf-palette [data-lib-id]').forEach(el => {
    el.addEventListener('mousedown', (e) => {
      if (!wfEditMode) return;
      e.preventDefault();
      wfDraggingPalette = { libId: el.dataset.libId, ghost: null };
      // ghost
      const ghost = el.cloneNode(true);
      ghost.style.position = 'fixed';
      ghost.style.zIndex = '1000';
      ghost.style.pointerEvents = 'none';
      ghost.style.opacity = '0.85';
      ghost.style.transform = 'scale(1.05)';
      document.body.appendChild(ghost);
      wfDraggingPalette.ghost = ghost;
      const moveGhost = (ev) => {
        ghost.style.left = (ev.clientX + 8) + 'px';
        ghost.style.top = (ev.clientY + 8) + 'px';
      };
      moveGhost(e);
      const onMove = (ev) => moveGhost(ev);
      const onUp = (ev) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        finishPaletteDrag(ev);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

function finishPaletteDrag(ev) {
  const dragInfo = wfDraggingPalette;
  if (dragInfo) {
    if (dragInfo.ghost) dragInfo.ghost.remove();
  }
  wfDraggingPalette = null;
  if (!dragInfo) return;
  // 캔버스 위에서 놓았는지 검사
  const svg = document.getElementById('wf-canvas');
  const rect = svg.getBoundingClientRect();
  if (ev.clientX < rect.left || ev.clientX > rect.right ||
      ev.clientY < rect.top  || ev.clientY > rect.bottom) return;
  // 클라이언트 좌표 → SVG viewBox 좌표
  const pt = clientToSvg(ev.clientX, ev.clientY);
  addNodeAt(dragInfo.libId, pt.x, pt.y);
}

function clientToSvg(cx, cy) {
  const svg = document.getElementById('wf-canvas');
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const x = vb.x + (cx - rect.left) * (vb.width / rect.width);
  const y = vb.y + (cy - rect.top) * (vb.height / rect.height);
  return { x, y };
}

function addNodeAt(libId, x, y) {
  const wf = WORKFLOWS[activeWorkflowId];
  if (!wf) return;
  // 빌트인 워크플로를 편집하는 경우 자동으로 사용자 워크플로로 분기
  if (!wf.isUser) {
    if (!confirm('빌트인 워크플로에 노드를 추가하면 새 워크플로로 복제됩니다. 계속하시겠습니까?')) return;
    saveCurrentWorkflow();
  }
  const newId = 'n_' + (++wfNextNodeIdCounter);
  WORKFLOWS[activeWorkflowId].nodes.push({
    id: newId, lib_id: libId,
    x: Math.round(x), y: Math.round(y),
    params: {},
  });
  wfDirty = true;
  updateSaveBtnVisibility();
  drawWorkflowGraph();
  showWfToast('+ 노드 추가됨');
}

function bindCanvasDropTarget() {
  const svg = document.getElementById('wf-canvas');
  // hover 시 캔버스 테두리 강조
  svg.addEventListener('dragover', e => e.preventDefault());
}

function bindWfKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (currentMode !== 'workflow' || !wfEditMode) return;
    // 입력 폼에 포커스 있으면 무시
    if (document.activeElement && ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && wfSelectedNodeId) {
      e.preventDefault();
      deleteNode(wfSelectedNodeId);
    }
  });
}

function deleteNode(nodeId) {
  const wf = WORKFLOWS[activeWorkflowId];
  if (!wf) return;
  if (!wf.isUser) {
    if (!confirm('빌트인 워크플로 수정 시 새 워크플로로 복제됩니다. 계속?')) return;
    saveCurrentWorkflow();
  }
  WORKFLOWS[activeWorkflowId].nodes = wf.nodes.filter(n => n.id !== nodeId);
  WORKFLOWS[activeWorkflowId].edges = wf.edges.filter(([f,t]) => f !== nodeId && t !== nodeId);
  wfSelectedNodeId = null;
  wfDirty = true;
  updateSaveBtnVisibility();
  drawWorkflowGraph();
  showWfToast('🗑 삭제됨');
}

function bindWfContextMenu() {
  const menu = document.getElementById('wf-ctxmenu');
  menu.querySelectorAll('.ctx-item').forEach(btn => {
    btn.onclick = () => {
      const action = btn.dataset.action;
      const nodeId = menu.dataset.nodeId;
      menu.classList.add('hidden');
      if (!nodeId) return;
      if (action === 'delete') deleteNode(nodeId);
      else if (action === 'duplicate') duplicateNode(nodeId);
      else if (action === 'rename') renameNode(nodeId);
    };
  });
  // 캔버스 외 클릭 시 메뉴 닫기
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) menu.classList.add('hidden');
  });
}

function duplicateNode(nodeId) {
  const wf = WORKFLOWS[activeWorkflowId];
  const orig = wf.nodes.find(n => n.id === nodeId);
  if (!orig) return;
  if (!wf.isUser) saveCurrentWorkflow();
  const newId = 'n_' + (++wfNextNodeIdCounter);
  WORKFLOWS[activeWorkflowId].nodes.push({
    ...JSON.parse(JSON.stringify(orig)),
    id: newId, x: orig.x + 30, y: orig.y + 30,
  });
  wfDirty = true; updateSaveBtnVisibility(); drawWorkflowGraph();
  showWfToast('📋 복제됨');
}

function renameNode(nodeId) {
  const wf = WORKFLOWS[activeWorkflowId];
  const node = wf.nodes.find(n => n.id === nodeId);
  if (!node) return;
  const lib = NODE_BY_ID[node.lib_id];
  const newName = prompt('노드 라벨 변경:', node.customLabel || lib.name);
  if (newName === null) return;
  if (!wf.isUser) saveCurrentWorkflow();
  node.customLabel = newName;
  wfDirty = true; updateSaveBtnVisibility(); drawWorkflowGraph();
}

function applyWfZoom() {
  const svg = document.getElementById('wf-canvas');
  const cx = 550, cy = 330;
  const w = 1100 / wfZoom, h = 660 / wfZoom;
  svg.setAttribute('viewBox', `${cx - w/2} ${cy - h/2} ${w} ${h}`);
}

function drawWorkflowGraph() {
  const wf = WORKFLOWS[activeWorkflowId];
  if (!wf) return;
  const svg = d3.select('#wf-canvas');
  svg.selectAll('*').remove();

  // Title
  document.getElementById('wf-title').textContent = wf.title;
  document.getElementById('wf-title-cat').textContent = wf.cat;
  document.getElementById('wf-meta-nodes').textContent = wf.nodes.length;
  document.getElementById('wf-meta-time').textContent = wf.runtime;
  document.getElementById('wf-meta-outputs').textContent = wf.outputs;
  document.getElementById('wf-explain').textContent = wf.explain;

  // Results preview
  const resEl = document.getElementById('wf-results');
  resEl.innerHTML = '';
  wf.sample_results.forEach(r => {
    resEl.insertAdjacentHTML('beforeend', `
      <div class="flex items-center justify-between text-[11px]">
        <span class="text-gray-300">${r.label}</span>
        <span class="font-bold mono" style="color:${r.color}">${r.value}</span>
      </div>
    `);
  });

  // Build node lookup
  const nMap = {};
  wf.nodes.forEach(n => {
    const lib = NODE_BY_ID[n.lib_id];
    nMap[n.id] = { ...n, lib };
  });

  // Edges (베지어 곡선)
  wf.edges.forEach(([from, to]) => {
    const A = nMap[from], B = nMap[to];
    if (!A || !B) return;
    const ax = A.x + 90, ay = A.y;
    const bx = B.x - 90, by = B.y;
    const dx = (bx - ax) * 0.45;
    const colorA = NODE_CATS[A.lib.cat].color;
    svg.append('path')
      .attr('d', `M${ax},${ay} C${ax+dx},${ay} ${bx-dx},${by} ${bx},${by}`)
      .attr('fill','none')
      .attr('stroke', `${colorA}99`)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray','4,3')
      .attr('opacity', 0.7);
  });

  // Nodes
  wf.nodes.forEach(n => {
    const lib = NODE_BY_ID[n.lib_id];
    if (!lib) return;
    const cat = NODE_CATS[lib.cat];
    const g = svg.append('g')
      .attr('transform', `translate(${n.x},${n.y})`)
      .style('cursor', wfEditMode ? 'grab' : 'pointer')
      .attr('data-node-id', n.id);

    // Body
    const W = 180, H = 64;
    const bodyRect = g.append('rect')
      .attr('x', -W/2).attr('y', -H/2).attr('width', W).attr('height', H)
      .attr('rx', 8)
      .attr('fill', `${cat.color}1a`)
      .attr('stroke', cat.color).attr('stroke-width', n.id === wfSelectedNodeId ? 2.5 : 1.4);

    // 선택 표시 — glow
    if (n.id === wfSelectedNodeId && wfEditMode) {
      bodyRect.style('filter', `drop-shadow(0 0 8px ${cat.color})`);
    }

    // Header bar
    g.append('rect')
      .attr('x', -W/2).attr('y', -H/2).attr('width', W).attr('height', 18)
      .attr('rx', 8)
      .attr('fill', `${cat.color}40`);
    g.append('text')
      .attr('x', -W/2 + 8).attr('y', -H/2 + 12)
      .attr('fill', cat.color).attr('font-size', 9)
      .attr('font-family', 'JetBrains Mono').attr('font-weight', 600)
      .text(cat.label);

    // Title
    g.append('text')
      .attr('x', 0).attr('y', 8)
      .attr('text-anchor','middle')
      .attr('fill','#E8EDF3').attr('font-size', 12)
      .attr('font-family','Inter').attr('font-weight', 600)
      .text(n.customLabel || lib.name);

    // Param hint
    const paramKeys = Object.keys(n.params || {});
    if (paramKeys.length > 0) {
      const paramSummary = paramKeys.slice(0, 1).map(k => `${k}=${n.params[k]}`)[0];
      g.append('text')
        .attr('x', 0).attr('y', 22)
        .attr('text-anchor','middle')
        .attr('fill','rgba(230,237,243,0.5)').attr('font-size', 9)
        .attr('font-family','JetBrains Mono')
        .text(paramSummary.length > 22 ? paramSummary.substring(0,22) + '…' : paramSummary);
    } else if (wfEditMode) {
      g.append('text')
        .attr('x', 0).attr('y', 22)
        .attr('text-anchor','middle')
        .attr('fill','rgba(255,255,255,0.25)').attr('font-size', 9)
        .attr('font-family','JetBrains Mono')
        .text('(파라미터 더블클릭)');
    }

    // Input ports (left)
    if (lib.in.length > 0) {
      const portIn = g.append('circle').attr('cx', -W/2).attr('cy', 0).attr('r', wfEditMode ? 6 : 4)
        .attr('fill', '#07101F').attr('stroke', cat.color).attr('stroke-width', 1.8)
        .attr('data-port-in', n.id)
        .style('cursor', wfEditMode ? 'crosshair' : 'default');
      if (wfEditMode) bindPortIn(portIn, n);
    }
    // Output ports (right)
    if (lib.out.length > 0) {
      const portOut = g.append('circle').attr('cx', W/2).attr('cy', 0).attr('r', wfEditMode ? 6 : 4)
        .attr('fill', cat.color).attr('stroke','#07101F').attr('stroke-width', 1.5)
        .attr('data-port-out', n.id)
        .style('cursor', wfEditMode ? 'crosshair' : 'default');
      if (wfEditMode) bindPortOut(portOut, n);
    }

    // Pulse
    g.append('circle').attr('cx', W/2 - 10).attr('cy', -H/2 + 9).attr('r', 2)
      .attr('fill', cat.color)
      .style('animation','pulse-r 2.4s ease-in-out infinite');

    // Hover/click
    g.on('mouseenter', () => {
      g.select('rect:first-of-type').attr('stroke-width', n.id === wfSelectedNodeId ? 2.8 : 2.2);
    });
    g.on('mouseleave', () => {
      g.select('rect:first-of-type').attr('stroke-width', n.id === wfSelectedNodeId ? 2.5 : 1.4);
    });

    if (wfEditMode) {
      // Edit mode — drag to move
      bindNodeDrag(g, n);
      // Right click = context menu
      g.on('contextmenu', (event) => {
        event.preventDefault();
        showWfContextMenu(event, n.id);
      });
      // Double click = parameter edit
      g.on('dblclick', (event) => {
        event.stopPropagation();
        editNodeParameters(n, lib);
      });
      // Single click = select
      g.on('click', (event) => {
        // 드래그 후 click 발생시키지 않도록
        if (g.attr('data-was-dragging') === 'true') {
          g.attr('data-was-dragging', 'false');
          return;
        }
        wfSelectedNodeId = n.id;
        showWfNodeInspector(n, lib);
        drawWorkflowGraph();
      });
    } else {
      g.on('click', () => showWfNodeInspector(n, lib));
    }
  });

  // 연결 중인 임시 엣지
  if (wfConnecting) renderConnectingEdge();
}

// ─── Editor: 노드 드래그 ───
function bindNodeDrag(g, node) {
  let startX, startY, startNodeX, startNodeY, dragged = false;
  g.on('mousedown', (event) => {
    // 포트 클릭은 무시
    if (event.target.hasAttribute && (event.target.hasAttribute('data-port-in') || event.target.hasAttribute('data-port-out'))) return;
    if (event.button !== 0) return;
    event.stopPropagation();
    const pt = clientToSvg(event.clientX, event.clientY);
    startX = pt.x; startY = pt.y;
    startNodeX = node.x; startNodeY = node.y;
    dragged = false;
    g.style('cursor','grabbing');
    const onMove = (ev) => {
      const p = clientToSvg(ev.clientX, ev.clientY);
      const dx = p.x - startX, dy = p.y - startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragged = true;
      node.x = Math.round(startNodeX + dx);
      node.y = Math.round(startNodeY + dy);
      g.attr('transform', `translate(${node.x},${node.y})`);
      // re-draw edges (단순 전체 갱신)
      redrawEdges();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      g.style('cursor','grab');
      if (dragged) {
        wfDirty = true;
        updateSaveBtnVisibility();
        g.attr('data-was-dragging', 'true');
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function redrawEdges() {
  const wf = WORKFLOWS[activeWorkflowId];
  if (!wf) return;
  const svg = d3.select('#wf-canvas');
  svg.selectAll('path[data-edge]').remove();
  const nMap = {};
  wf.nodes.forEach(n => { nMap[n.id] = { ...n, lib: NODE_BY_ID[n.lib_id] }; });
  wf.edges.forEach(([from, to]) => {
    const A = nMap[from], B = nMap[to];
    if (!A || !B || !A.lib || !B.lib) return;
    const ax = A.x + 90, ay = A.y;
    const bx = B.x - 90, by = B.y;
    const dx = (bx - ax) * 0.45;
    const colorA = NODE_CATS[A.lib.cat].color;
    svg.insert('path', ':first-child')
      .attr('data-edge', `${from}-${to}`)
      .attr('d', `M${ax},${ay} C${ax+dx},${ay} ${bx-dx},${by} ${bx},${by}`)
      .attr('fill','none')
      .attr('stroke', `${colorA}99`)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray','4,3')
      .attr('opacity', 0.7);
  });
}

// ─── Editor: 포트 연결 ───
function bindPortOut(portEl, node) {
  portEl.on('mousedown', (event) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    wfConnecting = { fromNodeId: node.id };
    document.addEventListener('mousemove', onConnDrawing);
    document.addEventListener('mouseup', onConnRelease);
  });
}

function bindPortIn(portEl, node) {
  // 입력 포트는 drag-end 시점에 캐치
  portEl.attr('data-target-node', node.id);
  portEl.on('mouseenter', function() {
    if (wfConnecting) d3.select(this).attr('r', 8).style('filter','drop-shadow(0 0 6px #5BC0EB)');
  });
  portEl.on('mouseleave', function() {
    if (wfConnecting) d3.select(this).attr('r', 6).style('filter','none');
  });
}

let connTmpPath = null;
function onConnDrawing(ev) {
  if (!wfConnecting) return;
  const wf = WORKFLOWS[activeWorkflowId];
  const from = wf.nodes.find(n => n.id === wfConnecting.fromNodeId);
  if (!from) return;
  const fromLib = NODE_BY_ID[from.lib_id];
  const color = NODE_CATS[fromLib.cat].color;
  const ax = from.x + 90, ay = from.y;
  const pt = clientToSvg(ev.clientX, ev.clientY);
  const dx = (pt.x - ax) * 0.45;
  const d = `M${ax},${ay} C${ax+dx},${ay} ${pt.x-dx},${pt.y} ${pt.x},${pt.y}`;
  const svg = d3.select('#wf-canvas');
  if (!connTmpPath) {
    connTmpPath = svg.append('path').attr('fill','none')
      .attr('stroke', color).attr('stroke-width', 2)
      .attr('stroke-dasharray','5,4').attr('opacity',0.85);
  }
  connTmpPath.attr('d', d);
}

function onConnRelease(ev) {
  document.removeEventListener('mousemove', onConnDrawing);
  document.removeEventListener('mouseup', onConnRelease);
  if (connTmpPath) { connTmpPath.remove(); connTmpPath = null; }
  if (!wfConnecting) return;
  // 입력 포트 위에서 놓았는지 검사
  const tgt = document.elementFromPoint(ev.clientX, ev.clientY);
  if (tgt && tgt.hasAttribute('data-port-in')) {
    const toId = tgt.getAttribute('data-port-in');
    const fromId = wfConnecting.fromNodeId;
    if (fromId !== toId) addEdge(fromId, toId);
  }
  wfConnecting = null;
}

function addEdge(fromId, toId) {
  const wf = WORKFLOWS[activeWorkflowId];
  if (!wf) return;
  // 중복 방지
  if (wf.edges.some(([f,t]) => f === fromId && t === toId)) return;
  if (!wf.isUser) {
    if (!confirm('빌트인 워크플로 수정 시 새 워크플로로 복제됩니다. 계속?')) return;
    saveCurrentWorkflow();
  }
  WORKFLOWS[activeWorkflowId].edges.push([fromId, toId]);
  wfDirty = true; updateSaveBtnVisibility(); drawWorkflowGraph();
  showWfToast('🔗 연결됨');
}

function showWfContextMenu(event, nodeId) {
  const menu = document.getElementById('wf-ctxmenu');
  menu.dataset.nodeId = nodeId;
  menu.style.left = (event.clientX - menu.parentElement.getBoundingClientRect().left) + 'px';
  menu.style.top = (event.clientY - menu.parentElement.getBoundingClientRect().top) + 'px';
  menu.classList.remove('hidden');
}

function renderConnectingEdge() { /* placeholder for future */ }

// ─── Editor: 파라미터 편집 ───
function editNodeParameters(node, lib) {
  // 간단한 prompt 기반 편집 (Phase 2에서는 인라인 폼은 다음 사이클)
  const current = JSON.stringify(node.params || {}, null, 2);
  const next = prompt(`"${lib.name}" 파라미터 (JSON 형식):`, current);
  if (next === null) return;
  try {
    const parsed = JSON.parse(next);
    if (!WORKFLOWS[activeWorkflowId].isUser) {
      if (!confirm('빌트인 워크플로 수정 시 새 워크플로로 복제됩니다. 계속?')) return;
      saveCurrentWorkflow();
    }
    node.params = parsed;
    wfDirty = true; updateSaveBtnVisibility(); drawWorkflowGraph();
    showWfToast('⚙ 파라미터 갱신');
  } catch (e) {
    alert('JSON 파싱 실패: ' + e.message);
  }
}

function showWfNodeInspector(node, lib) {
  const panel = document.getElementById('wf-node-inspector');
  panel.style.display = 'block';
  const cat = NODE_CATS[lib.cat];
  panel.style.borderColor = cat.color + '66';

  document.getElementById('wf-insp-cat').textContent = cat.label;
  document.getElementById('wf-insp-cat').style.color = cat.color;
  document.getElementById('wf-insp-name').textContent = lib.name;
  document.getElementById('wf-insp-desc').textContent = lib.desc;
  document.getElementById('wf-insp-in').textContent = lib.in.length ? lib.in.join(', ') : '(none)';
  document.getElementById('wf-insp-out').textContent = lib.out.length ? lib.out.join(', ') : '(terminal)';

  const pEl = document.getElementById('wf-insp-params');
  pEl.innerHTML = '';
  const params = node.params || {};
  if (Object.keys(params).length === 0) {
    pEl.insertAdjacentHTML('beforeend', `<div class="text-gray-500">(파라미터 없음)</div>`);
  } else {
    Object.entries(params).forEach(([k, v]) => {
      pEl.insertAdjacentHTML('beforeend', `
        <div class="flex items-center justify-between gap-2 px-2 py-1 rounded bg-white/5">
          <span class="text-gray-400 mono">${k}</span>
          <span class="mono text-cyan-300 truncate">${typeof v === 'object' ? JSON.stringify(v) : v}</span>
        </div>
      `);
    });
  }
}

function animateWfRun() {
  const wf = WORKFLOWS[activeWorkflowId];
  if (!wf) return;
  const svg = d3.select('#wf-canvas');

  // 위상 정렬
  const adj = {}, indeg = {}, nodeMap = {};
  wf.nodes.forEach(n => { adj[n.id] = []; indeg[n.id] = 0; nodeMap[n.id] = n; });
  wf.edges.forEach(([f, t]) => { adj[f].push(t); indeg[t]++; });
  const order = [];
  const queue = wf.nodes.filter(n => indeg[n.id] === 0).map(n => n.id);
  while (queue.length) {
    const cur = queue.shift();
    order.push(cur);
    adj[cur].forEach(nx => { indeg[nx]--; if (indeg[nx] === 0) queue.push(nx); });
  }

  const stepDelay = 280;

  // 각 노드 순차 발광
  order.forEach((nid, i) => {
    setTimeout(() => {
      const g = svg.select(`[data-node-id="${nid}"]`);
      if (!g.empty()) {
        const rect = g.select('rect:first-of-type');
        const node = nodeMap[nid];
        const lib = NODE_BY_ID[node.lib_id];
        const color = NODE_CATS[lib.cat].color;
        // 강한 펄스
        rect.transition().duration(180)
          .attr('stroke-width', 5)
          .style('filter', `drop-shadow(0 0 8px ${color})`)
          .transition().duration(520)
          .attr('stroke-width', 1.4)
          .style('filter', 'none');
        // 처리 시간 라벨
        const procText = svg.append('text')
          .attr('x', node.x).attr('y', node.y - 50)
          .attr('text-anchor', 'middle')
          .attr('fill', color).attr('font-size', 9)
          .attr('font-family', 'JetBrains Mono')
          .attr('opacity', 0)
          .text(`✓ ${(Math.random() * 0.3 + 0.05).toFixed(2)}s`);
        procText.transition().duration(180).attr('opacity', 1)
          .transition().delay(800).duration(400).attr('opacity', 0)
          .on('end', () => procText.remove());
      }
    }, i * stepDelay);

    // 출력 엣지로 데이터 파티클 발사
    setTimeout(() => emitParticles(nid, wf, nodeMap), i * stepDelay + 200);
  });
}

function emitParticles(fromNid, wf, nodeMap) {
  const svg = d3.select('#wf-canvas');
  const outgoing = wf.edges.filter(([f]) => f === fromNid);
  outgoing.forEach(([f, t]) => {
    const A = nodeMap[f], B = nodeMap[t];
    if (!A || !B) return;
    const ax = A.x + 90, ay = A.y;
    const bx = B.x - 90, by = B.y;
    const dx = (bx - ax) * 0.45;
    const path = `M${ax},${ay} C${ax+dx},${ay} ${bx-dx},${by} ${bx},${by}`;
    const fromLib = NODE_BY_ID[A.lib_id];
    const color = NODE_CATS[fromLib.cat].color;

    // 임시 path 객체
    const tmpPath = svg.append('path')
      .attr('d', path).attr('fill','none').attr('stroke','none').attr('id', `tmppath-${f}-${t}-${Date.now()}`);
    const pathNode = tmpPath.node();
    const len = pathNode.getTotalLength();

    // 3개의 빛 입자 발사
    [0, 90, 180].forEach(offset => {
      const particle = svg.append('circle')
        .attr('r', 3.2).attr('fill', color)
        .style('filter', `drop-shadow(0 0 4px ${color})`)
        .attr('opacity', 0.95);
      const startTime = performance.now() + offset;
      const dur = 720;
      const animate = (now) => {
        const t = (now - startTime) / dur;
        if (t < 0) { requestAnimationFrame(animate); return; }
        if (t > 1) { particle.remove(); return; }
        const pt = pathNode.getPointAtLength(len * t);
        particle.attr('cx', pt.x).attr('cy', pt.y).attr('opacity', 1 - Math.abs(t - 0.5) * 0.4);
        requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    });
    // tmp path 정리
    setTimeout(() => tmpPath.remove(), 1200);
  });
}

// [GRAPHRAG_PHASE2_FINISH-001] Workflow → Explore/Decide 연동
// src_dong 노드의 select 파라미터를 selectedDong으로 매핑하고 모드 전환.
function applyWfToMode(mode) {
  const wf = WORKFLOWS[activeWorkflowId];
  if (!wf || !DATA) return;
  const dongNode = wf.nodes.find(n => n.lib_id === 'src_dong' && n.params && n.params.select);
  if (dongNode) {
    const target = DATA.dongs.find(d => d.name === dongNode.params.select)
                || DATA.dongs.find(d => d.name.includes(dongNode.params.select));
    if (target) selectedDong = target;
  }
  switchMode(mode);
}

function applyWfToAnalyze() {
  const wf = WORKFLOWS[activeWorkflowId];
  if (!wf) return;
  // 워크플로 안에서 viz_map 또는 src_layer를 찾아 분석 모드 매핑 설정
  let height = 'visitors_total', color = 'biz_cafe', mapMode = 'columns';
  wf.nodes.forEach(n => {
    if (n.lib_id === 'src_layer' && n.params) {
      if (n.params.height) height = n.params.height;
      if (n.params.color) color = n.params.color;
      if (n.params.primary) height = n.params.primary;
      if (n.params.secondary) color = n.params.secondary;
    }
    if (n.lib_id === 'viz_heat') mapMode = 'heat';
    if (n.lib_id === 'viz_map' && n.params && n.params.mode) mapMode = n.params.mode;
  });
  switchMode('analyze');
  setTimeout(() => {
    const hSel = document.getElementById('m-height');
    const cSel = document.getElementById('m-color');
    const mSel = document.getElementById('m-mode');
    if (hSel && [...hSel.options].some(o => o.value === height)) hSel.value = height;
    if (cSel && [...cSel.options].some(o => o.value === color))  cSel.value = color;
    if (mSel && [...mSel.options].some(o => o.value === mapMode)) mSel.value = mapMode;
    updateAnalyze();
  }, 200);
}

// ─────────────────────────────────────────────
// [P2] Causal Graph — Pearson + Granger 인과 시각화
// ─────────────────────────────────────────────
let causalSelectedDong = null;
let causalMode = 'dong';  // 'dong' or 'national'

function renderDsCausal() {
  if (!CAUSAL) {
    document.getElementById('causal-canvas').innerHTML =
      '<text x="440" y="240" text-anchor="middle" fill="#9CA3AF" font-family="JetBrains Mono" font-size="12">causal.json 미로드 — python3 causal_extract.py 먼저 실행</text>';
    return;
  }

  // 동 selector 채우기
  const sel = document.getElementById('causal-dong-select');
  if (sel.options.length === 0 && DATA && DATA.dongs) {
    DATA.dongs.forEach((d, i) => {
      sel.insertAdjacentHTML('beforeend', `<option value="${d.code}">${d.name}</option>`);
    });
    // 기본값: 성수1가1동
    const susuIdx = DATA.dongs.findIndex(d => d.name.includes('성수1가1'));
    if (susuIdx >= 0) sel.value = DATA.dongs[susuIdx].code;
    causalSelectedDong = sel.value;
  }

  // 메타 통계
  const statEl = document.getElementById('causal-stat-total');
  if (statEl) statEl.textContent = `${CAUSAL.meta.granger_total} 트리플렛`;

  // 셀렉터 / 라디오 이벤트
  sel.onchange = () => { causalSelectedDong = sel.value; drawCausalGraph(); };
  document.querySelectorAll('input[name="causal-mode"]').forEach(r => {
    r.onchange = () => { causalMode = r.value; drawCausalGraph(); };
  });

  // 재생 버튼
  const replayBtn = document.getElementById('causal-replay');
  if (replayBtn) replayBtn.onclick = () => animateCausalFlow();

  drawCausalGraph();
}

function drawCausalGraph() {
  if (!CAUSAL) return;
  const labels = CAUSAL.meta.layer_label || {};
  const layers = CAUSAL.meta.layers;

  // 레이어별 노드 위치 (ETL DAG 스타일 5단계 컬럼)
  // visitors → land/biz → cafe → tx (가로 흐름)
  const NODE_LAYOUT = {
    visitors_total: { x: 160, y: 240, color: '#5BC0EB', icon: '👥' },
    land_price:     { x: 360, y: 130, color: '#00A1E0', icon: '💰' },
    biz_count:      { x: 360, y: 350, color: '#B5E853', icon: '🏪' },
    biz_cafe:       { x: 580, y: 240, color: '#FF8FB1', icon: '☕' },
    tx_volume:      { x: 780, y: 240, color: '#FED766', icon: '📈' },
  };

  const svg = d3.select('#causal-canvas');
  svg.selectAll('*').remove();

  // 인과 관계 결정 (mode별)
  let edges = [];
  if (causalMode === 'national') {
    // 전국 메타 인과 (top_causations)
    edges = (CAUSAL.top_causations || []).slice(0, 20).map(c => ({
      cause: c.cause, effect: c.effect,
      lag: c.lag,
      strength: c.support_rate,  // 0~1
      label: `${(c.support_rate * 100).toFixed(0)}%`,
    }));
  } else {
    // 동별 Granger 인과
    const dc = CAUSAL.dongs[causalSelectedDong];
    if (dc && dc.granger) {
      edges = dc.granger.map(g => ({
        cause: g.cause, effect: g.effect,
        lag: g.lag,
        strength: 1 - Math.min(0.999, g.p),  // p값 작을수록 굵게
        label: `${g.lag}mo`,
        p: g.p,
      }));
    }
  }

  // 엣지 (베지어 곡선)
  edges.forEach(e => {
    const from = NODE_LAYOUT[e.cause];
    const to = NODE_LAYOUT[e.effect];
    if (!from || !to) return;
    // 화살표 끝 보정 (노드 가장자리에서 시작/종료)
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const off = 50;  // 노드 반지름
    const sx = from.x + (dx / dist) * off;
    const sy = from.y + (dy / dist) * off;
    const ex = to.x - (dx / dist) * off;
    const ey = to.y - (dy / dist) * off;
    const midX = (sx + ex) / 2, midY = (sy + ey) / 2;

    // 가독성 보강 — 두께 절반 + 양방향 인과 분리
    const strokeWidth = 0.5 + e.strength * 1.6;  // 0.8+4 → 0.5+1.6 (최대 2.1)
    const opacity = 0.25 + e.strength * 0.45;     // 최대 0.7
    const color = causalMode === 'national' ? '#A78BFA' : '#5BC0EB';

    // 양방향 인과(A→B & B→A) 시 곡선 분리: 한쪽은 위로, 다른 쪽은 아래로
    const reverse = edges.find(o => o !== e && o.cause === e.effect && o.effect === e.cause);
    let curve;
    if (reverse) {
      // 양방향 — cause/effect 순서로 위/아래 분리
      curve = e.cause < e.effect ? 0.34 : -0.34;
    } else {
      // 단방향 — 더 작은 곡률 (직선에 가깝게)
      curve = 0.08;
    }

    svg.append('path')
      .attr('d', `M${sx},${sy} Q${midX + (sy-ey)*curve},${midY + (ex-sx)*curve} ${ex},${ey}`)
      .attr('fill', 'none').attr('stroke', color).attr('stroke-width', strokeWidth)
      .attr('opacity', opacity).attr('marker-end', 'url(#causal-arrow)');

    // 라벨 (더 작게 + 곡선 위치에 맞춰 약간 offset)
    const labelX = midX + (sy-ey) * curve * 0.5;
    const labelY = midY + (ex-sx) * curve * 0.5;
    svg.append('rect')
      .attr('x', labelX - 15).attr('y', labelY - 6)
      .attr('width', 30).attr('height', 12).attr('rx', 2)
      .attr('fill', 'rgba(15,25,42,0.92)').attr('stroke', color).attr('stroke-width', 0.4)
      .attr('opacity', 0.85);
    svg.append('text')
      .attr('x', labelX).attr('y', labelY + 2)
      .attr('text-anchor', 'middle').attr('alignment-baseline', 'middle')
      .attr('fill', color).attr('font-size', 8.5).attr('font-family', 'JetBrains Mono')
      .text(e.label);
  });

  // 화살표 마커 정의
  const defs = svg.append('defs');
  defs.append('marker')
    .attr('id', 'causal-arrow').attr('viewBox', '0 -3 7 6')
    .attr('refX', 7).attr('refY', 0)
    .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
    .append('path').attr('d', 'M0,-3L7,0L0,3').attr('fill', causalMode === 'national' ? '#A78BFA' : '#5BC0EB').attr('opacity', 0.7);

  // 노드
  layers.forEach(lyr => {
    const n = NODE_LAYOUT[lyr];
    if (!n) return;
    const g = svg.append('g').attr('transform', `translate(${n.x},${n.y})`).attr('data-causal-node', lyr);
    // 둥근 외곽
    g.append('circle').attr('r', 50).attr('fill', `${n.color}1a`).attr('stroke', n.color).attr('stroke-width', 2);
    // 아이콘
    g.append('text').attr('text-anchor', 'middle').attr('alignment-baseline', 'middle')
      .attr('y', -10).attr('font-size', 22).text(n.icon);
    // 레이블
    g.append('text').attr('text-anchor', 'middle').attr('alignment-baseline', 'middle')
      .attr('y', 10).attr('fill', '#E8EDF3').attr('font-size', 11)
      .attr('font-family', 'Inter').attr('font-weight', 700).text(labels[lyr] || lyr);
    // 작은 영문 라벨
    g.append('text').attr('text-anchor', 'middle').attr('alignment-baseline', 'middle')
      .attr('y', 24).attr('fill', 'rgba(230,237,243,0.45)').attr('font-size', 8)
      .attr('font-family', 'JetBrains Mono').text(lyr);
    // 펄스
    g.append('circle').attr('r', 4).attr('cx', 36).attr('cy', -36)
      .attr('fill', n.color)
      .style('animation', 'pulse-r 2.4s ease-in-out infinite');
  });

  // 우측 리스트 + 인사이트
  fillCausalLists();
}

// [CORR_MATRIX-001] 5x5 Pearson 상관 매트릭스 — pLDDT 팔레트 (>=0.9 hi / >=0.7 mid / >=0.5 low / poor)
const PEARSON_LAYERS = ['biz_count','biz_cafe','visitors_total','tx_volume','land_price'];
function pearsonHexByR(absR){
  if (absR >= 0.9) return '#00529B';
  if (absR >= 0.7) return '#5BC0EB';
  if (absR >= 0.5) return '#FED766';
  return '#C9485B';
}
function renderPearsonMatrix(pairs){
  const svg = document.getElementById('causal-pearson-matrix');
  const tip = document.getElementById('causal-pearson-tooltip');
  if (!svg) return;
  const labels = (CAUSAL && CAUSAL.meta && CAUSAL.meta.layer_label) || {};
  const layers = PEARSON_LAYERS;
  const N = layers.length;
  const lookup = {};
  (pairs||[]).forEach(p => {
    lookup[p.a + '|' + p.b] = p;
    lookup[p.b + '|' + p.a] = p;
  });
  const left = 56, top = 16, cell = 30;
  const w = left + cell * N + 8;
  const h = top + cell * N + 24;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  let s = '';
  // 행 라벨 (왼쪽)
  for (let i = 0; i < N; i++){
    const lbl = labels[layers[i]] || layers[i];
    s += `<text x="${left-6}" y="${top + cell*i + cell/2 + 3}" text-anchor="end" fill="#A4B0C0" font-size="9" font-family="ui-sans-serif,-apple-system">${lbl}</text>`;
  }
  // 열 라벨 (아래)
  for (let j = 0; j < N; j++){
    const lbl = labels[layers[j]] || layers[j];
    s += `<text x="${left + cell*j + cell/2}" y="${top + cell*N + 14}" text-anchor="middle" fill="#A4B0C0" font-size="9" font-family="ui-sans-serif,-apple-system">${lbl}</text>`;
  }
  // 셀
  for (let i = 0; i < N; i++){
    for (let j = 0; j < N; j++){
      const x = left + cell * j;
      const y = top + cell * i;
      let fill, txt, abs, r;
      if (i === j){
        fill = '#1A2330'; txt = '·'; abs = 1; r = 1;
      } else {
        const p = lookup[layers[i] + '|' + layers[j]];
        if (!p){
          fill = '#0F1419'; txt = ''; abs = 0; r = NaN;
        } else {
          r = p.r; abs = Math.abs(r);
          fill = pearsonHexByR(abs);
          // 3자리 정밀도 — 0.999 vs 0.998 같은 미세차이 보존. 선행 0은 공간 절약 위해 제거.
          txt = abs >= 1 ? '1.00' : '.' + abs.toFixed(3).slice(2);
        }
      }
      const dataAttr = (i === j || isNaN(r)) ? '' : `data-i="${i}" data-j="${j}" data-r="${r}"`;
      s += `<rect x="${x}" y="${y}" width="${cell-2}" height="${cell-2}" rx="3" fill="${fill}" stroke="#2A3445" stroke-width="0.5" ${dataAttr}><title>${(labels[layers[i]]||layers[i])} ↔ ${(labels[layers[j]]||layers[j])}${isNaN(r)?'':' · r='+r}</title></rect>`;
      const textColor = (abs >= 0.9 || abs < 0.5) ? '#FFFFFF' : '#0F1419';
      if (txt) s += `<text x="${x + (cell-2)/2}" y="${y + (cell-2)/2 + 3}" text-anchor="middle" fill="${textColor}" font-size="9" font-family="ui-monospace,SF Mono" pointer-events="none">${txt}</text>`;
    }
  }
  // 범례
  const legendY = top + cell*N + 22;
  const legend = [['≥.9','#00529B'],['≥.7','#5BC0EB'],['≥.5','#FED766'],['<.5','#C9485B']];
  let lx = left;
  legend.forEach(([t,c])=>{
    s += `<rect x="${lx}" y="${legendY-7}" width="9" height="9" rx="1.5" fill="${c}"/>`;
    s += `<text x="${lx+12}" y="${legendY+1}" fill="#A4B0C0" font-size="8" font-family="ui-monospace,SF Mono">${t}</text>`;
    lx += 32;
  });
  svg.innerHTML = s;
  if (tip) tip.textContent = pairs && pairs.length ? `n=60 · ${pairs.length}쌍 · 셀 hover로 상세` : '데이터 없음';
  // hover → 좌하단 텍스트 갱신
  if (tip){
    svg.querySelectorAll('rect[data-r]').forEach(rect => {
      rect.style.cursor = 'pointer';
      rect.addEventListener('mouseenter', e => {
        const i = +rect.getAttribute('data-i');
        const j = +rect.getAttribute('data-j');
        const r = +rect.getAttribute('data-r');
        const a = labels[layers[i]] || layers[i];
        const b = labels[layers[j]] || layers[j];
        tip.innerHTML = `<span style="color:#5BC0EB">${a}</span> ↔ <span style="color:#5BC0EB">${b}</span> · r=${r.toFixed(3)} · n=60`;
      });
    });
    svg.addEventListener('mouseleave', () => {
      tip.textContent = `n=60 · ${(pairs||[]).length}쌍 · 셀 hover로 상세`;
    });
  }
}

function fillCausalLists() {
  if (!CAUSAL) return;
  const labels = CAUSAL.meta.layer_label || {};

  if (causalMode === 'national') {
    // 전국 모드 — Granger Top 20
    const grangerEl = document.getElementById('causal-granger-list');
    grangerEl.innerHTML = '';
    (CAUSAL.top_causations || []).slice(0, 12).forEach((c, i) => {
      const pct = (c.support_rate * 100).toFixed(0);
      const color = c.support_rate >= 0.3 ? '#A78BFA' : c.support_rate >= 0.2 ? '#FED766' : '#9CA3AF';
      grangerEl.insertAdjacentHTML('beforeend', `
        <div class="flex items-center justify-between gap-2">
          <span class="text-gray-500 mono text-[9px] w-3">${i+1}.</span>
          <span class="flex-1 text-[10px]">
            <span style="color:#FED766">${labels[c.cause]||c.cause}</span>
            <span class="text-gray-500 mx-0.5">→${c.lag}mo→</span>
            <span style="color:#5BC0EB">${labels[c.effect]||c.effect}</span>
          </span>
          <span class="mono font-bold" style="color:${color}">${pct}%</span>
        </div>
      `);
    });
    document.getElementById('causal-pearson-list').innerHTML =
      '<div class="text-[10px] text-gray-500">전국 모드에서는 Pearson 미표시 (동별 모드에서 확인)</div>';
    renderPearsonMatrix([]);

    document.getElementById('causal-insight').innerHTML = `
      <div class="space-y-1">
        <div><b style="color:#A78BFA">전국 130개 동 메타 분석</b></div>
        <div class="text-gray-400">총 ${CAUSAL.meta.granger_total}건 Granger 인과</div>
        <div class="text-gray-400">상위 ${CAUSAL.top_causations.length}개 패턴 추출</div>
        <div class="text-cyan-300 mt-1.5 text-[10px]">→ 가장 빈번한 인과: ${labels[CAUSAL.top_causations[0].cause]} → ${labels[CAUSAL.top_causations[0].effect]} (${(CAUSAL.top_causations[0].support_rate*100).toFixed(0)}%)</div>
      </div>`;
  } else {
    // 동별 모드
    const dc = CAUSAL.dongs[causalSelectedDong];
    if (!dc) return;
    document.getElementById('causal-dong-info').textContent = `${dc.name}\nGranger: ${(dc.granger||[]).length}건 / Pearson: ${(dc.pearson||[]).length}쌍`;

    const grangerEl = document.getElementById('causal-granger-list');
    grangerEl.innerHTML = '';
    (dc.granger || []).sort((a, b) => a.p - b.p).forEach(g => {
      grangerEl.insertAdjacentHTML('beforeend', `
        <div class="flex items-center justify-between gap-2">
          <span class="flex-1 text-[10px]">
            <span style="color:#FED766">${labels[g.cause]||g.cause}</span>
            <span class="text-gray-500 mx-0.5">→${g.lag}mo→</span>
            <span style="color:#5BC0EB">${labels[g.effect]||g.effect}</span>
          </span>
          <span class="mono text-[9px] text-gray-500">p=${g.p}</span>
        </div>
      `);
    });

    renderPearsonMatrix(dc.pearson || []);

    const pearsonEl = document.getElementById('causal-pearson-list');
    pearsonEl.innerHTML = '';
    (dc.pearson || []).sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).forEach(p => {
      const color = Math.abs(p.r) >= 0.9 ? '#B5E853' : Math.abs(p.r) >= 0.7 ? '#5BC0EB' : '#9CA3AF';
      pearsonEl.insertAdjacentHTML('beforeend', `
        <div class="flex items-center justify-between gap-2">
          <span class="flex-1 text-[10px] text-gray-300">${labels[p.a]||p.a} ↔ ${labels[p.b]||p.b}</span>
          <span class="mono font-bold" style="color:${color}">r=${p.r}</span>
        </div>
      `);
    });

    // 인사이트 — 가장 강한 인과로 시나리오 생성
    const topG = (dc.granger || []).sort((a, b) => a.p - b.p).slice(0, 3);
    const insightEl = document.getElementById('causal-insight');
    if (topG.length > 0) {
      insightEl.innerHTML = `
        <div class="space-y-1">
          <div><b class="text-cyan-300">${dc.name}</b>의 핵심 사슬:</div>
          ${topG.map((g, i) => `
            <div class="text-gray-300 ml-2">
              ${i+1}. <span style="color:#FED766">${labels[g.cause]||g.cause}</span> 변화 →
              <span class="text-gray-500">${g.lag}개월 후</span> →
              <span style="color:#5BC0EB">${labels[g.effect]||g.effect}</span> 영향
            </div>
          `).join('')}
          <div class="text-[9px] text-gray-500 mt-2 pt-1 border-t border-white/5">
            * Granger 인과 = 시차 회귀로 예측력 개선 검증
          </div>
        </div>`;
    } else {
      insightEl.innerHTML = '<div class="text-gray-500">유의미한 인과 없음</div>';
    }
  }
}

function animateCausalFlow() {
  const svg = d3.select('#causal-canvas');
  // 모든 엣지 path 가져오기
  const paths = svg.selectAll('path').filter(function() {
    return d3.select(this).attr('marker-end') === 'url(#causal-arrow)';
  });
  paths.each(function(d, i) {
    const path = d3.select(this);
    const len = this.getTotalLength ? this.getTotalLength() : 100;
    setTimeout(() => {
      // 입자 발사
      const color = causalMode === 'national' ? '#A78BFA' : '#5BC0EB';
      const particle = svg.append('circle').attr('r', 4).attr('fill', color)
        .style('filter', `drop-shadow(0 0 6px ${color})`);
      const pathNode = this;
      const start = performance.now();
      const dur = 800;
      const step = (now) => {
        const t = (now - start) / dur;
        if (t > 1) { particle.remove(); return; }
        const pt = pathNode.getPointAtLength(len * t);
        particle.attr('cx', pt.x).attr('cy', pt.y);
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, i * 120);
  });
}
