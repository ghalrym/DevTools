const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Docker = require('dockerode');
const simpleGit = require('simple-git');

let mainWindow;
let docker;
let git;

// Initialize Docker connection
function initDocker() {
  try {
    docker = new Docker();
    return true;
  } catch (error) {
    console.error('Docker initialization error:', error);
    return false;
  }
}

// Initialize Git (will be set per repository)
function initGit(repoPath) {
  try {
    git = simpleGit(repoPath || process.cwd());
    return true;
  } catch (error) {
    console.error('Git initialization error:', error);
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');

  // Initialize Docker on startup
  initDocker();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers for Docker
ipcMain.handle('docker:list-containers', async () => {
  if (!docker) {
    if (!initDocker()) {
      return { error: 'Docker not available' };
    }
  }

  try {
    const containers = await docker.listContainers({ all: true });
    return { containers };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('docker:get-logs', async (event, containerId, tail = 100) => {
  if (!docker) {
    return { error: 'Docker not available' };
  }

  try {
    const container = docker.getContainer(containerId);
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail: tail,
      timestamps: true
    });
    return { logs: logs.toString('utf-8') };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('docker:get-container-info', async (event, containerId) => {
  if (!docker) {
    return { error: 'Docker not available' };
  }

  try {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    return { info };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('docker:restart-container', async (event, containerId) => {
  if (!docker) {
    return { error: 'Docker not available' };
  }

  try {
    const container = docker.getContainer(containerId);
    await container.restart();
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('docker:start-container', async (event, containerId) => {
  if (!docker) {
    return { error: 'Docker not available' };
  }

  try {
    const container = docker.getContainer(containerId);
    await container.start();
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('docker:stop-container', async (event, containerId) => {
  if (!docker) {
    return { error: 'Docker not available' };
  }

  try {
    const container = docker.getContainer(containerId);
    await container.stop();
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
});

// IPC Handlers for Git
ipcMain.handle('git:set-repo', async (event, repoPath) => {
  try {
    git = simpleGit(repoPath);
    const status = await git.status();
    return { success: true, status };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('git:get-status', async () => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    const status = await git.status();
    return { status };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('git:get-logs', async (event, limit = 50) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    const log = await git.log({ maxCount: limit });
    return { logs: log.all };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('git:stage-file', async (event, filePath) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    await git.add(filePath);
    const status = await git.status();
    return { success: true, status };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('git:unstage-file', async (event, filePath) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    await git.reset(['HEAD', filePath]);
    const status = await git.status();
    return { success: true, status };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('git:stage-all', async () => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    await git.add('.');
    const status = await git.status();
    return { success: true, status };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('git:commit', async (event, message) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    await git.commit(message);
    const status = await git.status();
    const log = await git.log({ maxCount: 1 });
    return { success: true, status, lastCommit: log.latest };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('git:push', async (event, remote = 'origin', branch = null) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    const status = await git.status();
    const currentBranch = branch || status.current;
    await git.push(remote, currentBranch);
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('git:get-diff', async (event, filePath = null) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    const diff = filePath 
      ? await git.diff([filePath])
      : await git.diff();
    return { diff };
  } catch (error) {
    return { error: error.message };
  }
});

