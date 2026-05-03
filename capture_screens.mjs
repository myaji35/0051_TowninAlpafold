// TowninGraph 매뉴얼용 스크린샷 자동 캡처
// 사용: node capture_screens.mjs (서버 8765 실행 필요)

import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const BASE = 'http://localhost:8765/index.html';
const OUT_DIR = './screenshots';
const VIEWPORT = { width: 1480, height: 920 };

const SHOTS = [
  // 0. 갤러리 (홈)
  {
    file: '01_gallery.png',
    label: '갤러리 — 12개 분석 주제 카드',
    before: async (page) => {
      await page.evaluate(() => switchMode('gallery'));
      await page.waitForTimeout(600);
    }
  },
  // 1. Explore
  {
    file: '02_explore.png',
    label: 'Explore — 자동 인사이트 + 3D 지도',
    before: async (page) => {
      await page.evaluate(() => switchMode('explore'));
      await page.waitForTimeout(2500);  // map tiles
    }
  },
  // 2. Analyze
  {
    file: '03_analyze.png',
    label: 'Analyze — Tableau식 자유 매핑',
    before: async (page) => {
      await page.evaluate(() => switchMode('analyze'));
      await page.waitForTimeout(2500);
    }
  },
  // 3. Decide
  {
    file: '04_decide.png',
    label: 'Decide — KPI + 5종 시계열 차트',
    before: async (page) => {
      await page.evaluate(() => switchMode('decide'));
      await page.waitForTimeout(800);
    }
  },
  // 4. Data Studio: Sources
  {
    file: '05_ds_sources.png',
    label: 'Data Studio · Sources — 9개 데이터 소스',
    before: async (page) => {
      await page.evaluate(() => switchMode('datastudio'));
      await page.waitForTimeout(400);
      await page.evaluate(() => { dsActiveTab = 'sources'; switchDsPane(); });
      await page.waitForTimeout(500);
    }
  },
  // 5. Data Studio: ETL
  {
    file: '06_ds_etl.png',
    label: 'Data Studio · ETL Pipeline — 5단계 DAG',
    before: async (page) => {
      await page.evaluate(() => switchMode('datastudio'));
      await page.waitForTimeout(300);
      await page.evaluate(() => { dsActiveTab = 'etl'; switchDsPane(); });
      await page.waitForTimeout(700);
    }
  },
  // 6. Data Studio: Quality
  {
    file: '07_ds_quality.png',
    label: 'Data Studio · Quality — 데이터 품질 검증',
    before: async (page) => {
      await page.evaluate(() => switchMode('datastudio'));
      await page.waitForTimeout(300);
      await page.evaluate(() => { dsActiveTab = 'quality'; switchDsPane(); });
      await page.waitForTimeout(700);
    }
  },
  // 7. Data Studio: Catalog
  {
    file: '08_ds_catalog.png',
    label: 'Data Studio · Catalog — 40 레이어 사전',
    before: async (page) => {
      await page.evaluate(() => switchMode('datastudio'));
      await page.waitForTimeout(300);
      await page.evaluate(() => { dsActiveTab = 'catalog'; switchDsPane(); });
      await page.waitForTimeout(700);
    }
  },
  // 8. Data Studio: AI Pipeline
  {
    file: '09_ds_ai.png',
    label: 'Data Studio · AI Pipeline — TimesFM + GraphRAG 추론 흐름',
    before: async (page) => {
      await page.evaluate(() => switchMode('datastudio'));
      await page.waitForTimeout(300);
      await page.evaluate(() => { dsActiveTab = 'ai'; switchDsPane(); });
      await page.waitForTimeout(700);
    }
  },
  // 9. Workflow Preview
  {
    file: '10_workflow_preview.png',
    label: 'Workflow · Preview — 빌트인 워크플로 노드 그래프',
    before: async (page) => {
      await page.evaluate(() => switchMode('workflow'));
      await page.waitForTimeout(700);
      // Ensure preview mode
      await page.evaluate(() => setWfMode(false));
      await page.waitForTimeout(300);
    }
  },
  // 10. Workflow Edit (with EDIT badge)
  {
    file: '11_workflow_edit.png',
    label: 'Workflow · Edit — 편집 모드 (드래그/연결/저장)',
    before: async (page) => {
      await page.evaluate(() => switchMode('workflow'));
      await page.waitForTimeout(500);
      await page.evaluate(() => setWfMode(true));
      await page.waitForTimeout(400);
    }
  },
  // 11. Command Palette
  {
    file: '12_cmd_palette.png',
    label: 'Command Palette (⌘K) — 통합 검색',
    before: async (page) => {
      await page.evaluate(() => switchMode('analyze'));
      await page.waitForTimeout(500);
      await page.evaluate(() => openCmdPalette());
      await page.waitForTimeout(400);
      // 미리 검색어 입력
      await page.fill('#cmd-input', '성수');
      await page.waitForTimeout(400);
    }
  },
];

(async () => {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2, // retina
  });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('  ⚠️  console.error:', msg.text().slice(0, 120));
  });

  console.log(`📡 Connecting to ${BASE}`);
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
  // 데이터 로드 대기
  await page.waitForFunction(() => typeof DATA !== 'undefined' && DATA && DATA.dongs && DATA.dongs.length > 100, { timeout: 10000 });
  console.log(`✅ Data loaded (${await page.evaluate(() => DATA.dongs.length)} dongs)`);

  for (const shot of SHOTS) {
    process.stdout.write(`📸 ${shot.file} ... `);
    try {
      if (shot.before) await shot.before(page);
      // 추가 안정화
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${OUT_DIR}/${shot.file}`,
        fullPage: false,
      });
      console.log('✓');
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
  }

  await browser.close();
  console.log(`\n✅ ${SHOTS.length}장 캡처 완료 → ${OUT_DIR}/`);
})();
