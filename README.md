# Agent Consultation MCP

[![npm version](https://img.shields.io/npm/v/ai-consultation-mcp.svg)](https://www.npmjs.com/package/ai-consultation-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An MCP (Model Context Protocol) server that enables AI agents to get a **second opinion** from other AI models, enriching their perspectives during work.

> **Purpose**: When AI agents work on complex tasks, having a single perspective can lead to blind spots or suboptimal solutions. This MCP server allows agents like Claude Code to consult with DeepSeek Reasoner or ChatGPT for alternative viewpoints, validation, or different problem-solving strategies.

## Features

- **Multi-Tool Auto-Install**: Automatically detects and configures MCP for Claude Code, Cursor, Windsurf, Cline, Continue, Zed, and more
- **Multi-Provider Support**: DeepSeek (Reasoner, Chat) and OpenAI (GPT-5.2, GPT-5.2 Pro)
- **Specialized Consultation Modes**: Debug, Code Analysis, Architecture Review, Plan Validation, Concept Explanation
- **Conversation Management**: Continue multi-turn conversations with context
- **Web UI**: Configure providers and API keys through a browser interface
- **Encrypted Storage**: API keys are encrypted at rest

## Quick Start (2 steps)

```bash
# 1. Auto-install to all detected AI tools
npx ai-consultation-mcp --install

# 2. Configure your API key in the Web UI that opens automatically
# Done! Restart your AI tools and start using
```

## Installation

### Option 1: npm (Recommended)

The easiest way to install and use the MCP server:

```bash
# Auto-install to all detected AI tools
npx ai-consultation-mcp --install

# Or install globally
npm install -g ai-consultation-mcp
ai-consultation-mcp --install
```

### Option 2: From GitHub

Clone the repository and build from source:

```bash
# Clone the repository
git clone https://github.com/menesekinci/ai-consultation-mcp.git
cd ai-consultation-mcp

# Install dependencies
npm install

# Build
npm run build

# Run the installer
npm start -- --install
```

### Auto-Install Features

The `--install` flag will:
- Scan for installed AI tools (Claude Code, Cursor, Windsurf, OpenCode, VSCode Copilot, Cline, Continue, Zed, Roo Code)
- Add MCP configuration to each detected tool
- Open the Web UI to configure your API key
- Show which tools need to be restarted

### Supported AI Tools

| Tool | Config Location |
|------|-----------------|
| Claude Code | `~/.claude/mcp.json` |
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| OpenCode | `~/.config/opencode/opencode.json` |
| VSCode Copilot | `~/Library/Application Support/Code/User/mcp.json` |
| Cline | VSCode globalStorage |
| Continue | `~/.continue/config.json` |
| Zed | `~/.config/zed/settings.json` |
| Roo Code | VSCode globalStorage |

### Manual Installation (Claude Code)

Add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "agent-consultation": {
      "command": "npx",
      "args": ["-y", "ai-consultation-mcp"]
    }
  }
}
```

## Configuration

### Setting Up API Keys

```bash
npx ai-consultation-mcp --config
```

This opens a web UI where you can:
- Add/update API keys for DeepSeek and OpenAI
- Test API key validity
- Change default model
- View conversation history

### Supported Providers

| Provider | Models | API Key |
|----------|--------|---------|
| DeepSeek | `deepseek-reasoner` (default), `deepseek-chat` | [Get API Key](https://platform.deepseek.com/) |
| OpenAI | `gpt-5.2`, `gpt-5.2-pro` | [Get API Key](https://platform.openai.com/) |

## Usage

Once configured, Claude Code can use the following tools:

### consult_agent

Get a second opinion from another AI model.

```
Parameters:
- question (required): The question or problem to get advice on
- mode (optional): Consultation mode - debug, analyzeCode, reviewArchitecture, validatePlan, explainConcept, general
- context (optional): Additional context like code snippets or error messages
```

### continue_conversation

Continue an existing consultation conversation.

```
Parameters:
- conversationId (required): The conversation ID from a previous consultation
- message (required): Your follow-up message
```

### end_conversation

End an active consultation conversation.

```
Parameters:
- conversationId (required): The conversation ID to end
```

## Example

In Claude Code, you might use it like:

> "Can you consult DeepSeek about this architecture decision? I'm not sure if using a monorepo is the right choice for this microservices setup."

Claude will then call the `consult_agent` tool with your question and provide the response.

## Consultation Modes

| Mode | Description |
|------|-------------|
| `debug` | Focus on finding bugs, analyzing errors, and suggesting fixes |
| `analyzeCode` | Code review focusing on quality, patterns, and improvements |
| `reviewArchitecture` | Evaluate architectural decisions and suggest alternatives |
| `validatePlan` | Review implementation plans for completeness and risks |
| `explainConcept` | Explain technical concepts clearly |
| `general` | General-purpose consultation |

## Development

```bash
# Clone the repo
git clone https://github.com/menesekinci/ai-consultation-mcp.git
cd ai-consultation-mcp

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
```

## License

MIT
