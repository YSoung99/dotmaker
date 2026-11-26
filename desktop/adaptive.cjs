// 설치판은 비교표와 같은 네이티브 Go 구현으로 내용 적응형 축소를 실행한다.
const { execFile } = require('node:child_process');
const path = require('node:path');

function registerAdaptive({ app, ipcMain }) {
  const folder = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'dist', 'native');
  const name = process.platform === 'win32' ? 'dotmaker-adaptive.exe' : 'dotmaker-adaptive';
  const binary = path.join(folder, name);
  let child = null;

  ipcMain.handle('dot:resizeAdaptive', (event, source, width, height) => {
    if (event.senderFrame !== event.sender.mainFrame || !event.senderFrame?.url.startsWith('file:')) {
      throw new Error('도트메이커 창에서만 축소할 수 있습니다.');
    }
    const { w, h, bytes } = source ?? {};
    const dimension = (value, max) => Number.isInteger(value) && value >= 1 && value <= max;
    if (!dimension(w, 2048) || !dimension(h, 2048) || !dimension(width, Math.min(w, 512)) ||
      !dimension(height, Math.min(h, 512)) || !ArrayBuffer.isView(bytes) || bytes.BYTES_PER_ELEMENT !== 1 ||
      bytes.byteLength !== w * h * 4) {
      throw new Error('내용 적응형 축소의 입력 크기가 올바르지 않습니다.');
    }
    if (child) throw new Error('내용 적응형 축소가 이미 실행 중입니다.');

    return new Promise((resolve, reject) => {
      child = execFile(binary, [w, h, width, height].map(String),
        { encoding: 'buffer', maxBuffer: width * height * 4 + 65536, timeout: 10 * 60_000, windowsHide: true },
        (error, stdout, stderr) => {
          child = null;
          if (error || stdout.length !== width * height * 4) {
            const detail = stderr?.toString().trim().slice(0, 300) || error?.code;
            reject(new Error(`내용 적응형 축소를 완료하지 못했습니다.${detail ? ` (${detail})` : ''}`));
            return;
          }
          resolve(new Uint8Array(stdout));
        });
      child.stdin.on('error', () => {}); // 실행 실패는 위 콜백에서 읽는다.
      child.stdin.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    });
  });
  app.once('will-quit', () => child?.kill());
}

module.exports = { registerAdaptive };
