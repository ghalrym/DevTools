const { ipcRenderer } = require('electron');
const path = require('path');
const { showAlert = window.showAlert, showConfirm = window.showConfirm, showPrompt = window.showPrompt, escapeHtml = window.escapeHtml } = window;

function createDiagramView() {
    // Diagram editor state
    let currentDiagramFilePath = null;
    let currentDiagramFileName = '';
    let mermaidInitialized = false;

function initializeMermaid() {
    if (mermaidInitialized || typeof mermaid === 'undefined') {
        return;
    }
    
    try {
        mermaid.initialize({ 
            startOnLoad: false,
            theme: 'dark',
            themeVariables: {
                primaryColor: '#4a9eff',
                primaryTextColor: '#e0e0e0',
                primaryBorderColor: '#3d3d3d',
                lineColor: '#4a9eff',
                secondaryColor: '#2d2d2d',
                tertiaryColor: '#1e1e1e'
            }
        });
        mermaidInitialized = true;
    } catch (error) {
        // Mermaid not loaded yet
    }
}

function setCurrentDiagramFile(filePath) {
    currentDiagramFilePath = filePath || null;
    currentDiagramFileName = filePath ? path.basename(filePath) : '';
    updateDiagramCurrentFileLabel();
}

function updateDiagramCurrentFileLabel() {
    const label = document.getElementById('diagram-current-file');
    if (!label) return;
    
    if (currentDiagramFilePath) {
        label.textContent = `Editing: ${currentDiagramFileName}`;
    } else {
        label.textContent = 'Unsaved diagram';
    }
}

function initializeDiagramEditor() {
    initializeMermaid();
    
    const diagramCode = document.getElementById('diagram-code');
    const diagramPreview = document.getElementById('diagram-preview');
    const clearBtn = document.getElementById('clear-diagram');
    const saveBtn = document.getElementById('save-diagram');
    const saveAsBtn = document.getElementById('save-diagram-as');
    const exportBtn = document.getElementById('export-diagram');
    const refreshDiagramsBtn = document.getElementById('refresh-diagrams');
    
    if (!diagramCode || !diagramPreview) return;
    
    // Load saved directory on init
    loadDiagramDirectory();
    
    // Render diagram on input
    let renderTimeout;
    diagramCode.addEventListener('input', () => {
        clearTimeout(renderTimeout);
        renderTimeout = setTimeout(() => {
            renderDiagram();
        }, 500); // Debounce rendering
    });
    
    // Clear button
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            diagramCode.value = '';
            diagramPreview.innerHTML = '<p class="placeholder">Enter diagram code to see preview</p>';
            setCurrentDiagramFile(null);
        });
    }
    
    // Save button
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const code = diagramCode.value.trim();
            if (!code) {
                await showAlert('Save Error', 'No diagram code to save.');
                return;
            }
            
            await saveDiagram(code);
        });
    }
    
    if (saveAsBtn) {
        saveAsBtn.addEventListener('click', async () => {
            const code = diagramCode.value.trim();
            if (!code) {
                await showAlert('Save Error', 'No diagram code to save.');
                return;
            }
            
            await saveDiagram(code, { forceNewFile: true });
        });
    }
    
    // Export button
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            const svg = diagramPreview.querySelector('svg');
            if (svg) {
                const svgData = new XMLSerializer().serializeToString(svg);
                const blob = new Blob([svgData], { type: 'image/svg+xml' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'diagram.svg';
                link.click();
                URL.revokeObjectURL(url);
            } else {
                showAlert('Export Error', 'No diagram to export. Please create a diagram first.');
            }
        });
    }
    
    // Refresh diagrams button
    if (refreshDiagramsBtn) {
        refreshDiagramsBtn.addEventListener('click', async () => {
            await loadSavedDiagrams();
        });
    }
    
    // Initial render if there's content
    if (diagramCode.value.trim()) {
        renderDiagram();
    }
    
    updateDiagramCurrentFileLabel();
}

async function loadDiagramDirectory() {
    const result = await ipcRenderer.invoke('diagram:get-directory');
    if (result.directory) {
        const diagramDirectory = document.getElementById('diagram-directory');
        if (diagramDirectory) {
            diagramDirectory.value = result.directory;
            await loadSavedDiagrams();
        }
    }
}

async function loadSavedDiagrams() {
    const savedDiagramsList = document.getElementById('saved-diagrams-list');
    
    if (!savedDiagramsList) return;
    
    const dirResult = await ipcRenderer.invoke('diagram:get-directory');
    const directory = dirResult.directory;
    
    if (!directory) {
        savedDiagramsList.innerHTML = '<p class="placeholder">Configure diagram directory in Settings</p>';
        return;
    }
    
    const result = await ipcRenderer.invoke('diagram:list-files', directory);
    
    if (result.error) {
        savedDiagramsList.innerHTML = `<p class="error">Error loading diagrams: ${result.error}</p>`;
        return;
    }
    
    const files = result.files || [];
    
    if (files.length === 0) {
        savedDiagramsList.innerHTML = '<p class="placeholder">No saved diagrams found in this directory</p>';
        return;
    }
    
    let html = '<div class="saved-diagrams-grid">';
    files.forEach(file => {
        const fileName = file.name.replace(/\.(mmd|mermaid)$/, '');
        const modifiedDate = new Date(file.modified).toLocaleString();
        html += `
            <div class="saved-diagram-item" data-file-path="${escapeHtml(file.path)}">
                <div class="saved-diagram-name">${escapeHtml(fileName)}</div>
                <div class="saved-diagram-meta">
                    <span class="saved-diagram-date">${modifiedDate}</span>
                    <span class="saved-diagram-size">${formatFileSize(file.size)}</span>
                </div>
                <div class="saved-diagram-actions">
                    <button class="btn btn-small btn-primary load-diagram-btn" data-file-path="${escapeHtml(file.path)}">Load</button>
                    <button class="btn btn-small btn-danger delete-diagram-btn" data-file-path="${escapeHtml(file.path)}">Delete</button>
                </div>
            </div>
        `;
    });
    html += '</div>';
    
    savedDiagramsList.innerHTML = html;
    
    // Attach event listeners
    savedDiagramsList.querySelectorAll('.load-diagram-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const filePath = e.target.dataset.filePath;
            await loadDiagramFromFile(filePath);
        });
    });
    
    savedDiagramsList.querySelectorAll('.delete-diagram-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const filePath = e.target.dataset.filePath;
            const fileName = path.basename(filePath);
            const confirmed = await showConfirm('Delete Diagram', `Are you sure you want to delete "${fileName}"?`);
            if (confirmed) {
                const result = await ipcRenderer.invoke('diagram:delete-file', filePath);
                if (result.error) {
                    await showAlert('Error', `Error deleting file: ${result.error}`);
                } else {
                    await loadSavedDiagrams();
                }
            }
        });
    });
}

async function loadDiagramFromFile(filePath) {
    const result = await ipcRenderer.invoke('diagram:load-file', filePath);
    if (result.error) {
        await showAlert('Error', `Error loading diagram: ${result.error}`);
    } else {
        const diagramCode = document.getElementById('diagram-code');
        if (diagramCode) {
            diagramCode.value = result.content;
            renderDiagram();
            setCurrentDiagramFile(filePath);
        }
    }
}

async function saveDiagram(code, options = {}) {
    const { forceNewFile = false } = options;
    const dirResult = await ipcRenderer.invoke('diagram:get-directory');
    const directory = dirResult.directory;
    
    if (!directory) {
        await showAlert('Save Error', 'Please configure a diagram directory in Settings first.');
        return;
    }
    
    let targetPath = !forceNewFile ? currentDiagramFilePath : null;
    
    if (!targetPath) {
        const defaultName = currentDiagramFileName
            ? currentDiagramFileName.replace(/\.(mmd|mermaid)$/i, '')
            : 'diagram';
        const fileName = await showPrompt('Save Diagram', 'Enter a name for this diagram:', defaultName);
        if (!fileName) {
            return;
        }
        
        const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        let finalFileName = sanitizedFileName;
        if (!finalFileName.toLowerCase().endsWith('.mmd')) {
            finalFileName += '.mmd';
        }
        
        targetPath = path.join(directory, finalFileName);
    }
    
    const result = await ipcRenderer.invoke('diagram:save-file', targetPath, code);
    if (result.error) {
        await showAlert('Error', `Error saving diagram: ${result.error}`);
    } else {
        setCurrentDiagramFile(targetPath);
        await showAlert('Success', `Diagram saved to ${path.basename(targetPath)}`);
        await loadSavedDiagrams();
    }
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// escapeHtml is now imported from renderer/core/utils.js


function renderDiagram() {
    const diagramCode = document.getElementById('diagram-code');
    const diagramPreview = document.getElementById('diagram-preview');
    
    if (!diagramCode || !diagramPreview) return;
    
    const code = diagramCode.value.trim();
    
    if (!code) {
        diagramPreview.innerHTML = '<p class="placeholder">Enter diagram code to see preview</p>';
        return;
    }
    
    if (typeof mermaid === 'undefined') {
        diagramPreview.innerHTML = '<p class="error">Mermaid library not loaded. Please refresh the page.</p>';
        return;
    }
    
    // Clear previous content
    diagramPreview.innerHTML = '';
    
    // Generate unique ID for this diagram
    const diagramId = 'diagram-' + Date.now();
    
    // Create a div for the diagram with the code as textContent
    const diagramDiv = document.createElement('div');
    diagramDiv.id = diagramId;
    diagramDiv.className = 'mermaid';
    diagramDiv.textContent = code;
    diagramPreview.appendChild(diagramDiv);
    
    // Render the diagram using mermaid.run() or mermaid.render()
    try {
        // Try using mermaid.run() first (for newer versions)
        if (typeof mermaid.run === 'function') {
            mermaid.run({
                nodes: [diagramDiv]
            }).catch((error) => {
                diagramPreview.innerHTML = `<p class="error">Error rendering diagram: ${error.message}</p>`;
            });
        } else {
            // Fallback to mermaid.render()
            mermaid.render(diagramId, code).then((result) => {
                diagramDiv.innerHTML = result.svg;
            }).catch((error) => {
                diagramPreview.innerHTML = `<p class="error">Error rendering diagram: ${error.message}</p>`;
            });
        }
    } catch (error) {
        diagramPreview.innerHTML = `<p class="error">Error rendering diagram: ${error.message}</p>`;
    }
}
    
    // Expose renderDiagram globally for notes preview
    window.renderDiagram = renderDiagram;
    
    return {
        initialize: initializeDiagramEditor,
        renderDiagram,
    };
}

module.exports = { createDiagramView };
