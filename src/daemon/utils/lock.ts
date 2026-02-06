import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';

export interface DaemonLock {
  pid: number;
  port: number;
  startedAt: string;
  token: string;
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
 * Check if a process is truly our daemon by checking its command line
 */
function isTrulyDaemon(pid: number): boolean {
  try {
    const platform = process.platform;
    let cmd = '';

    if (platform === 'darwin' || platform === 'linux') {
      cmd = execSync(`ps -p ${pid} -o command=`, { encoding: 'utf-8' });
    } else if (platform === 'win32') {
      cmd = execSync(`wmic process where processid=${pid} get commandline`, { encoding: 'utf-8' });
    }

    // Check if the command line contains our marker or expected path
    return cmd.includes('daemon') || cmd.includes('AskAnythink');
  } catch {
    return false;
  }
}

/**
 * Check if a process is running by PID and is our daemon
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    // If process exists, double check it's actually our daemon
    return isTrulyDaemon(pid);
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
export function writeLockFile(port: number): DaemonLock {
  ensureConfigDir();
  const lock: DaemonLock = {
    pid: process.pid,
    port,
    startedAt: new Date().toISOString(),
    token: crypto.randomBytes(32).toString('hex'),
  };
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2), {
    mode: 0o600,
  });
  if (process.platform !== 'win32') {
    fs.chmodSync(LOCK_FILE, 0o600);
  }
  return lock;
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
 * Returns the lock info if acquired, null if daemon already running
 */
export function acquireLock(port: number): DaemonLock | null {
  const existingPort = isDaemonRunning();
  if (existingPort !== null) {
    return null;
  }

  return writeLockFile(port);
}

export { CONFIG_DIR, LOCK_FILE };
