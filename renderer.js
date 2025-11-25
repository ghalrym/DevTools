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

