/**
 * Tool detection utilities for multi-tool installer
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { ToolDefinition, DetectedTool, Platform } from './types.js';
import { SUPPORTED_TOOLS } from './tools.js';

/**
 * Get current platform
 */
export function getPlatform(): Platform {
  const platform = process.platform;
  if (platform === 'darwin' || platform === 'win32' || platform === 'linux') {
    return platform;
  }
  // Default to linux for other Unix-like systems
  return 'linux';
}

/**
 * Get full config path for a tool
 */
export function getConfigPath(tool: ToolDefinition): string | null {
  const platform = getPlatform();
  const configPath = tool.configPaths[platform];

  if (!configPath) {
    return null;
  }

  if (configPath.relative) {
    return path.join(os.homedir(), configPath.path);
  }

  return configPath.path;
}

/**
 * Check if a binary exists in PATH using execFileSync (safe from injection)
 */
export function binaryExists(binaryName: string): boolean {
  try {
    const command = process.platform === 'win32' ? 'where' : 'which';
    // Using execFileSync is safe - binaryName is passed as argument, not shell-interpolated
    execFileSync(command, [binaryName], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a directory exists
 */
export function directoryExists(dirPath: string, relativePath = true): boolean {
  const fullPath = relativePath ? path.join(os.homedir(), dirPath) : dirPath;
  try {
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a file exists
 */
export function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, keyPath: string): unknown {
  const keys = keyPath.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

/**
 * Check if MCP is already installed in config
 */
export function isMcpInstalled(configPath: string, mcpKey: string, serverName: string): boolean {
  try {
    if (!fileExists(configPath)) {
      return false;
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    const mcpServers = getNestedValue(config, mcpKey);

    if (!mcpServers || typeof mcpServers !== 'object') {
      return false;
    }

    return serverName in (mcpServers as Record<string, unknown>);
  } catch {
    return false;
  }
}

/**
 * Detect if a specific tool is installed
 */
export function detectTool(tool: ToolDefinition): DetectedTool {
  const platform = getPlatform();
  const configPathObj = tool.configPaths[platform];
  const configPath = getConfigPath(tool);

  // Check if tool is installed
  let installed = false;

  // Check binary
  if (tool.detection.binary) {
    installed = installed || binaryExists(tool.detection.binary);
  }

  // Check directory
  if (tool.detection.directory) {
    installed = installed || directoryExists(tool.detection.directory);
  }

  // Check config file (for extensions without binary)
  if (tool.detection.configFile && configPath) {
    installed = installed || fileExists(configPath);
  }

  // Check config existence
  const configExists = configPath ? fileExists(configPath) : false;

  // Check if MCP already installed
  const mcpAlreadyInstalled =
    configPath && configPathObj
      ? isMcpInstalled(configPath, configPathObj.mcpKey, tool.mcpConfig.serverName)
      : false;

  return {
    tool,
    installed,
    configExists,
    mcpAlreadyInstalled,
    configPath: configPath || '',
  };
}

/**
 * Detect all installed tools
 */
export function detectAllTools(): DetectedTool[] {
  return SUPPORTED_TOOLS.map(detectTool);
}

/**
 * Get only installed tools
 */
export function getInstalledTools(): DetectedTool[] {
  return detectAllTools().filter((t) => t.installed);
}

/**
 * Get tools that need MCP installation
 */
export function getToolsNeedingInstallation(): DetectedTool[] {
  return detectAllTools().filter((t) => t.installed && !t.mcpAlreadyInstalled);
}

/**
 * Get tools where MCP is already installed
 */
export function getToolsWithMcpInstalled(): DetectedTool[] {
  return detectAllTools().filter((t) => t.installed && t.mcpAlreadyInstalled);
}
