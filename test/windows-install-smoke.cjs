// Windows 러너에서 NSIS를 설치하고 설치된 Electron 앱의 결과를 확인한다.
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { mkdtempSync, readdirSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { version } = require('../package.json');
const { expression, expected } = require('./outline-scenario.cjs');

async function findPage(debugPortFile, app) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (app.exitCode !== null) throw new Error(`설치한 앱이 먼저 종료되었습니다 (${app.exitCode}).`);
    try {
      const [port] = readFileSync(debugPortFile, 'utf8').split(/\r?\n/);
      const reply = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      const pages = await reply.json();
      const page = pages.find(target => target.type === 'page' && target.url.startsWith('file:'));
      if (page) return page;
    } catch { /* 앱이 뜨고 검사 포트가 열릴 때까지 기다린다. */ }
    await delay(250);
  }
  throw new Error('설치한 앱의 화면을 찾지 못했습니다.');
}

async function evaluate(socket, script) {
  const response = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Electron 화면 확인 시간 초과')), 15000);
    socket.addEventListener('message', function onMessage(event) {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      socket.removeEventListener('message', onMessage);
      clearTimeout(timeout);
      if (message.error || message.result.exceptionDetails) reject(new Error(JSON.stringify(message.error ?? message.result.exceptionDetails)));
      else resolve(message.result.result.value);
    });
  });
  socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: script, returnByValue: true, awaitPromise: true } }));
  return response;
}

async function main() {
  assert.equal(process.platform, 'win32');
  const root = mkdtempSync(path.join(process.env.RUNNER_TEMP || tmpdir(), 'dotmaker-installed-'));
  const destination = path.join(root, 'app');
  const profile = path.join(root, 'profile');
  const installer = path.resolve('release', `DotMaker-${version}-win-x64.exe`);
  execFileSync(installer, ['/S', `/D=${destination}`], { windowsVerbatimArguments: true, stdio: 'inherit', timeout: 120000 });
  const executables = readdirSync(destination).filter(name => /\.exe$/i.test(name) && !/^uninstall/i.test(name));
  assert.equal(executables.length, 1, `설치된 앱 실행 파일: ${executables.join(', ')}`);
  const app = spawn(path.join(destination, executables[0]), [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--disable-gpu'], { stdio: 'ignore' });
  const started = new Promise((resolve, reject) => { app.once('spawn', resolve); app.once('error', reject); });
  let socket;
  try {
    await started;
    const page = await findPage(path.join(profile, 'DevToolsActivePort'), app);
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Electron 검사 포트 연결 시간 초과')), 5000);
      socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Electron 검사 포트 접속 실패')); }, { once: true });
    });
    const checks = await evaluate(socket, `(async () => {
      const pixels = await ${expression};
      return { version: document.getElementById('version').textContent, pixels };
    })()`);
    assert.deepEqual(checks, { version, pixels: expected });
    console.log('윈도우 EXE 설치 및 실행 검증 통과', checks);
  } finally {
    socket?.close();
    app.kill();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
