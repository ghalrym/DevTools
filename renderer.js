const { ipcRenderer } = require('electron');

// Tab switching
document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
        const tabName = button.dataset.tab;
        
        // Stop following logs when switching away from Docker tab
        if (tabName !== 'docker') {
            stopFollowingLogs();
        }
        
        // Update tab buttons
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        
        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.getElementById(`${tabName}-tab`).classList.add('active');
        
        // Load data when switching tabs
        if (tabName === 'docker') {
            loadContainers();
            // If a container was already selected, resume following
            if (selectedContainerId) {
                startFollowingLogs();
            }
        } else if (tabName === 'git') {
            // Always try to load, let the functions handle errors gracefully
            loadBranches();
            loadCommitFiles();
            // Re-setup the create branch button in case it was recreated
            setupCreateBranchButton();
        } else if (tabName === 'settings') {
            loadSettings();
        }
    });
});

// Git inner tab switching is handled in event listeners section below

// Docker functionality
let selectedContainerId = null;
let selectedContainerStatus = null;
let logFollowInterval = null;
let previousLogLines = [];
let displayedLineCount = 0;
let isInitialLoad = true;
let lastLogContent = '';
let lastLogContentBeforeClear = '';

function startFollowingLogs() {
    if (!selectedContainerId) return;
    
    // Clear any existing interval
    stopFollowingLogs();
    
    // Start following logs every 5 seconds
    logFollowInterval = setInterval(() => {
        loadContainerLogs(false); // false = incremental update, not force reload
    }, 5000);
}

function stopFollowingLogs() {
    if (logFollowInterval) {
        clearInterval(logFollowInterval);
        logFollowInterval = null;
    }
}

function findLongestCommonPrefix(names) {
    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    
    // Split all names by common delimiters
    const nameParts = names.map(name => name.split(/[-_]/));
    
    // Find the minimum length
    const minLength = Math.min(...nameParts.map(parts => parts.length));
    
    // Find common prefix parts
    let commonParts = [];
    for (let i = 0; i < minLength; i++) {
        const firstPart = nameParts[0][i];
        const allMatch = nameParts.every(parts => parts[i] === firstPart);
        if (allMatch) {
            commonParts.push(firstPart);
        } else {
            break;
        }
    }
    
    return commonParts.join('-');
}

function groupContainersByPrefix(containerNames) {
    const groups = {};
    const processed = new Set();
    
    // Clean all names
    const cleanNames = containerNames.map(n => n.replace(/^\//, ''));
    
    // For each container, find all others that share a common prefix
    cleanNames.forEach((name, index) => {
        if (processed.has(index)) return;
        
        // Find all containers that share at least the first part with this one
        const nameParts = name.split(/[-_]/);
        if (nameParts.length < 2) {
            // Single part name, group by itself
            groups[name] = [index];
            processed.add(index);
            return;
        }
        
        // Find containers that share the first part
        const similarIndices = [index];
        cleanNames.forEach((otherName, otherIndex) => {
            if (otherIndex === index || processed.has(otherIndex)) return;
            
            const otherParts = otherName.split(/[-_]/);
            // Check if they share at least the first part
            if (otherParts.length >= 1 && nameParts[0] === otherParts[0]) {
                similarIndices.push(otherIndex);
            }
        });
        
        if (similarIndices.length > 1) {
            // Find the longest common prefix among similar containers
            const similarNames = similarIndices.map(i => cleanNames[i]);
            const commonPrefix = findLongestCommonPrefix(similarNames);
            
            if (commonPrefix && commonPrefix.length > 0) {
                // Mark all as processed
                similarIndices.forEach(i => processed.add(i));
                
                // Use the common prefix as group name
                if (!groups[commonPrefix]) {
                    groups[commonPrefix] = [];
                }
                groups[commonPrefix].push(...similarIndices);
            } else {
                // No common prefix found, group individually
                groups[name] = [index];
                processed.add(index);
            }
        } else {
            // No similar containers, group individually
            groups[name] = [index];
            processed.add(index);
        }
    });
    
    return groups;
}

async function loadContainers() {
    const containersList = document.getElementById('containers-list');
    containersList.innerHTML = '<p class="loading">Loading containers...</p>';
    
    const result = await ipcRenderer.invoke('docker:list-containers');
    
    if (result.error) {
        containersList.innerHTML = `<p class="error">Error: ${result.error}</p>`;
        return;
    }
    
    if (result.containers.length === 0) {
        containersList.innerHTML = '<p class="placeholder">No containers found</p>';
        return;
    }
    
    containersList.innerHTML = '';
    
    // Get all container names first
    const allContainerNames = result.containers.map(c => c.Names[0]?.replace('/', '') || 'Unnamed');
    
    // Group containers by finding longest common prefix
    const indexGroups = groupContainersByPrefix(allContainerNames);
    
    // Convert index groups to container groups
    const groups = {};
    Object.keys(indexGroups).forEach(groupName => {
        groups[groupName] = indexGroups[groupName].map(index => {
            const container = result.containers[index];
            const containerName = container.Names[0]?.replace('/', '') || 'Unnamed';
            return {
                ...container,
                displayName: containerName
            };
        });
    });
    
    // Sort groups alphabetically
    const sortedGroups = Object.keys(groups).sort();
    
    sortedGroups.forEach(groupName => {
        const containers = groups[groupName];
        
        // If only one container in group, display it directly without grouping
        if (containers.length === 1) {
            const container = containers[0];
            const item = document.createElement('div');
            item.className = 'container-item';
            item.dataset.containerId = container.Id;
            
            const statusClass = container.Status.startsWith('Up') ? 'running' : 
                               container.Status.startsWith('Exited') ? 'exited' : 'created';
            
            item.innerHTML = `
                <div class="container-item-header">
                    <span class="container-name">${container.displayName}</span>
                    <span class="container-status ${statusClass}">${container.Status.split(' ')[0]}</span>
                </div>
                <div class="container-id">${container.Id.substring(0, 12)}</div>
            `;
            
            item.addEventListener('click', () => selectContainer(container.Id, container.displayName, container.Status));
            
            containersList.appendChild(item);
        } else {
            // Multiple containers, create a group
            const groupDiv = document.createElement('div');
            groupDiv.className = 'container-group';
            groupDiv.innerHTML = `
                <div class="container-group-header">
                    <span class="group-toggle">▶</span>
                    <span class="group-name">${groupName}</span>
                    <span class="group-count">(${containers.length})</span>
                </div>
                <div class="container-group-items" style="display: none;">
                </div>
            `;
            
            const groupItems = groupDiv.querySelector('.container-group-items');
            const groupHeader = groupDiv.querySelector('.container-group-header');
            const groupToggle = groupDiv.querySelector('.group-toggle');
            
            // Sort containers within group
            containers.sort((a, b) => a.displayName.localeCompare(b.displayName));
            
            containers.forEach(container => {
                const item = document.createElement('div');
                item.className = 'container-item container-item-nested';
                item.dataset.containerId = container.Id;
                
                const statusClass = container.Status.startsWith('Up') ? 'running' : 
                                   container.Status.startsWith('Exited') ? 'exited' : 'created';
                
                item.innerHTML = `
                    <div class="container-item-header">
                        <span class="container-name">${container.displayName}</span>
                        <span class="container-status ${statusClass}">${container.Status.split(' ')[0]}</span>
                    </div>
                    <div class="container-id">${container.Id.substring(0, 12)}</div>
                `;
                
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectContainer(container.Id, container.displayName, container.Status);
                });
                
                groupItems.appendChild(item);
            });
            
            // Toggle group on header click
            groupHeader.addEventListener('click', () => {
                const isExpanded = groupItems.style.display !== 'none';
                groupItems.style.display = isExpanded ? 'none' : 'block';
                groupToggle.textContent = isExpanded ? '▶' : '▼';
            });
            
            containersList.appendChild(groupDiv);
        }
    });
}

async function selectContainer(containerId, containerName, containerStatus) {
    // Stop any existing log following
    stopFollowingLogs();
    
    selectedContainerId = containerId;
    selectedContainerStatus = containerStatus;
    previousLogLines = [];
    displayedLineCount = 0;
    lastLogContent = '';
    isInitialLoad = true;
    
    // Update UI
    document.querySelectorAll('.container-item').forEach(item => {
        item.classList.remove('selected');
        if (item.dataset.containerId === containerId) {
            item.classList.add('selected');
        }
    });
    
    document.getElementById('selected-container-name').textContent = containerName;
    
    // Update button states based on container status
    updateContainerButtonStates(containerStatus);
    
    await loadContainerLogs(true);
    
    // Automatically start following logs
    startFollowingLogs();
}

function updateContainerButtonStates(status) {
    const isRunning = status && status.startsWith('Up');
    const startBtn = document.getElementById('start-container');
    const stopBtn = document.getElementById('stop-container');
    const restartBtn = document.getElementById('restart-container');
    
    // Start button: disabled when running
    startBtn.disabled = isRunning;
    
    // Stop and Restart buttons: disabled when not running
    stopBtn.disabled = !isRunning;
    restartBtn.disabled = !isRunning;
}

async function refreshContainerStatus() {
    if (!selectedContainerId) return;
    
    const result = await ipcRenderer.invoke('docker:list-containers');
    if (result.error || !result.containers) return;
    
    const container = result.containers.find(c => c.Id === selectedContainerId);
    if (container) {
        selectedContainerStatus = container.Status;
        updateContainerButtonStates(container.Status);
    }
}

function cleanLogLine(line) {
    if (line.trim() === '') return '';
    
    let cleaned = line;
    
    // Remove ANSI escape codes (color codes, formatting, etc.)
    // Matches patterns like [32m, [0m, [1m, [36m, [31m, [33m, etc.
    cleaned = cleaned.replace(/\x1b\[[0-9;]*m/g, '');
    cleaned = cleaned.replace(/\033\[[0-9;]*m/g, '');
    cleaned = cleaned.replace(/\[[0-9;]*m/g, '');
    
    // Remove the full Docker log prefix pattern in one go:
    // Control char + timestamp + IP + HTTP log format
    // Pattern:2025-11-13T20:55:49.326542660Z 172.18.0.1 - - [13/Nov/2025:20:55:49 +0000] "
    cleaned = cleaned.replace(/^[\x00-\x1F\x7F-\x9F]*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s+\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\s+-\s+-\s+\[\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2}\s+\+\d{4}\]\s+"?\s*/, '');
    
    // Also handle cases where some parts might be missing (fallback patterns)
    // Remove standalone timestamp at start
    cleaned = cleaned.replace(/^[\x00-\x1F\x7F-\x9F]*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s*/, '');
    
    // Remove IP address patterns at the start (e.g., "172.18.0.1 - -")
    cleaned = cleaned.replace(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\s+-\s+-\s+/, '');
    
    // Remove HTTP log format: [DD/Mon/YYYY:HH:mm:ss +0000] "
    cleaned = cleaned.replace(/^\[\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2}\s+\+\d{4}\]\s+"?\s*/, '');
    
    // Remove log level prefixes like "INFO: " or "ERROR: "
    cleaned = cleaned.replace(/^(INFO|ERROR|WARN|DEBUG|TRACE):\s*/, '');
    
    // Remove IP:port patterns at the start (e.g., "172.18.0.5:59410 - ")
    cleaned = cleaned.replace(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+\s+-\s+/, '');
    
    // Remove any remaining control characters at the start
    cleaned = cleaned.replace(/^[\x00-\x1F\x7F-\x9F]+/, '');
    
    // Remove non-ASCII characters (keep only ASCII 32-126: printable characters)
    cleaned = cleaned.replace(/[^\x20-\x7E]/g, '');
    
    // Remove any remaining leading whitespace
    cleaned = cleaned.trimStart();
    
    return cleaned;
}

function formatLogLine(line) {
    const cleaned = cleanLogLine(line);
    if (cleaned === '') return '';
    
    if (cleaned.includes('ERROR') || cleaned.includes('error')) {
        return `<span style="color: #ff7f7f">${escapeHtml(cleaned)}</span>`;
    } else if (cleaned.includes('WARN') || cleaned.includes('warn')) {
        return `<span style="color: #ffff7f">${escapeHtml(cleaned)}</span>`;
    } else {
        return escapeHtml(cleaned);
    }
}

function isAtBottom(element) {
    const threshold = 50; // pixels from bottom
    return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
}

async function loadContainerLogs(forceReload = false) {
    if (!selectedContainerId) return;
    
    const logOutput = document.getElementById('container-logs');
    const tailLines = 100; // Fixed to 100 lines
    
    // Check if user is at bottom before updating
    const wasAtBottom = isAtBottom(logOutput);
    
    // Show loading only on initial load or force reload
    if (isInitialLoad || forceReload) {
        logOutput.innerHTML = '<p class="loading">Loading logs...</p>';
    }
    
    const result = await ipcRenderer.invoke('docker:get-logs', selectedContainerId, tailLines);
    
    if (result.error) {
        logOutput.innerHTML = `<p class="error">Error: ${result.error}</p>`;
        previousLogLines = [];
        displayedLineCount = 0;
        lastLogContent = '';
        isInitialLoad = true;
        return;
    }
    
    // Parse new logs (filter out empty lines after cleaning)
    const rawLines = result.logs.split('\n');
    const newLines = rawLines.map(line => cleanLogLine(line)).filter(line => line.trim() !== '');
    
    if (isInitialLoad || forceReload || displayedLineCount === 0) {
        // Initial load or force reload - replace all content
        const formattedContent = newLines.map(formatLogLine).join('\n');
        logOutput.innerHTML = formattedContent;
        displayedLineCount = newLines.length;
        previousLogLines = newLines;
        lastLogContent = result.logs;
        isInitialLoad = false;
        logOutput.scrollTop = logOutput.scrollHeight;
    } else {
        // Incremental update - check for new content by comparing with previous
        const currentLogContent = result.logs;
        
        // If logs were cleared, only show content that's NEWER than what we had before clearing
        if (lastLogContentBeforeClear && displayedLineCount === 0) {
            // We cleared logs, so find where new content starts
            const beforeClearLines = lastLogContentBeforeClear.split('\n').map(line => cleanLogLine(line)).filter(line => line.trim() !== '');
            
            if (beforeClearLines.length > 0) {
                // Find the last line we had before clearing in the new content
                const lastLineBeforeClear = beforeClearLines[beforeClearLines.length - 1];
                let startIndex = 0;
                
                for (let i = 0; i < newLines.length; i++) {
                    if (newLines[i] === lastLineBeforeClear) {
                        startIndex = i + 1;
                        break;
                    }
                }
                
                // Only show lines after the clear point
                if (startIndex < newLines.length) {
                    const newContentLines = newLines.slice(startIndex);
                    const newContent = newContentLines.map(formatLogLine).join('\n');
                    
                    if (newContent) {
                        // Replace the "waiting for new logs" message with actual new content
                        logOutput.innerHTML = newContent;
                        displayedLineCount = newContentLines.length;
                        previousLogLines = newContentLines;
                        lastLogContentBeforeClear = ''; // Reset clear flag
                        
                        if (wasAtBottom) {
                            logOutput.scrollTop = logOutput.scrollHeight;
                        }
                    } else {
                        // No new content yet, keep showing the placeholder
                        return;
                    }
                } else {
                    // No new content yet, keep showing the placeholder
                    return;
                }
            }
        } else if (currentLogContent !== lastLogContent) {
            // Normal incremental update - find and append new lines
            let startIndex = 0;
            
            // Try to find the last displayed line in the new content
            if (previousLogLines.length > 0) {
                const lastDisplayedLine = previousLogLines[previousLogLines.length - 1];
                for (let i = 0; i < newLines.length; i++) {
                    if (newLines[i] === lastDisplayedLine) {
                        startIndex = i + 1;
                        break;
                    }
                }
            }
            
            // If we found new lines, append them
            if (startIndex < newLines.length) {
                const newContentLines = newLines.slice(startIndex);
                const newContent = newContentLines.map(formatLogLine).join('\n');
                
                if (newContent) {
                    // Append new content without replacing existing
                    const currentContent = logOutput.innerHTML;
                    // Only add newline if current content doesn't end with one
                    const separator = currentContent && !currentContent.endsWith('\n') && !currentContent.endsWith('<br>') && !currentContent.includes('waiting for new logs') ? '\n' : '';
                    // Remove placeholder if it exists
                    const contentToAppend = currentContent.includes('waiting for new logs') ? newContent : currentContent + separator + newContent;
                    logOutput.innerHTML = contentToAppend;
                    
                    // Only auto-scroll if user was at bottom
                    if (wasAtBottom) {
                        logOutput.scrollTop = logOutput.scrollHeight;
                    }
                }
                
                displayedLineCount = newLines.length;
            }
        }
        
        // Update tracking variables
        previousLogLines = newLines.slice(-tailLines);
        lastLogContent = currentLogContent;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Event listeners for Docker
document.getElementById('refresh-containers').addEventListener('click', loadContainers);

document.getElementById('start-container').addEventListener('click', async () => {
    if (!selectedContainerId) {
        alert('Please select a container first');
        return;
    }
    
    const button = document.getElementById('start-container');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Starting...';
    
    try {
        const result = await ipcRenderer.invoke('docker:start-container', selectedContainerId);
        if (result.error) {
            alert(`Error starting container: ${result.error}`);
        } else {
            // Refresh container status and reload logs
            await refreshContainerStatus();
            await loadContainers(); // Refresh container list
            previousLogLines = [];
            displayedLineCount = 0;
            lastLogContent = '';
            isInitialLoad = true;
            await loadContainerLogs(true);
        }
    } catch (error) {
        alert(`Error: ${error.message}`);
    } finally {
        button.disabled = false;
        button.textContent = originalText;
    }
});

document.getElementById('stop-container').addEventListener('click', async () => {
    if (!selectedContainerId) {
        alert('Please select a container first');
        return;
    }
    
    const button = document.getElementById('stop-container');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Stopping...';
    
    try {
        const result = await ipcRenderer.invoke('docker:stop-container', selectedContainerId);
        if (result.error) {
            alert(`Error stopping container: ${result.error}`);
        } else {
            // Refresh container status and reload logs
            await refreshContainerStatus();
            await loadContainers(); // Refresh container list
            previousLogLines = [];
            displayedLineCount = 0;
            lastLogContent = '';
            isInitialLoad = true;
            await loadContainerLogs(true);
        }
    } catch (error) {
        alert(`Error: ${error.message}`);
    } finally {
        button.disabled = false;
        button.textContent = originalText;
    }
});

document.getElementById('restart-container').addEventListener('click', async () => {
    if (!selectedContainerId) {
        alert('Please select a container first');
        return;
    }
    
    const button = document.getElementById('restart-container');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Restarting...';
    
    try {
        const result = await ipcRenderer.invoke('docker:restart-container', selectedContainerId);
        if (result.error) {
            alert(`Error restarting container: ${result.error}`);
        } else {
            // Refresh container status and reload logs
            await refreshContainerStatus();
            await loadContainers(); // Refresh container list
            previousLogLines = [];
            displayedLineCount = 0;
            lastLogContent = '';
            isInitialLoad = true;
            await loadContainerLogs(true);
        }
    } catch (error) {
        alert(`Error: ${error.message}`);
    } finally {
        button.disabled = false;
        button.textContent = originalText;
    }
});

document.getElementById('clear-logs').addEventListener('click', () => {
    const logOutput = document.getElementById('container-logs');
    logOutput.innerHTML = '<p class="placeholder">Logs cleared - waiting for new logs...</p>';
    
    // Save the last log content before clearing so we can detect new logs
    lastLogContentBeforeClear = lastLogContent;
    
    // Reset display tracking but keep lastLogContent to compare against
    previousLogLines = [];
    displayedLineCount = 0;
    isInitialLoad = true;
});

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

async function loadSettings() {
    // Load saved repository path from config file via IPC
    const saved = await ipcRenderer.invoke('config:get-git-repo-path');
    const savedRepoPath = saved.path;
    
    if (document.getElementById('settings-repo-path')) {
        if (savedRepoPath) {
            document.getElementById('settings-repo-path').value = savedRepoPath;
        } else {
            document.getElementById('settings-repo-path').value = '';
        }
    }
    
    // Update status
    await updateSettingsRepoStatus();
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
                    loadSettings();
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
        
        const localList = document.createElement('div');
        localList.className = 'branch-group-list';
        
        localBranches.forEach(branch => {
            const item = document.createElement('div');
            item.className = `branch-item ${branch.current ? 'current' : ''}`;
            item.dataset.branchName = branch.name;
            item.dataset.branchType = 'local';
            
            item.innerHTML = `
                <span class="branch-name">${escapeHtml(branch.name)}</span>
                ${branch.current ? '<span class="branch-indicator">current</span>' : ''}
            `;
            
            if (!branch.current) {
                item.addEventListener('click', () => checkoutBranch(branch.name));
            }
            
            // Add right-click context menu (only for local branches)
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showBranchContextMenu(e, branch.name, branch.current);
            });
            
            localList.appendChild(item);
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
            
            // Clicking a remote branch will checkout and track it
            item.addEventListener('click', () => checkoutRemoteBranch(branch.fullName, branch.name));
            
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
    if (!confirm(`Switch to branch "${branchName}"?`)) {
        return;
    }
    
    const result = await ipcRenderer.invoke('git:checkout-branch', branchName);
    
    if (result.error) {
        alert(`Error switching branch: ${result.error}`);
    } else {
        await loadBranches();
        await loadCommitFiles();
    }
}

async function checkoutRemoteBranch(remoteBranchName, localBranchName) {
    if (!confirm(`Checkout and track remote branch "${localBranchName}"?`)) {
        return;
    }
    
    const result = await ipcRenderer.invoke('git:checkout-remote-branch', remoteBranchName, localBranchName);
    
    if (result.error) {
        alert(`Error checking out remote branch: ${result.error}`);
    } else {
        await loadBranches();
        await loadCommitFiles();
    }
}

function showBranchContextMenu(e, branchName, isCurrent) {
    const contextMenu = document.getElementById('branch-context-menu');
    if (!contextMenu) return;
    
    // Hide delete option for current branch
    const deleteItem = document.getElementById('context-delete-branch');
    if (deleteItem) {
        deleteItem.style.display = isCurrent ? 'none' : 'block';
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

async function deleteBranch(branchName) {
    if (!confirm(`Are you sure you want to delete branch "${branchName}"?\n\nThis action cannot be undone.`)) {
        return;
    }
    
    // Check if branch has unmerged changes
    const force = confirm('Force delete? (Use this if the branch has unmerged changes)');
    
    const result = await ipcRenderer.invoke('git:delete-branch', branchName, force);
    
    if (result.error) {
        alert(`Error deleting branch: ${result.error}`);
    } else {
        await loadBranches();
        await loadCommitFiles();
        alert(`Branch "${branchName}" deleted successfully!`);
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
                    loadSettings();
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
                alert(`Error: ${result.error}`);
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
                alert(`Error: ${result.error}`);
            } else {
                await loadCommitFiles(); // Refresh commit tab file lists
            }
        });
    });
}

async function loadGitLogs() {
    const logsContent = document.getElementById('git-logs-content');
    
    if (!logsContent) {
        return;
    }
    
    logsContent.innerHTML = '<p class="loading">Loading commit history...</p>';
    
    try {
        const result = await ipcRenderer.invoke('git:get-logs', 50);
        
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
                        loadSettings();
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
        
        let html = '';
        result.logs.forEach(commit => {
            html += `
                <div class="commit-log-item">
                    <div class="commit-hash">${commit.hash ? commit.hash.substring(0, 7) : 'N/A'}</div>
                    <div class="commit-message">${escapeHtml(commit.message || 'No message')}</div>
                    <div class="commit-author">${commit.author_name || 'Unknown'} &lt;${commit.author_email || 'unknown'}&gt; - ${commit.date ? new Date(commit.date).toLocaleString() : 'Unknown date'}</div>
                </div>
            `;
        });
        
        logsContent.innerHTML = html;
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
                                alert(`Error: ${result.error}`);
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
                            alert(`Error: ${error.message}`);
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
                
                return `<div class="file-item-clickable" data-file="${file.path}" data-staged="false" style="padding: 4px 8px; margin: 2px 0; background: rgba(255, 255, 127, 0.1); border-left: 2px solid #ffff7f; font-size: 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                    <span>${statusIcon} ${file.path}</span>
                    <button class="btn btn-small btn-primary stage-file-from-commit" data-file="${file.path}" style="padding: 2px 8px; font-size: 11px; margin-left: 8px;" onclick="event.stopPropagation();">Stage</button>
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
                            alert(`Error: ${result.error}`);
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
                        alert(`Error: ${error.message}`);
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
                        loadSettings();
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

async function commitAndPush() {
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
        const commitResult_data = await ipcRenderer.invoke('git:commit', commitMessage);
        
        if (commitResult_data.error) {
            if (commitResult_data.error.includes('not initialized')) {
                commitResult.innerHTML = `
                    <p class="error">Error: ${commitResult_data.error}</p>
                    <p style="margin-top: 10px; font-size: 12px;">
                        <a href="#" id="open-settings-from-commit-push" style="color: #4a9eff; text-decoration: underline; cursor: pointer;">
                            Configure repository in settings
                        </a>
                    </p>
                `;
                const settingsLink = document.getElementById('open-settings-from-commit-push');
                if (settingsLink) {
                    settingsLink.addEventListener('click', (e) => {
                        e.preventDefault();
                        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                        document.querySelector('[data-tab="settings"]').classList.add('active');
                        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
                        document.getElementById('settings-tab').classList.add('active');
                        loadSettings();
                    });
                }
            } else {
                commitResult.innerHTML = `<p class="error">Error: ${commitResult_data.error}</p>`;
            }
            return;
        }
        
        commitResult.innerHTML = '<p class="loading">Pushing...</p>';
        
        const pushResult = await ipcRenderer.invoke('git:push');
        
        if (pushResult.error) {
            commitResult.innerHTML = `<p class="error">Commit successful but push failed: ${pushResult.error}</p>`;
            return;
        }
        
        commitResult.innerHTML = '<p class="success">✓ Commit and push successful!</p>';
        message.value = '';
        await loadBranches();
        await loadCommitFiles(); // Refresh file lists after commit
        await loadGitLogs(); // Refresh logs to show the new commit
    } catch (error) {
        commitResult.innerHTML = `<p class="error">Error: ${error.message}</p>`;
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
        alert('Invalid branch name. Branch names can only contain letters, numbers, dots, underscores, slashes, and hyphens.');
        return;
    }
    
    try {
        const result = await ipcRenderer.invoke('git:create-branch', trimmedName);
        
        if (result.error) {
            alert(`Error creating branch: ${result.error}`);
        } else {
            // Refresh branches and checkout the new branch
            await loadBranches();
            await loadCommitFiles();
            alert(`Branch "${trimmedName}" created and checked out successfully!`);
        }
    } catch (error) {
        alert(`Error: ${error.message}`);
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
            alert('Failed to save repository path to config file!');
            return;
        }
        
        // Verify immediately
        const verify = await ipcRenderer.invoke('config:get-git-repo-path');
        if (verify.path !== finalPath) {
            alert('Saved but verification failed! Expected: ' + finalPath + ' Got: ' + verify.path);
            return;
        }
        
    } catch (error) {
        alert('Error saving repository path: ' + error.message);
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
            // Always try to load logs, let the function handle errors gracefully
            loadGitLogs();
        } else if (tabName === 'commit') {
            // Load staged/unstaged files for commit tab
            loadCommitFiles();
        }
    });
});
document.getElementById('commit-btn').addEventListener('click', commitChanges);
document.getElementById('commit-push-btn').addEventListener('click', commitAndPush);

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

function createBranchFromModal() {
    const input = document.getElementById('branch-name-input');
    if (!input) return;
    
    const branchName = input.value.trim();
    if (!branchName) {
        alert('Please enter a branch name.');
        return;
    }
    
    if (!/^[a-zA-Z0-9._/-]+$/.test(branchName)) {
        alert('Invalid branch name. Branch names can only contain letters, numbers, dots, underscores, slashes, and hyphens.');
        return;
    }
    
    hideBranchNameModal();
    
    ipcRenderer.invoke('git:create-branch', branchName).then(result => {
        if (result.error) {
            alert(`Error creating branch: ${result.error}`);
        } else {
            loadBranches().then(() => {
                loadCommitFiles().then(() => {
                    alert(`Branch "${branchName}" created and checked out successfully!`);
                });
            });
        }
    }).catch(error => {
        alert(`Error: ${error.message}`);
    });
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

// Set up context menu delete handler
function setupContextMenuHandler() {
    const contextDeleteBranch = document.getElementById('context-delete-branch');
    if (contextDeleteBranch) {
        contextDeleteBranch.onclick = (e) => {
            const branchName = e.target.dataset.branchName;
            if (branchName) {
                deleteBranch(branchName);
                const contextMenu = document.getElementById('branch-context-menu');
                if (contextMenu) {
                    contextMenu.style.display = 'none';
                }
            }
        };
        return true;
    }
    return false;
}

if (!setupContextMenuHandler()) {
    setTimeout(() => setupContextMenuHandler(), 100);
}

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

// Git branch buttons
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


// Initialize on load
loadContainers();

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

// Initialize button states (all disabled until container is selected)
document.getElementById('start-container').disabled = true;
document.getElementById('stop-container').disabled = true;
document.getElementById('restart-container').disabled = true;

