// lab-core.js는 ES 모듈이 아니라(빌드할 때 화면·작업자 코드에 그대로 붙는다) vm으로 불러 함수를 꺼낸다.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

export function loadLab() {
  const context = vm.createContext({});
  const code = readFileSync(new URL('../src/lab-core.js', import.meta.url), 'utf8');
  vm.runInContext(`${code}\nthis.lab = { labShrink, labVote, labRepairOutline, labAutoPalette, labNearest, labCompute };`, context);
  return context.lab;
}
