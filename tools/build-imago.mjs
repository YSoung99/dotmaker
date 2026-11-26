// tools/imago(Go)를 js/wasm으로 빌드해, 작업자 스크립트 앞에 붙일 classic 코드 한 덩어리로 돌려준다.
// 결과: 라이선스 주석 + Go의 wasm_exec.js + IMAGO_WASM_GZ(gzip+base64) + src/imago-worker.js(resizeImago).
// wasm 파일은 임시 폴더에만 만들고 지운다(저장소에 남기지 않음). Go 1.26 이상이 PATH에 있어야 한다.
// buildAdaptive는 설치판용 contentadaptive 네이티브 헬퍼(tools/imago/adaptive)를 dist/native/에 만든다.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = new URL('../', import.meta.url);
const moduleDir = fileURLToPath(new URL('tools/imago/', root));

// 내용 적응형 축소는 아주 작은 계산 차이에도 결과가 갈린다. arm64(맥 M 칩)는 곱셈·덧셈을 한 번에 계산(FMA)해
// 결과가 달라지므로 모든 빌드에서 끈다. 표준 math의 CPU별 어셈블리는 tools/imago/contentadaptive가 피한다.
const SAME_FLOAT = '-gcflags=all=-d=fmahash=n';

function go(args, env = {}) {
  try {
    return execFileSync('go', args, { cwd: moduleDir, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('imago 빌드에 Go 1.26 이상이 필요합니다(https://go.dev/dl/).');
    throw new Error(`go ${args.join(' ')} 실패\n${error.stderr || error.message}`);
  }
}

function checkGo() {
  const version = go(['env', 'GOVERSION']);
  const [major, minor] = (version.match(/go(\d+)\.(\d+)/) || []).slice(1).map(Number);
  if (!(major > 1 || (major === 1 && minor >= 26))) throw new Error(`imago 빌드에 Go 1.26 이상이 필요합니다(현재 ${version}).`);
}

// 결과물에 함께 실어야 하는 고지문: imago(MIT)와 Go 런타임·wasm_exec.js(BSD-3-Clause). 원문은 tools/imago/LICENSE-*.
function licenses() {
  const text = name => readFileSync(join(moduleDir, name), 'utf8').trim();
  return [
    'imago v0.1.0 (github.com/loov/imago)\n\n' + text('LICENSE-imago'),
    `Go ${go(['env', 'GOVERSION'])} runtime and wasm_exec.js (go.dev)\n\n` + text('LICENSE-go'),
  ].join('\n\n----------------------------------------\n\n');
}

export async function buildImago() {
  checkGo();
  const out = mkdtempSync(join(tmpdir(), 'dotmaker-imago-'));
  try {
    const wasmPath = join(out, 'imago.wasm');
    go(['build', '-trimpath', '-mod=readonly', SAME_FLOAT, '-ldflags=-s -w', '-o', wasmPath, '.'], { GOOS: 'js', GOARCH: 'wasm', CGO_ENABLED: '0' });
    const wasm = gzipSync(readFileSync(wasmPath), { level: 9 }).toString('base64');
    const runtime = readFileSync(join(go(['env', 'GOROOT']), 'lib', 'wasm', 'wasm_exec.js'), 'utf8');
    const bridge = readFileSync(new URL('src/imago-worker.js', root), 'utf8');
    const code = [`/*!\n${licenses().replaceAll('*/', '* /')}\n*/`, runtime, `const IMAGO_WASM_GZ = '${wasm}';`, bridge].join('\n');
    if (/<\/script/i.test(code)) throw new Error('imago 코드에 </script가 들어 있어 묶을 수 없습니다.');
    return code;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

const GOOS = { darwin: 'darwin', win32: 'windows', linux: 'linux' };
const GOARCH = { arm64: 'arm64', x64: 'amd64' };

// platform/arch는 Node 이름(process.platform, process.arch). 고지문은 같은 폴더의 .LICENSES.txt로 남긴다.
export async function buildAdaptive({ platform = process.platform, arch = process.arch } = {}) {
  if (!GOOS[platform] || !GOARCH[arch]) throw new Error(`dotmaker-adaptive를 만들 수 없는 대상입니다: ${platform}/${arch}`);
  checkGo();
  const dir = fileURLToPath(new URL('dist/native/', root));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, platform === 'win32' ? 'dotmaker-adaptive.exe' : 'dotmaker-adaptive');
  go(['build', '-trimpath', '-mod=readonly', SAME_FLOAT, '-ldflags=-s -w', '-o', file, './adaptive'], { GOOS: GOOS[platform], GOARCH: GOARCH[arch], GOAMD64: 'v1', CGO_ENABLED: '0' });
  writeFileSync(join(dir, 'dotmaker-adaptive.LICENSES.txt'), licenses() + '\n');
  return file;
}
