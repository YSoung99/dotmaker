// 화면에 JEV 요청·키 관리만 열어 준다(키 값 자체는 화면으로 돌려주지 않는다).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dotmakerDesktop', {
  jev: body => ipcRenderer.invoke('jev:request', body),
  hasJevKey: () => ipcRenderer.invoke('jev:hasKey'),
  setJevKey: key => ipcRenderer.invoke('jev:setKey', key),
  clearJevKey: () => ipcRenderer.invoke('jev:clearKey'),
});
