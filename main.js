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
    console.error('Error getting user data path:', error);
    // Fallback to current directory if app.getPath fails
    return path.join(process.cwd(), 'config.json');
  }
};

// Load config from file
const loadConfig = () => {
  try {
    const configPath = getUserDataPath();
    console.log('Loading config from:', configPath);
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(data);
      console.log('Loaded config:', config);
      return config;
    } else {
      console.log('Config file does not exist, returning empty config');
    }
  } catch (error) {
    console.error('Error loading config:', error);
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
      console.log('Created config directory:', configDir);
    }
    
    const configString = JSON.stringify(config, null, 2);
    fs.writeFileSync(configPath, configString, 'utf-8');
    console.log('Config saved successfully to:', configPath);
    console.log('Config content:', configString);
    
    // Verify it was written
    if (fs.existsSync(configPath)) {
      const verifyData = fs.readFileSync(configPath, 'utf-8');
      console.log('Verified config file exists and contains:', verifyData);
      return true;
    } else {
      console.error('Config file was not created!');
      return false;
    }
  } catch (error) {
    console.error('Error saving config:', error);
    console.error('Error stack:', error.stack);
    return false;
  }
};

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

  // Open DevTools automatically to see errors
  mainWindow.webContents.openDevTools();

  // Forward renderer console logs to main process console
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const prefix = level === 0 ? 'LOG' : level === 1 ? 'WARN' : 'ERROR';
    console.log(`[RENDERER ${prefix}] ${message}`);
    if (sourceId) {
      console.log(`  at ${sourceId}:${line}`);
    }
  });

  // Also listen to console.log from renderer
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      const originalLog = console.log;
      const originalError = console.error;
      const originalWarn = console.warn;
      
      console.log = function(...args) {
        originalLog.apply(console, args);
        try {
          const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
          require('electron').ipcRenderer.send('console-log', 'log', msg);
        } catch(e) {}
      };
      
      console.error = function(...args) {
        originalError.apply(console, args);
        try {
          const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
          require('electron').ipcRenderer.send('console-log', 'error', msg);
        } catch(e) {}
      };
      
      console.warn = function(...args) {
        originalWarn.apply(console, args);
        try {
          const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
          require('electron').ipcRenderer.send('console-log', 'warn', msg);
        } catch(e) {}
      };
    `);
  });

  // Initialize Docker on startup
  initDocker();
}

// Listen for console logs from renderer
ipcMain.on('console-log', (event, level, message) => {
  const prefix = level === 'error' ? 'ERROR' : level === 'warn' ? 'WARN' : 'LOG';
  console.log(`[RENDERER ${prefix}] ${message}`);
});

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

// IPC Handlers for Settings/Config
ipcMain.handle('config:get-git-repo-path', async () => {
  console.log('=== GETTING GIT REPO PATH ===');
  const config = loadConfig();
  console.log('Config loaded:', config);
  const path = config.gitRepoPath || null;
  console.log('Returning path:', path);
  return { path };
});

ipcMain.handle('config:set-git-repo-path', async (event, repoPath) => {
  console.log('=== SAVING GIT REPO PATH ===');
  console.log('Received path:', repoPath);
  
  const config = loadConfig();
  console.log('Current config:', config);
  
  config.gitRepoPath = repoPath;
  console.log('Updated config:', config);
  
  const success = saveConfig(config);
  console.log('Save result:', success);
  
  // Verify it was saved
  const verifyConfig = loadConfig();
  console.log('Verified config after save:', verifyConfig);
  
  return { success, path: repoPath };
});

