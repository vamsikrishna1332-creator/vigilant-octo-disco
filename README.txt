LaunchDesk — Electron Desktop App
===================================

REQUIREMENTS
------------
Node.js 18+ must be installed: https://nodejs.org

QUICK START (run without installing)
-------------------------------------
1. Open a terminal in this folder
2. Run:   npm install
3. Run:   npm start
   LaunchDesk opens as a native desktop window.

BUILD AN INSTALLER (optional)
------------------------------
After `npm install`, run one of:

  Windows (.exe installer):  npm run build:win
  macOS   (.dmg):            npm run build:mac
  Linux   (.AppImage):       npm run build:linux

The installer is saved to the  dist/  folder.

NOTES
-----
- All your data (shortcuts, schedules, quotes, settings) is stored
  in your OS's local app-data folder — it persists across sessions.
- No internet connection required after first launch.
