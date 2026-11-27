// 자주 바꾸는 값은 여기 한 곳에서 고친다. 맥·윈도우 프로그램이 같은 값을 쓴다.
// 고친 뒤 `npm start`로 확인하고, `npm run dist`로 설치 파일을 다시 만든다.
// 프로그램 버전은 package.json의 "version" 한 곳에서만 고친다.
const SETTINGS = {
  // 결과 크기(정사각형, px): 가장 작은 크기 ~ 가장 큰 크기를 간격마다. 프로그램이 받는 범위는 16 ~ 250.
  // step: 직접 입력 칸의 간격, listStep: 드롭다운(도트화·AI 보정·실험 탭 목록)의 간격.
  size: { min: 50, max: 250, step: 1, listStep: 10, initial: 100 },
  // 새 버전 알림과 받기 링크가 가리키는 깃허브 저장소.
  repository: 'YSoung99/dotmaker',
};
