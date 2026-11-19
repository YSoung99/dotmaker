// lab-core.js·maple.js는 ES 모듈이 아니라(빌드할 때 화면·작업자 코드에 그대로 붙는다) vm으로 불러 함수를 꺼낸다.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

export function loadLab() {
  const context = vm.createContext({});
  const code = ['lab-core.js', 'maple.js'].map(name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')).join('\n');
  vm.runInContext(`${code}\nthis.lab = { labShrink, labVote, labRepairOutline, labAutoPalette, labNearest, labCompute, mapleBuild, mapleDecode, mapleEncode };`, context);
  return context.lab;
}
