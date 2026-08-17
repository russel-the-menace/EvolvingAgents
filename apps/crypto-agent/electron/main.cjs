const { app, BrowserWindow } = require('electron');

let mainWindow;
let quitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 920,
    minHeight: 640,
    title: 'CryptoAgent',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f4f5f6',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadURL('http://127.0.0.1:5450');
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (!mainWindow) createWindow();
    else mainWindow.show();
  });
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
