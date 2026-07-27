const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,

  // Launch a local app or file by path
  launchApp: (path) => ipcRenderer.invoke('launch-app', path),

  // Open a URL in the default browser
  openURL: (url) => ipcRenderer.invoke('open-url', url),

  // List all connected drives (returns array of drive objects)
  getDrives: () => ipcRenderer.invoke('get-drives'),

  // Open a file picker and set selected image as desktop wallpaper
  // Returns { success: boolean, path?: string, error?: string }
  chooseWallpaper: () => ipcRenderer.invoke('choose-wallpaper'),

  // Set wallpaper directly by path
  setWallpaper: (imagePath) => ipcRenderer.invoke('set-wallpaper', imagePath),

  // Listen for drive change events (USB plugged/unplugged)
  onDrivesChanged: (callback) => {
    ipcRenderer.on('drives-changed', (_, drives) => callback(drives));
  },

  // Real CPU + RAM usage from OS
  getSystemStats: () => ipcRenderer.invoke('get-system-stats'),
});
