// src/app.html에 코드를 넣어 파일 하나짜리 dist/도트메이커.html을 만든다.
// - 화면(module): core.js + files.js + lab-core.js + maple.js(공용, SHARED 표시 사이) + app.js
// - 작업자(text/plain, 화면이 Blob으로 띄움): 공용 부분 + ai.js + worker.js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildAdaptive, buildImago } from './build-imago.mjs';

const root = new URL('../', import.meta.url);
const [platform = process.platform, arch = process.arch] = process.argv.slice(2);
const read = path => readFileSync(new URL(path, root), 'utf8');
const { version } = JSON.parse(read('package.json'));
const core = read('src/core.js').replace(/^export (?=const|function|class|let)/gm, '');
const pica = `/*! pica 10.0.3\n${read('node_modules/pica/LICENSE')}*/\n${read('node_modules/pica/dist/pica.min.js')}`;
await buildAdaptive({ platform, arch });
const parts = {
  '/*CORE*/': core,
  '/*FILES*/': [read('src/files.js'), read('src/lab-core.js'), read('src/maple.js')].join('\n'),
  '/*AI*/': [read('src/ai.js'), read('src/mobile-sam.js'), read('src/jev-core.js')].join('\n'),
  '/*WORKER*/': [await buildImago(), pica, read('src/dot-resize.js'), read('src/lab2-core.js'), read('src/worker.js')].join('\n'),
  '/*APP*/': [read('src/settings.js'), read('src/png.js').replace(/^export /gm, ''), read('src/cloud.js'),
    read('src/jev-app.js'), read('src/lab.js'), read('src/lab2.js'), read('src/app.js').replace('__VERSION__', version)].join('\n'),
};
let html = read('src/app.html');
for (const [mark, text] of Object.entries(parts)) {
  if (/<\/script/i.test(text)) throw new Error(`${mark}에 </script가 들어 있어 묶을 수 없습니다.`);
  html = html.replace(mark, () => text);
}
mkdirSync(new URL('dist/', root), { recursive: true });
writeFileSync(new URL('dist/도트메이커.html', root), html);
console.log(`dist/도트메이커.html ${(html.length / 1024).toFixed(0)} KB`);
