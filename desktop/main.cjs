// 도트메이커 설치형 프로그램 본체. 화면은 dist/도트메이커.html을 그대로 띄우고,
// 브라우저에서 막히는 JEV(LLM Gateway) 요청만 여기서 대신 보낸다. API 키는 운영체제 암호화 저장소로 보관한다.
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const keyFile = () => path.join(app.getPath('userData'), 'jev-key.bin');

function readKey() {
  try {
    const data = fs.readFileSync(keyFile());
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(data) : null;
  } catch {
    return null;
  }
}

ipcMain.handle('jev:hasKey', () => Boolean(readKey()));
ipcMain.handle('jev:setKey', (_event, key) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('이 컴퓨터에서 암호화 저장소를 쓸 수 없습니다.');
  fs.mkdirSync(path.dirname(keyFile()), { recursive: true });
  fs.writeFileSync(keyFile(), safeStorage.encryptString(String(key).trim()));
  return true;
});
ipcMain.handle('jev:clearKey', () => { fs.rmSync(keyFile(), { force: true }); return true; });
ipcMain.handle('jev:request', async (_event, body) => {
  const key = readKey();
  if (!key) return { status: 401, text: 'JEV 설정에서 LLM Gateway API 키를 저장해 주세요.' };
  const response = await fetch('https://api.llmgateway.io/v1/decisions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  return { status: response.status, text: await response.text() };
});

// 여러 장 저장: 사용자가 고른 폴더 안에만, 파일 이름만 받아서 쓴다.
let batchFolder = null;
ipcMain.handle('batch:pickFolder', async event => {
  const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: '도트 그림을 저장할 폴더', properties: ['openDirectory', 'createDirectory'] });
  batchFolder = picked.canceled ? null : picked.filePaths[0];
  return batchFolder && path.basename(batchFolder);
});
ipcMain.handle('batch:write', (_event, name, png) => {
  if (!batchFolder) throw new Error('저장할 폴더를 고르지 않았습니다.');
  fs.writeFileSync(path.join(batchFolder, path.basename(String(name))), Buffer.from(png));
  return true;
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1100, height: 800, minWidth: 760, minHeight: 560,
    title: '도트메이커',
    backgroundColor: '#1c1b1a',
    // 리눅스는 창 아이콘을 따로 알려 줘야 작업 표시줄에 프로그램 아이콘이 보인다(맥·윈도우는 설치 파일의 아이콘을 쓴다).
    ...(process.platform === 'linux' ? { icon: path.join(__dirname, 'icons', 'icon.png') } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  window.removeMenu();
  // 설명서의 바깥 링크는 기본 브라우저로 연다.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.loadFile(path.join(__dirname, '..', 'dist', '도트메이커.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
