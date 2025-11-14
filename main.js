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

ipcMain.handle('git:force-push', async (event, remote = 'origin', branch = null) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    const status = await git.status();
    const currentBranch = branch || status.current;
    await git.push(remote, currentBranch, ['--force']);
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('git:get-commit-diff', async (event, commitHash) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    // Get the diff for a specific commit
    // Use git show to get the full diff, then extract just the diff part
    let diff;
    try {
      // First try git diff between parent and commit (works for most commits)
      diff = await git.raw(['diff', `${commitHash}^..${commitHash}`, '--no-color']);
    } catch (e) {
      // If parent doesn't exist (first commit) or other error, use git show
      try {
        diff = await git.raw(['show', commitHash, '--no-color', '--format=']);
        // git show includes commit message, we need just the diff part
        // Find where the actual diff starts (after commit message)
        const lines = diff.split('\n');
        let diffStart = 0;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('diff --git')) {
            diffStart = i;
            break;
          }
        }
        // If we found the diff start, use from there, otherwise use all
        if (diffStart > 0) {
          diff = lines.slice(diffStart).join('\n');
        }
      } catch (e2) {
        return { error: e2.message };
      }
    }
    return { diff: diff || '' };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('git:get-diff', async (event, filePath = null, staged = false) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    let diff;
    if (staged) {
      // Staged diff: shows changes between HEAD and index
      if (filePath) {
        diff = await git.raw(['diff', '--cached', '--', filePath]);
      } else {
        diff = await git.raw(['diff', '--cached']);
      }
    } else {
      // Unstaged diff: shows changes between index and working directory
      if (filePath) {
        diff = await git.raw(['diff', '--', filePath]);
      } else {
        diff = await git.raw(['diff']);
      }
    }
    
    // If diff is empty, it might be a new file - try to get the file content
    if ((!diff || diff.trim() === '') && filePath) {
      const fs = require('fs');
      const path = require('path');
      try {
        const status = await git.status();
        const file = status.files.find(f => f.path === filePath);
        
        if (file) {
          // Check if it's a new/untracked file
          if (file.working_dir === '?' || file.index === '?') {
            // New/untracked file - show the file content
            // Get the repo path from git instance
            let repoPath;
            try {
              repoPath = await git.revparse(['--show-toplevel']);
            } catch (e) {
              // Try alternative method
              repoPath = null;
            }
            
            // Get base directory - simple-git stores it in _baseDir
            let basePath = process.cwd();
            if (git._baseDir) {
              basePath = git._baseDir.toString();
            } else if (repoPath) {
              basePath = repoPath;
            }
            
            const fullPath = path.join(basePath, filePath);
            if (fs.existsSync(fullPath)) {
              const content = fs.readFileSync(fullPath, 'utf8');
              // Format as a new file diff
              diff = `diff --git a/${filePath} b/${filePath}\nnew file mode 100644\nindex 0000000..0000000\n--- /dev/null\n+++ b/${filePath}\n${content.split('\n').map(line => `+${line}`).join('\n')}`;
            }
          } else if (staged && file.index !== ' ' && file.index !== '?') {
            // File is staged but diff is empty - might be a binary file or all content is new
            // Try to get the diff with more options
            try {
              diff = await git.raw(['diff', '--cached', '--text', '--', filePath]);
            } catch (e) {
              // If that fails, try without --text
              try {
                diff = await git.raw(['diff', '--cached', '--', filePath]);
              } catch (e2) {
                // Still empty, might be binary
              }
            }
          } else if (!staged && (file.working_dir === 'M' || file.working_dir === 'D')) {
            // File is modified but diff is empty - try with more options
            try {
              diff = await git.raw(['diff', '--text', '--', filePath]);
            } catch (e) {
              try {
                diff = await git.raw(['diff', '--', filePath]);
              } catch (e2) {
                // Still empty
              }
            }
          }
        }
      } catch (err) {
        // If we can't read the file, just return empty diff
      }
    }
    
    return { diff: diff || '' };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('git:get-branches', async () => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    // Get local branches
    const branchSummary = await git.branchLocal();
    const localBranches = branchSummary.all.map(branch => ({
      name: branch,
      current: branch === branchSummary.current,
      type: 'local'
    }));
    
    // Get remote branches
    let remoteBranches = [];
    try {
      const remoteSummary = await git.branch(['-r']);
      remoteBranches = remoteSummary.all
        .filter(branch => !branch.includes('HEAD'))
        .map(branch => {
          // Remove 'origin/' or other remote prefix
          const name = branch.replace(/^[^/]+\//, '');
          return {
            name: name,
            fullName: branch,
            current: false,
            type: 'remote'
          };
        });
    } catch (error) {
      // If remote branches can't be fetched, just continue with local branches
    }
    
    return { 
      local: localBranches,
      remote: remoteBranches
    };
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

ipcMain.handle('git:checkout-remote-branch', async (event, remoteBranchName, localBranchName) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    // Checkout remote branch and create a local tracking branch
    await git.checkout(['-b', localBranchName, remoteBranchName]);
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

ipcMain.handle('config:get-commit-template', async () => {
  const config = loadConfig();
  const template = config.commitTemplate || '';
  return { template };
});

ipcMain.handle('config:set-commit-template', async (event, template) => {
  const config = loadConfig();
  config.commitTemplate = template;
  const success = saveConfig(config);
  return { success, template };
});

