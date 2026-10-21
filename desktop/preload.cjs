const {contextBridge,ipcRenderer}=require('electron');
// This is the entire renderer bridge. No generic IPC, filesystem or shell API.
contextBridge.exposeInMainWorld('mailWizard',Object.freeze({
  connect:config=>ipcRenderer.invoke('mail:connect',config),
  sync:options=>ipcRenderer.invoke('mail:sync',options),
  update:options=>ipcRenderer.invoke('mail:update',options),
  send:draft=>ipcRenderer.invoke('mail:send',draft),
  attachment:options=>ipcRenderer.invoke('mail:attachment',options),
  disconnect:()=>ipcRenderer.invoke('mail:disconnect'),
  windowCommand:command=>ipcRenderer.invoke('window:command',command)
}));
