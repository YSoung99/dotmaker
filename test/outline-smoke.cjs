// 맥·윈도우 CI의 Electron에서 도트화 화면과 작업자 결과를 함께 확인한다.
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');

app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'dotmaker-outline-smoke-')));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (_details, reply) => reply({ cancel: true }));
  const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await window.loadFile(path.join(__dirname, '..', 'dist', '도트메이커.html'));
  const checks = await window.webContents.executeJavaScript(`(async () => {
    const number = () => document.querySelector('[aria-label="검정 테두리 겹침 퍼센트"]');
    const status = () => document.querySelector('.status')?.textContent ?? '';
    const ready = () => !document.getElementById('save').disabled && !document.querySelector('.spinner');
    const until = async condition => {
      for (let i = 0; i < 200; i++) {
        if (condition()) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('결과 미리보기 시간 초과: ' + status());
    };
    const alpha = () => {
      const canvas = document.querySelector('canvas[aria-label="결과"]');
      return canvas.getContext('2d').getImageData(10, 45, 1, 1).data[3];
    };
    const set = value => {
      const input = number();
      input.value = String(value);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    await until(() => number());
    const upscale = [...document.querySelectorAll('[aria-label="AI 업스케일"] button')];
    upscale.find(button => button.textContent === '끄기').click();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,.04)';
    ctx.fillRect(7, 7, 50, 50);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(13, 13, 38, 38);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'outline-test.png', { type: 'image/png' }));
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));

    await until(ready);
    const before = alpha();
    set(1);
    await until(() => ready() && status().includes('10장 겹침'));
    const tenLayers = alpha();
    set(50);
    await until(() => ready() && status().includes('500장 겹침'));
    const fiveHundredLayers = alpha();
    set(0);
    await until(() => ready() && !status().includes('장 겹침'));
    return { before, tenLayers, fiveHundredLayers, restored: alpha() };
  })()`);
  assert.deepEqual(checks, { before: 10, tenLayers: 84, fiveHundredLayers: 255, restored: 10 });
  console.log('검정 테두리 겹침 Electron 검증 통과', checks);
  app.exit(0);
}).catch(error => {
  console.error(error);
  app.exit(1);
});
