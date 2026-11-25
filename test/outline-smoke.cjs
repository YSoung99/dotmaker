// 맥·윈도우 CI의 Electron에서 도트화 화면과 작업자 결과를 함께 확인한다.
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');
const { expression, expected } = require('./outline-scenario.cjs');
const { lab2Expression, lab2Expected } = require('./lab2-scenario.cjs');

app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'dotmaker-outline-smoke-')));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (_details, reply) => reply({ cancel: true }));
  const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await window.loadFile(path.join(__dirname, '..', 'dist', '도트메이커.html'));
  const checks = await window.webContents.executeJavaScript(expression);
  assert.deepEqual(checks, expected);
  console.log('검정 테두리 겹침 Electron 검증 통과', checks);
  const lab2 = await window.webContents.executeJavaScript(lab2Expression);
  assert.deepEqual(lab2, lab2Expected);
  console.log('실험실 2 Electron 검증 통과', lab2);
  app.exit(0);
}).catch(error => {
  console.error(error);
  app.exit(1);
});
