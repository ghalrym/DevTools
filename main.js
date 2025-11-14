const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const Docker = require('dockerode');
const simpleGit = require('simple-git');

let mainWindow;
let docker;
let git;

// Get config file path
const getUserDataPath = () => {
  try {
    const userDataDir = app.getPath('userData');
    // Ensure directory exists
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    return path.join(userDataDir, 'config.json');
  } catch (error) {
    // Fallback to current directory if app.getPath fails
    return path.join(process.cwd(), 'config.json');
  }
};

// Load config from file
const loadConfig = () => {
  try {
    const configPath = getUserDataPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(data);
      return config;
    }
  } catch (error) {
    // Silently fail
  }
  return {};
};

// Save config to file
const saveConfig = (config) => {
  try {
    const configPath = getUserDataPath();
    const configDir = path.dirname(configPath);
    
    // Ensure directory exists
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    const configString = JSON.stringify(config, null, 2);
    fs.writeFileSync(configPath, configString, 'utf-8');
    
    // Verify it was written
    if (fs.existsSync(configPath)) {
      return true;
    } else {
      return false;
    }
  } catch (error) {
    return false;
  }
};

// Initialize Docker connection
function initDocker() {
  try {
    docker = new Docker();
    return true;
  } catch (error) {
    return false;
  }
}

// Initialize Git (will be set per repository)
function initGit(repoPath) {
  try {
    git = simpleGit(repoPath || process.cwd());
    return true;
  } catch (error) {
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
    // Return only serializable data, not the full status object
    return { 
      success: true, 
      status: {
        current: status.current,
        tracking: status.tracking,
        ahead: status.ahead,
        behind: status.behind,
        files: status.files ? status.files.map(f => ({
          path: f.path,
          index: f.index,
          working_dir: f.working_dir
        })) : []
      }
    };
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
    // Return only serializable data
    return { 
      status: {
        current: status.current,
        tracking: status.tracking,
        ahead: status.ahead,
        behind: status.behind,
        files: status.files ? status.files.map(f => ({
          path: f.path,
          index: f.index,
          working_dir: f.working_dir
        })) : []
      }
    };
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
    // Return only serializable data
    const logs = log.all.map(commit => ({
      hash: commit.hash ? String(commit.hash) : '',
      date: commit.date ? (commit.date instanceof Date ? commit.date.toISOString() : String(commit.date)) : '',
      message: commit.message ? String(commit.message) : '',
      author_name: commit.author_name ? String(commit.author_name) : '',
      author_email: commit.author_email ? String(commit.author_email) : '',
      refs: commit.refs ? String(commit.refs) : ''
    }));
    return { logs };
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
    // Return only serializable data
    return { 
      success: true, 
      status: {
        current: status.current,
        tracking: status.tracking,
        ahead: status.ahead,
        behind: status.behind,
        files: status.files ? status.files.map(f => ({
          path: f.path,
          index: f.index,
          working_dir: f.working_dir
        })) : []
      }
    };
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
    // Return only serializable data
    return { 
      success: true, 
      status: {
        current: status.current,
        tracking: status.tracking,
        ahead: status.ahead,
        behind: status.behind,
        files: status.files ? status.files.map(f => ({
          path: f.path,
          index: f.index,
          working_dir: f.working_dir
        })) : []
      }
    };
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
    // Return only serializable data
    return { 
      success: true, 
      status: {
        current: status.current,
        tracking: status.tracking,
        ahead: status.ahead,
        behind: status.behind,
        files: status.files ? status.files.map(f => ({
          path: f.path,
          index: f.index,
          working_dir: f.working_dir
        })) : []
      }
    };
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
    
    // Return only serializable data
    return { 
      success: true, 
      status: {
        current: status.current,
        tracking: status.tracking,
        ahead: status.ahead,
        behind: status.behind,
        files: status.files ? status.files.map(f => ({
          path: f.path,
          index: f.index,
          working_dir: f.working_dir
        })) : []
      },
      lastCommit: log.latest ? {
        hash: log.latest.hash,
        date: log.latest.date,
        message: log.latest.message,
        author_name: log.latest.author_name,
        author_email: log.latest.author_email
      } : null
    };
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

ipcMain.handle('git:get-branches', async () => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    const branchSummary = await git.branchLocal();
    const branches = branchSummary.all.map(branch => ({
      name: branch,
      current: branch === branchSummary.current
    }));
    return { branches };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('git:checkout-branch', async (event, branchName) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    await git.checkout(branchName);
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('git:create-branch', async (event, branchName) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    await git.checkoutLocalBranch(branchName);
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('git:delete-branch', async (event, branchName, force) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    await git.deleteLocalBranch(branchName, force || false);
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
});

// IPC Handlers for Settings/Config
ipcMain.handle('config:get-git-repo-path', async () => {
  const config = loadConfig();
  const path = config.gitRepoPath || null;
  return { path };
});

ipcMain.handle('config:set-git-repo-path', async (event, repoPath) => {
  const config = loadConfig();
  config.gitRepoPath = repoPath;
  const success = saveConfig(config);
  return { success, path: repoPath };
});

