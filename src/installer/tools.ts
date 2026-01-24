/**
 * Tool definitions for multi-tool MCP installer
 */

import { ToolDefinition } from './types.js';

/**
 * Default MCP configuration for agent-consultation
 */
const DEFAULT_MCP_CONFIG = {
  serverName: 'agent-consultation',
  command: 'npx',
  args: ['-y', 'agent-consultation-mcp'],
};

/**
 * All supported tools with their configurations
 */
export const SUPPORTED_TOOLS: ToolDefinition[] = [
  // Claude Code (Official Anthropic CLI)
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Anthropic\'s official CLI for Claude',
    configPaths: {
      darwin: {
        path: '.claude.json',
        relative: true,
        mcpKey: 'mcpServers',
        format: 'json',
      },
      linux: {
        path: '.claude.json',
        relative: true,
        mcpKey: 'mcpServers',
        format: 'json',
      },
      win32: {
        path: '.claude.json',
        relative: true,
        mcpKey: 'mcpServers',
        format: 'json',
      },
    },
    detection: {
      binary: 'claude',
      directory: '.claude',
    },
    mcpConfig: DEFAULT_MCP_CONFIG,
    requiresRestart: true,
    notes: 'Restart Claude Code to load the MCP',
  },

  // Cursor
  {
    id: 'cursor',
    name: 'Cursor',
    description: 'AI-first code editor',
    configPaths: {
      darwin: {
        path: '.cursor/mcp.json',
        relative: true,
        mcpKey: 'mcpServers',
        format: 'json',
      },
      linux: {
        path: '.cursor/mcp.json',
        relative: true,
        mcpKey: 'mcpServers',
        format: 'json',
      },
      win32: {
        path: '.cursor/mcp.json',
        relative: true,
        mcpKey: 'mcpServers',
        format: 'json',
      },
    },
    detection: {
      binary: 'cursor',
      directory: '.cursor',
    },
    mcpConfig: DEFAULT_MCP_CONFIG,
    requiresRestart: true,
    notes: 'Restart Cursor to load the MCP',
  },

  // Windsurf (Codeium)
  {
    id: 'windsurf',
    name: 'Windsurf',
    description: 'Codeium\'s AI-powered IDE',
    configPaths: {
      darwin: {
        path: '.codeium/windsurf/mcp_config.json',
        relative: true,
        mcpKey: 'mcpServers',
        format: 'json',
      },
      linux: {
        path: '.codeium/windsurf/mcp_config.json',
        relative: true,
        mcpKey: 'mcpServers',
        format: 'json',
      },
      win32: {
        path: '.codeium/windsurf/mcp_config.json',
        relative: true,
        mcpKey: 'mcpServers',
        format: 'json',
      },
    },
    detection: {
      binary: 'windsurf',
      directory: '.codeium/windsurf',
    },
    mcpConfig: DEFAULT_MCP_CONFIG,
    requiresRestart: true,
    notes: 'Restart Windsurf to load the MCP',
  },

  // Cline (VSCode Extension)
  {
    id: 'cline',
    name: 'Cline',
    description: 'Autonomous coding agent for VSCode',
    configPaths: {
      darwin: {
        path: 'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
        relative: true,
        mcpKey: 'mcpServers',
        format: 'json',
      },
      linux: {
        path: '.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
        relative: true,
        mcpKey: 'mcpServers',
        format: 'json',
      },
      win32: {
        path: 'AppData/Roaming/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
        relative: true,
        mcpKey: 'mcpServers',
        format: 'json',
      },
    },
    detection: {
      vscodeExtension: 'saoudrizwan.claude-dev',
      configFile: true,
    },
    mcpConfig: DEFAULT_MCP_CONFIG,
    requiresRestart: false,
    notes: 'Reload VSCode window or restart Cline extension',
  },

  // Continue (VSCode/JetBrains Extension)
  {
    id: 'continue',
    name: 'Continue',
    description: 'Open-source AI code assistant',
    configPaths: {
      darwin: {
        path: '.continue/config.json',
        relative: true,
        mcpKey: 'experimental.modelContextProtocolServers',
        format: 'json',
      },
      linux: {
        path: '.continue/config.json',
        relative: true,
        mcpKey: 'experimental.modelContextProtocolServers',
        format: 'json',
      },
      win32: {
        path: '.continue/config.json',
        relative: true,
        mcpKey: 'experimental.modelContextProtocolServers',
        format: 'json',
      },
    },
    detection: {
      directory: '.continue',
      vscodeExtension: 'Continue.continue',
    },
    mcpConfig: {
      serverName: 'agent-consultation',
      command: 'npx',
      args: ['-y', 'agent-consultation-mcp'],
    },
    requiresRestart: false,
    notes: 'Reload Continue extension to load the MCP',
  },

  // Zed
  {
    id: 'zed',
    name: 'Zed',
    description: 'High-performance code editor',
    configPaths: {
      darwin: {
        path: '.config/zed/settings.json',
        relative: true,
        mcpKey: 'context_servers',
        format: 'json',
      },
      linux: {
        path: '.config/zed/settings.json',
        relative: true,
        mcpKey: 'context_servers',
        format: 'json',
      },
    },
    detection: {
      binary: 'zed',
      directory: '.config/zed',
    },
    mcpConfig: {
      serverName: 'agent-consultation',
      command: 'npx',
      args: ['-y', 'agent-consultation-mcp'],
    },
    requiresRestart: false,
    notes: 'Zed will auto-reload the configuration',
  },

  // Roo Code (VSCode Extension - Roo-Cline fork)
  {
    id: 'roo-code',
    name: 'Roo Code',
    description: 'AI coding assistant (Cline fork)',
    configPaths: {
      darwin: {
        path: 'Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json',
        relative: true,
        mcpKey: 'mcpServers',
        format: 'json',
      },
      linux: {
        path: '.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json',
        relative: true,
        mcpKey: 'mcpServers',
        format: 'json',
      },
      win32: {
        path: 'AppData/Roaming/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json',
        relative: true,
        mcpKey: 'mcpServers',
        format: 'json',
      },
    },
    detection: {
      vscodeExtension: 'rooveterinaryinc.roo-cline',
      configFile: true,
    },
    mcpConfig: DEFAULT_MCP_CONFIG,
    requiresRestart: false,
    notes: 'Reload VSCode window to load the MCP',
  },

  // OpenCode
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'AI-powered terminal coding assistant',
    configPaths: {
      darwin: {
        path: '.config/opencode/opencode.json',
        relative: true,
        mcpKey: 'mcp',
        format: 'json',
      },
      linux: {
        path: '.config/opencode/opencode.json',
        relative: true,
        mcpKey: 'mcp',
        format: 'json',
      },
      win32: {
        path: '.config/opencode/opencode.json',
        relative: true,
        mcpKey: 'mcp',
        format: 'json',
      },
    },
    detection: {
      binary: 'opencode',
      directory: '.config/opencode',
    },
    mcpConfig: DEFAULT_MCP_CONFIG,
    requiresRestart: false,
    notes: 'OpenCode will auto-detect the new MCP server',
  },

  // VSCode GitHub Copilot (User MCP Config)
  {
    id: 'vscode-copilot',
    name: 'VSCode Copilot',
    description: 'GitHub Copilot in Visual Studio Code',
    configPaths: {
      darwin: {
        path: 'Library/Application Support/Code/User/mcp.json',
        relative: true,
        mcpKey: 'servers',
        format: 'json',
      },
      linux: {
        path: '.config/Code/User/mcp.json',
        relative: true,
        mcpKey: 'servers',
        format: 'json',
      },
      win32: {
        path: 'AppData/Roaming/Code/User/mcp.json',
        relative: true,
        mcpKey: 'servers',
        format: 'json',
      },
    },
    detection: {
      configFile: true,
    },
    mcpConfig: DEFAULT_MCP_CONFIG,
    requiresRestart: false,
    notes: 'Reload VSCode window to load the MCP',
  },
];

/**
 * Get tool by ID
 */
export function getToolById(id: string): ToolDefinition | undefined {
  return SUPPORTED_TOOLS.find((tool) => tool.id === id);
}

/**
 * Get all tool IDs
 */
export function getToolIds(): string[] {
  return SUPPORTED_TOOLS.map((tool) => tool.id);
}
