// 설치판 업데이트(mac-updater.cjs), 클라우드 AI(cloud.js), JEV(jev-app.js·jev-core.js) 단위 시험.
// cloud.js·jev-*.js는 ES 모듈이 아니라 vm으로 불러 함수를 꺼낸다(load-lab.mjs와 같은 방식).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const { parseFeed, newer, pickMacZip } = require('../desktop/mac-updater.cjs');

// ───────────── mac-updater.cjs
const FEED = `version: 3.14.2
files:
  - url: DotMaker-3.14.2-mac-x64.zip
    sha512: xHASH
    size: 100
  - url: DotMaker-3.14.2-mac-arm64.zip
    sha512: aHASH
    size: 200
  - url: DotMaker-3.14.2-mac-arm64.dmg
    sha512: dHASH
    size: 300
path: DotMaker-3.14.2-mac-arm64.zip
`;

test('parseFeed는 버전과 칩에 맞는 zip을 읽는다', () => {
  assert.deepEqual(parseFeed(FEED, 'arm64'), { version: '3.14.2', zip: { url: 'DotMaker-3.14.2-mac-arm64.zip', sha512: 'aHASH', size: 200 } });
  assert.equal(parseFeed(FEED, 'x64').zip.sha512, 'xHASH');
  assert.throws(() => parseFeed('files: []', 'arm64'));
});

test('arm64 맥은 x64 zip으로 절대 바꾸지 않는다', () => {
  const onlyX64 = FEED.replace(/  - url: DotMaker-3\.14\.2-mac-arm64\.zip\n.*\n.*\n/, '');
  assert.throws(() => parseFeed(onlyX64, 'arm64'), /맞는 파일이 없습니다/);
  assert.equal(pickMacZip([{ url: 'DotMaker-1.0.0-mac.zip' }], 'arm64'), null);
  assert.equal(pickMacZip([{ url: 'DotMaker-1.0.0-mac.zip' }], 'x64').url, 'DotMaker-1.0.0-mac.zip');
  assert.equal(pickMacZip([{ url: 'DotMaker-1.0.0-mac-universal.zip' }], 'arm64').url, 'DotMaker-1.0.0-mac-universal.zip');
  assert.equal(pickMacZip([{ url: 'DotMaker-1.0.0-mac-arm64.zip' }], 'x64'), null);
});

test('newer는 숫자 단위로 버전을 비교한다', () => {
  assert.equal(newer('3.14.10', '3.14.9'), true);
  assert.equal(newer('v3.15.0', '3.14.1'), true);
  assert.equal(newer('3.14.1', '3.14.1'), false);
  assert.equal(newer('3.14.0', '3.14.1'), false);
  assert.equal(newer('3.14.1-beta', '3.14.0'), true);
});

// ───────────── cloud.js
function loadCloud(fetchStub) {
  const context = vm.createContext({ Blob, atob, AbortSignal, fetch: fetchStub, globalThis: undefined });
  context.globalThis = context;
  vm.runInContext(`${source('cloud.js')}\nthis.cloud = { failure, send, openaiCost, base64Mime, base64ToBlob, findImage, cloudDesktop, CloudError };`, context);
  return context.cloud;
}
const jsonResponse = (status, body) => ({ status, json: async () => body });

test('failure는 FastAPI detail 배열을 읽기 쉽게 풀고 422를 설명한다', async () => {
  const { failure } = loadCloud();
  const error = await failure('PixelLab', jsonResponse(422, { detail: [
    { loc: ['body', 'image_size', 'width'], msg: 'must be <= 400', type: 'value_error' },
    { loc: ['body', 'seed'], msg: 'field required' },
  ] }));
  assert.match(error.message, /^PixelLab: 보낸 그림이나 설정 값을 받아 주지 않았습니다/);
  assert.match(error.message, /HTTP 422/);
  assert.match(error.message, /image_size\.width: must be <= 400; seed: field required/);
  assert.doesNotMatch(error.message, /\[object Object\]/);
});

test('failure는 500·503·객체 오류도 한국어로 알려 준다', async () => {
  const { failure } = loadCloud();
  assert.match((await failure('Gemini', jsonResponse(503, { error: { message: 'overloaded' } }))).message, /바쁘거나 점검 중.*overloaded/);
  assert.match((await failure('OpenAI', jsonResponse(500, {}))).message, /서비스 쪽에서 오류/);
  assert.match((await failure('PixelLab', jsonResponse(400, { detail: { msg: 'bad image' } }))).message, /bad image/);
  const noBody = { status: 502, json: async () => { throw new SyntaxError('no json'); } };
  assert.equal((await failure('OpenAI', noBody)).message, 'OpenAI: 서버 오류가 났습니다 (HTTP 502)');
});

test('openaiCost는 토큰 수로 요금을 계산한다', () => {
  const { openaiCost } = loadCloud();
  assert.equal(openaiCost(null), null);
  const cost = openaiCost({ input_tokens: 1500, input_tokens_details: { image_tokens: 1000 }, output_tokens: 4000 });
  assert.ok(Math.abs(cost - (1000 * 8 + 500 * 5 + 4000 * 30) / 1e6) < 1e-12);
});

test('base64 앞부분으로 그림 종류를 알아낸다', () => {
  const { base64Mime, base64ToBlob } = loadCloud();
  assert.equal(base64Mime('iVBORw0KGgo='), 'image/png');
  assert.equal(base64Mime('/9j/4AAQSkZJRg=='), 'image/jpeg');
  assert.equal(base64Mime('UklGRiQAAABXRUJQ'), 'image/webp');
  assert.equal(base64Mime('R0lGODlh'), 'image/png');
  assert.equal(base64ToBlob('/9j/4AAQ').type, 'image/jpeg');
});

test('findImage는 생각 중 그림(thought)을 건너뛰고 마지막 그림을 쓴다', () => {
  const { findImage } = loadCloud();
  const body = { candidates: [{ content: { parts: [
    { inlineData: { data: 'DRAFT' }, thought: true },
    { text: 'here' },
    { inlineData: { data: 'FINAL' } },
  ] } }] };
  assert.equal(findImage(body), 'FINAL');
  assert.equal(findImage({ data: [{ b64_json: 'OPENAI' }] }), 'OPENAI');
  assert.equal(findImage({ candidates: [{ content: { parts: [{ inline_data: { data: 'X' }, thought: true }] } }] }), null);
});

test('send는 시간 초과를 알아보기 쉬운 오류로 바꾼다', async () => {
  let signal = null;
  const { send } = loadCloud(async (_url, options) => {
    signal = options.signal;
    throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  });
  await assert.rejects(send('Gemini', 'https://example.invalid', { method: 'POST' }), error => {
    assert.match(error.message, /^Gemini: 3분 안에 응답이 오지 않아 멈췄습니다/);
    return true;
  });
  assert.ok(signal instanceof AbortSignal);
});

test('send는 연결 실패와 시간 초과를 구분한다', async () => {
  const { send } = loadCloud(async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(send('OpenAI', 'https://example.invalid', {}), /OpenAI: 서버에 연결하지 못했습니다/);
});

test('cloudDesktop은 jev-app.js 없이도 본체를 찾는다', () => {
  const cloud = loadCloud();
  assert.equal(cloud.cloudDesktop(), null);
});

// ───────────── jev-app.js
function loadJevApp(jev) {
  const canvas = { getContext: () => ({ fillRect() {}, drawImage() {} }), toDataURL: () => 'data:image/png;base64,' };
  const context = vm.createContext({
    window: { dotmakerDesktop: { jev } },
    document: { createElement: () => canvas },
    toCanvas: () => ({}),
    setTimeout,
    Raster: { fromStraight: (bytes, w, h) => ({ px: Array.from({ length: w * h }, () => 0), grid: { w, h } }) },
  });
  vm.runInContext(`${source('jev-app.js')}\nthis.jev = { parseChoice, jevRows, chooseJev, askJev, JEV_CRITERIA };`, context);
  return context.jev;
}
const choice = (name, probabilities) => ({ name, type: 'choice', probabilities: probabilities.map(([value, probability]) => ({ value: String(value), probability })) });
const reply = answers => ({ status: 200, text: JSON.stringify({ answers }) });

test('parseChoice는 전체·일부 확률을 모두 읽는다', () => {
  const { parseChoice } = loadJevApp();
  const full = parseChoice([choice('outer', [[0, 0.7], [1, 0.2], [2, 0.1]])], 'outer', 3);
  assert.equal(full.index, 0);
  assert.deepEqual([...full.scores], [0.7, 0.2, 0.1]);
  const partial = parseChoice([choice('outer', [[0, 0.3], [2, 0.65], [7, 0.5], ['x', 0.2]])], 'outer', 3);
  assert.equal(partial.index, 2);
  assert.deepEqual([...partial.scores], [0.3, 0, 0.65]);
  assert.equal(parseChoice([choice('outer', [[1, 0.9]])], 'outer', 3), null);
  assert.equal(parseChoice([choice('outer', [[0, 0], [1, 0]])], 'outer', 3), null);
  assert.equal(parseChoice([], 'outer', 3), null);
});

test('jevRows의 확신 기준은 후보 수에 맞춰 바뀐다', () => {
  const { jevRows } = loadJevApp();
  const probe = (id, count) => ({ id, title: id, images: [], choices: Array.from({ length: count }, (_, k) => [`c${k}`, `후보${k}`]),
    edits: Object.fromEntries(Array.from({ length: count }, (_, k) => [k, [[0, k + 1]]])) });
  const data = { base: { bytes: [], w: 1, h: 1 }, full: [], cleanEdges: [], probes: [probe('two', 2), probe('four', 4), probe('weak', 3)] };
  const rows = jevRows(data, [
    choice('two', [[0, 0.45], [1, 0.55]]),                       // 2개: 기준 0.65 → 유보
    choice('four', [[0, 0.42], [1, 0.2], [2, 0.2], [3, 0.18]]),  // 4개: 기준 0.5 → 0.42는 유보
    choice('weak', [[0, 0.56], [1, 0.40], [2, 0.04]]),           // 3개: 기준 0.5, 차이 0.16 → 확신
  ]);
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.equal(byId.two.suggested, null);
  assert.match(byId.two.result, /판단 유보/);
  assert.equal(byId.four.suggested, null);
  assert.equal(byId.weak.suggested, 0);
  const strong = jevRows(data, [choice('four', [[0, 0.1], [1, 0.1], [2, 0.6], [3, 0.2]])]);
  assert.equal(strong.find(r => r.id === 'four').suggested, 2);
});

test('chooseJev는 차이가 작으면 지금 설정(0번)을 지킨다', async () => {
  const pictures = [{ w: 1, h: 1 }, { w: 1, h: 1 }, { w: 1, h: 1 }, { w: 1, h: 1 }, { w: 1, h: 1 }];
  const noisy = loadJevApp(async () => reply([choice('best', [['A', 0.2], ['B', 0.21], ['C', 0.2], ['D', 0.2], ['E', 0.19]])]));
  const kept = await noisy.chooseJev({ w: 1, h: 1 }, pictures, 'overall');
  assert.equal(kept.index, 0);
  assert.equal(kept.picked, 1);
  assert.equal(kept.confident, false);
  const clear = loadJevApp(async () => reply([choice('best', [['A', 0.1], ['B', 0.7], ['C', 0.1], ['D', 0.05], ['E', 0.05]])]));
  const flipped = await clear.chooseJev({ w: 1, h: 1 }, pictures, 'overall');
  assert.equal(flipped.index, 1);
  assert.equal(flipped.confident, true);
});

test('chooseJev는 깨진 JSON을 알아보기 쉬운 오류로 바꾼다', async () => {
  const broken = loadJevApp(async () => ({ status: 200, text: '{"answers": [' }));
  await assert.rejects(broken.chooseJev({ w: 1, h: 1 }, [{ w: 1, h: 1 }, { w: 1, h: 1 }], 'strokes'), /JEV 응답을 읽지 못했습니다/);
  const offline = loadJevApp(async () => ({ status: 401, text: 'bad key' }));
  await assert.rejects(offline.chooseJev({ w: 1, h: 1 }, [{ w: 1, h: 1 }, { w: 1, h: 1 }], 'strokes'), /HTTP 401/);
});

test('askJev는 한 묶음이 실패해도 받은 답을 버리지 않는다', async () => {
  const image = { picture: { w: 1, h: 1 }, nearest: true, gray: 0.88 };
  const calls = [];
  const app = loadJevApp(async body => {
    calls.push(body.questions.map(q => q.name).join());
    return body.questions[0].name === 'face' ? reply([choice('face', [[0, 0.8], [1, 0.1], [2, 0.1]])]) : { status: 401, text: 'no' };
  });
  const answers = await app.askJev({ full: [image, image], probes: [
    { id: 'face', full: true, images: [], instructions: '', choices: [['a'], ['b'], ['c']] },
    { id: 'big', images: Array(16).fill(image), instructions: '', choices: [['a'], ['b']] },
  ] });
  assert.deepEqual(calls, ['face', 'big']);
  assert.equal(answers.length, 1);
  assert.equal(answers[0].name, 'face');
});

test('overall 기준에 특정 캐릭터 색(분홍 머리·보라 눈)이 박혀 있지 않다', () => {
  const { JEV_CRITERIA } = loadJevApp();
  assert.doesNotMatch(JEV_CRITERIA.overall, /pink|purple|ribbon|white body|hair/i);
  assert.match(JEV_CRITERIA.overall, /silhouette/);
});

// ───────────── jev-core.js (core.js와 함께 불러 실제 Raster로 잰다)
function loadJevCore() {
  const core = source('core.js').replace(/^export (?=const|function|class|let)/gm, '');
  const context = vm.createContext({});
  vm.runInContext(`${core}\n${source('jev-core.js')}\nthis.jc = { Raster, pack, jevDeltaE, jevEdgeSSIM, jevContourBreaks, jevBleedRatio, jevNearby, edgeFindings };`, context);
  return context.jc;
}
const rasterOf = (jc, w, h, fill) => {
  const bytes = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) bytes.set(fill(i % w, Math.trunc(i / w)), i * 4);
  return jc.Raster.fromStraight(bytes, w, h);
};

test('jevDeltaE·jevEdgeSSIM는 같은 그림에서 0·1이다', () => {
  const jc = loadJevCore();
  assert.equal(jc.jevDeltaE(jc.pack(10, 200, 30), jc.pack(10, 200, 30)), 0);
  assert.ok(jc.jevDeltaE(jc.pack(255, 0, 128), jc.pack(0, 200, 0)) > 0.3);
  const picture = rasterOf(jc, 8, 8, (x, y) => (x > 2 && x < 6 && y > 2 && y < 6 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  assert.ok(Math.abs(jc.jevEdgeSSIM(picture, picture) - 1) < 1e-9);
  const flat = rasterOf(jc, 8, 8, () => [255, 255, 255, 255]);
  assert.ok(jc.jevEdgeSSIM(picture, flat) < 0.5);
});

test('jevContourBreaks는 끊긴 선의 끝점을 센다', () => {
  const jc = loadJevCore();
  const line = rasterOf(jc, 9, 3, (x, y) => (y === 1 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const broken = rasterOf(jc, 9, 3, (x, y) => (y === 1 && x !== 4 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  assert.equal(jc.jevContourBreaks(line), 2);
  assert.equal(jc.jevContourBreaks(broken), 4);
});

test('jevBleedRatio는 옆 색이 번진 칸 비율을 잰다', () => {
  const jc = loadJevCore();
  const halves = (x) => (x < 4 ? [230, 60, 140, 255] : [240, 240, 240, 255]);
  const reference = rasterOf(jc, 8, 2, halves);
  const bled = rasterOf(jc, 8, 2, (x) => (x === 4 ? [230, 60, 140, 255] : halves(x)));
  assert.equal(jc.jevBleedRatio(reference, reference), 0);
  assert.equal(jc.jevBleedRatio(reference, bled), 2 / 16);
});

test('edgeFindings는 밝기 차이가 작은 색 번짐도 잡는다', () => {
  const jc = loadJevCore();
  const reference = rasterOf(jc, 4, 1, () => [0, 0, 0, 0]);
  const current = rasterOf(jc, 4, 1, x => (x === 1 ? [255, 60, 200, 90] : x === 2 ? [40, 255, 60, 70] : [0, 0, 0, 0]));
  const findings = Object.fromEntries(jc.edgeFindings({ image: reference }, current).map(f => [f.id, f]));
  assert.deepEqual([...findings.edge_light.points], []);
  assert.deepEqual([...findings.edge_dark.points], []);
  assert.deepEqual([...findings.edge_color.points], [1, 2]);
});

test('jevNearby는 보여 준 구역에 이어진 근처 칸만 남긴다', () => {
  const jc = loadJevCore();
  const grid = rasterOf(jc, 30, 1, () => [0, 0, 0, 255]).grid;
  const points = [2, 3, 4, 5, 6, 7, 20, 21];   // 2~7은 이어진 선, 20·21은 멀리 떨어진 다른 선
  assert.deepEqual([...jc.jevNearby(points, { x: 2, y: 0, w: 2, h: 1 }, grid, 4)], [2, 3, 4, 5, 6, 7]);
  assert.deepEqual([...jc.jevNearby(points, { x: 2, y: 0, w: 2, h: 1 }, grid, 2)], [2, 3, 4, 5]);
});
