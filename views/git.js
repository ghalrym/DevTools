const { ipcRenderer } = require('electron');
const path = require('path');
const { escapeHtml } = require('../renderer/core/utils');

function createGitView() {
// Git functionality
let currentRepoPath = null;

async function setRepository(repoPath = null) {
    if (!repoPath) {
        const input = document.getElementById('settings-repo-path');
        if (input) {
            repoPath = input.value.trim() || process.cwd();
        } else {
            const saved = await ipcRenderer.invoke('config:get-git-repo-path');
            repoPath = saved.path || process.cwd();
        }
    }
    
    // Ensure we have a valid path
    if (!repoPath || repoPath.trim() === '') {
        repoPath = process.cwd();
    }
    
    currentRepoPath = repoPath;
    
    const result = await ipcRenderer.invoke('git:set-repo', repoPath);
    
    if (result.error) {
        if (document.getElementById('settings-repo-status')) {
            document.getElementById('settings-repo-status').innerHTML = `<div class="error">❌ Error: ${result.error}</div>`;
        }
        if (document.getElementById('repo-status')) {
            document.getElementById('repo-status').innerHTML = `<p class="error">Error: ${result.error}</p>`;
        }
        return false;
    }
    
    // Note: Config saving is now handled in the settings button click handler
    // This function just initializes git, config should already be saved
    
    // Update settings input if it exists
    if (document.getElementById('settings-repo-path')) {
        document.getElementById('settings-repo-path').value = repoPath;
    }
    
    // Force reload of all git data
    await Promise.all([
        loadCommitFiles(),
        loadBranches()
    ]);
    return true;
}

async function updateMCPStatus() {
    try {
        const status = await ipcRenderer.invoke('mcp:status');
        const statusText = document.getElementById('mcp-status-text');
        const statusDisplay = document.getElementById('mcp-status-display');
        const startBtn = document.getElementById('mcp-start-btn');
        const stopBtn = document.getElementById('mcp-stop-btn');
        
        if (statusText) {
            if (status.running) {
                statusText.textContent = `Running (Port: ${status.port || 'stdio'})`;
                if (statusDisplay) {
                    statusDisplay.style.borderColor = '#2d5a2d';
                    statusDisplay.style.background = '#1a2d1a';
                }
                if (startBtn) startBtn.disabled = true;
                if (stopBtn) stopBtn.disabled = false;
            } else {
                statusText.textContent = 'Not running';
                if (statusDisplay) {
                    statusDisplay.style.borderColor = '#3d3d3d';
                    statusDisplay.style.background = '#1a1a1a';
                }
                if (startBtn) startBtn.disabled = false;
                if (stopBtn) stopBtn.disabled = true;
            }
        }
    } catch (error) {
        const statusText = document.getElementById('mcp-status-text');
        if (statusText) {
            statusText.textContent = 'Error checking status';
        }
    }
}

async function updateSettingsRepoStatus() {
    const statusDiv = document.getElementById('settings-repo-status');
    if (!statusDiv) return;
    
    const inputValue = document.getElementById('settings-repo-path')?.value.trim();
    let repoPath = inputValue;
    
    if (!repoPath) {
        const saved = await ipcRenderer.invoke('config:get-git-repo-path');
        repoPath = saved.path || 'Not set';
    }
    
    if (repoPath && repoPath !== 'Not set') {
        const result = await ipcRenderer.invoke('git:set-repo', repoPath);
        if (result.error) {
            statusDiv.innerHTML = `<div class="error">❌ Error: ${result.error}</div>`;
        } else {
            statusDiv.innerHTML = `<div class="success">✓ Repository configured successfully<br><span style="font-size: 12px; opacity: 0.8; margin-top: 4px; display: block;">${repoPath}</span></div>`;
        }
    } else {
        statusDiv.innerHTML = '<div class="placeholder">No repository configured. Leave empty to use current directory.</div>';
    }
}

async function loadBranches() {
    const branchesList = document.getElementById('branches-list');
    
    if (!branchesList) return;
    
    const result = await ipcRenderer.invoke('git:get-branches');
    
    if (result.error) {
        // If repository not initialized, show helpful message
        if (result.error.includes('not initialized')) {
            branchesList.innerHTML = `
                <p class="placeholder">No repository configured</p>
                <p style="margin-top: 10px; font-size: 12px; color: #888;">
                    <a href="#" id="open-settings-from-branches" style="color: #4a9eff; text-decoration: underline; cursor: pointer;">
                        Configure repository in settings
                    </a>
                </p>
            `;
            // Add event listener for the settings link
            const settingsLink = document.getElementById('open-settings-from-branches');
            if (settingsLink) {
                settingsLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    // Switch to settings tab
                    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                    document.querySelector('[data-tab="settings"]').classList.add('active');
                    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
                    document.getElementById('settings-tab').classList.add('active');
                    if (window.loadSettings) window.loadSettings();
                });
            }
        } else {
            branchesList.innerHTML = `<p class="error">Error: ${result.error}</p>`;
        }
        return;
    }
    
    const localBranches = result.local || [];
    const remoteBranches = result.remote || [];
    
    if (localBranches.length === 0 && remoteBranches.length === 0) {
        branchesList.innerHTML = '<p class="placeholder">No branches found</p>';
        return;
    }
    
    branchesList.innerHTML = '';
    
    // Local branches group
    if (localBranches.length > 0) {
        const localGroup = document.createElement('div');
        localGroup.className = 'branch-group';
        localGroup.innerHTML = '<div class="branch-group-header">📁 Local</div>';
        
        // Add search bar for local branches
        const searchContainer = document.createElement('div');
        searchContainer.className = 'branch-search-container';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'branch-search-input';
        searchInput.placeholder = 'Search local branches...';
        searchInput.id = 'local-branch-search';
        searchContainer.appendChild(searchInput);
        localGroup.appendChild(searchContainer);
        
        const localList = document.createElement('div');
        localList.className = 'branch-group-list';
        localList.id = 'local-branches-list';
        
        localBranches.forEach(branch => {
            const item = document.createElement('div');
            item.className = `branch-item ${branch.current ? 'current' : ''}`;
            item.dataset.branchName = branch.name;
            item.dataset.branchType = 'local';
            
            item.innerHTML = `
                <span class="branch-name">${escapeHtml(branch.name)}</span>
                ${branch.current ? '<span class="branch-indicator">current</span>' : ''}
            `;
            
            // Make branch clickable to view its logs
            item.style.cursor = 'pointer';
            item.addEventListener('click', async (e) => {
                // Don't trigger if right-clicking
                if (e.button === 2) return;
                
                // Switch to logs tab and load this branch's logs
                document.querySelectorAll('.git-tab-button').forEach(btn => btn.classList.remove('active'));
                const logsButton = document.querySelector('[data-git-tab="logs"]');
                if (logsButton) {
                    logsButton.classList.add('active');
                }
                
                document.querySelectorAll('.git-tab-content').forEach(content => content.classList.remove('active'));
                const logsTab = document.getElementById('git-logs-tab');
                if (logsTab) {
                    logsTab.classList.add('active');
                }
                
                // Load logs for this branch
                await loadGitLogs(branch.name);
            });
            
            // Add right-click context menu (only for local branches)
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showBranchContextMenu(e, branch.name, branch.current, 'local', null);
            });
            
            localList.appendChild(item);
        });
        
        // Add search functionality
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase().trim();
            const items = localList.querySelectorAll('.branch-item');
            
            items.forEach(item => {
                const branchName = item.dataset.branchName.toLowerCase();
                if (branchName.includes(searchTerm)) {
                    item.style.display = '';
                } else {
                    item.style.display = 'none';
                }
            });
            
            // Show message if no results
            const visibleItems = Array.from(items).filter(item => item.style.display !== 'none');
            let noResultsMsg = localList.querySelector('.no-results-message');
            if (visibleItems.length === 0 && searchTerm !== '') {
                if (!noResultsMsg) {
                    noResultsMsg = document.createElement('div');
                    noResultsMsg.className = 'no-results-message';
                    noResultsMsg.textContent = 'No branches found';
                    localList.appendChild(noResultsMsg);
                }
            } else if (noResultsMsg) {
                noResultsMsg.remove();
            }
        });
        
        localGroup.appendChild(localList);
        branchesList.appendChild(localGroup);
    }
    
    // Remote branches group
    if (remoteBranches.length > 0) {
        const remoteGroup = document.createElement('div');
        remoteGroup.className = 'branch-group';
        remoteGroup.innerHTML = '<div class="branch-group-header">🌐 Server</div>';
        
        // Add search bar for remote branches
        const searchContainer = document.createElement('div');
        searchContainer.className = 'branch-search-container';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'branch-search-input';
        searchInput.placeholder = 'Search server branches...';
        searchInput.id = 'remote-branch-search';
        searchContainer.appendChild(searchInput);
        remoteGroup.appendChild(searchContainer);
        
        const remoteList = document.createElement('div');
        remoteList.className = 'branch-group-list';
        remoteList.id = 'remote-branches-list';
        
        // Store original branches for filtering
        remoteBranches.forEach(branch => {
            const item = document.createElement('div');
            item.className = 'branch-item branch-item-remote';
            item.dataset.branchName = branch.name;
            item.dataset.branchFullName = branch.fullName;
            item.dataset.branchType = 'remote';
            
            item.innerHTML = `
                <span class="branch-name">${escapeHtml(branch.name)}</span>
            `;
            
            // Make branch clickable to view its logs
            item.style.cursor = 'pointer';
            item.addEventListener('click', async (e) => {
                // Don't trigger if right-clicking
                if (e.button === 2) return;
                
                // Switch to logs tab and load this branch's logs
                // For remote branches, we need to use the full name (e.g., origin/branch-name)
                document.querySelectorAll('.git-tab-button').forEach(btn => btn.classList.remove('active'));
                const logsButton = document.querySelector('[data-git-tab="logs"]');
                if (logsButton) {
                    logsButton.classList.add('active');
                }
                
                document.querySelectorAll('.git-tab-content').forEach(content => content.classList.remove('active'));
                const logsTab = document.getElementById('git-logs-tab');
                if (logsTab) {
                    logsTab.classList.add('active');
                }
                
                // Load logs for this remote branch (use full name like origin/branch-name)
                await loadGitLogs(branch.fullName);
            });
            
            // Add right-click context menu for remote branches
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showBranchContextMenu(e, branch.name, false, 'remote', branch.fullName);
            });
            
            remoteList.appendChild(item);
        });
        
        // Add search functionality
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase().trim();
            const items = remoteList.querySelectorAll('.branch-item-remote');
            
            items.forEach(item => {
                const branchName = item.dataset.branchName.toLowerCase();
                if (branchName.includes(searchTerm)) {
                    item.style.display = '';
                } else {
                    item.style.display = 'none';
                }
            });
            
            // Show message if no results
            const visibleItems = Array.from(items).filter(item => item.style.display !== 'none');
            let noResultsMsg = remoteList.querySelector('.no-results-message');
            if (visibleItems.length === 0 && searchTerm !== '') {
                if (!noResultsMsg) {
                    noResultsMsg = document.createElement('div');
                    noResultsMsg.className = 'no-results-message';
                    noResultsMsg.textContent = 'No branches found';
                    remoteList.appendChild(noResultsMsg);
                }
            } else if (noResultsMsg) {
                noResultsMsg.remove();
            }
        });
        
        remoteGroup.appendChild(remoteList);
        branchesList.appendChild(remoteGroup);
    }
}

async function checkoutBranch(branchName) {
    const confirmed = await window.showConfirm('Switch Branch', `Switch to branch "${branchName}"?`);
    if (!confirmed) {
        return;
    }
    
    const result = await ipcRenderer.invoke('git:checkout-branch', branchName);
    
    if (result.error) {
        await window.showAlert('Error', `Error switching branch: ${result.error}`);
    } else {
        await loadBranches();
        await loadCommitFiles();
        // Refresh logs to show the new branch's commits
        await loadGitLogs(branchName);
    }
}

async function checkoutRemoteBranch(remoteBranchName, localBranchName) {
    const confirmed = await window.showConfirm('Checkout Remote Branch', `Checkout and track remote branch "${localBranchName}"?`);
    if (!confirmed) {
        return;
    }
    
    const result = await ipcRenderer.invoke('git:checkout-remote-branch', remoteBranchName, localBranchName);
    
    if (result.error) {
        await window.showAlert('Error', `Error checking out remote branch: ${result.error}`);
    } else {
        await loadBranches();
        await loadCommitFiles();
        // Refresh logs to show the new branch's commits (use localBranchName as that's what was checked out)
        await loadGitLogs(localBranchName);
    }
}

function showBranchContextMenu(e, branchName, isCurrent, branchType, remoteBranchFullName) {
    const contextMenu = document.getElementById('branch-context-menu');
    if (!contextMenu) return;
    
    // Store branch information in the context menu
    contextMenu.dataset.branchName = branchName;
    contextMenu.dataset.branchType = branchType || 'local';
    contextMenu.dataset.remoteBranchFullName = remoteBranchFullName || '';
    contextMenu.dataset.isCurrent = isCurrent ? 'true' : 'false';
    
    // Show/hide checkout option (hide if current branch)
    const checkoutItem = document.getElementById('context-checkout-branch');
    if (checkoutItem) {
        checkoutItem.style.display = isCurrent ? 'none' : 'block';
    }
    
    // Show/hide update option (only for local branches, not remote)
    const updateItem = document.getElementById('context-update-branch');
    if (updateItem) {
        updateItem.style.display = (branchType === 'remote') ? 'none' : 'block';
        updateItem.dataset.branchName = branchName;
    }
    
    // Show/hide rebase option (hide if current branch or remote branch)
    const rebaseItem = document.getElementById('context-rebase-branch');
    if (rebaseItem) {
        rebaseItem.style.display = (isCurrent || branchType === 'remote') ? 'none' : 'block';
        rebaseItem.dataset.branchName = branchName;
    }
    
    // Hide delete option for current branch (only for local branches)
    const deleteItem = document.getElementById('context-delete-branch');
    if (deleteItem) {
        deleteItem.style.display = (isCurrent || branchType === 'remote') ? 'none' : 'block';
        deleteItem.dataset.branchName = branchName;
    }
    
    // Position the menu at cursor
    contextMenu.style.display = 'block';
    contextMenu.style.left = `${e.pageX}px`;
    contextMenu.style.top = `${e.pageY}px`;
    
    // Hide menu when clicking elsewhere
    const hideMenu = (event) => {
        if (!contextMenu.contains(event.target)) {
            contextMenu.style.display = 'none';
            document.removeEventListener('click', hideMenu);
        }
    };
    
    setTimeout(() => {
        document.addEventListener('click', hideMenu);
    }, 10);
}

function showCommitContextMenu(e, commitHash, commitElement) {
    const contextMenu = document.getElementById('commit-context-menu');
    if (!contextMenu) return;
    
    // Store commit information in the context menu
    contextMenu.dataset.commitHash = commitHash;
    
    // Get commit message for display
    const commitMessage = commitElement.querySelector('.commit-message')?.textContent || 'Unknown commit';
    const shortHash = commitHash.substring(0, 7);
    
    // Position the menu at cursor
    contextMenu.style.display = 'block';
    contextMenu.style.left = `${e.pageX}px`;
    contextMenu.style.top = `${e.pageY}px`;
    
    // Hide menu when clicking elsewhere
    const hideMenu = (event) => {
        if (!contextMenu.contains(event.target)) {
            contextMenu.style.display = 'none';
            document.removeEventListener('click', hideMenu);
        }
    };
    
    setTimeout(() => {
        document.addEventListener('click', hideMenu);
    }, 10);
}

async function resetToCommit(commitHash, resetType) {
    const typeNames = {
        'soft': 'Soft',
        'mixed': 'Mixed',
        'hard': 'Hard'
    };
    
    const typeDescriptions = {
        'soft': 'Keeps changes staged',
        'mixed': 'Keeps changes unstaged (default)',
        'hard': 'Discards all changes (DESTRUCTIVE)'
    };
    
    const confirmed = await window.showConfirm(
        `Reset to Commit (${typeNames[resetType]})`,
        `Reset HEAD to commit ${commitHash.substring(0, 7)}?\n\nType: ${typeNames[resetType]} - ${typeDescriptions[resetType]}\n\n${resetType === 'hard' ? 'WARNING: This will discard all uncommitted changes!' : 'This will move HEAD to the selected commit.'}`
    );
    
    if (!confirmed) {
        return;
    }
    
    try {
        const result = await ipcRenderer.invoke('git:reset', commitHash, resetType);
        
        if (result.error) {
            await window.showAlert('Error', `Error resetting: ${result.error}`);
            addGitMessage('Reset Error', result.message || result.error, 'error');
        } else {
            await window.showAlert('Success', `Reset to commit ${commitHash.substring(0, 7)} successful!`);
            addGitMessage('Reset Success', result.message || `Reset to ${commitHash.substring(0, 7)} (${typeNames[resetType]})`, 'success');
            await loadBranches();
            await loadCommitFiles();
            await loadGitLogs();
        }
    } catch (error) {
        await window.showAlert('Error', `Error: ${error.message}`);
        addGitMessage('Reset Error', error.message, 'error');
    }
}

async function updateBranch(branchName) {
    if (!branchName) {
        await window.showAlert('Error', 'No branch specified');
        return;
    }
    
    try {
        // Get current branch to check if we need to checkout first
        const statusResult = await ipcRenderer.invoke('git:get-status');
        let currentBranch = null;
        if (statusResult.status && statusResult.status.current) {
            currentBranch = statusResult.status.current;
        }
        
        // If not on the target branch, checkout first
        if (currentBranch !== branchName) {
            const confirmed = await window.showConfirm(
                'Checkout Branch',
                `You need to checkout "${branchName}" first to update it. Checkout now?`
            );
            
            if (!confirmed) {
                return;
            }
            
            // Checkout the branch
            const checkoutResult = await ipcRenderer.invoke('git:checkout-branch', branchName);
            if (checkoutResult.error) {
                await window.showAlert('Error', `Error checking out branch: ${checkoutResult.error}`);
                addGitMessage('Update Error', `Failed to checkout ${branchName}: ${checkoutResult.error}`, 'error');
                return;
            }
        }
        
        // Now pull from remote (default to origin)
        const pullResult = await ipcRenderer.invoke('git:pull', 'origin', branchName);
        
        if (pullResult.error) {
            await window.showAlert('Error', `Error updating branch: ${pullResult.error}`);
            addGitMessage('Update Error', pullResult.message || pullResult.error, 'error');
        } else {
            await window.showAlert('Success', `Branch "${branchName}" updated successfully!`);
            addGitMessage('Update Success', pullResult.message || `Updated ${branchName} from remote`, 'success');
            // Refresh branches and logs
            await loadBranches();
            await loadCommitFiles();
            await loadGitLogs(branchName);
        }
    } catch (error) {
        await window.showAlert('Error', `Error: ${error.message}`);
        addGitMessage('Update Error', error.message, 'error');
    }
}

async function rebaseBranch(branchName) {
    // Get current branch name
    let currentBranch = null;
    try {
        const statusResult = await ipcRenderer.invoke('git:get-status');
        if (statusResult.status && statusResult.status.current) {
            currentBranch = statusResult.status.current;
        }
    } catch (e) {
        await window.showAlert('Error', 'Could not determine current branch');
        return;
    }
    
    if (!currentBranch) {
        await window.showAlert('Error', 'Could not determine current branch');
        return;
    }
    
    const confirmed = await window.showConfirm(
        'Rebase Branch',
        `Rebase current branch "${currentBranch}" onto "${branchName}"?\n\nThis will rebase "${currentBranch}" onto "${branchName}".`
    );
    
    if (!confirmed) {
        return;
    }
    
    try {
        const result = await ipcRenderer.invoke('git:rebase-branch', currentBranch, branchName);
        
        if (result.error) {
            await window.showAlert('Error', `Error rebasing branch: ${result.error}`);
        } else {
            await loadBranches();
            await loadCommitFiles();
            await loadGitLogs(currentBranch);
            await window.showAlert('Success', `Branch "${currentBranch}" has been rebased onto "${branchName}"!`);
        }
    } catch (error) {
        await window.showAlert('Error', `Error: ${error.message}`);
    }
}

async function deleteBranch(branchName) {
    const confirmed = await window.showConfirm('Delete Branch', `Are you sure you want to delete branch "${branchName}"?\n\nThis action cannot be undone.`);
    if (!confirmed) {
        return;
    }
    
    // Check if branch has unmerged changes
    const force = await window.showConfirm('Force Delete', 'Force delete? (Use this if the branch has unmerged changes)');
    
    const result = await ipcRenderer.invoke('git:delete-branch', branchName, force);
    
    if (result.error) {
        await window.showAlert('Error', `Error deleting branch: ${result.error}`);
    } else {
        await loadBranches();
        await loadCommitFiles();
        await window.showAlert('Success', `Branch "${branchName}" deleted successfully!`);
    }
}

async function loadGitStatus() {
    // Status tab removed - this function is kept for internal use but doesn't update UI
    // The commit tab handles file display now
    return;
    
    const result = await ipcRenderer.invoke('git:get-status');
    
    if (result.error) {
        // If repository not initialized, show helpful message
        if (result.error.includes('not initialized')) {
            statusContent.innerHTML = `
                <p class="placeholder">No repository configured</p>
                <p style="margin-top: 10px; font-size: 12px; color: #888;">
                    <a href="#" id="open-settings-from-status" style="color: #4a9eff; text-decoration: underline; cursor: pointer;">
                        Configure repository in settings
                    </a>
                </p>
            `;
            const settingsLink = document.getElementById('open-settings-from-status');
            if (settingsLink) {
                settingsLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                    document.querySelector('[data-tab="settings"]').classList.add('active');
                    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
                    document.getElementById('settings-tab').classList.add('active');
                    if (window.loadSettings) window.loadSettings();
                });
            }
        } else {
            statusContent.innerHTML = `<p class="error">Error: ${result.error}</p>`;
        }
        return;
    }
    
    const status = result.status;
    
    // Update status content
    const files = status.files || [];
    if (files.length === 0) {
        statusContent.innerHTML = '<p class="placeholder">Working directory clean</p>';
        return;
    }
    
    let html = '<div class="file-list">';
    
    // Group files by status
    const staged = files.filter(f => f.index !== ' ' && f.index !== '?');
    const modified = files.filter(f => f.working_dir === 'M');
    const notAdded = files.filter(f => f.index === '?' || f.working_dir === '?');
    const deleted = files.filter(f => f.working_dir === 'D');
    
    // Staged files
    if (staged.length > 0) {
        html += '<h3 style="margin-bottom: 10px; color: #4a9eff;">Staged Files</h3>';
        staged.forEach(file => {
            html += createFileItem(file, 'staged');
        });
    }
    
    // Modified files
    if (modified.length > 0) {
        html += '<h3 style="margin-top: 20px; margin-bottom: 10px; color: #ffff7f;">Modified Files</h3>';
        modified.forEach(file => {
            html += createFileItem(file, 'modified');
        });
    }
    
    // Not added files
    if (notAdded.length > 0) {
        html += '<h3 style="margin-top: 20px; margin-bottom: 10px; color: #7fff7f;">Untracked Files</h3>';
        notAdded.forEach(file => {
            html += createFileItem(file, 'added');
        });
    }
    
    // Deleted files
    if (deleted.length > 0) {
        html += '<h3 style="margin-top: 20px; margin-bottom: 10px; color: #ff7f7f;">Deleted Files</h3>';
        deleted.forEach(file => {
            html += createFileItem(file, 'deleted');
        });
    }
    
    html += '</div>';
    statusContent.innerHTML = html;
    
    // Attach event listeners to file actions
    attachFileActionListeners();
}

function createFileItem(filePath, status) {
    const statusLabels = {
        'staged': 'Staged',
        'modified': 'Modified',
        'added': 'Untracked',
        'deleted': 'Deleted'
    };
    
    return `
        <div class="file-item">
            <div>
                <div class="file-name">${filePath}</div>
                <span class="file-status ${status}">${statusLabels[status]}</span>
            </div>
            <div class="file-actions">
                ${status !== 'staged' ? `<button class="btn btn-small btn-primary stage-file" data-file="${filePath}">Stage</button>` : ''}
                ${status === 'staged' ? `<button class="btn btn-small btn-secondary unstage-file" data-file="${filePath}">Unstage</button>` : ''}
            </div>
        </div>
    `;
}

function attachFileActionListeners() {
    document.querySelectorAll('.stage-file').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const filePath = e.target.dataset.file;
            const result = await ipcRenderer.invoke('git:stage-file', filePath);
            
            if (result.error) {
                await window.showAlert('Error', `Error: ${result.error}`);
            } else {
                await loadCommitFiles(); // Refresh commit tab file lists
            }
        });
    });
    
    document.querySelectorAll('.unstage-file').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const filePath = e.target.dataset.file;
            const result = await ipcRenderer.invoke('git:unstage-file', filePath);
            
            if (result.error) {
                await window.showAlert('Error', `Error: ${result.error}`);
            } else {
                await loadCommitFiles(); // Refresh commit tab file lists
            }
        });
    });
}

async function loadGitLogs(branchName = null) {
    const logsContent = document.getElementById('git-logs-content');
    
    if (!logsContent) {
        return;
    }
    
    logsContent.innerHTML = '<p class="loading">Loading commit history...</p>';
    
    try {
        const result = await ipcRenderer.invoke('git:get-logs', 50, branchName);
        
        if (result.error) {
            // If repository not initialized, show helpful message
            if (result.error.includes('not initialized')) {
                logsContent.innerHTML = `
                    <p class="placeholder">No repository configured</p>
                    <p style="margin-top: 10px; font-size: 12px; color: #888;">
                        <a href="#" id="open-settings-from-logs" style="color: #4a9eff; text-decoration: underline; cursor: pointer;">
                            Configure repository in settings
                        </a>
                    </p>
                `;
                const settingsLink = document.getElementById('open-settings-from-logs');
                if (settingsLink) {
                    settingsLink.addEventListener('click', (e) => {
                        e.preventDefault();
                        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                        document.querySelector('[data-tab="settings"]').classList.add('active');
                        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
                        document.getElementById('settings-tab').classList.add('active');
                        if (window.loadSettings) window.loadSettings();
                    });
                }
            } else {
                logsContent.innerHTML = `<p class="error">Error: ${result.error}</p>`;
            }
            return;
        }
        
        if (!result.logs || result.logs.length === 0) {
            logsContent.innerHTML = '<p class="placeholder">No commits found</p>';
            return;
        }
        
        // Show which branch we're viewing
        let html = '';
        if (result.branch) {
            html += `<div style="padding: 8px 12px; background: #2a2a2a; border-bottom: 1px solid #3d3d3d; color: #4a9eff; font-size: 12px; font-weight: 600;">
                branch: ${escapeHtml(result.branch)}
            </div>`;
        } else {
            // Get current branch name
            try {
                const statusResult = await ipcRenderer.invoke('git:get-status');
                if (statusResult.status && statusResult.status.current) {
                    html += `<div style="padding: 8px 12px; background: #2a2a2a; border-bottom: 1px solid #3d3d3d; color: #4a9eff; font-size: 12px; font-weight: 600;">
                        branch: ${escapeHtml(statusResult.status.current)}
                    </div>`;
                }
            } catch (e) {
                // Silently fail if we can't get branch name
            }
        }
        
        result.logs.forEach(commit => {
            const shortHash = commit.hash ? commit.hash.substring(0, 7) : 'N/A';
            html += `
                <div class="commit-log-item commit-clickable" data-commit-hash="${commit.hash || ''}" style="cursor: pointer;">
                    <div class="commit-hash">${shortHash}</div>
                    <div class="commit-message">${escapeHtml(commit.message || 'No message')}</div>
                    <div class="commit-author">${commit.author_name || 'Unknown'} &lt;${commit.author_email || 'unknown'}&gt; - ${commit.date ? new Date(commit.date).toLocaleString() : 'Unknown date'}</div>
                </div>
            `;
        });
        
        logsContent.innerHTML = html;
        
        // Attach click listeners to commit items
        logsContent.querySelectorAll('.commit-clickable').forEach(item => {
            // Left click to view diff
            item.addEventListener('click', async () => {
                const commitHash = item.dataset.commitHash;
                if (commitHash) {
                    await showCommitDiff(commitHash, item);
                }
            });
            
            // Right click for context menu
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const commitHash = item.dataset.commitHash;
                if (commitHash) {
                    showCommitContextMenu(e, commitHash, item);
                }
            });
        });
    } catch (error) {
        logsContent.innerHTML = `<p class="error">Error loading logs: ${error.message}</p>`;
    }
}

async function loadCommitFiles() {
    const stagedFilesDiv = document.getElementById('commit-staged-files');
    const unstagedFilesDiv = document.getElementById('commit-unstaged-files');
    
    if (!stagedFilesDiv || !unstagedFilesDiv) {
        return;
    }
    
    try {
        const result = await ipcRenderer.invoke('git:get-status');
        
        if (result.error) {
            stagedFilesDiv.innerHTML = '<p class="placeholder" style="font-size: 12px; opacity: 0.7;">Error loading files</p>';
            unstagedFilesDiv.innerHTML = '<p class="placeholder" style="font-size: 12px; opacity: 0.7;">Error loading files</p>';
            return;
        }
        
        const status = result.status;
        const files = status.files || [];
        
        // Separate staged and unstaged files
        const staged = files.filter(f => f.index !== ' ' && f.index !== '?');
        const unstaged = files.filter(f => {
            // Unstaged: modified, untracked, or deleted in working directory
            return (f.working_dir === 'M' || f.working_dir === '?' || f.working_dir === 'D') && 
                   (f.index === ' ' || f.index === '?');
        });
        
        // Display staged files
        if (staged.length > 0) {
            stagedFilesDiv.innerHTML = staged.map(file => {
                const statusIcon = file.index === 'A' ? '📄' : file.index === 'M' ? '✏️' : file.index === 'D' ? '🗑️' : '📝';
                return `<div class="file-item-clickable" data-file="${file.path}" data-staged="true" style="padding: 4px 8px; margin: 2px 0; background: rgba(74, 158, 255, 0.1); border-left: 2px solid #4a9eff; font-size: 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                    <span>${statusIcon} ${file.path}</span>
                    <button class="btn btn-small btn-secondary unstage-file-from-commit" data-file="${file.path}" style="padding: 2px 8px; font-size: 11px; margin-left: 8px;" onclick="event.stopPropagation();">Unstage</button>
                </div>`;
            }).join('');
            
                // Attach click listeners to file items for showing diff
                stagedFilesDiv.querySelectorAll('.file-item-clickable').forEach(item => {
                    item.addEventListener('click', async (e) => {
                        // Don't trigger if clicking the button
                        if (e.target.classList.contains('btn') || e.target.closest('.btn')) {
                            return;
                        }
                        const filePath = item.dataset.file;
                        const isStaged = item.dataset.staged === 'true';
                        await showFileDiff(filePath, isStaged);
                    });
                });
            
                // Attach event listeners to unstage buttons
                stagedFilesDiv.querySelectorAll('.unstage-file-from-commit').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const filePath = e.target.dataset.file;
                        const button = e.target;
                        button.disabled = true;
                        button.textContent = 'Unstaging...';

                        try {
                            const result = await ipcRenderer.invoke('git:unstage-file', filePath);

                            if (result.error) {
                                await window.showAlert('Error', `Error: ${result.error}`);
                                button.disabled = false;
                                button.textContent = 'Unstage';
                            } else {
                                // Refresh both lists
                                await loadCommitFiles();
                                // Ensure textarea remains accessible
                                const textarea = document.getElementById('commit-message');
                                if (textarea) {
                                    textarea.style.pointerEvents = 'auto';
                                    textarea.style.zIndex = '1';
                                }
                            }
                        } catch (error) {
                            await window.showAlert('Error', `Error: ${error.message}`);
                            button.disabled = false;
                            button.textContent = 'Unstage';
                        }
                    });
                });
        } else {
            stagedFilesDiv.innerHTML = '<p class="placeholder" style="font-size: 12px; opacity: 0.7;">No staged files</p>';
        }
        
        // Display unstaged files
        if (unstaged.length > 0) {
            unstagedFilesDiv.innerHTML = unstaged.map(file => {
                let statusIcon = '📝';
                if (file.working_dir === 'M') statusIcon = '✏️';
                else if (file.working_dir === '?') statusIcon = '📄';
                else if (file.working_dir === 'D') statusIcon = '🗑️';
                
                // Only show rollback for modified or deleted files (not new/untracked files)
                const canRollback = file.working_dir === 'M' || file.working_dir === 'D';
                return `<div class="file-item-clickable" data-file="${file.path}" data-staged="false" style="padding: 4px 8px; margin: 2px 0; background: rgba(255, 255, 127, 0.1); border-left: 2px solid #ffff7f; font-size: 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                    <span>${statusIcon} ${file.path}</span>
                    <div style="display: flex; gap: 4px;">
                        ${canRollback ? `<button class="btn btn-small btn-warning rollback-file" data-file="${file.path}" style="padding: 2px 8px; font-size: 11px;" onclick="event.stopPropagation();">Roll Back</button>` : ''}
                        <button class="btn btn-small btn-primary stage-file-from-commit" data-file="${file.path}" style="padding: 2px 8px; font-size: 11px;" onclick="event.stopPropagation();">Stage</button>
                    </div>
                </div>`;
            }).join('');
            
            // Attach click listeners to file items for showing diff
            unstagedFilesDiv.querySelectorAll('.file-item-clickable').forEach(item => {
                item.addEventListener('click', async (e) => {
                    // Don't trigger if clicking the button
                    if (e.target.classList.contains('btn') || e.target.closest('.btn')) {
                        return;
                    }
                    const filePath = item.dataset.file;
                    const isStaged = item.dataset.staged === 'false';
                    await showFileDiff(filePath, isStaged);
                });
            });
            
                // Attach event listeners to rollback buttons
                unstagedFilesDiv.querySelectorAll('.rollback-file').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const filePath = e.target.dataset.file;
                        const button = e.target;
                        
                        const confirmed = await window.showConfirm(
                            'Roll Back File',
                            `Roll back changes to "${filePath}"?\n\nThis will discard all uncommitted changes to this file.`
                        );
                        
                        if (!confirmed) {
                            return;
                        }
                        
                        button.disabled = true;
                        button.textContent = 'Rolling back...';
                        
                        try {
                            const result = await ipcRenderer.invoke('git:rollback-file', filePath);
                            
                            if (result.error) {
                                await window.showAlert('Error', `Error: ${result.error}`);
                                addGitMessage('Rollback Error', result.message || result.error, 'error');
                                button.disabled = false;
                                button.textContent = 'Roll Back';
                            } else {
                                addGitMessage('Rollback Success', result.message || `Rolled back ${filePath}`, 'success');
                                // Refresh both lists
                                await loadCommitFiles();
                                // Ensure textarea remains accessible
                                const textarea = document.getElementById('commit-message');
                                if (textarea) {
                                    textarea.style.pointerEvents = 'auto';
                                    textarea.style.zIndex = '1';
                                }
                            }
                        } catch (error) {
                            await window.showAlert('Error', `Error: ${error.message}`);
                            addGitMessage('Rollback Error', error.message, 'error');
                            button.disabled = false;
                            button.textContent = 'Roll Back';
                        }
                    });
                });
                
                // Attach event listeners to stage buttons
                unstagedFilesDiv.querySelectorAll('.stage-file-from-commit').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const filePath = e.target.dataset.file;
                        const button = e.target;
                        button.disabled = true;
                        button.textContent = 'Staging...';
                        
                        try {
                            const result = await ipcRenderer.invoke('git:stage-file', filePath);
                            
                            if (result.error) {
                                await window.showAlert('Error', `Error: ${result.error}`);
                                button.disabled = false;
                                button.textContent = 'Stage';
                            } else {
                                // Refresh both lists
                                await loadCommitFiles();
                                // Ensure textarea remains accessible
                                const textarea = document.getElementById('commit-message');
                                if (textarea) {
                                    textarea.style.pointerEvents = 'auto';
                                    textarea.style.zIndex = '1';
                                }
                            }
                        } catch (error) {
                            await window.showAlert('Error', `Error: ${error.message}`);
                            button.disabled = false;
                            button.textContent = 'Stage';
                        }
                    });
                });
        } else {
            unstagedFilesDiv.innerHTML = '<p class="placeholder" style="font-size: 12px; opacity: 0.7;">No unstaged files</p>';
        }
        
    } catch (error) {
        stagedFilesDiv.innerHTML = '<p class="placeholder" style="font-size: 12px; opacity: 0.7;">Error loading files</p>';
        unstagedFilesDiv.innerHTML = '<p class="placeholder" style="font-size: 12px; opacity: 0.7;">Error loading files</p>';
    }
}

async function applyCommitTemplate() {
    const messageField = document.getElementById('commit-message');
    if (!messageField) return;
    
    // Only apply template if field is empty
    if (messageField.value.trim() !== '') return;
    
    try {
        const templateResult = await ipcRenderer.invoke('config:get-commit-template');
        if (templateResult.template && templateResult.template.trim() !== '') {
            let template = templateResult.template;
            
            // Replace {branch} placeholder with current branch name
            try {
                const statusResult = await ipcRenderer.invoke('git:get-status');
                if (statusResult.status && statusResult.status.current) {
                    template = template.replace(/{branch}/g, statusResult.status.current);
                }
            } catch (e) {
                // If we can't get branch, just remove the placeholder
                template = template.replace(/{branch}/g, '');
            }
            
            messageField.value = template;
        }
    } catch (error) {
        // Silently fail if template can't be loaded
    }
}

async function commitChanges() {
    const message = document.getElementById('commit-message');
    const commitResult = document.getElementById('commit-result');
    
    if (!message || !commitResult) {
        return;
    }
    
    const commitMessage = message.value.trim();
    
    if (!commitMessage) {
        commitResult.innerHTML = '<p class="error">Please enter a commit message</p>';
        return;
    }
    
    commitResult.innerHTML = '<p class="loading">Committing...</p>';
    
    try {
        const result = await ipcRenderer.invoke('git:commit', commitMessage);
        
        if (result.error) {
            if (result.error.includes('not initialized')) {
                commitResult.innerHTML = `
                    <p class="error">Error: ${result.error}</p>
                    <p style="margin-top: 10px; font-size: 12px;">
                        <a href="#" id="open-settings-from-commit" style="color: #4a9eff; text-decoration: underline; cursor: pointer;">
                            Configure repository in settings
                        </a>
                    </p>
                `;
                const settingsLink = document.getElementById('open-settings-from-commit');
                if (settingsLink) {
                    settingsLink.addEventListener('click', (e) => {
                        e.preventDefault();
                        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                        document.querySelector('[data-tab="settings"]').classList.add('active');
                        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
                        document.getElementById('settings-tab').classList.add('active');
                        if (window.loadSettings) window.loadSettings();
                    });
                }
            } else {
                commitResult.innerHTML = `<p class="error">Error: ${result.error}</p>`;
            }
            return;
        }
        
        commitResult.innerHTML = '<p class="success">✓ Commit successful!</p>';
        message.value = '';
        await loadBranches();
        await loadCommitFiles(); // Refresh file lists after commit
        await loadGitLogs(); // Refresh logs to show the new commit
    } catch (error) {
        commitResult.innerHTML = `<p class="error">Error: ${error.message}</p>`;
    }
}

async function pullChanges() {
    const commitResult = document.getElementById('commit-result');
    
    if (!commitResult) {
        return;
    }
    
    commitResult.innerHTML = '<p class="loading">Pulling...</p>';
    
    try {
        const pullResult = await ipcRenderer.invoke('git:pull');
        
        if (pullResult.error) {
            commitResult.innerHTML = `<p class="error">Pull failed: ${pullResult.error}</p>`;
            addGitMessage('Pull Error', pullResult.message || pullResult.error, 'error');
        } else {
            commitResult.innerHTML = '<p class="success">✓ Pull successful!</p>';
            addGitMessage('Pull Success', pullResult.message || 'Pull completed successfully', 'success');
            await loadBranches();
            await loadCommitFiles();
            await loadGitLogs();
        }
    } catch (error) {
        commitResult.innerHTML = `<p class="error">Error: ${error.message}</p>`;
        addGitMessage('Pull Error', error.message, 'error');
    }
}

async function forcePush() {
    const commitResult = document.getElementById('commit-result');
    
    if (!commitResult) {
        return;
    }
    
    // Show warning confirmation
    const confirmed = await window.showConfirm(
        'Force Push Warning',
        'Force push will overwrite the remote branch history. This is a destructive operation that cannot be undone.\n\nAre you sure you want to force push?'
    );
    
    if (!confirmed) {
        return;
    }
    
    commitResult.innerHTML = '<p class="loading">Force pushing...</p>';
    
    try {
        const pushResult = await ipcRenderer.invoke('git:force-push');
        
        if (pushResult.error) {
            commitResult.innerHTML = `<p class="error">Force push failed: ${pushResult.error}</p>`;
            addGitMessage('Force Push Error', pushResult.message || pushResult.error, 'error');
        } else {
            commitResult.innerHTML = '<p class="success">✓ Force push successful!</p>';
            addGitMessage('Force Push Success', pushResult.message || 'Force push completed successfully', 'success');
            await loadBranches();
            await loadCommitFiles();
            await loadGitLogs();
        }
    } catch (error) {
        commitResult.innerHTML = `<p class="error">Error: ${error.message}</p>`;
        addGitMessage('Force Push Error', error.message, 'error');
    }
}

async function pushChanges() {
    const commitResult = document.getElementById('commit-result');
    
    if (!commitResult) {
        return;
    }
    
    commitResult.innerHTML = '<p class="loading">Pushing...</p>';
    
    try {
        const pushResult = await ipcRenderer.invoke('git:push');
        
        if (pushResult.error) {
            commitResult.innerHTML = `<p class="error">Push failed: ${pushResult.error}</p>`;
            addGitMessage('Push Error', pushResult.message || pushResult.error, 'error');
        } else {
            commitResult.innerHTML = '<p class="success">✓ Push successful!</p>';
            addGitMessage('Push Success', pushResult.message || 'Push completed successfully', 'success');
            await loadBranches();
            await loadCommitFiles();
            await loadGitLogs();
        }
    } catch (error) {
        commitResult.innerHTML = `<p class="error">Error: ${error.message}</p>`;
        addGitMessage('Push Error', error.message, 'error');
    }
}

// Event listeners for Git
async function handleCreateBranch() {
    const branchName = prompt('Enter new branch name:');
    
    if (!branchName || !branchName.trim()) {
        return;
    }
    
    const trimmedName = branchName.trim();
    
    // Basic validation
    if (!/^[a-zA-Z0-9._/-]+$/.test(trimmedName)) {
        await window.showAlert('Invalid Branch Name', 'Branch names can only contain letters, numbers, dots, underscores, slashes, and hyphens.');
        return;
    }
    
    try {
        const result = await ipcRenderer.invoke('git:create-branch', trimmedName);
        
        if (result.error) {
            await window.showAlert('Error', `Error creating branch: ${result.error}`);
        } else {
            // Refresh branches and checkout the new branch
            await loadBranches();
            await loadCommitFiles();
            await window.showAlert('Success', `Branch "${trimmedName}" created and checked out successfully!`);
        }
    } catch (error) {
        await window.showAlert('Error', `Error: ${error.message}`);
    }
}

// Make function available globally for onclick handler - ensure it's available immediately
window.handleCreateBranchClick = handleCreateBranch;

// Also ensure it's set up after DOM loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.handleCreateBranchClick = handleCreateBranch;
    });
} else {
    window.handleCreateBranchClick = handleCreateBranch;
}
const openSettingsBtn = document.getElementById('open-settings');
if (openSettingsBtn) {
    openSettingsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        // Switch to settings tab
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        document.querySelector('[data-tab="settings"]').classList.add('active');
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.getElementById('settings-tab').classList.add('active');
        loadSettings();
    });
}

// Settings event listeners
document.getElementById('settings-save-repo').addEventListener('click', async () => {
    const input = document.getElementById('settings-repo-path');
    const repoPath = input.value.trim();
    
    // Use current directory if input is empty
    const finalPath = repoPath === '' ? process.cwd() : repoPath;
    
    // SAVE TO CONFIG FILE FIRST - BEFORE ANYTHING ELSE
    try {
        const saveResult = await ipcRenderer.invoke('config:set-git-repo-path', finalPath);
        
        if (!saveResult || !saveResult.success) {
            await window.showAlert('Error', 'Failed to save repository path to config file!');
            return;
        }
        
        // Verify immediately
        const verify = await ipcRenderer.invoke('config:get-git-repo-path');
        if (verify.path !== finalPath) {
            await window.showAlert('Error', 'Saved but verification failed! Expected: ' + finalPath + ' Got: ' + verify.path);
            return;
        }
        
    } catch (error) {
        await window.showAlert('Error', 'Error saving repository path: ' + error.message);
        return;
    }
    
    // NOW try to initialize git with the saved path
    await setRepository(finalPath);
    
    // Update UI
    await updateSettingsRepoStatus();
    
    // Show success feedback
    const button = document.getElementById('settings-save-repo');
    const originalText = button.textContent;
    button.textContent = '✓ Saved!';
    button.style.background = '#2d5a2d';
    setTimeout(() => {
        button.textContent = originalText;
        button.style.background = '';
    }, 2000);
});

// Save commit template
document.getElementById('settings-save-template').addEventListener('click', async () => {
    const textarea = document.getElementById('settings-commit-template');
    const template = textarea.value;
    
    try {
        const saveResult = await ipcRenderer.invoke('config:set-commit-template', template);
        
        if (!saveResult || !saveResult.success) {
            await window.showAlert('Error', 'Failed to save commit template!');
            return;
        }
        
        // Show success feedback
        const button = document.getElementById('settings-save-template');
        const statusDiv = document.getElementById('settings-template-status');
        const originalText = button.textContent;
        button.textContent = '✓ Saved!';
        button.style.background = '#2d5a2d';
        if (statusDiv) {
            statusDiv.innerHTML = '<p class="success">Template saved successfully!</p>';
        }
        setTimeout(() => {
            button.textContent = originalText;
            button.style.background = '';
            if (statusDiv) {
                statusDiv.innerHTML = '';
            }
        }, 2000);
    } catch (error) {
        await window.showAlert('Error', 'Error saving commit template: ' + error.message);
    }
});

// Select diagram directory
document.getElementById('settings-select-diagram-directory').addEventListener('click', async () => {
    try {
        const result = await ipcRenderer.invoke('diagram:select-directory');
        if (result.error) {
            await window.showAlert('Error', `Error selecting directory: ${result.error}`);
        } else if (result.directory) {
            const diagramDirectoryInput = document.getElementById('settings-diagram-directory');
            if (diagramDirectoryInput) {
                diagramDirectoryInput.value = result.directory;
            }
        }
    } catch (error) {
        await window.showAlert('Error', `Error: ${error.message}`);
    }
});

// Save diagram directory
document.getElementById('settings-save-diagram-directory').addEventListener('click', async () => {
    const directory = document.getElementById('settings-diagram-directory').value;
    if (!directory) {
        const statusDiv = document.getElementById('settings-diagram-status');
        if (statusDiv) {
            statusDiv.innerHTML = '<div class="error">❌ Please select a directory first</div>';
        }
        return;
    }
    
    try {
        const result = await ipcRenderer.invoke('diagram:set-directory', directory);
        const statusDiv = document.getElementById('settings-diagram-status');
        if (result.success) {
            if (statusDiv) {
                statusDiv.innerHTML = '<div class="success">✓ Diagram directory saved successfully</div>';
            }
            // Refresh diagrams if we're on the diagraming tab
            if (document.getElementById('diagraming-tab') && document.getElementById('diagraming-tab').classList.contains('active')) {
                await loadSavedDiagrams();
            }
        } else {
            if (statusDiv) {
                statusDiv.innerHTML = `<div class="error">❌ Error: ${result.error || 'Failed to save directory'}</div>`;
            }
        }
    } catch (error) {
        await window.showAlert('Error', `Error: ${error.message}`);
    }
});

// Save main branch
document.getElementById('settings-save-main-branch').addEventListener('click', async () => {
    const branchName = document.getElementById('settings-main-branch').value.trim();
    const statusDiv = document.getElementById('settings-main-branch-status');
    
    try {
        const result = await ipcRenderer.invoke('config:set-main-branch', branchName || null);
        if (result.success) {
            if (statusDiv) {
                statusDiv.innerHTML = '<div class="success">✓ Main branch saved successfully</div>';
            }
            // Refresh branches if we're on the git tab
            if (document.getElementById('git-tab') && document.getElementById('git-tab').classList.contains('active')) {
                await loadBranches();
            }
        } else {
            if (statusDiv) {
                statusDiv.innerHTML = `<div class="error">❌ Error: ${result.error || 'Failed to save main branch'}</div>`;
            }
        }
    } catch (error) {
        await window.showAlert('Error', `Error: ${error.message}`);
    }
});

// Save tab size
document.getElementById('settings-save-tab-size').addEventListener('click', async () => {
    const tabSizeValue = parseInt(document.getElementById('settings-tab-size').value);
    
    if (isNaN(tabSizeValue) || tabSizeValue < 1 || tabSizeValue > 8) {
        const statusDiv = document.getElementById('settings-tab-size-status');
        if (statusDiv) {
            statusDiv.innerHTML = '<div class="error">❌ Tab size must be between 1 and 8</div>';
        }
        return;
    }
    
    try {
        const result = await ipcRenderer.invoke('config:set-tab-size', tabSizeValue);
        if (result.success) {
            tabSize = result.tabSize || tabSizeValue;
            // Re-setup handlers with new tab size - need to clear flags first
            const editorIds = ['notes-editor', 'diagram-code', 'commit-message', 'settings-commit-template'];
            editorIds.forEach(id => {
                const editor = document.getElementById(id);
                if (editor) {
                    editor.dataset.tabHandler = '';
                }
            });
            setupTabHandling();
            
            const statusDiv = document.getElementById('settings-tab-size-status');
            if (statusDiv) {
                statusDiv.innerHTML = '<div class="success">✓ Tab size saved successfully</div>';
            }
        } else {
            const statusDiv = document.getElementById('settings-tab-size-status');
            if (statusDiv) {
                statusDiv.innerHTML = '<div class="error">❌ Error saving tab size</div>';
            }
        }
    } catch (error) {
        await window.showAlert('Error', `Error: ${error.message}`);
    }
});

// MCP Server controls
document.getElementById('mcp-start-btn').addEventListener('click', async () => {
    try {
        const result = await ipcRenderer.invoke('mcp:start');
        const statusDiv = document.getElementById('mcp-status');
        if (result.success) {
            if (statusDiv) {
                statusDiv.innerHTML = '<div class="success">✓ MCP server started successfully</div>';
            }
            await updateMCPStatus();
        } else {
            if (statusDiv) {
                statusDiv.innerHTML = `<div class="error">❌ Error: ${result.error || 'Failed to start MCP server'}</div>`;
            }
        }
    } catch (error) {
        await window.showAlert('Error', `Error: ${error.message}`);
    }
});

document.getElementById('mcp-stop-btn').addEventListener('click', async () => {
    try {
        const result = await ipcRenderer.invoke('mcp:stop');
        const statusDiv = document.getElementById('mcp-status');
        if (result.success) {
            if (statusDiv) {
                statusDiv.innerHTML = '<div class="success">✓ MCP server stopped</div>';
            }
            await updateMCPStatus();
        } else {
            if (statusDiv) {
                statusDiv.innerHTML = `<div class="error">❌ Error: ${result.error || 'Failed to stop MCP server'}</div>`;
            }
        }
    } catch (error) {
        await window.showAlert('Error', `Error: ${error.message}`);
    }
});

document.getElementById('mcp-refresh-status-btn').addEventListener('click', async () => {
    await updateMCPStatus();
});

// Select notes directory
document.getElementById('settings-select-notes-directory').addEventListener('click', async () => {
    try {
        const result = await ipcRenderer.invoke('notes:select-directory');
        if (result.error) {
            await window.showAlert('Error', `Error selecting directory: ${result.error}`);
        } else if (result.directory) {
            const notesDirectoryInput = document.getElementById('settings-notes-directory');
            if (notesDirectoryInput) {
                notesDirectoryInput.value = result.directory;
            }
        }
    } catch (error) {
        await window.showAlert('Error', `Error: ${error.message}`);
    }
});

// Save notes directory
document.getElementById('settings-save-notes-directory').addEventListener('click', async () => {
    const directory = document.getElementById('settings-notes-directory').value;
    if (!directory) {
        const statusDiv = document.getElementById('settings-notes-status');
        if (statusDiv) {
            statusDiv.innerHTML = '<div class="error">❌ Please select a directory first</div>';
        }
        return;
    }
    
    try {
        const result = await ipcRenderer.invoke('notes:set-directory', directory);
        const statusDiv = document.getElementById('settings-notes-status');
        if (result.success) {
            if (statusDiv) {
                statusDiv.innerHTML = '<div class="success">✓ Notes directory saved successfully</div>';
            }
            // Refresh notes tree if we're on the notes tab
            if (document.getElementById('notes-tab') && document.getElementById('notes-tab').classList.contains('active')) {
                notesDirectory = directory;
                await loadNotesDirectoryTree(directory);
            }
        } else {
            if (statusDiv) {
                statusDiv.innerHTML = `<div class="error">❌ Error: ${result.error || 'Failed to save directory'}</div>`;
            }
        }
    } catch (error) {
        await window.showAlert('Error', `Error: ${error.message}`);
    }
});

// Git tab inner buttons
document.querySelectorAll('.git-tab-button').forEach(button => {
    button.addEventListener('click', () => {
        const tabName = button.dataset.gitTab;
        
        document.querySelectorAll('.git-tab-button').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        
        document.querySelectorAll('.git-tab-content').forEach(content => content.classList.remove('active'));
        const targetTab = document.getElementById(`git-${tabName}-tab`);
        if (targetTab) {
            targetTab.classList.add('active');
        }
        
        if (tabName === 'logs') {
            // Always try to load logs for current branch, let the function handle errors gracefully
            loadGitLogs();
        } else if (tabName === 'commit') {
            // Load staged/unstaged files for commit tab
            loadCommitFiles();
            // Apply commit template if available
            applyCommitTemplate();
        } else if (tabName === 'stash') {
            // Load stashes
            loadStashes();
        }
    });
});
document.getElementById('commit-btn').addEventListener('click', commitChanges);
document.getElementById('push-btn').addEventListener('click', pushChanges);
document.getElementById('pull-btn').addEventListener('click', pullChanges);
document.getElementById('force-push-btn').addEventListener('click', forcePush);

// Stash buttons
const createStashBtn = document.getElementById('create-stash-btn');
if (createStashBtn) {
    createStashBtn.addEventListener('click', async () => {
        await createStash();
    });
}

const refreshStashBtn = document.getElementById('refresh-stash-btn');
if (refreshStashBtn) {
    refreshStashBtn.addEventListener('click', async () => {
        await loadStashes();
    });
}

// Refresh commit files button
const refreshCommitFilesBtn = document.getElementById('refresh-commit-files');
if (refreshCommitFilesBtn) {
    refreshCommitFilesBtn.addEventListener('click', async () => {
        await loadCommitFiles();
    });
} else {
    setTimeout(() => {
        const btn = document.getElementById('refresh-commit-files');
        if (btn) {
            btn.addEventListener('click', async () => {
                await loadCommitFiles();
            });
        }
    }, 500);
}

// Create branch button - use direct event listener
function setupCreateBranchButton() {
    const btn = document.getElementById('create-branch');
    if (!btn) return false;
    
    // Remove any existing event listeners by cloning
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    
    // Set up handler on the new button
    newBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        showBranchNameModal();
    });
    
    return true;
}

// Try to set up immediately
if (!setupCreateBranchButton()) {
    // Retry after a delay
    setTimeout(() => {
        if (!setupCreateBranchButton()) {
            setTimeout(() => setupCreateBranchButton(), 2000);
        }
    }, 500);
}

// Branch name modal functions
function showBranchNameModal() {
    const modal = document.getElementById('branch-name-modal');
    const input = document.getElementById('branch-name-input');
    if (modal && input) {
        modal.style.display = 'flex';
        input.value = '';
        input.focus();
    }
}

function hideBranchNameModal() {
    const modal = document.getElementById('branch-name-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function createBranchFromModal() {
    const input = document.getElementById('branch-name-input');
    if (!input) return;
    
    const branchName = input.value.trim();
    if (!branchName) {
        await window.showAlert('Input Required', 'Please enter a branch name.');
        return;
    }
    
    if (!/^[a-zA-Z0-9._/-]+$/.test(branchName)) {
        await window.showAlert('Invalid Branch Name', 'Branch names can only contain letters, numbers, dots, underscores, slashes, and hyphens.');
        return;
    }
    
    hideBranchNameModal();
    
    try {
        const result = await ipcRenderer.invoke('git:create-branch', branchName);
        if (result.error) {
            await window.showAlert('Error', `Error creating branch: ${result.error}`);
        } else {
            await loadBranches();
            await loadCommitFiles();
            await window.showAlert('Success', `Branch "${branchName}" created and checked out successfully!`);
        }
    } catch (error) {
        await window.showAlert('Error', `Error: ${error.message}`);
    }
}

// Set up modal event listeners
function setupBranchModalListeners() {
    const cancelBtn = document.getElementById('branch-name-cancel');
    const confirmBtn = document.getElementById('branch-name-confirm');
    const input = document.getElementById('branch-name-input');
    const modal = document.getElementById('branch-name-modal');
    
    if (cancelBtn) {
        cancelBtn.onclick = hideBranchNameModal;
    }
    
    if (confirmBtn) {
        confirmBtn.onclick = createBranchFromModal;
    }
    
    if (input) {
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                createBranchFromModal();
            } else if (e.key === 'Escape') {
                hideBranchNameModal();
            }
        };
    }
    
    if (modal) {
        modal.onclick = (e) => {
            if (e.target === modal) {
                hideBranchNameModal();
            }
        };
    }
}

// Set up immediately and also on DOMContentLoaded
setupBranchModalListeners();
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupBranchModalListeners);
}

// Set up context menu handlers
function setupContextMenuHandler() {
    const contextMenu = document.getElementById('branch-context-menu');
    if (!contextMenu) return false;
    
    // Checkout handler
    const contextCheckoutBranch = document.getElementById('context-checkout-branch');
    if (contextCheckoutBranch) {
        contextCheckoutBranch.onclick = (e) => {
            const branchName = contextMenu.dataset.branchName;
            const branchType = contextMenu.dataset.branchType;
            const remoteBranchFullName = contextMenu.dataset.remoteBranchFullName;
            
            if (branchName) {
                if (branchType === 'remote' && remoteBranchFullName) {
                    checkoutRemoteBranch(remoteBranchFullName, branchName);
                } else {
                    checkoutBranch(branchName);
                }
                contextMenu.style.display = 'none';
            }
        };
    }
    
    // Update handler
    const contextUpdateBranch = document.getElementById('context-update-branch');
    if (contextUpdateBranch) {
        contextUpdateBranch.onclick = (e) => {
            const branchName = contextMenu.dataset.branchName;
            if (branchName) {
                updateBranch(branchName);
                contextMenu.style.display = 'none';
            }
        };
    }
    
    // Rebase handler
    const contextRebaseBranch = document.getElementById('context-rebase-branch');
    if (contextRebaseBranch) {
        contextRebaseBranch.onclick = (e) => {
            const branchName = e.target.dataset.branchName;
            if (branchName) {
                rebaseBranch(branchName);
                contextMenu.style.display = 'none';
            }
        };
    }
    
    // Delete handler
    const contextDeleteBranch = document.getElementById('context-delete-branch');
    if (contextDeleteBranch) {
        contextDeleteBranch.onclick = (e) => {
            const branchName = e.target.dataset.branchName;
            if (branchName) {
                deleteBranch(branchName);
                contextMenu.style.display = 'none';
            }
        };
    }
    
    return true;
}

// Set up commit context menu handlers
function setupCommitContextMenuHandler() {
    const contextMenu = document.getElementById('commit-context-menu');
    if (!contextMenu) return false;
    
    // Reset Soft handler
    const contextResetSoft = document.getElementById('context-reset-soft');
    if (contextResetSoft) {
        contextResetSoft.onclick = (e) => {
            const commitHash = contextMenu.dataset.commitHash;
            if (commitHash) {
                resetToCommit(commitHash, 'soft');
                contextMenu.style.display = 'none';
            }
        };
    }
    
    // Reset Mixed handler
    const contextResetMixed = document.getElementById('context-reset-mixed');
    if (contextResetMixed) {
        contextResetMixed.onclick = (e) => {
            const commitHash = contextMenu.dataset.commitHash;
            if (commitHash) {
                resetToCommit(commitHash, 'mixed');
                contextMenu.style.display = 'none';
            }
        };
    }
    
    // Reset Hard handler
    const contextResetHard = document.getElementById('context-reset-hard');
    if (contextResetHard) {
        contextResetHard.onclick = (e) => {
            const commitHash = contextMenu.dataset.commitHash;
            if (commitHash) {
                resetToCommit(commitHash, 'hard');
                contextMenu.style.display = 'none';
            }
        };
    }
    
    return true;
}

if (!setupContextMenuHandler()) {
    setTimeout(() => setupContextMenuHandler(), 100);
}

if (!setupCommitContextMenuHandler()) {
    setTimeout(() => setupCommitContextMenuHandler(), 100);
}

// Set up notes context menu handlers
function setupNotesContextMenuHandler() {
    const contextMenu = document.getElementById('notes-context-menu');
    if (!contextMenu) return false;
    
    // Create note handler
    const contextCreateNote = document.getElementById('context-create-note');
    if (contextCreateNote) {
        contextCreateNote.onclick = async (e) => {
            const targetPath = contextMenu.dataset.targetPath;
            if (targetPath) {
                await createNewNote(targetPath);
                contextMenu.style.display = 'none';
            }
        };
    }
    
    // Create folder handler
    const contextCreateFolder = document.getElementById('context-create-folder');
    if (contextCreateFolder) {
        contextCreateFolder.onclick = async (e) => {
            const targetPath = contextMenu.dataset.targetPath;
            if (targetPath) {
                await createNewFolder(targetPath);
                contextMenu.style.display = 'none';
            }
        };
    }
    
    return true;
}

if (!setupNotesContextMenuHandler()) {
    setTimeout(() => setupNotesContextMenuHandler(), 100);
}

// Tab handling for editors
let tabSize = 4;

async function loadTabSize() {
    try {
        const result = await ipcRenderer.invoke('config:get-tab-size');
        tabSize = result.tabSize || 4;
        setupTabHandling();
    } catch (error) {
        tabSize = 4;
        setupTabHandling();
    }
}

function setupTabHandling() {
    // Get all editor textareas
    const editorIds = ['notes-editor', 'diagram-code', 'commit-message', 'settings-commit-template'];
    
    editorIds.forEach(editorId => {
        const editor = document.getElementById(editorId);
        if (!editor) return;
        
        // Remove existing handler if present (by checking for a flag)
        if (editor.dataset.tabHandler === 'true') {
            // We'll just overwrite it - the new handler will use the updated tabSize
            return;
        }
        
        editor.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                
                const start = editor.selectionStart;
                const end = editor.selectionEnd;
                const value = editor.value;
                
                // Insert spaces at cursor position
                const spaces = ' '.repeat(tabSize);
                const newValue = value.substring(0, start) + spaces + value.substring(end);
                
                editor.value = newValue;
                
                // Set cursor position after inserted spaces
                editor.selectionStart = editor.selectionEnd = start + tabSize;
            }
        });
        
        editor.dataset.tabHandler = 'true';
    });
}

// Load tab size on startup
loadTabSize();

// Diagram Editor Functions moved to views/diagram.js
// mermaidInitialized kept for notes preview
let mermaidInitialized = false;

// Diff modal functions
async function showFileDiff(filePath, isStaged) {
    const modal = document.getElementById('diff-modal');
    const title = document.getElementById('diff-modal-title');
    const content = document.getElementById('diff-content');
    
    if (!modal || !title || !content) return;
    
    // Show modal and set title
    modal.style.display = 'flex';
    content.innerHTML = '<p class="loading">Loading diff...</p>';
    
    try {
        // First, get the actual file status to determine if it's really staged
        const statusResult = await ipcRenderer.invoke('git:get-status');
        let actualIsStaged = isStaged;
        
        if (statusResult.status && statusResult.status.files) {
            const file = statusResult.status.files.find(f => f.path === filePath);
            if (file) {
                // Determine if file is actually staged based on index status
                // Staged: index is not ' ' and not '?'
                actualIsStaged = (file.index !== ' ' && file.index !== '?');
                
                // Update title based on actual status
                if (actualIsStaged) {
                    title.textContent = `Staged Changes: ${filePath}`;
                } else if (file.working_dir === 'M' || file.working_dir === 'D') {
                    title.textContent = `Unstaged Changes: ${filePath}`;
                } else if (file.working_dir === '?') {
                    title.textContent = `New File: ${filePath}`;
                } else {
                    title.textContent = `Changes: ${filePath}`;
                }
            } else {
                title.textContent = `Changes: ${filePath}`;
            }
        } else {
            title.textContent = `${isStaged ? 'Staged' : 'Unstaged'} Changes: ${filePath}`;
        }
        
        // Get diff for the specific file using the actual staged status
        const result = await ipcRenderer.invoke('git:get-diff', filePath, actualIsStaged);
        
        if (result.error) {
            content.innerHTML = `<p class="error">Error loading diff: ${result.error}</p>`;
            return;
        }
        
        // Format and display the diff
        const diff = result.diff || '';
        
        if (!diff || diff.trim() === '') {
            // Try to get file status to see if it's a new file
            if (statusResult.status && statusResult.status.files) {
                const file = statusResult.status.files.find(f => f.path === filePath);
                if (file && (file.working_dir === '?' || file.index === '?')) {
                    content.innerHTML = '<p class="placeholder">This is a new/untracked file. The full file content will be shown as a diff.</p>';
                } else {
                    content.innerHTML = '<p class="placeholder">No changes to display for this file.</p>';
                }
            } else {
                content.innerHTML = '<p class="placeholder">No changes to display. Could not get file status.</p>';
            }
            return;
        }
        
        // Parse and format diff with syntax highlighting
        const formattedDiff = formatDiff(diff);
        content.innerHTML = formattedDiff;
        
    } catch (error) {
        content.innerHTML = `<p class="error">Error: ${error.message}</p>`;
    }
}

function formatDiff(diff) {
    const lines = diff.split('\n');
    let html = '';
    
    lines.forEach(line => {
        let className = 'diff-line';
        if (line.startsWith('+++') || line.startsWith('---')) {
            className += ' header';
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
            className += ' added';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            className += ' removed';
        } else if (line.startsWith('@@')) {
            className += ' header';
        } else {
            className += ' context';
        }
        
        html += `<div class="${className}">${escapeHtml(line)}</div>`;
    });
    
    return html;
}

function formatCommitDiff(diff) {
    if (!diff || diff.trim() === '') {
        return '<p class="placeholder">No diff content</p>';
    }
    
    // Split by lines, preserving empty lines
    const lines = diff.split(/\r?\n/);
    const files = [];
    let currentFile = null;
    let currentFileLines = [];
    
    // Debug: Count how many "diff --git" lines we have
    const diffGitCount = lines.filter(l => l.startsWith('diff --git')).length;
    
    // Parse diff to separate by file
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Check if this is the start of a new file diff
        // Also check for variations like "diff --cc" (combined diff) or "diff --combined"
        if (line.startsWith('diff --git') || line.startsWith('diff --cc') || line.startsWith('diff --combined')) {
            // Save previous file if exists
            if (currentFile !== null && currentFileLines.length > 0) {
                files.push({
                    header: currentFile,
                    lines: [...currentFileLines]
                });
            }
            
            // Extract file paths from "diff --git a/path b/path"
            // The format is: diff --git a/path b/path
            let filePath = '';
            const parts = line.split(/\s+/);
            
            // Find the part that starts with 'b/' (the new file path)
            for (let j = 0; j < parts.length; j++) {
                if (parts[j].startsWith('b/')) {
                    filePath = parts[j].substring(2); // Remove 'b/' prefix
                    // Remove quotes if present
                    filePath = filePath.replace(/^["']|["']$/g, '');
                    break;
                }
            }
            
            // If we didn't find b/, try to find a/ and use the next part
            if (!filePath) {
                for (let j = 0; j < parts.length; j++) {
                    if (parts[j].startsWith('a/') && j + 1 < parts.length) {
                        const nextPart = parts[j + 1];
                        if (nextPart.startsWith('b/')) {
                            filePath = nextPart.substring(2);
                            filePath = filePath.replace(/^["']|["']$/g, '');
                        } else {
                            // Sometimes the format is different, try the next part anyway
                            filePath = nextPart.replace(/^["']|["']$/g, '');
                        }
                        break;
                    }
                }
            }
            
            // If still no path, try to extract from the last meaningful part
            if (!filePath && parts.length >= 4) {
                const lastPart = parts[parts.length - 1];
                filePath = lastPart.replace(/^b\//, '').replace(/^["']|["']$/g, '');
            }
            
            // Initialize new file
            currentFile = {
                headerLine: line,
                filePath: filePath || 'Unknown file',
                isNew: false,
                isDeleted: false,
                renameFrom: null,
                renameTo: null,
                oldPath: null,
                newPath: null
            };
            currentFileLines = [line];
        } else if (currentFile !== null) {
            // All other lines belong to the current file
            currentFileLines.push(line);
            
            // Check for metadata that tells us about the file
            if (line.startsWith('new file mode')) {
                currentFile.isNew = true;
            } else if (line.startsWith('deleted file mode')) {
                currentFile.isDeleted = true;
            } else if (line.startsWith('rename from')) {
                currentFile.renameFrom = line.replace(/^rename from\s+/, '').trim();
            } else if (line.startsWith('rename to')) {
                currentFile.renameTo = line.replace(/^rename to\s+/, '').trim();
            } else if (line.startsWith('---')) {
                // Old file path: --- a/path or --- /dev/null
                const pathPart = line.replace(/^---\s+/, '').trim();
                currentFile.oldPath = pathPart.replace(/^a\//, '').replace(/^\/dev\/null$/, '/dev/null');
            } else if (line.startsWith('+++')) {
                // New file path: +++ b/path or +++ /dev/null
                const pathPart = line.replace(/^\+\+\+\s+/, '').trim();
                currentFile.newPath = pathPart.replace(/^b\//, '').replace(/^\/dev\/null$/, '/dev/null');
                // Update filePath if we have a better path now
                if (currentFile.newPath && currentFile.newPath !== '/dev/null') {
                    currentFile.filePath = currentFile.newPath;
                }
            }
        } else {
            // We have lines before any "diff --git" - this shouldn't happen in a proper diff
            // But we'll handle it by creating a file for orphaned lines
            if (files.length === 0 && currentFile === null) {
                currentFile = {
                    headerLine: 'diff --git',
                    filePath: 'Changes',
                    isNew: false,
                    isDeleted: false,
                    renameFrom: null,
                    renameTo: null,
                    oldPath: null,
                    newPath: null
                };
                currentFileLines = [];
            }
            if (currentFile !== null) {
                currentFileLines.push(line);
            }
        }
    }
    
    // Don't forget the last file
    if (currentFile !== null && currentFileLines.length > 0) {
        files.push({
            header: currentFile,
            lines: currentFileLines
        });
    }
    
    // If no files were found, try to find any file indicators
    if (files.length === 0) {
        // Maybe the diff format is different - look for file indicators
        // Check if we have any lines that look like file paths
        let foundFileStart = false;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('---') || lines[i].startsWith('+++')) {
                foundFileStart = true;
                // Try to extract file path
                const pathLine = lines[i];
                let filePath = pathLine.replace(/^---\s+/, '').replace(/^\+\+\+\s+/, '').replace(/^[ab]\//, '').trim();
                if (filePath && filePath !== '/dev/null') {
                    currentFile = {
                        headerLine: 'diff --git',
                        filePath: filePath,
                        isNew: false,
                        isDeleted: false,
                        renameFrom: null,
                        renameTo: null,
                        oldPath: null,
                        newPath: null
                    };
                    // Collect all lines from this point
                    currentFileLines = lines.slice(i);
                    files.push({
                        header: currentFile,
                        lines: currentFileLines
                    });
                    break;
                }
            }
        }
        
        // If still no files, treat entire diff as one file
        if (files.length === 0) {
            files.push({
                header: {
                    headerLine: 'diff --git',
                    filePath: 'All Changes',
                    isNew: false,
                    isDeleted: false,
                    renameFrom: null,
                    renameTo: null,
                    oldPath: null,
                    newPath: null
                },
                lines: lines
            });
        }
    }
    
    // Generate HTML with cards for each file
    let html = '';
    files.forEach((file, index) => {
        const filePath = file.header.filePath || file.header.newPath || file.header.oldPath || 'Unknown file';
        const isNew = file.header.isNew;
        const isDeleted = file.header.isDeleted;
        const isRenamed = file.header.renameFrom && file.header.renameTo;
        const fileId = `diff-file-${index}`;
        
        html += `<div class="diff-file-card">`;
        html += `<div class="diff-file-header" data-file-id="${fileId}" style="cursor: pointer;">`;
        html += `<span class="diff-file-toggle">▼</span>`;
        
        if (isNew) {
            html += `<span class="diff-file-status new">📄 New File</span>`;
        } else if (isDeleted) {
            html += `<span class="diff-file-status deleted">🗑️ Deleted</span>`;
        } else if (isRenamed) {
            html += `<span class="diff-file-status renamed">↔️ Renamed</span>`;
        } else {
            html += `<span class="diff-file-status modified">✏️ Modified</span>`;
        }
        
        html += `<span class="diff-file-path">${escapeHtml(filePath)}</span>`;
        
        if (isRenamed) {
            html += `<div class="diff-file-rename-info">`;
            html += `<span class="diff-file-rename-from">From: ${escapeHtml(file.header.renameFrom)}</span>`;
            html += `<span class="diff-file-rename-to">To: ${escapeHtml(file.header.renameTo)}</span>`;
            html += `</div>`;
        }
        
        html += `</div>`;
        html += `<div class="diff-file-content" id="${fileId}-content">`;
        
        // Format the lines for this file
        file.lines.forEach(line => {
            let className = 'diff-line';
            if (line.startsWith('+++') || line.startsWith('---')) {
                className += ' header';
            } else if (line.startsWith('+') && !line.startsWith('+++')) {
                className += ' added';
            } else if (line.startsWith('-') && !line.startsWith('---')) {
                className += ' removed';
            } else if (line.startsWith('@@')) {
                className += ' header';
            } else if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('new file mode') || line.startsWith('deleted file mode') || line.startsWith('old mode') || line.startsWith('new mode') || line.startsWith('rename from') || line.startsWith('rename to') || line.startsWith('similarity index') || line.startsWith('copy from') || line.startsWith('copy to')) {
                className += ' metadata';
            } else {
                className += ' context';
            }
            
            html += `<div class="${className}">${escapeHtml(line)}</div>`;
        });
        
        html += `</div>`;
        html += `</div>`;
    });
    
    return html;
}

// Set up collapse/expand handlers for file cards
function setupDiffFileCollapse() {
    const headers = document.querySelectorAll('.diff-file-header');
    headers.forEach(header => {
        // Remove existing listeners by cloning
        const newHeader = header.cloneNode(true);
        header.parentNode.replaceChild(newHeader, header);
        
        newHeader.addEventListener('click', (e) => {
            // Don't collapse if clicking on the rename info
            if (e.target.closest('.diff-file-rename-info')) {
                return;
            }
            
            const fileId = newHeader.dataset.fileId;
            const content = document.getElementById(`${fileId}-content`);
            const toggle = newHeader.querySelector('.diff-file-toggle');
            
            if (content && toggle) {
                const isCollapsed = content.style.display === 'none';
                content.style.display = isCollapsed ? 'block' : 'none';
                toggle.textContent = isCollapsed ? '▼' : '▶';
                toggle.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
            }
        });
    });
}

async function showCommitDiff(commitHash, commitElement) {
    const modal = document.getElementById('diff-modal');
    const title = document.getElementById('diff-modal-title');
    const content = document.getElementById('diff-content');
    
    if (!modal || !title || !content) return;
    
    // Show modal and set title
    modal.style.display = 'flex';
    content.innerHTML = '<p class="loading">Loading commit diff...</p>';
    
    // Get commit message from the element
    const commitMessage = commitElement.querySelector('.commit-message')?.textContent || 'Unknown commit';
    const shortHash = commitHash.substring(0, 7);
    title.textContent = `Commit: ${shortHash} - ${commitMessage.substring(0, 50)}${commitMessage.length > 50 ? '...' : ''}`;
    
    try {
        // Get diff for the commit
        const result = await ipcRenderer.invoke('git:get-commit-diff', commitHash);
        
        if (result.error) {
            content.innerHTML = `<p class="error">Error loading commit diff: ${result.error}</p>`;
            return;
        }
        
        // Format and display the diff
        const diff = result.diff || '';
        
        if (!diff || diff.trim() === '') {
            content.innerHTML = '<p class="placeholder">No changes to display for this commit.</p>';
            return;
        }
        
        // Parse and format diff with syntax highlighting, grouped by file
        const formattedDiff = formatCommitDiff(diff);
        
        // Debug: Check if we got multiple files (should contain diff-file-card)
        if (!formattedDiff.includes('diff-file-card')) {
            // If no cards were created, the parsing might have failed
            // Fall back to showing the raw diff with a note
            content.innerHTML = `
                <p class="error" style="margin-bottom: 12px;">Warning: Could not parse diff into separate files. Showing raw diff:</p>
                <div style="background: #1a1a1a; padding: 12px; border-radius: 4px; font-family: monospace; font-size: 11px; white-space: pre-wrap; max-height: 500px; overflow-y: auto;">
                    ${escapeHtml(diff.substring(0, 5000))}${diff.length > 5000 ? '...\n\n(truncated)' : ''}
                </div>
            `;
        } else {
            content.innerHTML = formattedDiff;
            // Set up collapse/expand handlers after content is added
            setTimeout(() => {
                setupDiffFileCollapse();
            }, 10);
        }
        
    } catch (error) {
        content.innerHTML = `<p class="error">Error: ${error.message}</p>`;
    }
}

function hideDiffModal() {
    const modal = document.getElementById('diff-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Set up diff modal close button
function setupDiffModal() {
    const closeBtn = document.getElementById('diff-modal-close');
    const modal = document.getElementById('diff-modal');
    
    if (closeBtn) {
        closeBtn.onclick = hideDiffModal;
    }
    
    if (modal) {
        modal.onclick = (e) => {
            if (e.target === modal) {
                hideDiffModal();
            }
        };
    }
}

setupDiffModal();

// Git messages functions
function addGitMessage(title, message, type = 'info') {
    const messagesContainer = document.getElementById('git-messages');
    if (!messagesContainer) return;
    
    // Remove placeholder if it exists
    const placeholder = messagesContainer.querySelector('.placeholder');
    if (placeholder) {
        placeholder.remove();
    }
    
    const timestamp = new Date().toLocaleTimeString();
    const typeClass = type === 'error' ? 'error' : type === 'success' ? 'success' : 'info';
    const typeIcon = type === 'error' ? '❌' : type === 'success' ? '✓' : 'ℹ️';
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `git-message git-message-${typeClass}`;
    messageDiv.innerHTML = `
        <div class="git-message-header">
            <span class="git-message-icon">${typeIcon}</span>
            <span class="git-message-title">${escapeHtml(title)}</span>
            <span class="git-message-time">${timestamp}</span>
        </div>
        <div class="git-message-content">${escapeHtml(message)}</div>
    `;
    
    messagesContainer.insertBefore(messageDiv, messagesContainer.firstChild);
    
    // Limit to 50 messages
    const messages = messagesContainer.querySelectorAll('.git-message');
    if (messages.length > 50) {
        messages[messages.length - 1].remove();
    }
    
    // Auto-scroll to top to show latest message
    messagesContainer.scrollTop = 0;
}

// Clear git messages button
const clearGitMessagesBtn = document.getElementById('clear-git-messages');
if (clearGitMessagesBtn) {
    clearGitMessagesBtn.addEventListener('click', () => {
        const messagesContainer = document.getElementById('git-messages');
        if (messagesContainer) {
            messagesContainer.innerHTML = '<p class="placeholder" style="font-size: 12px; opacity: 0.7;">No messages yet</p>';
        }
    });
}

// Git branch buttons
const fetchBranchesBtn = document.getElementById('fetch-branches');
if (fetchBranchesBtn) {
    fetchBranchesBtn.addEventListener('click', async () => {
        const button = fetchBranchesBtn;
        const originalText = button.textContent;
        button.textContent = '📥 Fetching...';
        button.disabled = true;
        
        try {
            const result = await ipcRenderer.invoke('git:fetch');
            
            if (result.error) {
                await window.showAlert('Error', `Error fetching: ${result.error}`);
                addGitMessage('Fetch Error', result.message || result.error, 'error');
            } else {
                // After successful fetch, refresh branches to show updated remote branches
                await loadBranches();
                addGitMessage('Fetch Success', result.message || 'Fetched latest changes from remote', 'success');
            }
        } catch (error) {
            await window.showAlert('Error', `Error: ${error.message}`);
        } finally {
            button.textContent = originalText;
            button.disabled = false;
        }
    });
}

const refreshBranchesBtn = document.getElementById('refresh-branches');
if (refreshBranchesBtn) {
    refreshBranchesBtn.addEventListener('click', async () => {
        await loadBranches();
        await loadCommitFiles();
    });
} else {
    // Retry if element doesn't exist yet
    setTimeout(() => {
        const btn = document.getElementById('refresh-branches');
        if (btn) {
            btn.addEventListener('click', async () => {
                await loadBranches();
                await loadCommitFiles();
            });
        }
    }, 500);
}



// Auto-initialize git repository on startup
async function initializeGit() {
    try {
        const saved = await ipcRenderer.invoke('config:get-git-repo-path');
        const savedRepoPath = saved.path;
        
        if (savedRepoPath && savedRepoPath.trim() !== '' && savedRepoPath !== 'null' && savedRepoPath !== 'undefined') {
            await setRepository(savedRepoPath);
        }
    } catch (error) {
        // Silently fail
    }
}

// Initialize git after DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(initializeGit, 500);
    });
} else {
    setTimeout(initializeGit, 500);
}


    return {
        setRepository,
        loadBranches,
        loadCommitFiles,
        loadGitLogs,
        commitChanges,
        pushChanges,
        pullChanges,
        applyCommitTemplate,
        setupCreateBranchButton,
        initialize: initializeGit,
    };
}

module.exports = { createGitView };
