const { ipcRenderer } = require('electron');
const { escapeRegExp, escapeHtml } = require('../renderer/core/utils');

function createDockerView() {
// Docker functionality
let selectedContainerId = null;
let selectedContainerStatus = null;
let logFollowInterval = null;
let previousLogLines = [];
let displayedLineCount = 0;
let isInitialLoad = true;
let lastLogContent = '';
let lastLogContentBeforeClear = '';
let lastRenderedLogHtml = '';
let logSearchTerm = '';
let logSearchMatchCount = 0;
let logSearchCurrentIndex = -1;

const initialLogOutputElement = document.getElementById('container-logs');
if (initialLogOutputElement) {
    lastRenderedLogHtml = initialLogOutputElement.innerHTML;
}

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

function renderLogContent(content = '', options = {}) {
    const logOutput = document.getElementById('container-logs');
    if (!logOutput) return;
    
    const { scrollToBottom = false, preserveScroll = false, scrollToActiveMatch = false } = options;
    let previousScrollOffset = 0;
    
    if (preserveScroll) {
        previousScrollOffset = logOutput.scrollHeight - logOutput.scrollTop;
    }
    
    lastRenderedLogHtml = content ?? '';
    const highlightedContent = applyLogSearchHighlight(lastRenderedLogHtml);
    logOutput.innerHTML = highlightedContent;
    updateLogSearchActiveHighlight();
    
    if (scrollToBottom) {
        logOutput.scrollTop = logOutput.scrollHeight;
    } else if (preserveScroll) {
        const newScrollTop = Math.max(logOutput.scrollHeight - previousScrollOffset, 0);
        logOutput.scrollTop = newScrollTop;
    }
    
    if (scrollToActiveMatch) {
        scrollToActiveLogMatch();
    }
}

function applyLogSearchHighlight(content) {
    const baseContent = content || '';
    logSearchMatchCount = 0;
    
    if (!logSearchTerm) {
        logSearchCurrentIndex = -1;
        updateLogSearchStatus();
        updateLogSearchControls();
        return baseContent;
    }
    
    const regex = new RegExp(`(${escapeRegExp(logSearchTerm)})`, 'gi');
    const highlighted = baseContent.replace(regex, (match) => {
        const wrapped = `<mark class="log-search-highlight" data-match-index="${logSearchMatchCount}">${match}</mark>`;
        logSearchMatchCount += 1;
        return wrapped;
    });
    
    if (logSearchMatchCount === 0) {
        logSearchCurrentIndex = -1;
    } else {
        if (logSearchCurrentIndex === -1) {
            logSearchCurrentIndex = 0;
        } else if (logSearchCurrentIndex >= logSearchMatchCount) {
            logSearchCurrentIndex = logSearchMatchCount - 1;
        }
    }
    
    updateLogSearchStatus();
    updateLogSearchControls();
    return highlighted;
}

function updateLogSearchStatus() {
    const statusElement = document.getElementById('log-search-count');
    if (!statusElement) return;
    
    if (!logSearchTerm) {
        statusElement.textContent = 'No search';
        return;
    }
    
    if (logSearchMatchCount === 0) {
        statusElement.textContent = '0 matches';
        return;
    }
    
    const currentDisplay = Math.max(logSearchCurrentIndex, 0) + 1;
    statusElement.textContent = `Match ${currentDisplay}/${logSearchMatchCount}`;
}

function updateLogSearchControls() {
    const prevBtn = document.getElementById('log-search-prev');
    const nextBtn = document.getElementById('log-search-next');
    const hasMatches = Boolean(logSearchTerm) && logSearchMatchCount > 0;
    
    if (prevBtn) prevBtn.disabled = !hasMatches;
    if (nextBtn) nextBtn.disabled = !hasMatches;
}

function updateLogSearchActiveHighlight() {
    const logOutput = document.getElementById('container-logs');
    if (!logOutput) return;
    
    const highlights = logOutput.querySelectorAll('.log-search-highlight');
    highlights.forEach(el => el.classList.remove('log-search-highlight-active'));
    
    if (!logSearchTerm || logSearchMatchCount === 0) {
        return;
    }
    
    const targetIndex = Math.min(Math.max(logSearchCurrentIndex, 0), highlights.length - 1);
    logSearchCurrentIndex = targetIndex;
    const target = highlights[targetIndex];
    if (target) {
        target.classList.add('log-search-highlight-active');
    }
}

function scrollToActiveLogMatch() {
    if (!logSearchTerm || logSearchMatchCount === 0) return;
    
    const logOutput = document.getElementById('container-logs');
    if (!logOutput) return;
    
    const highlights = logOutput.querySelectorAll('.log-search-highlight');
    const target = highlights[logSearchCurrentIndex];
    if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({
            behavior: 'auto',
            block: 'center'
        });
    }
}

function focusNextLogSearchMatch() {
    if (!logSearchTerm || logSearchMatchCount === 0) return;
    
    logSearchCurrentIndex = (logSearchCurrentIndex + 1) % logSearchMatchCount;
    renderLogContent(lastRenderedLogHtml, { preserveScroll: true, scrollToActiveMatch: true });
}

function focusPreviousLogSearchMatch() {
    if (!logSearchTerm || logSearchMatchCount === 0) return;
    
    logSearchCurrentIndex = (logSearchCurrentIndex - 1 + logSearchMatchCount) % logSearchMatchCount;
    renderLogContent(lastRenderedLogHtml, { preserveScroll: true, scrollToActiveMatch: true });
}

function handleLogSearchInput(event) {
    logSearchTerm = event.target.value || '';
    logSearchCurrentIndex = logSearchTerm ? 0 : -1;
    renderLogContent(lastRenderedLogHtml, { preserveScroll: true, scrollToActiveMatch: true });
}

function clearLogSearch() {
    logSearchTerm = '';
    logSearchCurrentIndex = -1;
    renderLogContent(lastRenderedLogHtml, { preserveScroll: true });
    updateLogSearchStatus();
    updateLogSearchControls();
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
    
    let result;
    try {
        result = await ipcRenderer.invoke('docker:get-logs', selectedContainerId, tailLines);
    } catch (error) {
        const errorHtml = `<p class="error">Error: ${escapeHtml(error.message || 'Failed to load logs')}</p>`;
        renderLogContent(errorHtml);
        previousLogLines = [];
        displayedLineCount = 0;
        lastLogContent = '';
        isInitialLoad = true;
        return;
    }
    
    if (result.error) {
        const errorHtml = `<p class="error">Error: ${escapeHtml(result.error)}</p>`;
        renderLogContent(errorHtml);
        previousLogLines = [];
        displayedLineCount = 0;
        lastLogContent = '';
        isInitialLoad = true;
        return;
    }
    
    // Handle empty/null logs
    if (!result.logs) {
        renderLogContent('<p class="placeholder">No logs available</p>', { scrollToBottom: true });
        previousLogLines = [];
        displayedLineCount = 0;
        lastLogContent = '';
        isInitialLoad = false;
        return;
    }
    
    // Parse new logs (filter out empty lines after cleaning)
    const rawLines = result.logs.split('\n');
    const newLines = rawLines.map(line => cleanLogLine(line)).filter(line => line.trim() !== '');
    
    if (isInitialLoad || forceReload || displayedLineCount === 0) {
        // Initial load or force reload - replace all content
        const formattedContent = newLines.map(formatLogLine).join('\n');
        renderLogContent(formattedContent, { scrollToBottom: true });
        displayedLineCount = newLines.length;
        previousLogLines = newLines;
        lastLogContent = result.logs;
        isInitialLoad = false;
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
                        renderLogContent(newContent, { scrollToBottom: wasAtBottom });
                        displayedLineCount = newContentLines.length;
                        previousLogLines = newContentLines;
                        lastLogContentBeforeClear = ''; // Reset clear flag
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
                    const currentContent = lastRenderedLogHtml || '';
                    let updatedContent = newContent;
                    
                    if (currentContent && !currentContent.includes('waiting for new logs')) {
                        const needsSeparator = !currentContent.endsWith('\n') && !currentContent.endsWith('<br>');
                        const separator = needsSeparator ? '\n' : '';
                        updatedContent = currentContent + separator + newContent;
                    }
                    
                    renderLogContent(updatedContent, { scrollToBottom: wasAtBottom });
                }
                
                displayedLineCount = newLines.length;
            }
        }
        
        // Update tracking variables
        previousLogLines = newLines.slice(-tailLines);
        lastLogContent = currentLogContent;
    }
}

// Event listeners for Docker
document.getElementById('refresh-containers').addEventListener('click', loadContainers);

const logSearchInputElement = document.getElementById('log-search-input');
if (logSearchInputElement) {
    logSearchInputElement.addEventListener('input', handleLogSearchInput);
}

const logSearchPrevButton = document.getElementById('log-search-prev');
if (logSearchPrevButton) {
    logSearchPrevButton.addEventListener('click', focusPreviousLogSearchMatch);
}

const logSearchNextButton = document.getElementById('log-search-next');
if (logSearchNextButton) {
    logSearchNextButton.addEventListener('click', focusNextLogSearchMatch);
}

const logSearchClearButton = document.getElementById('log-search-clear');
if (logSearchClearButton) {
    logSearchClearButton.addEventListener('click', () => {
        if (logSearchInputElement) {
            logSearchInputElement.value = '';
            logSearchInputElement.focus();
        }
        clearLogSearch();
    });
}

updateLogSearchStatus();
updateLogSearchControls();

document.getElementById('start-container').addEventListener('click', async () => {
    if (!selectedContainerId) {
        await window.showAlert('No Container Selected', 'Please select a container first');
        return;
    }
    
    const button = document.getElementById('start-container');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Starting...';
    
    try {
        const result = await ipcRenderer.invoke('docker:start-container', selectedContainerId);
        if (result.error) {
            await window.showAlert('Error', `Error starting container: ${result.error}`);
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
        await window.showAlert('Error', `Error: ${error.message}`);
    } finally {
        button.disabled = false;
        button.textContent = originalText;
    }
});

document.getElementById('stop-container').addEventListener('click', async () => {
    if (!selectedContainerId) {
        await window.showAlert('No Container Selected', 'Please select a container first');
        return;
    }
    
    const button = document.getElementById('stop-container');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Stopping...';
    
    try {
        const result = await ipcRenderer.invoke('docker:stop-container', selectedContainerId);
        if (result.error) {
            await window.showAlert('Error', `Error stopping container: ${result.error}`);
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
        await window.showAlert('Error', `Error: ${error.message}`);
    } finally {
        button.disabled = false;
        button.textContent = originalText;
    }
});

document.getElementById('restart-container').addEventListener('click', async () => {
    if (!selectedContainerId) {
        await window.showAlert('No Container Selected', 'Please select a container first');
        return;
    }
    
    const button = document.getElementById('restart-container');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Restarting...';
    
    try {
        const result = await ipcRenderer.invoke('docker:restart-container', selectedContainerId);
        if (result.error) {
            await window.showAlert('Error', `Error restarting container: ${result.error}`);
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
        await window.showAlert('Error', `Error: ${error.message}`);
    } finally {
        button.disabled = false;
        button.textContent = originalText;
    }
});

document.getElementById('clear-logs').addEventListener('click', () => {
    renderLogContent('<p class="placeholder">Logs cleared - waiting for new logs...</p>');
    
    // Save the last log content before clearing so we can detect new logs
    lastLogContentBeforeClear = lastLogContent;
    
    // Reset display tracking but keep lastLogContent to compare against
    previousLogLines = [];
    displayedLineCount = 0;
    isInitialLoad = true;
});


    return {
        loadContainers,
        startFollowingLogs,
        stopFollowingLogs,
        hasSelection: () => Boolean(selectedContainerId),
    };
}

module.exports = { createDockerView };
