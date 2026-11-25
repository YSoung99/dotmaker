// Windows 러너에서 NSIS를 설치하고 설치된 Electron 앱의 결과를 확인한다.
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { mkdtempSync, readdirSync, readFileSync, rmSync } = require('node:fs');
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
  const documents = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Environment]::GetFolderPath('MyDocuments')",
  ], { encoding: 'utf8', timeout: 10000 }).trim();
  assert.ok(path.isAbsolute(documents), '내 문서 경로를 확인하지 못했습니다.');
  const sourceName = `dotmaker-save-test-${randomUUID()}`;
  const output = `${sourceName}-도트화-100x100`;
  const pngPaths = [`${output}.png`, `${output}-2.png`].map(name => path.join(documents, name));
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
      const pixels = await ${expression.replace('outline-test.png', `${sourceName}.png`)};
      const toggle = document.getElementById('choose-save-location');
      const save = document.getElementById('save');
      const saveState = () => [toggle.getAttribute('aria-pressed'), save.textContent];
      const initial = saveState();
      toggle.click();
      const off = saveState();
      const saved = localStorage.getItem('dotmaker.chooseSaveLocation');
      const waitForSave = async name => {
        for (let i = 0; i < 120; i++) {
          const status = document.querySelector('.status')?.textContent;
          if (status?.includes('저장하지 못했습니다')) throw new Error(status);
          if (!save.disabled && status?.includes('PNG를 저장했습니다 · ' + name)) return;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('PNG 저장 시간 초과: ' + name);
      };
      save.click();
      await waitForSave(${JSON.stringify(`${output}.png`)});
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }));
      await waitForSave(${JSON.stringify(`${output}-2.png`)});
      toggle.click();
      return {
        version: document.getElementById('version').textContent, pixels,
        saveLocation: { visible: !toggle.hidden, initial, off, saved, on: saveState() },
      };
    })()`);
    assert.deepEqual(checks, {
      version, pixels: expected,
      saveLocation: { visible: true, initial: ['true', 'PNG 저장…'], off: ['false', 'PNG 저장'], saved: 'false', on: ['true', 'PNG 저장…'] },
    });
    const [first, second] = pngPaths.map(file => readFileSync(file));
    assert.equal(first.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(first.readUInt32BE(16), 100);
    assert.equal(first.readUInt32BE(20), 100);
    assert.deepEqual(first, second);
    console.log('PNG 버튼과 Ctrl+S로 내 문서에 저장하고 이름 충돌 회피 확인');
    console.log('윈도우 EXE 설치 및 실행 검증 통과', checks);
  } finally {
    socket?.close();
    app.kill();
    for (const file of pngPaths) rmSync(file, { force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
