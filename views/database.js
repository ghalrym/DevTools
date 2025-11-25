const { ipcRenderer } = require('electron');
const { showAlert = window.showAlert, showConfirm = window.showConfirm, escapeHtml = window.escapeHtml } = window;

function createDatabaseView() {
    // Database viewer state
    let isDatabaseConnected = false;
    let databaseViewerInitialized = false;
    
    // Database connection management state
    let dbConnectionsCache = [];
    let activeDbConnectionId = null;
    let selectedSettingsDbConnectionId = null;
    let dbConnectionsLoaded = false;
    let dbConnectionSelectElement = null;
    
    // Tab size for query editor
    let tabSize = 4;
    
    // Load tab size from config
    async function loadTabSize() {
        try {
            const result = await ipcRenderer.invoke('config:get-tab-size');
            if (result.tabSize) {
                tabSize = result.tabSize;
            }
        } catch (error) {
            // Use default
        }
    }
    
    // Setup tab handling for query editor
    function setupTabHandling(editor) {
        if (!editor) return;
        
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
    }
    
    // Database connection management functions
    async function refreshDbConnectionsData(options = {}) {
        try {
            const result = await ipcRenderer.invoke('config:get-db-connections');
            dbConnectionsCache = Array.isArray(result.connections) ? result.connections : [];
            activeDbConnectionId = result.activeId || null;
            dbConnectionsLoaded = true;

            if (!options.skipDatabaseSelect) {
                renderDatabaseConnectionSelect();
                if (options.applyActiveToDatabaseForm) {
                    applyDbConnectionToDatabaseForm(activeDbConnectionId);
                }
            }

            if (!options.skipSettingsRender) {
                renderSettingsDbConnections();
            }
        } catch (error) {
            console.error('Failed to load database connections', error);
        }
    }

    function getDbConnectionById(id) {
        if (!id) return null;
        return dbConnectionsCache.find(conn => conn.id === id) || null;
    }

    function renderDatabaseConnectionSelect() {
        const select = document.getElementById('db-connection-select');
        if (!select) return;

        const previousValue = select.value;
        select.innerHTML = '';

        const manualOption = document.createElement('option');
        manualOption.value = '';
        manualOption.textContent = 'Manual entry';
        select.appendChild(manualOption);

        dbConnectionsCache.forEach(connection => {
            const option = document.createElement('option');
            option.value = connection.id;
            option.textContent = connection.name || `${connection.host}:${connection.port}/${connection.database}`;
            if (connection.id === activeDbConnectionId) {
                option.textContent += ' • Default';
            }
            select.appendChild(option);
        });

        if (previousValue && dbConnectionsCache.some(conn => conn.id === previousValue)) {
            select.value = previousValue;
        } else if (activeDbConnectionId && dbConnectionsCache.some(conn => conn.id === activeDbConnectionId)) {
            select.value = activeDbConnectionId;
        } else {
            select.value = '';
        }
    }

    function applyDbConnectionToDatabaseForm(connectionId = null) {
        const targetId = connectionId || activeDbConnectionId;
        const connection = getDbConnectionById(targetId);
        if (!connection) return;

        const hostInput = document.getElementById('db-host');
        const portInput = document.getElementById('db-port');
        const databaseInput = document.getElementById('db-database');
        const usernameInput = document.getElementById('db-username');
        const passwordInput = document.getElementById('db-password');

        if (hostInput) hostInput.value = connection.host || '';
        if (portInput) portInput.value = connection.port || 5432;
        if (databaseInput) databaseInput.value = connection.database || '';
        if (usernameInput) usernameInput.value = connection.username || '';
        if (passwordInput) passwordInput.value = connection.password || '';
    }

    function renderSettingsDbConnections() {
        const list = document.getElementById('settings-db-connections-list');
        if (!list) return;

        if (!dbConnectionsCache.length) {
            list.innerHTML = '<p class="placeholder" style="font-size: 12px; opacity: 0.7;">No saved connections</p>';
            selectedSettingsDbConnectionId = null;
            return;
        }

        list.innerHTML = '';

        dbConnectionsCache.forEach(connection => {
            const item = document.createElement('div');
            item.classList.add('db-connection-item');
            if (connection.id === selectedSettingsDbConnectionId) {
                item.classList.add('active');
            }
            if (connection.id === activeDbConnectionId) {
                item.classList.add('default');
            }
            item.dataset.connectionId = connection.id;
            item.innerHTML = `
                <div>
                    <div class="db-connection-name">${escapeHtml(connection.name || 'Untitled Connection')}</div>
                    <div class="db-connection-meta">${escapeHtml(`${connection.host || ''}:${connection.port || ''} • ${connection.database || ''}`)}</div>
                </div>
            `;
            item.addEventListener('click', () => {
                selectedSettingsDbConnectionId = connection.id;
                populateSettingsDbForm(connection);
                renderSettingsDbConnections();
            });
            list.appendChild(item);
        });
    }

    function populateSettingsDbForm(connection = null) {
        const nameInput = document.getElementById('settings-db-name');
        const hostInput = document.getElementById('settings-db-host');
        const portInput = document.getElementById('settings-db-port');
        const databaseInput = document.getElementById('settings-db-database');
        const usernameInput = document.getElementById('settings-db-username');
        const passwordInput = document.getElementById('settings-db-password');
        const makeDefaultCheckbox = document.getElementById('settings-db-make-default');
        const deleteButton = document.getElementById('settings-db-delete');

        if (!nameInput || !hostInput || !portInput || !databaseInput || !usernameInput || !passwordInput || !makeDefaultCheckbox) {
            return;
        }

        if (!connection) {
            nameInput.value = '';
            hostInput.value = '';
            portInput.value = 5432;
            databaseInput.value = '';
            usernameInput.value = '';
            passwordInput.value = '';
            makeDefaultCheckbox.checked = false;
            if (deleteButton) deleteButton.disabled = true;
            return;
        }

        nameInput.value = connection.name || '';
        hostInput.value = connection.host || '';
        portInput.value = connection.port || 5432;
        databaseInput.value = connection.database || '';
        usernameInput.value = connection.username || '';
        passwordInput.value = connection.password || '';
        makeDefaultCheckbox.checked = connection.id === activeDbConnectionId;
        if (deleteButton) deleteButton.disabled = false;
    }

    function resetSettingsDbForm() {
        selectedSettingsDbConnectionId = null;
        populateSettingsDbForm(null);
        renderSettingsDbConnections();
    }

    function scrollToDbSettingsSection() {
        const section = document.getElementById('settings-db-connections-section');
        if (section) {
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
    
    // Database viewer functions
    async function initializeDatabaseViewer(forceRefresh = false) {
        const connectBtn = document.getElementById('db-connect');
        const disconnectBtn = document.getElementById('db-disconnect');
        const executeBtn = document.getElementById('db-execute-query');
        const clearBtn = document.getElementById('db-clear-query');
        const queryEditor = document.getElementById('db-query-editor');
        const connectionStatus = document.getElementById('db-connection-status');
        const schemaTree = document.getElementById('db-schema-tree');

        if (!connectBtn || !queryEditor) return;

        await loadTabSize();
        await refreshDbConnectionsData({
            skipSettingsRender: true,
            applyActiveToDatabaseForm: !dbConnectionSelectElement || !dbConnectionSelectElement.value
        });

        if (databaseViewerInitialized && !forceRefresh) {
            return;
        }
        databaseViewerInitialized = true;

        // Connect button
        connectBtn.addEventListener('click', async () => {
            const host = document.getElementById('db-host').value.trim();
            const port = parseInt(document.getElementById('db-port').value) || 5432;
            const database = document.getElementById('db-database').value.trim();
            const username = document.getElementById('db-username').value.trim();
            const password = document.getElementById('db-password').value;

            if (!host || !database || !username) {
                connectionStatus.innerHTML = '<div class="error">❌ Please fill in all required fields</div>';
                return;
            }

            connectBtn.disabled = true;
            connectBtn.textContent = 'Connecting...';
            connectionStatus.innerHTML = '<div class="info">Connecting...</div>';

            const result = await ipcRenderer.invoke('db:connect', {
                host,
                port,
                database,
                username,
                password,
            });

            if (result.success) {
                isDatabaseConnected = true;
                connectBtn.style.display = 'none';
                disconnectBtn.style.display = 'block';
                connectionStatus.innerHTML = '<div class="success">✅ Connected</div>';
                schemaTree.style.display = 'block';
                await loadDatabaseTables();
            } else {
                connectionStatus.innerHTML = `<div class="error">❌ ${escapeHtml(result.error)}</div>`;
            }

            connectBtn.disabled = false;
            connectBtn.textContent = 'Connect';
        });

        // Disconnect button
        if (disconnectBtn) {
            disconnectBtn.addEventListener('click', async () => {
                const result = await ipcRenderer.invoke('db:disconnect');
                if (result.success) {
                    isDatabaseConnected = false;
                    connectBtn.style.display = 'block';
                    disconnectBtn.style.display = 'none';
                    connectionStatus.innerHTML = '<div class="info">Disconnected</div>';
                    schemaTree.style.display = 'none';
                    document.getElementById('db-tables-list').innerHTML = '<p class="placeholder">Not connected</p>';
                    document.getElementById('db-results-container').innerHTML = '<p class="placeholder">Execute a query to see results</p>';
                }
            });
        }

        // Execute query button
        if (executeBtn) {
            executeBtn.addEventListener('click', async () => {
                if (!isDatabaseConnected) {
                    await showAlert('Not Connected', 'Please connect to a database first.');
                    return;
                }

                const query = queryEditor.value.trim();
                if (!query) {
                    await showAlert('Empty Query', 'Please enter a SQL query.');
                    return;
                }

                executeBtn.disabled = true;
                executeBtn.textContent = 'Executing...';
                const statusEl = document.getElementById('db-query-status');
                statusEl.textContent = 'Executing query...';

                const result = await ipcRenderer.invoke('db:execute-query', query);

                if (result.success) {
                    displayQueryResults(result);
                    statusEl.textContent = `✓ ${result.rowCount} row(s) in ${result.duration}ms`;
                } else {
                    document.getElementById('db-results-container').innerHTML = `<div class="error">❌ Error: ${escapeHtml(result.error)}</div>`;
                    statusEl.textContent = `✗ Query failed`;
                }

                executeBtn.disabled = false;
                executeBtn.textContent = '▶ Execute';
            });
        }

        // Clear query button
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                queryEditor.value = '';
                queryEditor.focus();
            });
        }

        // Setup tab handling for query editor
        if (queryEditor) {
            setupTabHandling(queryEditor);
        }
    }

    async function loadDatabaseTables() {
        const tablesList = document.getElementById('db-tables-list');
        if (!tablesList) return;

        const result = await ipcRenderer.invoke('db:get-tables');
        if (result.success) {
            const tables = (result.tables || []).map(table => ({
                name: table.name,
                schema: table.schema || 'public',
                type: table.type
            }));

            if (tables.length === 0) {
                tablesList.innerHTML = '<p class="placeholder">No tables found</p>';
                return;
            }

            let html = '<div class="db-tables-tree">';
            tables.forEach(table => {
                html += `
                    <div class="db-table-item" data-table-name="${escapeHtml(table.name)}" data-table-schema="${escapeHtml(table.schema || '')}">
                        <span class="db-table-icon">📊</span>
                        <div>
                            <span class="db-table-name">${escapeHtml(table.name)}</span>
                            <span class="db-table-schema">${escapeHtml(table.schema || '')}</span>
                        </div>
                    </div>
                `;
            });
            html += '</div>';

            tablesList.innerHTML = html;

            // Add click handlers to insert table name into query
            tablesList.querySelectorAll('.db-table-item').forEach(item => {
                item.addEventListener('click', () => {
                    const tableName = item.dataset.tableName;
                    const tableSchema = item.dataset.tableSchema;
                    const queryEditor = document.getElementById('db-query-editor');
                    if (queryEditor) {
                        const qualifiedName = tableSchema && tableSchema.trim() !== ''
                            ? `${tableSchema}.${tableName}`
                            : tableName;
                        const cursorPos = queryEditor.selectionStart;
                        const textBefore = queryEditor.value.substring(0, cursorPos);
                        const textAfter = queryEditor.value.substring(cursorPos);
                        queryEditor.value = textBefore + qualifiedName + textAfter;
                        queryEditor.focus();
                        queryEditor.setSelectionRange(cursorPos + qualifiedName.length, cursorPos + qualifiedName.length);
                    }
                });
            });
        } else {
            tablesList.innerHTML = `<p class="error">Error loading tables: ${escapeHtml(result.error)}</p>`;
        }
    }

    function displayQueryResults(result) {
        const container = document.getElementById('db-results-container');
        if (!container) return;

        if (!result.rows || result.rows.length === 0) {
            container.innerHTML = '<p class="placeholder">Query executed successfully, but returned no rows</p>';
            return;
        }

        const columns = result.columns || Object.keys(result.rows[0] || {});
        const rows = result.rows;

        // Create table
        let html = '<div class="db-results-table-wrapper">';
        html += '<table class="db-results-table">';
        
        // Header
        html += '<thead><tr>';
        columns.forEach(col => {
            const colName = typeof col === 'string' ? col : col.name;
            html += `<th>${escapeHtml(colName)}</th>`;
        });
        html += '</tr></thead>';

        // Rows
        html += '<tbody>';
        rows.forEach(row => {
            html += '<tr>';
            columns.forEach(col => {
                const colName = typeof col === 'string' ? col : col.name;
                const value = row[colName];
                const displayValue = value === null || value === undefined ? '<em>NULL</em>' : escapeHtml(String(value));
                html += `<td>${displayValue}</td>`;
            });
            html += '</tr>';
        });
        html += '</tbody>';
        html += '</table>';
        html += '</div>';

        container.innerHTML = html;
    }
    
    // Setup event listeners for database connection management
    function setupDatabaseConnectionListeners() {
        dbConnectionSelectElement = document.getElementById('db-connection-select');
        if (dbConnectionSelectElement) {
            dbConnectionSelectElement.addEventListener('change', () => {
                const selectedId = dbConnectionSelectElement.value;
                if (selectedId) {
                    applyDbConnectionToDatabaseForm(selectedId);
                }
            });
        }

        const dbConnectionManageButton = document.getElementById('db-connection-manage');
        if (dbConnectionManageButton) {
            dbConnectionManageButton.addEventListener('click', async () => {
                const settingsTabButton = document.querySelector('[data-tab="settings"]');
                if (settingsTabButton) {
                    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                    settingsTabButton.classList.add('active');
                    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
                    document.getElementById('settings-tab').classList.add('active');
                }

                // Load settings (this will be handled by renderer.js)
                if (window.loadSettings) {
                    await window.loadSettings();
                }
                await refreshDbConnectionsData({ skipDatabaseSelect: true });

                const selectedId = dbConnectionSelectElement ? dbConnectionSelectElement.value : null;
                selectedSettingsDbConnectionId = selectedId || null;
                populateSettingsDbForm(getDbConnectionById(selectedSettingsDbConnectionId));
                renderSettingsDbConnections();
                scrollToDbSettingsSection();
            });
        }

        const settingsDbNewButton = document.getElementById('settings-db-new');
        if (settingsDbNewButton) {
            settingsDbNewButton.addEventListener('click', () => {
                resetSettingsDbForm();
                const status = document.getElementById('settings-db-status');
                if (status) {
                    status.innerHTML = '<div class="info">Creating a new connection</div>';
                }
            });
        }

        const settingsDbSaveButton = document.getElementById('settings-db-save');
        if (settingsDbSaveButton) {
            settingsDbSaveButton.addEventListener('click', async () => {
                const status = document.getElementById('settings-db-status');
                const payload = {
                    id: selectedSettingsDbConnectionId,
                    name: document.getElementById('settings-db-name')?.value.trim(),
                    host: document.getElementById('settings-db-host')?.value.trim(),
                    port: document.getElementById('settings-db-port')?.value,
                    database: document.getElementById('settings-db-database')?.value.trim(),
                    username: document.getElementById('settings-db-username')?.value.trim(),
                    password: document.getElementById('settings-db-password')?.value,
                    setActive: document.getElementById('settings-db-make-default')?.checked || false
                };

                if (status) {
                    status.innerHTML = '<div class="info">Saving connection...</div>';
                }

                const result = await ipcRenderer.invoke('config:save-db-connection', payload);
                if (result.success) {
                    selectedSettingsDbConnectionId = result.connection.id;
                    if (status) {
                        status.innerHTML = '<div class="success">Connection saved</div>';
                    }
                    await refreshDbConnectionsData({ applyActiveToDatabaseForm: result.connection.id === (dbConnectionSelectElement?.value || null) });
                    populateSettingsDbForm(getDbConnectionById(selectedSettingsDbConnectionId));
                } else if (status) {
                    status.innerHTML = `<div class="error">❌ ${escapeHtml(result.error || 'Unable to save connection')}</div>`;
                }
            });
        }

        const settingsDbDeleteButton = document.getElementById('settings-db-delete');
        if (settingsDbDeleteButton) {
            settingsDbDeleteButton.addEventListener('click', async () => {
                if (!selectedSettingsDbConnectionId) {
                    await showAlert('No Connection Selected', 'Select a saved connection to delete.');
                    return;
                }

                const connection = getDbConnectionById(selectedSettingsDbConnectionId);
                const confirmed = await showConfirm('Delete Connection', `Delete "${connection?.name || 'connection'}"?`);
                if (!confirmed) return;

                const status = document.getElementById('settings-db-status');
                if (status) {
                    status.innerHTML = '<div class="info">Deleting connection...</div>';
                }

                const result = await ipcRenderer.invoke('config:delete-db-connection', selectedSettingsDbConnectionId);
                if (result.success) {
                    selectedSettingsDbConnectionId = null;
                    if (status) {
                        status.innerHTML = '<div class="success">Connection deleted</div>';
                    }
                    await refreshDbConnectionsData({ applyActiveToDatabaseForm: true });
                    resetSettingsDbForm();
                } else if (status) {
                    status.innerHTML = `<div class="error">❌ ${escapeHtml(result.error || 'Unable to delete connection')}</div>`;
                }
            });
        }
    }
    
    // Initialize event listeners
    setupDatabaseConnectionListeners();
    
    return {
        initialize: initializeDatabaseViewer,
        loadTables: loadDatabaseTables,
        refreshConnections: refreshDbConnectionsData,
    };
}

module.exports = { createDatabaseView };

