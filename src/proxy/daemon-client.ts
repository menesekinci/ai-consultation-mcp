import { io, Socket } from 'socket.io-client';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

let browserOpened = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_DIR = path.join(os.homedir(), '.ai-consultation-mcp');
const LOCK_FILE = path.join(CONFIG_DIR, 'daemon.lock');

interface DaemonLock {
  pid: number;
  port: number;
  startedAt: string;
}

/**
 * Read daemon lock file
 */
function readLockFile(): DaemonLock | null {
  try {
    if (!fs.existsSync(LOCK_FILE)) {
      return null;
    }
    const content = fs.readFileSync(LOCK_FILE, 'utf-8');
    return JSON.parse(content) as DaemonLock;
  } catch {
    return null;
  }
}

/**
 * Check if daemon process is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start daemon process
 */
async function startDaemon(): Promise<number> {
  const daemonPath = path.join(__dirname, '..', 'daemon', 'index.js');

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [daemonPath], {
      detached: true,
      stdio: 'ignore',
    });

    child.unref();

    // Wait for daemon to start
    let attempts = 0;
    const maxAttempts = 30; // 3 seconds

    const checkDaemon = setInterval(() => {
      attempts++;
      const lock = readLockFile();

      if (lock && isProcessRunning(lock.pid)) {
        clearInterval(checkDaemon);
        resolve(lock.port);
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(checkDaemon);
        reject(new Error('Daemon failed to start within timeout'));
      }
    }, 100);
  });
}

/**
 * Ensure daemon is running and get its port
 */
export async function ensureDaemonRunning(): Promise<number> {
  const lock = readLockFile();

  if (lock && isProcessRunning(lock.pid)) {
    return lock.port;
  }

  // Daemon not running, start it
  console.error('[Proxy] Starting daemon...');
  return startDaemon();
}

/**
 * Connect to daemon via WebSocket
 */
export async function connectToDaemon(): Promise<Socket> {
  const port = await ensureDaemonRunning();

  return new Promise((resolve, reject) => {
    const socket = io(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
      query: { type: 'proxy' },
    });

    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Connection timeout'));
    }, 10000);

    socket.on('connect', () => {
      clearTimeout(timeout);
      console.error('[Proxy] Connected to daemon');
      resolve(socket);
    });

    socket.on('connect_error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Connection failed: ${err.message}`));
    });
  });
}

/**
 * Create daemon client with auto-reconnect
 */
export function createDaemonClient(): {
  getSocket: () => Promise<Socket>;
  disconnect: () => void;
} {
  let socket: Socket | null = null;
  let connecting: Promise<Socket> | null = null;

  return {
    getSocket: async () => {
      if (socket?.connected) {
        return socket;
      }

      if (connecting) {
        return connecting;
      }

      connecting = connectToDaemon();
      try {
        socket = await connecting;
        socket.on('disconnect', () => {
          socket = null;
        });
        return socket;
      } finally {
        connecting = null;
      }
    },
    disconnect: () => {
      if (socket) {
        socket.disconnect();
        socket = null;
      }
    },
  };
}

/**
 * Open Web UI in browser (only once per session, if enabled in config)
 */
export async function openWebUI(socket?: Socket): Promise<void> {
  if (browserOpened) {
    return;
  }

  // Check config if socket is provided
  if (socket) {
    try {
      const config = await new Promise<{ autoOpenWebUI?: boolean }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Config timeout')), 2000);
        socket.emit('config:get', (response: { autoOpenWebUI?: boolean }) => {
          clearTimeout(timeout);
          if (response) {
            resolve(response);
          } else {
            resolve({ autoOpenWebUI: true }); // Default to true if config fetch fails
          }
        });
      });

      if (config.autoOpenWebUI === false) {
        return; // User disabled auto-open
      }
    } catch {
      // If config check fails, proceed with opening (default behavior)
    }
  }

  const port = await ensureDaemonRunning();
  const url = `http://127.0.0.1:${port}`;

  browserOpened = true;

  // Platform-specific browser open using spawn (safer than exec)
  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (error) {
    console.error('[Proxy] Failed to open browser:', error instanceof Error ? error.message : 'Unknown error');
  }
}
