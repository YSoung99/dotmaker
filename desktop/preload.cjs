// 화면에 JEV 요청·키 관리, 여러 장 저장(고른 폴더 안에만)만 열어 준다(키 값 자체는 화면으로 돌려주지 않는다).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dotmakerDesktop', {
  jev: body => ipcRenderer.invoke('jev:request', body),
  hasJevKey: () => ipcRenderer.invoke('jev:hasKey'),
  setJevKey: key => ipcRenderer.invoke('jev:setKey', key),
  clearJevKey: () => ipcRenderer.invoke('jev:clearKey'),
  pickFolder: () => ipcRenderer.invoke('batch:pickFolder'),
  writeToFolder: (name, png) => ipcRenderer.invoke('batch:write', name, png),
});
