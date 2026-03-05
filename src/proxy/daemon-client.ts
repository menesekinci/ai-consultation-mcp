import { io, Socket } from 'socket.io-client';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_DIR = path.join(os.homedir(), '.ai-consultation-mcp');
const LOCK_FILE = path.join(CONFIG_DIR, 'daemon.lock');

interface DaemonLock {
  pid: number;
  port: number;
  startedAt: string;
  token: string;
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
async function startDaemon(): Promise<void> {
  const daemonPath = path.join(__dirname, '..', 'daemon', 'index.js');

  const child = spawn(process.execPath, [daemonPath], {
    detached: true,
    stdio: 'ignore',
  });

  child.unref();
}

/**
 * Ensure daemon is running and get its lock info
 */
export async function ensureDaemonRunning(): Promise<DaemonLock> {
  const lock = readLockFile();

  if (lock && isProcessRunning(lock.pid)) {
    return lock;
  }

  // Daemon not running, start it
  console.error('[Proxy] Starting daemon...');
  await startDaemon();

  // Wait for lock file to appear
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds

    const checkDaemon = setInterval(() => {
      attempts++;
      const currentLock = readLockFile();

      if (currentLock && isProcessRunning(currentLock.pid)) {
        clearInterval(checkDaemon);
        resolve(currentLock);
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
 * Connect to daemon via WebSocket
 */
export async function connectToDaemon(): Promise<Socket> {
  const lock = await ensureDaemonRunning();

  return new Promise((resolve, reject) => {
    const socket = io(`http://127.0.0.1:${lock.port}`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
      query: { type: 'proxy' },
      auth: { token: lock.token },
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

export function buildWebUIUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}
