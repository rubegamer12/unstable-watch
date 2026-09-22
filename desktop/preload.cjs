const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('unstableDesktop', {
  checkForUpdates: () => ipcRenderer.invoke('desktop:update-check'),
  getUpdateState: () => ipcRenderer.invoke('desktop:update-state'),
  restartAndUpdate: () => ipcRenderer.invoke('desktop:update-restart'),
  onUpdateState: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop:update-state', listener);
    return () => ipcRenderer.removeListener('desktop:update-state', listener);
  },
  getState: () => ipcRenderer.invoke('desktop:get-state'),
  windowAction: action => ipcRenderer.invoke('desktop:window', action),
  setLaunchAtLogin: enabled => ipcRenderer.invoke('desktop:set-login', Boolean(enabled)),
  saveConfig: input => ipcRenderer.invoke('desktop:save-config', input),
  openDataFolder: () => ipcRenderer.invoke('desktop:open-data'),
  relaunch: () => ipcRenderer.invoke('desktop:relaunch'),
  quit: () => ipcRenderer.invoke('desktop:quit')
});

