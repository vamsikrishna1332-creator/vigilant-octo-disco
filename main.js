const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

// ── System stats ─────────────────────────────────────────────────────────────

let cachedCpu = 0;

function sampleCpu() {
  return new Promise(resolve => {
    const s1 = os.cpus();
    setTimeout(() => {
      const s2 = os.cpus();
      let idle = 0, total = 0;
      for (let i = 0; i < s1.length; i++) {
        const t1 = Object.values(s1[i].times).reduce((a, b) => a + b, 0);
        const t2 = Object.values(s2[i].times).reduce((a, b) => a + b, 0);
        const id1 = s1[i].times.idle, id2 = s2[i].times.idle;
        total += t2 - t1;
        idle  += id2 - id1;
      }
      resolve(total === 0 ? 0 : Math.round((1 - idle / total) * 100));
    }, 200);
  });
}

// Keep a background sample so top bar reads without waiting
setInterval(async () => { cachedCpu = await sampleCpu(); }, 2000);
sampleCpu().then(v => { cachedCpu = v; });

function getSystemStats() {
  const total  = os.totalmem();
  const free   = os.freemem();
  const used   = total - free;
  const cpus   = os.cpus();
  return {
    cpu:       cachedCpu,
    ramPct:    Math.round((used / total) * 100),
    ramUsedGB: (used  / 1073741824).toFixed(1),
    ramTotalGB:(total / 1073741824).toFixed(1),
    cores:     cpus.length,
    cpuModel:  cpus[0]?.model?.replace(/ CPU.*/, '').trim() ?? 'CPU',
    platform:  process.platform,
  };
}

// ── Drive detection ──────────────────────────────────────────────────────────

function getDrivesWin() {
  return new Promise((resolve) => {
    exec(
      'wmic logicaldisk get DeviceID,VolumeName,Size,FreeSpace,DriveType /format:csv',
      (err, stdout) => {
        if (err) { resolve([]); return; }
        const lines = stdout.trim().split(/\r?\n/).filter(l => l.trim() && !l.startsWith('Node'));
        const drives = lines.map(line => {
          const parts = line.split(',');
          // CSV: Node, DeviceID, DriveType, FreeSpace, Size, VolumeName
          const [, deviceId, driveType, freeSpace, size, volumeName] = parts;
          return {
            name: (deviceId || '').trim(),
            label: (volumeName || '').trim() || (deviceId || '').trim(),
            size: parseInt(size) || 0,
            freeSpace: parseInt(freeSpace) || 0,
            type: parseInt(driveType) || 0,
            // DriveType 2 = Removable (USB/pendrive), 3 = Local, 4 = Network, 5 = CD
            isRemovable: parseInt(driveType) === 2,
          };
        }).filter(d => d.name);
        resolve(drives);
      }
    );
  });
}

function getDrivesMac() {
  return new Promise((resolve) => {
    exec('df -k | grep -v "^Filesystem"', (err, stdout) => {
      if (err) { resolve([]); return; }
      const lines = stdout.trim().split('\n');
      const drives = lines.map(line => {
        const parts = line.trim().split(/\s+/);
        const mountPoint = parts[parts.length - 1];
        const blocks = parseInt(parts[1]) || 0;
        const used = parseInt(parts[2]) || 0;
        const avail = parseInt(parts[3]) || 0;
        return {
          name: mountPoint,
          label: mountPoint.split('/').pop() || mountPoint,
          size: blocks * 1024,
          freeSpace: avail * 1024,
          isRemovable: mountPoint.startsWith('/Volumes/'),
          type: mountPoint.startsWith('/Volumes/') ? 2 : 3,
        };
      }).filter(d => d.name && d.name !== '/');
      resolve(drives);
    });
  });
}

function getDrivesLinux() {
  return new Promise((resolve) => {
    exec('lsblk -J -o NAME,MOUNTPOINT,SIZE,TYPE,RM,LABEL', (err, stdout) => {
      if (err) { resolve([]); return; }
      try {
        const data = JSON.parse(stdout);
        const drives = [];
        const walk = (devices) => {
          for (const dev of devices) {
            if (dev.mountpoint) {
              drives.push({
                name: dev.mountpoint,
                label: dev.label || dev.name,
                size: 0,
                freeSpace: 0,
                isRemovable: dev.rm === '1' || dev.rm === true,
                type: (dev.rm === '1' || dev.rm === true) ? 2 : 3,
              });
            }
            if (dev.children) walk(dev.children);
          }
        };
        walk(data.blockdevices || []);
        resolve(drives);
      } catch { resolve([]); }
    });
  });
}

async function getDrives() {
  if (process.platform === 'win32') return getDrivesWin();
  if (process.platform === 'darwin') return getDrivesMac();
  return getDrivesLinux();
}

// ── Wallpaper ────────────────────────────────────────────────────────────────

function setWallpaperWin(imagePath) {
  return new Promise((resolve, reject) => {
    const safe = imagePath.replace(/'/g, "''");
    const ps = `
      Add-Type -TypeDefinition @"
        using System;
        using System.Runtime.InteropServices;
        public class Wallpaper {
          [DllImport("user32.dll", CharSet = CharSet.Auto)]
          public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
        }
"@
      [Wallpaper]::SystemParametersInfo(20, 0, '${safe}', 3)
    `;
    exec(`powershell -NoProfile -Command "${ps.replace(/\n/g, ' ')}"`, (err) => {
      if (err) reject(err); else resolve(true);
    });
  });
}

function setWallpaperMac(imagePath) {
  return new Promise((resolve, reject) => {
    const safe = imagePath.replace(/"/g, '\\"');
    exec(
      `osascript -e 'tell application "Finder" to set desktop picture to POSIX file "${safe}"'`,
      (err) => { if (err) reject(err); else resolve(true); }
    );
  });
}

function setWallpaperLinux(imagePath) {
  return new Promise((resolve, reject) => {
    // Try GNOME then KDE then feh
    const safe = imagePath.replace(/"/g, '\\"');
    const cmd = `gsettings set org.gnome.desktop.background picture-uri "file://${safe}" 2>/dev/null || ` +
                `qdbus org.kde.plasmashell /PlasmaShell evaluateScript "" 2>/dev/null || ` +
                `feh --bg-scale "${safe}"`;
    exec(cmd, (err) => { if (err) reject(err); else resolve(true); });
  });
}

async function setWallpaper(imagePath) {
  if (process.platform === 'win32') return setWallpaperWin(imagePath);
  if (process.platform === 'darwin') return setWallpaperMac(imagePath);
  return setWallpaperLinux(imagePath);
}

// ── Window ───────────────────────────────────────────────────────────────────

let mainWindow = null;
let drivePollingInterval = null;
let lastDriveSnapshot = '';

function startDrivePolling() {
  drivePollingInterval = setInterval(async () => {
    const drives = await getDrives();
    const snapshot = JSON.stringify(drives);
    if (snapshot !== lastDriveSnapshot) {
      lastDriveSnapshot = snapshot;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('drives-changed', drives);
      }
    }
  }, 3000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0e1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'App', 'index.html'));

  // Make the top bar draggable without blocking child interactions
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.insertCSS(`
      .cursor-grab { -webkit-app-region: drag; }
      .cursor-grab button, .cursor-grab a, .cursor-grab input, .cursor-grab select { -webkit-app-region: no-drag; }
    `);
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  startDrivePolling();
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (drivePollingInterval) clearInterval(drivePollingInterval);
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC Handlers ─────────────────────────────────────────────────────────────

// Launch a local app/file by path
ipcMain.handle('launch-app', async (_, appPath) => {
  const err = await shell.openPath(appPath);
  return { success: !err, error: err || null };
});

// Open a URL in default browser
ipcMain.handle('open-url', async (_, url) => {
  await shell.openExternal(url);
  return { success: true };
});

// Get all connected drives
ipcMain.handle('get-drives', async () => {
  return getDrives();
});

// Choose wallpaper via file dialog and apply it
ipcMain.handle('choose-wallpaper', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Wallpaper',
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'gif', 'webp'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) {
    return { success: false, error: 'Cancelled' };
  }
  const imagePath = result.filePaths[0];
  try {
    await setWallpaper(imagePath);
    return { success: true, path: imagePath };
  } catch (e) {
    return { success: false, error: String(e) };
  }
});

// Set wallpaper directly by path
ipcMain.handle('set-wallpaper', async (_, imagePath) => {
  try {
    await setWallpaper(imagePath);
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
});

// Real system stats
ipcMain.handle('get-system-stats', () => getSystemStats());
