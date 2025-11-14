const { app, BrowserWindow, ipcMain, dialog } = require('electron');
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

ipcMain.handle('git:get-logs', async (event, limit = 50, branch = null) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    // If branch is specified, get logs for that branch, otherwise get logs for current branch
    let log;
    if (branch) {
      // Use git.raw to get logs for a specific branch
      // Format: git log --format="%H|%an|%ae|%ad|%s" --date=iso -n 50 branchName
      const logOutput = await git.raw([
        'log',
        `--format=%H|%an|%ae|%ad|%s|%D`,
        '--date=iso',
        `-n${limit}`,
        branch
      ]);
      
      // Parse the raw output
      const lines = logOutput.trim().split('\n').filter(line => line.trim());
      const logs = lines.map(line => {
        const parts = line.split('|');
        return {
          hash: parts[0] || '',
          author_name: parts[1] || 'Unknown',
          author_email: parts[2] || 'unknown',
          date: parts[3] || '',
          message: parts[4] || 'No message',
          refs: parts[5] || ''
        };
      });
      
      return { logs, branch: branch };
    } else {
      // Get logs for current branch using the normal method
      log = await git.log({ maxCount: limit });
      // Return only serializable data
      const logs = log.all.map(commit => ({
        hash: commit.hash ? String(commit.hash) : '',
        date: commit.date ? (commit.date instanceof Date ? commit.date.toISOString() : String(commit.date)) : '',
        message: commit.message ? String(commit.message) : '',
        author_name: commit.author_name ? String(commit.author_name) : '',
        author_email: commit.author_email ? String(commit.author_email) : '',
        refs: commit.refs ? String(commit.refs) : ''
      }));
      return { logs, branch: null };
    }
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
    // Use raw to capture the output
    const pushResult = await git.raw(['push', remote, currentBranch]);
    return { success: true, message: pushResult || 'Push completed successfully' };
  } catch (error) {
    return { error: error.message, message: error.message };
  }
});

ipcMain.handle('git:force-push', async (event, remote = 'origin', branch = null) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    const status = await git.status();
    const currentBranch = branch || status.current;
    // Use raw to capture the output
    const pushResult = await git.raw(['push', remote, currentBranch, '--force']);
    return { success: true, message: pushResult || 'Force push completed successfully' };
  } catch (error) {
    return { error: error.message, message: error.message };
  }
});

ipcMain.handle('git:fetch', async (event, remote = 'origin') => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    const fetchResult = await git.raw(['fetch', remote]);
    return { success: true, message: fetchResult || 'Fetch completed successfully' };
  } catch (error) {
    return { error: error.message, message: error.message };
  }
});

ipcMain.handle('git:pull', async (event, remote = 'origin', branch = null) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    const pullResult = await git.raw(['pull', remote, branch || '']);
    return { success: true, message: pullResult || 'Pull completed successfully' };
  } catch (error) {
    return { error: error.message, message: error.message };
  }
});

ipcMain.handle('git:rollback-file', async (event, filePath) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    // Use git checkout to restore the file from HEAD
    const restoreResult = await git.raw(['checkout', 'HEAD', '--', filePath]);
    return { success: true, message: restoreResult || `Rolled back ${filePath}` };
  } catch (error) {
    return { error: error.message, message: error.message };
  }
});

ipcMain.handle('git:reset', async (event, commitHash, resetType = 'mixed') => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    // Validate reset type
    const validTypes = ['soft', 'mixed', 'hard'];
    if (!validTypes.includes(resetType)) {
      return { error: `Invalid reset type. Must be one of: ${validTypes.join(', ')}` };
    }
    
    // Use raw to capture the output
    const resetResult = await git.raw(['reset', `--${resetType}`, commitHash]);
    return { success: true, message: resetResult || `Reset to ${commitHash.substring(0, 7)} (${resetType}) completed` };
  } catch (error) {
    return { error: error.message, message: error.message };
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
    
    // Get most recent commit date for each local branch
    const localBranchesWithDates = await Promise.all(
      localBranches.map(async (branch) => {
        try {
          const log = await git.log({ from: branch.name, maxCount: 1 });
          let lastCommitDate = 0;
          if (log.latest && log.latest.date) {
            lastCommitDate = log.latest.date instanceof Date 
              ? log.latest.date.getTime() 
              : new Date(log.latest.date).getTime();
          }
          return {
            ...branch,
            lastCommitDate: lastCommitDate
          };
        } catch (error) {
          // If we can't get the date, use epoch (will sort to bottom)
          return {
            ...branch,
            lastCommitDate: 0
          };
        }
      })
    );

    // Get main branch from config
    const config = loadConfig();
    const mainBranch = config.mainBranch;

    // Sort local branches by most recent commit date (newest first)
    // Main branch always goes first, then current branch, then by date
    localBranchesWithDates.sort((a, b) => {
      // Main branch always goes first (if set)
      if (mainBranch) {
        if (a.name === mainBranch) return -1;
        if (b.name === mainBranch) return 1;
      }
      // Current branch goes second (if not main branch)
      if (a.current) return -1;
      if (b.current) return 1;
      // Then sort by date (newest first)
      return b.lastCommitDate - a.lastCommitDate;
    });
    
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

      // Get most recent commit date for each remote branch
      const remoteBranchesWithDates = await Promise.all(
        remoteBranches.map(async (branch) => {
          try {
            const log = await git.log({ from: branch.fullName, maxCount: 1 });
            let lastCommitDate = 0;
            if (log.latest && log.latest.date) {
              lastCommitDate = log.latest.date instanceof Date 
                ? log.latest.date.getTime() 
                : new Date(log.latest.date).getTime();
            }
            return {
              ...branch,
              lastCommitDate: lastCommitDate
            };
          } catch (error) {
            // If we can't get the date, use epoch (will sort to bottom)
            return {
              ...branch,
              lastCommitDate: 0
            };
          }
        })
      );

      // Get main branch from config
      const config = loadConfig();
      const mainBranch = config.mainBranch;

      // Sort remote branches by most recent commit date (newest first)
      // Main branch always goes first (if set)
      remoteBranchesWithDates.sort((a, b) => {
        // Main branch always goes first (if set)
        if (mainBranch) {
          if (a.name === mainBranch) return -1;
          if (b.name === mainBranch) return 1;
        }
        // Then sort by date (newest first)
        return b.lastCommitDate - a.lastCommitDate;
      });
      
      return { 
        local: localBranchesWithDates,
        remote: remoteBranchesWithDates
      };
    } catch (error) {
      // If remote branches can't be fetched, just continue with local branches
      return { 
        local: localBranchesWithDates,
        remote: []
      };
    }
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

// Diagram management IPC handlers
ipcMain.handle('diagram:get-directory', async () => {
  const config = loadConfig();
  return { directory: config.diagramDirectory || null };
});

ipcMain.handle('diagram:set-directory', async (event, directory) => {
  try {
    const config = loadConfig();
    config.diagramDirectory = directory;
    if (saveConfig(config)) {
      return { success: true };
    }
    return { error: 'Failed to save directory path' };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('diagram:select-directory', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Directory for Diagrams'
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      return { directory: result.filePaths[0] };
    }
    return { directory: null };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('diagram:list-files', async (event, directory) => {
  try {
    if (!directory || !fs.existsSync(directory)) {
      return { files: [] };
    }
    
    const files = fs.readdirSync(directory)
      .filter(file => file.endsWith('.mmd') || file.endsWith('.mermaid'))
      .map(file => {
        const filePath = path.join(directory, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          path: filePath,
          modified: stats.mtime.toISOString(),
          size: stats.size
        };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified)); // Sort by modified date, newest first
    
    return { files };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('diagram:load-file', async (event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return { error: 'File not found' };
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    return { content };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('diagram:save-file', async (event, filePath, content) => {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('diagram:delete-file', async (event, filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return { success: true };
    }
    return { error: 'File not found' };
  } catch (error) {
    return { error: error.message };
  }
});

// Stash IPC handlers
ipcMain.handle('git:list-stashes', async () => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    const stashList = await git.stashList();
    // Return only serializable data
    const stashes = stashList.all.map(stash => ({
      index: stash.index,
      hash: stash.hash ? String(stash.hash) : '',
      date: stash.date ? (stash.date instanceof Date ? stash.date.toISOString() : String(stash.date)) : '',
      message: stash.message ? String(stash.message) : '',
      refs: stash.refs ? String(stash.refs) : ''
    }));
    return { stashes };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('git:get-stash-diff', async (event, stashIndex) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    const diff = await git.raw(['stash', 'show', '-p', `stash@{${stashIndex}}`, '--no-color']);
    return { diff: diff || '' };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('git:apply-stash', async (event, stashIndex) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    const result = await git.raw(['stash', 'apply', `stash@{${stashIndex}}`]);
    return { success: true, message: result || 'Stash applied successfully' };
  } catch (error) {
    return { error: error.message, message: error.message };
  }
});

ipcMain.handle('git:pop-stash', async (event, stashIndex) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    const result = await git.raw(['stash', 'pop', `stash@{${stashIndex}}`]);
    return { success: true, message: result || 'Stash popped successfully' };
  } catch (error) {
    return { error: error.message, message: error.message };
  }
});

ipcMain.handle('git:drop-stash', async (event, stashIndex) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    const result = await git.raw(['stash', 'drop', `stash@{${stashIndex}}`]);
    return { success: true, message: result || 'Stash dropped successfully' };
  } catch (error) {
    return { error: error.message, message: error.message };
  }
});

ipcMain.handle('git:create-stash', async (event, message) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    const args = ['stash', 'push'];
    if (message) {
      args.push('-m', message);
    }
    const result = await git.raw(args);
    return { success: true, message: result || 'Stash created successfully' };
  } catch (error) {
    return { error: error.message, message: error.message };
  }
});

ipcMain.handle('git:rebase-branch', async (event, branchToRebase, ontoBranch) => {
  if (!git) {
    return { error: 'Git repository not initialized' };
  }

  try {
    // First, checkout the branch we want to rebase (should already be checked out, but ensure it)
    await git.checkout(branchToRebase);
    
    // Then rebase it onto the target branch
    await git.rebase([ontoBranch]);
    
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

ipcMain.handle('config:get-main-branch', async () => {
  const config = loadConfig();
  const branch = config.mainBranch || null;
  return { branch };
});

ipcMain.handle('config:set-main-branch', async (event, branchName) => {
  const config = loadConfig();
  config.mainBranch = branchName ? branchName.trim() : null;
  const success = saveConfig(config);
  return { success, branch: config.mainBranch };
});

