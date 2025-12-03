const { ipcRenderer } = require('electron');
const path = require('path');
const {
    showAlert,
    showConfirm,
    showPrompt,
    registerNativeOverrides,
} = require('./renderer/core/modals');
const {
    escapeRegExp,
    escapeHtml,
} = require('./renderer/core/utils');
const { createDockerView } = require('./views/docker');
const { createGitView } = require('./views/git');
const { createDatabaseView } = require('./views/database');
const { createDiagramView } = require('./views/diagram');

registerNativeOverrides();
window.showAlert = showAlert;
window.showConfirm = showConfirm;
window.showPrompt = showPrompt;
window.escapeRegExp = escapeRegExp;
window.escapeHtml = escapeHtml;
const dockerView = createDockerView();
window.dockerView = dockerView;
const databaseView = createDatabaseView();
window.databaseView = databaseView;
const gitView = createGitView();
window.gitView = gitView;
const diagramView = createDiagramView();
window.diagramView = diagramView;

// Tab switching
document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
        const tabName = button.dataset.tab;
        
        // Stop following logs when switching away from Docker tab
        if (tabName !== 'docker' && window.dockerView) {
            window.dockerView.stopFollowingLogs();
        }
        
        // Update tab buttons
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        
        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.getElementById(`${tabName}-tab`).classList.add('active');
        
        // Load data when switching tabs
        if (tabName === 'docker') {
            if (window.dockerView) {
                window.dockerView.loadContainers();
                if (window.dockerView.hasSelection()) {
                    window.dockerView.startFollowingLogs();
                }
            }
        } else if (tabName === 'git') {
            if (window.gitView) {
                // Always try to load, let the functions handle errors gracefully
                window.gitView.loadBranches();
                window.gitView.loadCommitFiles();
                // Apply commit template if commit tab is active
                const commitTab = document.getElementById('git-commit-tab');
                if (commitTab && commitTab.classList.contains('active')) {
                    if (window.gitView.applyCommitTemplate) {
                        window.gitView.applyCommitTemplate();
                    }
                }
                // Re-setup the create branch button in case it was recreated
                if (window.gitView.setupCreateBranchButton) {
                    window.gitView.setupCreateBranchButton();
                }
            }
        } else if (tabName === 'diagraming') {
            if (window.diagramView) {
                window.diagramView.initialize();
            }
        } else if (tabName === 'notes') {
            initializeNotesEditor();
        } else if (tabName === 'database') {
            if (window.databaseView) {
                window.databaseView.initialize();
            }
        } else if (tabName === 'settings') {
            loadSettings();
        }
    });
});

// Git inner tab switching is handled in event listeners section below


// Docker view code moved to views/docker.js

// Git view code moved to views/git.js

// Placeholder to maintain compatibility
async function setRepository(repoPath = null) {
    if (window.gitView && window.gitView.setRepository) {
        return await window.gitView.setRepository(repoPath);
    }
    return false;
}

// Database view code moved to views/database.js

// Initialize on load
if (window.dockerView) {
    window.dockerView.loadContainers();
}

// Auto-initialize git repository on startup
if (window.gitView && window.gitView.initialize) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => window.gitView.initialize(), 500);
        });
    } else {
        setTimeout(() => window.gitView.initialize(), 500);
    }
}

// Initialize button states (all disabled until container is selected)
document.getElementById('start-container').disabled = true;
document.getElementById('stop-container').disabled = true;
document.getElementById('restart-container').disabled = true;

// Load settings function
async function loadSettings() {
    try {
        // Load git repo path
        const repoResult = await ipcRenderer.invoke('config:get-git-repo-path');
        const repoInput = document.getElementById('settings-repo-path');
        if (repoInput && repoResult.path) {
            repoInput.value = repoResult.path;
        }
        
        // Load commit template
        const templateResult = await ipcRenderer.invoke('config:get-commit-template');
        const templateInput = document.getElementById('settings-commit-template');
        if (templateInput && templateResult.template) {
            templateInput.value = templateResult.template;
        }
        
        // Load main branch
        const branchResult = await ipcRenderer.invoke('config:get-main-branch');
        const branchInput = document.getElementById('settings-main-branch');
        if (branchInput && branchResult.branch) {
            branchInput.value = branchResult.branch;
        }
        
        // Load tab size
        const tabSizeResult = await ipcRenderer.invoke('config:get-tab-size');
        const tabSizeInput = document.getElementById('settings-tab-size');
        if (tabSizeInput) {
            tabSizeInput.value = tabSizeResult.tabSize || 4;
        }
        
        // Load diagram directory
        const diagramResult = await ipcRenderer.invoke('diagram:get-directory');
        const diagramInput = document.getElementById('settings-diagram-directory');
        if (diagramInput && diagramResult.directory) {
            diagramInput.value = diagramResult.directory;
        }
        
        // Load notes directory
        const notesResult = await ipcRenderer.invoke('notes:get-directory');
        const notesInput = document.getElementById('settings-notes-directory');
        if (notesInput && notesResult.directory) {
            notesInput.value = notesResult.directory;
        }
        
        // Load docker regex exclusions
        const dockerRegexResult = await ipcRenderer.invoke('config:get-docker-regex-exclusions');
        const dockerRegexInput = document.getElementById('settings-docker-regex-exclusions');
        if (dockerRegexInput && dockerRegexResult.exclusions) {
            dockerRegexInput.value = dockerRegexResult.exclusions.join('\n');
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// Make loadSettings available globally
window.loadSettings = loadSettings;

// Save docker regex exclusions
document.getElementById('settings-save-docker-regex').addEventListener('click', async () => {
    const textarea = document.getElementById('settings-docker-regex-exclusions');
    const value = textarea.value.trim();
    
    // Split by newlines and filter out empty lines
    const exclusions = value.split('\n')
        .map(line => line.trim())
        .filter(line => line !== '');
    
    // Validate regex patterns
    const invalidPatterns = [];
    for (const pattern of exclusions) {
        try {
            new RegExp(pattern);
        } catch (e) {
            invalidPatterns.push(pattern);
        }
    }
    
    if (invalidPatterns.length > 0) {
        const statusDiv = document.getElementById('settings-docker-regex-status');
        if (statusDiv) {
            statusDiv.innerHTML = `<div class="error">❌ Invalid regex patterns: ${invalidPatterns.join(', ')}</div>`;
        }
        return;
    }
    
    try {
        const result = await ipcRenderer.invoke('config:set-docker-regex-exclusions', exclusions);
        const statusDiv = document.getElementById('settings-docker-regex-status');
        const button = document.getElementById('settings-save-docker-regex');
        
        if (result.success) {
            if (statusDiv) {
                statusDiv.innerHTML = '<div class="success">✓ Regex exclusions saved successfully</div>';
            }
            const originalText = button.textContent;
            button.textContent = '✓ Saved!';
            button.style.background = '#2d5a2d';
            setTimeout(() => {
                button.textContent = originalText;
                button.style.background = '';
                if (statusDiv) {
                    statusDiv.innerHTML = '';
                }
            }, 2000);
            
            // Reload logs if a container is selected
            if (window.dockerView && window.dockerView.hasSelection()) {
                // Invalidate cache and reload logs to apply the new filters
                if (window.dockerView.invalidateExclusionCache) {
                    window.dockerView.invalidateExclusionCache();
                }
                const loadContainerLogs = window.dockerView.loadContainerLogs;
                if (loadContainerLogs) {
                    await loadContainerLogs(true);
                }
            }
        } else {
            if (statusDiv) {
                statusDiv.innerHTML = `<div class="error">❌ Error: ${result.error || 'Failed to save exclusions'}</div>`;
            }
        }
    } catch (error) {
        await window.showAlert('Error', `Error saving regex exclusions: ${error.message}`);
    }
});

