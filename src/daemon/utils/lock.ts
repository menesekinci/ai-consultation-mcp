import fs from 'fs';
import path from 'path';
import os from 'os';

export interface DaemonLock {
  pid: number;
  port: number;
  startedAt: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.ai-consultation-mcp');
const LOCK_FILE = path.join(CONFIG_DIR, 'daemon.lock');

/**
 * Ensure config directory exists
 */
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Check if a process is running by PID
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
 * Read the current lock file
 */
export function readLockFile(): DaemonLock | null {
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
 * Write a new lock file
 */
export function writeLockFile(port: number): void {
  ensureConfigDir();
  const lock: DaemonLock = {
    pid: process.pid,
    port,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2));
}

/**
 * Remove the lock file
 */
export function removeLockFile(): void {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Check if daemon is already running
 * Returns the port if running, null otherwise
 */
export function isDaemonRunning(): number | null {
  const lock = readLockFile();
  if (!lock) {
    return null;
  }

  if (isProcessRunning(lock.pid)) {
    return lock.port;
  }

  // Stale lock file - remove it
  removeLockFile();
  return null;
}

/**
 * Acquire daemon lock
 * Returns true if lock acquired, false if daemon already running
 */
export function acquireLock(port: number): boolean {
  const existingPort = isDaemonRunning();
  if (existingPort !== null) {
    return false;
  }

  writeLockFile(port);
  return true;
}

export { CONFIG_DIR, LOCK_FILE };
