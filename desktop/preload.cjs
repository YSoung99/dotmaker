// 화면에 JEV 요청·키 관리, 클라우드 AI 키 관리, 여러 장 저장(고른 폴더 안에만), 업데이트 확인만 열어 준다.
// JEV 키 값은 화면으로 돌려주지 않는다. 클라우드 AI 요청은 화면이 보내므로 그 키만 요청할 때 꺼내 준다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dotmakerDesktop', {
  jev: body => ipcRenderer.invoke('jev:request', body),
  hasJevKey: () => ipcRenderer.invoke('jev:hasKey'),
  setJevKey: key => ipcRenderer.invoke('jev:setKey', key),
  clearJevKey: () => ipcRenderer.invoke('jev:clearKey'),
  getCloudKey: id => ipcRenderer.invoke('cloud:getKey', id),
  setCloudKey: (id, key) => ipcRenderer.invoke('cloud:setKey', id, key),
  clearCloudKey: id => ipcRenderer.invoke('cloud:clearKey', id),
  pickFolder: () => ipcRenderer.invoke('batch:pickFolder'),
  writeToFolder: (name, png) => ipcRenderer.invoke('batch:write', name, png),
  updateSupported: () => ipcRenderer.invoke('update:supported'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
});
