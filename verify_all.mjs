// 통합 검증 — 모든 verify_*.mjs를 순차 실행하고 PASS/FAIL 리포트
// 사용: npm run verify:all  (사전 조건: localhost:8765에서 정적 서버 실행)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve('.');
const PORT = 8765;
const SUITES = [
  { name: 'v07',        file: 'verify_v07.mjs' },
  { name: 'cdd',        file: 'verify_cdd.mjs' },
  { name: 'causal',     file: 'verify_causal.mjs' },
  { name: 'p2',         file: 'verify_p2.mjs' },
  { name: 'prophet',    file: 'verify_prophet.mjs' },
  { name: 'responsive', file: 'verify_responsive.mjs' },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const safe = join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
      if (!safe.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      const buf = await readFile(safe);
      res.writeHead(200, { 'Content-Type': MIME[extname(safe)] || 'application/octet-stream' });
      res.end(buf);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise((ok, ng) => {
    server.on('error', ng);
    server.listen(PORT, () => ok(server));
  });
}

function runSuite(file) {
  return new Promise((ok) => {
    const child = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    child.on('close', code => ok({ code, out, err }));
  });
}

async function tryFetch() {
  try {
    const r = await fetch(`http://localhost:${PORT}/index.html`);
    return r.ok;
  } catch { return false; }
}

(async () => {
  const externalServerOk = await tryFetch();
  let server = null;
  if (!externalServerOk) {
    console.log(`[verify_all] 내장 정적 서버 시작 :${PORT}`);
    server = await startServer();
  } else {
    console.log(`[verify_all] 기존 :${PORT} 서버 재사용`);
  }

  const results = [];
  for (const s of SUITES) {
    try { await stat(s.file); }
    catch { console.log(`⏭  ${s.name} (${s.file} 없음, 스킵)`); continue; }
    process.stdout.write(`▶  ${s.name.padEnd(11)} ... `);
    const t0 = Date.now();
    const r = await runSuite(s.file);
    const ms = Date.now() - t0;
    const pass = r.code === 0;
    results.push({ ...s, pass, ms, out: r.out, err: r.err, code: r.code });
    console.log(`${pass ? '✅ PASS' : '❌ FAIL'} (${ms}ms, exit=${r.code})`);
    if (!pass) {
      const tail = (r.err || r.out).split('\n').slice(-8).join('\n');
      console.log(tail.split('\n').map(l => `     ${l}`).join('\n'));
    }
  }

  if (server) server.close();

  const passCount = results.filter(r => r.pass).length;
  const total = results.length;
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 결과: ${passCount}/${total} PASS`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(passCount === total ? 0 : 1);
})();
