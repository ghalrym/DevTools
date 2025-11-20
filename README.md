# ReedForge

ReedForge is a desktop application built with Electron for managing Docker containers and Git repositories.

## Features

### Docker Management
- View all Docker containers (running and stopped)
- Scrollable list of containers with status indicators
- View container logs with customizable line count
- Follow logs in real-time
- Color-coded log output (errors in red, warnings in yellow)

### Git Management
- Set and manage Git repositories
- View repository status (staged, modified, untracked, deleted files)
- Stage/unstage individual files or all files
- View commit history
- Commit changes with custom messages
- Push commits to remote repository
- Commit and push in one action

## Installation

1. Install dependencies:
```bash
npm install
```

2. Run the application:
```bash
npm start
```

## Requirements

- Node.js (v14 or higher)
- Docker Desktop (for Docker functionality)
- Git (for Git functionality)

## Usage

### Docker Tab
1. Click on the "Docker Containers" tab
2. Select a container from the list on the left
3. View logs in the main panel
4. Adjust the number of log lines to display
5. Click "Follow" to auto-refresh logs every 2 seconds

### Git Tab
1. Click on the "Git Management" tab
2. Enter a repository path (or leave empty to use current directory)
3. Click "Set Repository"
4. View status, logs, or commit changes using the inner tabs
5. Stage files individually or all at once
6. Enter a commit message and click "Commit" or "Commit & Push"
