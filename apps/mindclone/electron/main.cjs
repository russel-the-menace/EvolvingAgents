const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1040,
    minHeight: 720,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f4f5f2',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  window.loadURL('http://127.0.0.1:5269');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
