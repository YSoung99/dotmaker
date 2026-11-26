// imago v0.1.0(Go, MIT, github.com/loov/imago)를 wasm으로 돌리는 작업자용 줄이기 함수.
// tools/build-imago.mjs가 Go의 wasm_exec.js와 IMAGO_WASM_GZ(gzip+base64)를 이 파일 앞에 붙인다.
const IMAGO_METHODS = ['dpid', 'ssim', 'adaptive'];
let imagoReady = null;

function loadImago() {
  if (!imagoReady) {
    imagoReady = (async () => {
      const zipped = Uint8Array.from(atob(IMAGO_WASM_GZ), c => c.charCodeAt(0));
      const wasm = await new Response(new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      const go = new Go();
      const { instance } = await WebAssembly.instantiate(wasm, go.importObject);
      // Go가 끝나 버리면(메모리 부족 등) 다음 호출에서 새로 띄운다.
      go.run(instance).finally(() => { imagoReady = null; });
      if (typeof globalThis.__imagoResize !== 'function') throw new Error('imago를 시작하지 못했습니다.');
      return globalThis.__imagoResize;
    })();
    imagoReady.catch(() => { imagoReady = null; });
  }
  return imagoReady;
}

async function resizeImago(method, source, w, h) {
  if (!IMAGO_METHODS.includes(method)) throw new Error(`imago 방식은 ${IMAGO_METHODS.join(', ')} 중 하나여야 합니다: ${method}`);
  const ok = n => Number.isInteger(n) && n > 0;
  if (!source || !ok(source.w) || !ok(source.h) || !ok(w) || !ok(h)) throw new Error('imago 크기는 양의 정수여야 합니다.');
  if (w > source.w || h > source.h) throw new Error('imago는 줄이기만 할 수 있습니다.');
  const bytes = source.bytes instanceof Uint8Array ? source.bytes : new Uint8Array(source.bytes.buffer, source.bytes.byteOffset, source.bytes.byteLength);
  if (bytes.length !== source.w * source.h * 4) throw new Error('imago 입력 바이트 수가 w*h*4와 다릅니다.');
  const run = await loadImago();
  let result;
  try {
    result = run(method, source.w, source.h, bytes, w, h);
  } catch (error) {
    imagoReady = null;
    throw error;
  }
  if (result.error) throw new Error(result.error);
  return { w, h, bytes: result.bytes };
}
