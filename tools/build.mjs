// src/app.html에 코드를 넣어 파일 하나짜리 dist/도트메이커.html을 만든다.
// - 화면(module): core.js + files.js + lab-core.js + maple.js(공용, SHARED 표시 사이) + app.js
// - 작업자(text/plain, 화면이 Blob으로 띄움): 공용 부분 + ai.js + worker.js
// 선 추출 AI 구조(ONNX)와 가중치 목록은 tools/export-lines.py가 만든다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const { version } = JSON.parse(read('package.json'));
const core = read('src/core.js').replace(/^export (?=const|function|class|let)/gm, '');
const graph = readFileSync(new URL('src/lines-graph.onnx', root)).toString('base64');
const ai = read('src/ai.js').replace("'__LINES_GRAPH__'", () => `'${graph}'`).replace("'__LINES_MANIFEST__'", () => read('src/lines-manifest.json'));
// 실험실 2는 별도 Blob 작업자에서 시작한다. WASM도 묶어 파일 하나로 열 수 있게 한다.
const notices = ['smart-downscaler/LICENSE', '@xprite/pixelate/LICENSE', '@xprite/pixelate/NOTICE.md',
  ...['pixel-art-fixer-MIT', 'PixelOE-Apache-2.0', 'proper-pixel-art-MIT', 'tensorhead-dithering-MIT'].map(name => `@xprite/pixelate/licenses/${name}.txt`)];
const { outputFiles: [labWorker] } = await build({
  absWorkingDir: fileURLToPath(root), entryPoints: ['src/lab2-worker.js'], bundle: true,
  write: false, format: 'esm', platform: 'browser', minify: true, loader: { '.wasm': 'binary' },
  banner: { js: notices.map(name => `/*! ${name}\n${read('node_modules/' + name)}*/`).join('\n') },
  plugins: [{
    name: 'embedded-wasm',
    setup(bundle) {
      bundle.onResolve({ filter: /^lab2-pax-wasm$/ }, () => ({
        path: fileURLToPath(new URL('./smart_downscaler_bg.wasm', import.meta.resolve('smart-downscaler/web'))),
      }));
      bundle.onResolve({ filter: /^\.\.\/wasm\/pixelfixer_detect\.js$/ }, () => ({ path: 'xprite-wasm', namespace: 'lab2' }));
      bundle.onLoad({ filter: /.*/, namespace: 'lab2' }, () => ({
        resolveDir: fileURLToPath(root),
        contents: `import init from '@xprite/pixelate/wasm/pixelfixer_detect.js';
          import bytes from '@xprite/pixelate/wasm/pixelfixer_detect_bg.wasm';
          export * from '@xprite/pixelate/wasm/pixelfixer_detect.js';
          export default () => init({ module_or_path: bytes });`,
      }));
    },
  }],
});
const parts = {
  '/*CORE*/': core,
  '/*FILES*/': [read('src/files.js'), read('src/lab-core.js'), read('src/maple.js')].join('\n'),
  '/*AI*/': ai + '\n' + read('src/jev-core.js'),
  '/*WORKER*/': read('src/worker.js'),
  '/*LAB2-WORKER*/': labWorker.text,
  '/*APP*/': [read('src/settings.js'), read('src/cloud.js'), read('src/jev-app.js'), read('src/lab.js'), read('src/lab2.js'), read('src/app.js').replace('__VERSION__', version)].join('\n'),
};
let html = read('src/app.html');
for (const [mark, text] of Object.entries(parts)) {
  if (/<\/script/i.test(text)) throw new Error(`${mark}에 </script가 들어 있어 묶을 수 없습니다.`);
  html = html.replace(mark, () => text);
}
mkdirSync(new URL('dist/', root), { recursive: true });
writeFileSync(new URL('dist/도트메이커.html', root), html);
console.log(`dist/도트메이커.html ${(html.length / 1024).toFixed(0)} KB`);
