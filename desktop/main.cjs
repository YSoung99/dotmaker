// 도트메이커 설치형 프로그램 본체. 화면은 dist/도트메이커.html을 그대로 띄우고,
// 브라우저에서 막히는 JEV(LLM Gateway) 요청만 여기서 대신 보낸다. API 키(JEV·클라우드 AI)는 운영체제 암호화 저장소로 보관한다.
// 업데이트(윈도우·맥·리눅스)도 여기서 확인하고 받는다.
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { registerAdaptive } = require('./adaptive.cjs');

registerAdaptive({ app, ipcMain });

// 요청은 도트메이커 창 본문(file://)에서 온 것만 받는다(adaptive.cjs와 같은 확인). 다른 곳에서 오면 거절한다.
const trusted = event => event.senderFrame === event.sender.mainFrame && Boolean(event.senderFrame?.url.startsWith('file:'));
const guard = handler => (event, ...args) => {
  if (!trusted(event)) throw new Error('도트메이커 창에서만 쓸 수 있습니다.');
  return handler(event, ...args);
};
const handle = (channel, handler) => ipcMain.handle(channel, guard(handler));

const keyFile = (name = 'jev') => path.join(app.getPath('userData'), `${name}-key.bin`);

// 키 파일이 없으면(아직 저장 안 함) 조용히 null, 있는데 못 풀면(다른 컴퓨터에서 옮겨 옴·저장소 바뀜) 기록을 남기고 null.
function readKey(name = 'jev') {
  let data;
  try {
    data = fs.readFileSync(keyFile(name));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(`${name} 키 파일을 읽지 못했습니다:`, error.message);
    return null;
  }
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(data);
  } catch (error) {
    console.error(`${name} 키를 풀지 못했습니다(다시 저장해 주세요):`, error.message);
    return null;
  }
}

function writeKey(name, key) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('이 컴퓨터에서 암호화 저장소를 쓸 수 없습니다.');
  // 리눅스에서 키링이 없으면 'basic_text'(사실상 암호화 안 됨)로 떨어진다. 막지는 않고 기록만 남긴다.
  if (safeStorage.getSelectedStorageBackend?.() === 'basic_text') console.warn('암호화 키링이 없어 키를 약한 방식(basic_text)으로 저장합니다.');
  fs.mkdirSync(path.dirname(keyFile(name)), { recursive: true });
  fs.writeFileSync(keyFile(name), safeStorage.encryptString(String(key).trim()));
}

handle('jev:hasKey', () => Boolean(readKey()));
handle('jev:setKey', (_event, key) => { writeKey('jev', key); return true; });
handle('jev:clearKey', () => { fs.rmSync(keyFile(), { force: true }); return true; });
handle('jev:request', async (_event, body) => {
  const key = readKey();
  if (!key) return { status: 401, text: 'JEV 설정에서 LLM Gateway API 키를 저장해 주세요.' };
  // 인터넷 끊김·시간 초과는 status 0으로 돌려준다(화면이 읽기 쉬운 오류로 보여 준다).
  try {
    const response = await fetch('https://api.llmgateway.io/v1/decisions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    return { status: response.status, text: await response.text() };
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return { status: 0, text: timedOut ? 'LLM Gateway 응답이 90초 안에 오지 않았습니다.' : `LLM Gateway에 연결하지 못했습니다: ${error?.message ?? error}` };
  }
});

// 클라우드 AI(PixelLab·Gemini·OpenAI) 키: 요청은 화면이 직접 보내므로, 보낼 때 화면이 키를 꺼내 간다.
const cloudName = id => {
  if (!['pixellab', 'gemini', 'openai'].includes(id)) throw new Error('알 수 없는 클라우드 서비스입니다.');
  return 'cloud-' + id;
};
handle('cloud:getKey', (_event, id) => readKey(cloudName(id)) ?? '');
handle('cloud:setKey', (_event, id, key) => { writeKey(cloudName(id), key); return true; });
handle('cloud:clearKey', (_event, id) => { fs.rmSync(keyFile(cloudName(id)), { force: true }); return true; });

// 여러 장 저장: 사용자가 고른 폴더 안에만, 파일 이름만 받아서 쓴다.
let batchFolder = null;
handle('batch:pickFolder', async event => {
  const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: '도트 그림을 저장할 폴더', properties: ['openDirectory', 'createDirectory'] });
  batchFolder = picked.canceled ? null : picked.filePaths[0];
  return batchFolder && path.basename(batchFolder);
});
// 같은 이름이 있으면 덮어쓰지 않고 -2, -3…을 붙여 새로 만든다. 실제로 쓴 파일 이름을 돌려준다.
function writeWithoutOverwrite(folder, filename, bytes) {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  for (let index = 1; ; index++) {
    const candidate = index === 1 ? filename : `${stem}-${index}${ext}`;
    try {
      fs.writeFileSync(path.join(folder, candidate), bytes, { flag: 'wx' });
      return candidate;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}

// 완성 PNG 저장(윈도우): 고르기를 켜면 저장 대화상자에서 고른 곳에, 끄면 내 문서에 바로 쓴다.
// 화면이 준 폴더 경로에는 직접 쓰지 않고, 대화상자의 시작 위치로만 쓴다.
const isFolder = folder => {
  try { return typeof folder === 'string' && path.isAbsolute(folder) && fs.statSync(folder).isDirectory(); } catch { return false; }
};
// 윈도우 파일 이름으로 안전하게: 폴더 부분·금지 문자(: 포함, 대체 스트림 방지)·끝의 점과 공백·예약 이름(CON, COM1 등)을 피한다.
const pngName = name => {
  const base = path.win32.basename(String(name ?? '')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  let stem = (path.extname(base).toLowerCase() === '.png' ? base.slice(0, -4) : base).replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i.test(stem)) stem = '_' + stem;
  return `${stem || 'dotmaker'}.png`;
};
// PNG 시작 표시(89 50 4E 47 0D 0A 1A 0A)가 있는 바이트만 PNG 파일로 쓴다.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function pngBytes(png) {
  if (!ArrayBuffer.isView(png) || png.BYTES_PER_ELEMENT !== 1 || png.byteLength < PNG_MAGIC.length) throw new Error('PNG 그림 데이터가 아닙니다.');
  const bytes = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (!bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) throw new Error('PNG 그림 데이터가 아닙니다.');
  return bytes;
}

handle('batch:write', (_event, name, png) => {
  if (!batchFolder) throw new Error('저장할 폴더를 고르지 않았습니다.');
  return writeWithoutOverwrite(batchFolder, pngName(name), pngBytes(png));
});

handle('result:savePNG', async (event, name, png, chooseLocation, rememberedFolder) => {
  const filename = pngName(name);
  const bytes = pngBytes(png);
  const documents = app.getPath('documents');
  if (!chooseLocation) return { name: writeWithoutOverwrite(documents, filename, bytes), folder: documents };

  const startFolder = isFolder(rememberedFolder) ? rememberedFolder : documents;
  const picked = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
    title: '완성 PNG 저장',
    defaultPath: path.join(startFolder, filename),
    filters: [{ name: 'PNG 이미지', extensions: ['png'] }],
  });
  if (picked.canceled || !picked.filePath) return null;
  const folder = path.dirname(picked.filePath);
  const chosen = path.basename(picked.filePath);
  // 대화상자가 덮어쓰기를 확인한 건 고른 그 이름뿐이다. .png를 붙여 이름이 바뀌면 기존 파일은 건드리지 않는다.
  if (path.extname(chosen).toLowerCase() === '.png') {
    fs.writeFileSync(picked.filePath, bytes);
    return { name: chosen, folder };
  }
  return { name: writeWithoutOverwrite(folder, pngName(chosen + '.png'), bytes), folder };
});

// ───────────── 업데이트
// 켤 때마다 깃허브 릴리스를 확인해, 새 버전이 있으면 지금 할지 묻는다(없거나 인터넷이 안 되면 조용히 넘어감).
// '지금 업데이트'를 고르면 뒤에서 받고, 다 받으면 설치 창 없이 바로 설치한 뒤 다시 켠다.
// 윈도우 설치판·리눅스 AppImage·deb는 electron-updater, 맥은 서명 없는 앱이라 mac-updater.cjs가 직접 바꾼다.
// 그 밖(리눅스에서 압축을 풀어 켠 경우 등)은 화면 위쪽 받기 링크를 쓴다.
// 설치 파일 안의 package.json에는 build 항목이 빠지므로 여기 직접 적는다(package.json의 build.publish와 같게).
const RELEASES = { owner: 'YSoung99', repo: 'dotmaker', page: 'https://github.com/YSoung99/dotmaker/releases/latest' };
function linuxPackage() {
  if (process.env.APPIMAGE) return 'appimage';
  try { return fs.readFileSync(path.join(process.resourcesPath, 'package-type'), 'utf8').trim(); } catch { return null; }
}
const canAutoUpdate = () => app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin'
  || (process.platform === 'linux' && ['appimage', 'deb'].includes(linuxPackage())));
let updater = null;
let updateState = 'idle';  // idle · checking · downloading · ready
let manualCheck = false;   // 사용자가 직접 '업데이트 확인'을 눌렀으면 결과(최신·오류)도 알려 준다
let readyVersion = null;   // 다 받아 둔 새 버전
let reportedError = null;  // 같은 오류가 'error' 이벤트와 Promise 거절로 두 번 와도 창은 한 번만

function mainWindow() { return BrowserWindow.getAllWindows()[0] ?? null; }
function ask(options) { const window = mainWindow(); return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options); }

// 업데이트 준비가 어떤 이유로 실패해도 프로그램은 켜져야 한다.
function setupUpdater() {
  try { startUpdater(); } catch (error) { console.error('업데이트 준비 실패:', error); updater = null; }
}

function startUpdater() {
  if (!canAutoUpdate()) return;
  if (process.platform === 'darwin') {
    const { MacUpdater } = require('./mac-updater.cjs');
    updater = new MacUpdater(RELEASES);
  } else {
    ({ autoUpdater: updater } = require('electron-updater'));
  }
  updater.autoDownload = false;          // 받기 전에 먼저 묻는다
  updater.autoInstallOnAppQuit = true;   // 받아 두고 '나중에'를 고르면 끌 때 설치
  // 시험용: DOTMAKER_UPDATE_URL을 주면 그 주소(latest.yml이 있는 폴더)에서 확인한다.
  if (process.env.DOTMAKER_UPDATE_URL) updater.setFeedURL({ provider: 'generic', url: process.env.DOTMAKER_UPDATE_URL });

  updater.on('update-available', async info => {
    const { response } = await ask({
      type: 'info', buttons: ['지금 업데이트', '나중에'], defaultId: 0, cancelId: 1,
      title: '새 버전', message: `도트메이커 ${info.version}이(가) 나왔습니다. 지금 업데이트할까요?`,
      detail: `지금 버전: ${app.getVersion()}\n받는 동안 계속 쓸 수 있고, 다 받으면 바로 설치한 뒤 다시 켭니다.`
        + (linuxPackage() === 'deb' && process.platform === 'linux' ? '\n설치할 때 컴퓨터 암호를 한 번 묻습니다.' : ''),
    });
    manualCheck = false;
    if (response !== 0) { updateState = 'idle'; return; }
    updateState = 'downloading';
    updater.downloadUpdate().catch(error => updateFailed(error, true));
  });
  updater.on('update-not-available', () => {
    updateState = 'idle';
    if (manualCheck) ask({ type: 'info', buttons: ['확인'], title: '업데이트 확인', message: `최신 버전입니다 (${app.getVersion()}).` });
    manualCheck = false;
  });
  updater.on('download-progress', progress => mainWindow()?.setProgressBar(progress.percent / 100));
  updater.on('update-downloaded', info => {
    updateState = 'ready';
    readyVersion = info.version;
    mainWindow()?.setProgressBar(-1);
    askInstall();
  });
  updater.on('error', error => updateFailed(error, updateState === 'downloading'));
}

async function askInstall() {
  const { response } = await ask({
    type: 'info', buttons: ['지금 다시 켜기', '끌 때 설치'], defaultId: 0, cancelId: 1,
    title: '업데이트 준비 완료', message: `도트메이커 ${readyVersion ?? '새 버전'}을(를) 다 받았습니다.`,
    detail: '지금 다시 켜면 바로 새 버전으로 바뀝니다. 작업 중이면 \'끌 때 설치\'를 고르세요.',
  });
  if (response === 0) setImmediate(() => updater.quitAndInstall(true, true));  // 설치 창 없이, 설치 뒤 다시 켜기
}

function updateFailed(error, loud) {
  if (error && error === reportedError) return;
  reportedError = error;
  console.error('업데이트 실패:', error);
  mainWindow()?.setProgressBar(-1);
  const wasManual = manualCheck;
  updateState = 'idle';
  manualCheck = false;
  if (!loud && !wasManual) return;
  ask({ type: 'warning', buttons: ['릴리스에서 받기', '닫기'], defaultId: 0, cancelId: 1, title: '업데이트',
    message: '업데이트를 확인하거나 받지 못했습니다.',
    detail: `${error?.message ?? error}\n\n인터넷 연결을 확인한 뒤 다시 해 보거나, 릴리스 페이지에서 새 버전을 받아 직접 설치하세요.` })
    .then(({ response }) => { if (response === 0) shell.openExternal(RELEASES.page); });
}

function checkForUpdates(manual) {
  if (!updater || updateState !== 'idle') {
    if (manual && updateState === 'downloading') ask({ type: 'info', buttons: ['확인'], title: '업데이트', message: '새 버전을 받는 중입니다.' });
    if (manual && updateState === 'ready') askInstall();
    return;
  }
  manualCheck = manual;
  updateState = 'checking';
  updater.checkForUpdates().catch(error => updateFailed(error, false));
}

handle('update:supported', () => Boolean(updater));
handle('update:check', () => { checkForUpdates(true); return true; });

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
  // 설명서의 바깥 링크(https만)는 기본 브라우저로 연다. 창 안에서는 도트메이커 파일 밖으로 이동하지 않는다.
  const openOutside = url => { if (/^https:/i.test(url)) shell.openExternal(url); };
  window.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:')) return;
    event.preventDefault();
    openOutside(url);
  });
  window.webContents.on('will-redirect', event => event.preventDefault());
  window.loadFile(path.join(__dirname, '..', 'dist', '도트메이커.html'));
}

app.whenReady().then(() => {
  setupUpdater();
  createWindow();
  // 창이 뜨고 조금 뒤에 확인한다(켜는 속도에 영향 없게).
  if (updater) setTimeout(() => checkForUpdates(false), 3000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
