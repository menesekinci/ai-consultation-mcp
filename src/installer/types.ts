/**
 * Tool configuration types for multi-tool installer
 */

export type Platform = 'darwin' | 'win32' | 'linux';

export interface ToolConfigPath {
  /** Path relative to home directory or absolute */
  path: string;
  /** Whether path is relative to home directory */
  relative: boolean;
  /** JSON key path to mcpServers object (e.g., "mcpServers" or "context_servers") */
  mcpKey: string;
  /** Config format */
  format: 'json' | 'yaml';
}

export interface ToolDefinition {
  /** Tool identifier */
  id: string;
  /** Display name */
  name: string;
  /** Tool description */
  description: string;
  /** Config paths per platform */
  configPaths: Partial<Record<Platform, ToolConfigPath>>;
  /** Detection methods */
  detection: {
    /** Check if binary exists in PATH */
    binary?: string;
    /** Check if directory exists (relative to home) */
    directory?: string;
    /** Check if config file exists */
    configFile?: boolean;
    /** VSCode extension ID to check */
    vscodeExtension?: string;
  };
  /** MCP server configuration to add */
  mcpConfig: {
    /** Server name in config */
    serverName: string;
    /** Command to run */
    command: string;
    /** Command arguments */
    args: string[];
  };
  /** Whether tool requires restart after installation */
  requiresRestart: boolean;
  /** Installation notes/instructions */
  notes?: string;
}

export interface DetectedTool {
  tool: ToolDefinition;
  installed: boolean;
  configExists: boolean;
  mcpAlreadyInstalled: boolean;
  configPath: string;
}

export interface InstallResult {
  tool: ToolDefinition;
  success: boolean;
  message: string;
  configPath?: string;
  error?: string;
}

export interface InstallSummary {
  detected: DetectedTool[];
  installed: InstallResult[];
  skipped: DetectedTool[];
  errors: InstallResult[];
}
