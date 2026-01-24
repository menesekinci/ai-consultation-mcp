/**
 * Multi-tool MCP installer module
 */

// Types
export type {
  Platform,
  ToolConfigPath,
  ToolDefinition,
  DetectedTool,
  InstallResult,
  InstallSummary,
} from './types.js';

// Tool definitions
export { SUPPORTED_TOOLS, getToolById, getToolIds } from './tools.js';

// Detection utilities
export {
  getPlatform,
  getConfigPath,
  binaryExists,
  directoryExists,
  fileExists,
  isMcpInstalled,
  detectTool,
  detectAllTools,
  getInstalledTools,
  getToolsNeedingInstallation,
  getToolsWithMcpInstalled,
} from './detector.js';

// Installation functions
export { installToTool, installToAllTools, printInstallSummary } from './installer.js';
