// 맥용 업데이트. 개발자 서명이 없는 앱은 표준 업데이트(Squirrel.Mac)가 막혀서, 직접 한다.
// 1) 릴리스의 latest-mac.yml로 새 버전을 확인 → 2) zip을 받아 sha512로 확인하고 풀어 둠
// → 3) 프로그램을 끈 뒤 /Applications의 DotMaker.app을 새 것으로 바꾸고 다시 켠다.
// main.cjs가 electron-updater와 똑같이 쓰도록 같은 이벤트(update-available 등)와 메서드를 낸다.
const { app } = require('electron');
const { EventEmitter } = require('node:events');
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

/** latest-mac.yml(electron-builder가 만드는 형식)에서 버전과 zip 파일 정보만 읽는다. */
function parseFeed(text) {
  const version = /^version:\s*['"]?([^'"\s]+)/m.exec(text)?.[1];
  const files = [...text.matchAll(/-\s+url:\s*['"]?([^'"\s]+)['"]?\s*\n\s+sha512:\s*['"]?([^'"\s]+)['"]?(?:\s*\n\s+size:\s*(\d+))?/g)]
    .map(m => ({ url: m[1], sha512: m[2], size: m[3] ? Number(m[3]) : 0 }));
  const zip = files.find(f => f.url.endsWith('.zip') && f.url.includes(process.arch)) ?? files.find(f => f.url.endsWith('.zip'));
  if (!version || !zip) throw new Error('업데이트 정보(latest-mac.yml)를 읽지 못했습니다.');
  return { version, zip };
}

/** a > b 인지(1.2.10 > 1.2.9). 숫자가 아닌 꼬리(-beta 등)는 무시한다. */
function newer(a, b) {
  const parts = v => String(v).replace(/^v/, '').split(/[.-]/).slice(0, 3).map(n => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

class MacUpdater extends EventEmitter {
  constructor({ owner, repo }) {
    super();
    this.owner = owner;
    this.repo = repo;
    this.feedURL = null;        // 시험용 주소(generic). 없으면 깃허브 릴리스
    this.info = null;           // 찾은 새 버전 { version, zip }
    this.ready = null;          // 받아서 푼 새 앱 경로
    this.autoInstallOnAppQuit = true;
    this.installing = false;
    app.on('before-quit', () => { if (this.ready && this.autoInstallOnAppQuit && !this.installing) this.install(false); });
  }

  setFeedURL({ url }) { this.feedURL = url.replace(/\/?$/, '/'); }

  fileURL(name, version) {
    return this.feedURL ? new URL(name, this.feedURL).href
      : `https://github.com/${this.owner}/${this.repo}/releases/download/v${version}/${encodeURIComponent(name)}`;
  }

  async checkForUpdates() {
    try {
      const feed = this.feedURL ? new URL('latest-mac.yml', this.feedURL).href
        : `https://github.com/${this.owner}/${this.repo}/releases/latest/download/latest-mac.yml`;
      const reply = await fetch(`${feed}?t=${Date.now()}`, { signal: AbortSignal.timeout(15_000) });
      if (!reply.ok) throw new Error(`업데이트 정보를 받지 못했습니다 (${reply.status}).`);
      const info = parseFeed(await reply.text());
      if (newer(info.version, app.getVersion())) { this.info = info; this.emit('update-available', { version: info.version }); }
      else this.emit('update-not-available', { version: info.version });
      return { updateInfo: info };
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  async downloadUpdate() {
    try {
      if (!this.info) throw new Error('먼저 업데이트를 확인해 주세요.');
      this.target();  // 바꿀 수 없는 곳에 설치돼 있으면 받기 전에 알려 준다
      const { version, zip } = this.info;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotmaker-update-'));
      const file = path.join(dir, path.basename(zip.url));
      const reply = await fetch(this.fileURL(zip.url, version), { signal: AbortSignal.timeout(30 * 60_000) });
      if (!reply.ok || !reply.body) throw new Error(`새 버전 파일을 받지 못했습니다 (${reply.status}).`);
      const total = Number(reply.headers.get('content-length')) || zip.size || 0;
      const hash = crypto.createHash('sha512'), out = fs.createWriteStream(file);
      let received = 0;
      for await (const chunk of reply.body) {
        hash.update(chunk);
        received += chunk.length;
        if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
        if (total) this.emit('download-progress', { percent: Math.min(100, received / total * 100), transferred: received, total });
      }
      await new Promise((resolve, reject) => out.end(error => (error ? reject(error) : resolve())));
      if (hash.digest('base64') !== zip.sha512) throw new Error('받은 파일이 손상되었습니다(확인 값이 다름). 다시 해 보세요.');
      const unpacked = path.join(dir, 'app');
      execFileSync('ditto', ['-x', '-k', file, unpacked]);
      const bundle = fs.readdirSync(unpacked).find(name => name.endsWith('.app'));
      if (!bundle) throw new Error('받은 파일 안에 프로그램이 없습니다.');
      this.ready = { dir, app: path.join(unpacked, bundle) };
      this.emit('update-downloaded', { version });
      return [file];
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /** 지금 켜져 있는 DotMaker.app 경로(바꿀 수 있는지도 확인). */
  target() {
    const bundle = path.resolve(process.execPath, '..', '..', '..');
    if (!bundle.endsWith('.app')) throw new Error('설치된 프로그램(.app)에서 켠 경우에만 업데이트할 수 있습니다.');
    try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); }
    catch { throw new Error(`${path.dirname(bundle)} 폴더를 바꿀 권한이 없습니다. 릴리스에서 새 버전을 받아 직접 설치해 주세요.`); }
    return bundle;
  }

  /** 프로그램이 꺼지기를 기다렸다가 새 앱으로 바꾸는 스크립트를 띄운다. reopen이면 바꾼 뒤 다시 켠다. */
  install(reopen) {
    if (!this.ready || this.installing) return false;
    let bundle;
    try { bundle = this.target(); } catch (error) { this.emit('error', error); return false; }
    this.installing = true;
    const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
    const script = [
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done`,
      `rm -rf ${q(bundle + '.old')}`,
      // 옛 앱을 옆으로 옮긴 뒤 새 앱을 복사한다. 복사가 실패하면 옛 앱을 그대로 되돌린다(옮기기부터 실패하면 아무것도 안 건드림).
      `if mv ${q(bundle)} ${q(bundle + '.old')}; then`,
      `  if ditto ${q(this.ready.app)} ${q(bundle)}; then rm -rf ${q(bundle + '.old')}; else rm -rf ${q(bundle)}; mv ${q(bundle + '.old')} ${q(bundle)}; fi`,
      `fi`,
      `xattr -dr com.apple.quarantine ${q(bundle)} 2>/dev/null`,
      reopen ? `open ${q(bundle)}` : ':',
      `rm -rf ${q(this.ready.dir)}`,
    ].join('\n');
    spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }

  quitAndInstall() {
    if (this.install(true)) app.quit();
  }
}

module.exports = { MacUpdater, parseFeed, newer };
