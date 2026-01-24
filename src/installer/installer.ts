/**
 * Multi-tool MCP installer
 */

import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition, DetectedTool, InstallResult, InstallSummary } from './types.js';
import {
  detectAllTools,
  getConfigPath,
  getPlatform,
  fileExists,
} from './detector.js';

/**
 * Set nested value in object using dot notation
 */
function setNestedValue(
  obj: Record<string, unknown>,
  keyPath: string,
  key: string,
  value: unknown
): void {
  const keys = keyPath.split('.');
  let current = obj;

  // Navigate to the parent object, creating intermediate objects as needed
  for (const k of keys) {
    if (!(k in current) || typeof current[k] !== 'object' || current[k] === null) {
      current[k] = {};
    }
    current = current[k] as Record<string, unknown>;
  }

  // Set the value
  current[key] = value;
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
 * Create MCP server configuration object
 */
function createMcpServerConfig(tool: ToolDefinition): Record<string, unknown> {
  // Special handling for Zed (uses different format)
  if (tool.id === 'zed') {
    return {
      command: tool.mcpConfig.command,
      args: tool.mcpConfig.args,
    };
  }

  // Special handling for Continue (uses transport wrapper)
  if (tool.id === 'continue') {
    return {
      transport: {
        type: 'stdio',
        command: tool.mcpConfig.command,
        args: tool.mcpConfig.args,
      },
    };
  }

  // Special handling for OpenCode (uses type, command as array, enabled)
  if (tool.id === 'opencode') {
    return {
      type: 'local',
      command: [tool.mcpConfig.command, ...tool.mcpConfig.args],
      enabled: true,
    };
  }

  // Special handling for VSCode Copilot (uses type: stdio)
  if (tool.id === 'vscode-copilot') {
    return {
      type: 'stdio',
      command: tool.mcpConfig.command,
      args: tool.mcpConfig.args,
    };
  }

  // Standard format for most tools
  return {
    command: tool.mcpConfig.command,
    args: tool.mcpConfig.args,
  };
}

/**
 * Install MCP to a specific tool
 */
export function installToTool(detected: DetectedTool): InstallResult {
  const { tool } = detected;
  const configPath = getConfigPath(tool);

  if (!configPath) {
    return {
      tool,
      success: false,
      message: `No config path for platform ${getPlatform()}`,
      error: 'Platform not supported',
    };
  }

  const platform = getPlatform();
  const configPathObj = tool.configPaths[platform];

  if (!configPathObj) {
    return {
      tool,
      success: false,
      message: `No config path for platform ${platform}`,
      error: 'Platform not supported',
    };
  }

  try {
    // Ensure directory exists
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Read existing config or create new one
    let config: Record<string, unknown> = {};
    if (fileExists(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        config = JSON.parse(content);
      } catch {
        // If parse fails, start with empty config
        config = {};
      }
    }

    // Check if already installed
    const mcpServers = getNestedValue(config, configPathObj.mcpKey);
    if (
      mcpServers &&
      typeof mcpServers === 'object' &&
      tool.mcpConfig.serverName in (mcpServers as Record<string, unknown>)
    ) {
      return {
        tool,
        success: true,
        message: 'Already installed',
        configPath,
      };
    }

    // Create MCP server config
    const serverConfig = createMcpServerConfig(tool);

    // Add MCP to config
    setNestedValue(config, configPathObj.mcpKey, tool.mcpConfig.serverName, serverConfig);

    // Write config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    return {
      tool,
      success: true,
      message: tool.notes || 'Installed successfully',
      configPath,
    };
  } catch (error) {
    return {
      tool,
      success: false,
      message: 'Installation failed',
      configPath,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Install MCP to all detected tools
 */
export function installToAllTools(): InstallSummary {
  const allTools = detectAllTools();

  const detected: DetectedTool[] = [];
  const installed: InstallResult[] = [];
  const skipped: DetectedTool[] = [];
  const errors: InstallResult[] = [];

  for (const tool of allTools) {
    if (!tool.installed) {
      // Tool not installed on system
      continue;
    }

    detected.push(tool);

    if (tool.mcpAlreadyInstalled) {
      // MCP already installed, skip
      skipped.push(tool);
      continue;
    }

    // Install MCP
    const result = installToTool(tool);

    if (result.success) {
      installed.push(result);
    } else {
      errors.push(result);
    }
  }

  return { detected, installed, skipped, errors };
}

/**
 * Print installation summary to console
 */
export function printInstallSummary(summary: InstallSummary): void {
  console.log('\n📊 Installation Summary\n');
  console.log('─'.repeat(50));

  // Detected tools
  if (summary.detected.length === 0) {
    console.log('❌ No supported AI tools detected on this system.\n');
    console.log('Supported tools:');
    console.log('  - Claude Code (Anthropic CLI)');
    console.log('  - Cursor');
    console.log('  - Windsurf');
    console.log('  - OpenCode');
    console.log('  - VSCode Copilot (GitHub Copilot)');
    console.log('  - Cline (VSCode extension)');
    console.log('  - Continue (VSCode extension)');
    console.log('  - Zed');
    console.log('  - Roo Code (VSCode extension)\n');
    return;
  }

  console.log(`\n🔍 Detected ${summary.detected.length} tool(s):\n`);
  for (const tool of summary.detected) {
    const status = tool.mcpAlreadyInstalled ? '✅ (already configured)' : '📦';
    console.log(`   ${status} ${tool.tool.name}`);
  }

  // Installed
  if (summary.installed.length > 0) {
    console.log(`\n✅ Installed to ${summary.installed.length} tool(s):\n`);
    for (const result of summary.installed) {
      console.log(`   • ${result.tool.name}`);
      console.log(`     📍 ${result.configPath}`);
      if (result.tool.requiresRestart) {
        console.log(`     ⚠️  ${result.message}`);
      }
    }
  }

  // Skipped (already installed)
  if (summary.skipped.length > 0) {
    console.log(`\n⏭️  Skipped ${summary.skipped.length} tool(s) (already configured):\n`);
    for (const tool of summary.skipped) {
      console.log(`   • ${tool.tool.name}`);
    }
  }

  // Errors
  if (summary.errors.length > 0) {
    console.log(`\n❌ Failed to install to ${summary.errors.length} tool(s):\n`);
    for (const result of summary.errors) {
      console.log(`   • ${result.tool.name}: ${result.error}`);
    }
  }

  // Next steps
  console.log('\n' + '─'.repeat(50));
  console.log('\n🚀 Next steps:\n');

  const needsRestart = summary.installed.filter((r) => r.tool.requiresRestart);
  if (needsRestart.length > 0) {
    console.log('   1. Restart the following tools to load the MCP:');
    for (const result of needsRestart) {
      console.log(`      - ${result.tool.name}`);
    }
    console.log('');
  }

  console.log('   2. Configure your API key:');
  console.log('      npx agent-consultation-mcp --config\n');
}
