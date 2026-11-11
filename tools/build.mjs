// src/app.html에 코드를 넣어 파일 하나짜리 dist/도트메이커.html을 만든다.
// - 화면(module): core.js + files.js(공용, SHARED 표시 사이) + app.js
// - 작업자(text/plain, 화면이 Blob으로 띄움): 공용 부분 + ai.js + worker.js
// 선 추출 AI 구조(ONNX)와 가중치 목록은 tools/export-lines.py가 만든다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const { version } = JSON.parse(read('package.json'));
const core = read('src/core.js').replace(/^export (?=const|function|class|let)/gm, '');
const graph = readFileSync(new URL('src/lines-graph.onnx', root)).toString('base64');
const ai = read('src/ai.js').replace("'__LINES_GRAPH__'", () => `'${graph}'`).replace("'__LINES_MANIFEST__'", () => read('src/lines-manifest.json'));
const parts = { '/*CORE*/': core, '/*FILES*/': read('src/files.js'), '/*AI*/': ai + '\n' + read('src/jev-core.js'), '/*WORKER*/': read('src/worker.js'), '/*APP*/': [read('src/settings.js'), read('src/cloud.js'), read('src/jev-app.js'), read('src/app.js').replace('__VERSION__', version)].join('\n') };
let html = read('src/app.html');
for (const [mark, text] of Object.entries(parts)) {
  if (/<\/script/i.test(text)) throw new Error(`${mark}에 </script가 들어 있어 묶을 수 없습니다.`);
  html = html.replace(mark, () => text);
}
mkdirSync(new URL('dist/', root), { recursive: true });
writeFileSync(new URL('dist/도트메이커.html', root), html);
console.log(`dist/도트메이커.html ${(html.length / 1024).toFixed(0)} KB`);
