// MCP Server Module
// Handles Model Context Protocol server for exposing Docker and Git functionality

let mcpServer = null;
let mcpServerPort = null;

async function initializeMCPServer(docker, git, initDocker) {
  try {
    if (mcpServer) {
      return { success: true, message: 'MCP server already running' };
    }

    // Try to load MCP SDK dynamically
    let Server;
    try {
      // Import Server from the server subpath
      const serverModule = require('@modelcontextprotocol/sdk/server');
      Server = serverModule.Server;
      
      if (!Server) {
        return { 
          success: false, 
          error: `Server class not found in @modelcontextprotocol/sdk/server. Please ensure @modelcontextprotocol/sdk is properly installed.` 
        };
      }
    } catch (error) {
      return { 
        success: false, 
        error: `MCP SDK not available: ${error.message}. Please ensure @modelcontextprotocol/sdk is properly installed with: npm install @modelcontextprotocol/sdk` 
      };
    }

    mcpServer = new Server({
      name: 'andrews-dev-tool',
      version: '1.0.0',
    }, {
      capabilities: {
        tools: {},
        resources: {},
      },
    });

    // Register Docker tools
    mcpServer.setRequestHandler('tools/list', async () => {
      return {
        tools: [
          {
            name: 'list_docker_containers',
            description: 'List all Docker containers',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'get_docker_logs',
            description: 'Get logs from a Docker container',
            inputSchema: {
              type: 'object',
              properties: {
                containerId: {
                  type: 'string',
                  description: 'Container ID or name',
                },
                tail: {
                  type: 'number',
                  description: 'Number of lines to tail (default: 100)',
                  default: 100,
                },
              },
              required: ['containerId'],
            },
          },
          {
            name: 'get_git_status',
            description: 'Get Git repository status',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'get_git_branches',
            description: 'Get list of Git branches',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'get_git_logs',
            description: 'Get Git commit logs',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Number of commits to retrieve (default: 10)',
                  default: 10,
                },
                branch: {
                  type: 'string',
                  description: 'Branch name (optional)',
                },
              },
            },
          },
        ],
      };
    });

    mcpServer.setRequestHandler('tools/call', async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'list_docker_containers': {
            if (!docker) {
              if (!initDocker()) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({ error: 'Docker not available' }, null, 2),
                    },
                  ],
                };
              }
            }

            const containers = await docker.listContainers({ all: true });
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ containers }, null, 2),
                },
              ],
            };
          }

          case 'get_docker_logs': {
            if (!docker) {
              if (!initDocker()) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({ error: 'Docker not available' }, null, 2),
                    },
                  ],
                };
              }
            }

            const containerId = args?.containerId;
            const tail = args?.tail || 100;

            if (!containerId) {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ error: 'containerId is required' }, null, 2),
                  },
                ],
              };
            }

            const container = docker.getContainer(containerId);
            const logs = await container.logs({
              stdout: true,
              stderr: true,
              tail: tail,
              timestamps: false,
            });

            return {
              content: [
                {
                  type: 'text',
                  text: logs.toString('utf-8'),
                },
              ],
            };
          }

          case 'get_git_status': {
            if (!git) {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ error: 'Git repository not initialized' }, null, 2),
                  },
                ],
              };
            }

            const status = await git.status();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    current: status.current,
                    files: status.files.map(f => ({
                      path: f.path,
                      index: f.index,
                      working_dir: f.working_dir,
                    })),
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_git_branches': {
            if (!git) {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ error: 'Git repository not initialized' }, null, 2),
                  },
                ],
              };
            }

            const branchSummary = await git.branchLocal();
            const remoteBranches = await git.branch(['-r']).catch(() => ({ all: [] }));

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    current: branchSummary.current,
                    local: branchSummary.all,
                    remote: remoteBranches.all.filter(b => !b.includes('HEAD')),
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_git_logs': {
            if (!git) {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ error: 'Git repository not initialized' }, null, 2),
                  },
                ],
              };
            }

            const limit = args?.limit || 10;
            const branch = args?.branch;

            const logOptions = { maxCount: limit };
            if (branch) {
              logOptions.from = branch;
            }

            const log = await git.log(logOptions);
            const commits = log.all.map(commit => ({
              hash: commit.hash,
              date: commit.date instanceof Date ? commit.date.toISOString() : commit.date,
              message: commit.message,
              author_name: commit.author_name,
              author_email: commit.author_email,
            }));

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ commits }, null, 2),
                },
              ],
            };
          }

          default:
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ error: `Unknown tool: ${name}` }, null, 2),
                },
              ],
            };
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: error.message }, null, 2),
            },
          ],
        };
      }
    });

    // Start server on stdio (for MCP clients)
    // The MCP SDK Server.connect() method accepts a transport object with reader/writer
    // We'll use process.stdin and process.stdout for stdio communication
    try {
      await mcpServer.connect({
        reader: process.stdin,
        writer: process.stdout
      });
    } catch (connectError) {
      return { 
        success: false, 
        error: `Failed to connect MCP server to stdio: ${connectError.message}. The SDK API may have changed.` 
      };
    }

    mcpServerPort = 'stdio';
    return { success: true, port: mcpServerPort, message: 'MCP server started successfully' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function stopMCPServer() {
  try {
    if (mcpServer) {
      await mcpServer.close();
      mcpServer = null;
      mcpServerPort = null;
      return { success: true, message: 'MCP server stopped' };
    }
    return { success: true, message: 'MCP server was not running' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function getMCPStatus() {
  return {
    running: mcpServer !== null,
    port: mcpServerPort,
  };
}

module.exports = {
  initializeMCPServer,
  stopMCPServer,
  getMCPStatus,
};

