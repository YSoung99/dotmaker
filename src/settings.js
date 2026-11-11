// 자주 바꾸는 값은 여기 한 곳에서 고친다. 맥·윈도우 프로그램이 같은 값을 쓴다.
// 고친 뒤 `npm start`로 확인하고, `npm run dist`로 설치 파일을 다시 만든다.
// 프로그램 버전은 package.json의 "version" 한 곳에서만 고친다.
const SETTINGS = {
  // 결과 크기(정사각형, px): 가장 작은 크기 ~ 가장 큰 크기를 간격마다. 프로그램이 받는 범위는 16 ~ 512.
  size: { min: 50, max: 200, step: 10, initial: 100 },
  // 새 버전 알림과 받기 링크가 가리키는 깃허브 저장소.
  repository: 'YSoung99/dotmaker',
};
