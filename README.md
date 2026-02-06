# Agent Consultation MCP

[![npm version](https://img.shields.io/npm/v/ai-consultation-mcp.svg)](https://www.npmjs.com/package/ai-consultation-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An MCP (Model Context Protocol) server that enables AI agents to get a **second opinion** from other AI models, enriching their perspectives during work.

> **Purpose**: When AI agents work on complex tasks, having a single perspective can lead to blind spots or suboptimal solutions. This MCP server allows agents like Claude Code to consult with DeepSeek and OpenAI models for alternative viewpoints, validation, or different problem-solving strategies.

## Features

- **Central Daemon Architecture**: SQLite-based central daemon with WebSocket real-time sync across all connected clients
- **Multi-Tool Auto-Install**: Automatically detects and configures MCP for Claude Code, Cursor, Windsurf, Cline, Continue, Zed, Roo Code, OpenCode, and VSCode Copilot
- **Multi-Provider Support**: 
  - **OpenAI**: gpt-5.2, gpt-5.2-pro
  - **DeepSeek**: deepseek-chat, deepseek-reasoner
- **Specialized Consultation Modes**: Debug, Code Analysis, Architecture Review, Plan Validation, Concept Explanation
- **Conversation Management**: Continue multi-turn conversations with context (max 5 messages to prevent infinite loops)
- **Real-time Web UI**: Configure providers, API keys, and view conversation history with live updates via WebSocket
- **Encrypted Storage**: API keys are encrypted at rest using AES-256-GCM
- **RAG + Memory**: Upload documents (txt, md, pdf, docx), add memory notes, and use them during consultations

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

## Architecture

### Central Daemon + WebSocket

The MCP server uses a **central daemon architecture** for robust multi-client support:

```
┌─────────────────────────────────────────────────────────────────┐
│                      CENTRAL DAEMON                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ SQLite DB   │  │ WebSocket   │  │ HTTP API               │  │
│  │ (WAL mode)  │  │ Server      │  │ /api/*                 │  │
│  │             │  │             │  │                         │  │
│  │ - config    │  │ - sync      │  │ - config CRUD          │  │
│  │ - convos    │  │ - broadcast │  │ - provider CRUD        │  │
│  │ - history   │  │ - rooms     │  │ - chat history         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
            ▼               ▼               ▼
    ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
    │ MCP Proxy     │ │ MCP Proxy     │ │ Web UI        │
    │ (Claude Code) │ │ (Cursor)      │ │ (Browser)     │
    │               │ │               │ │               │
    │ stdio ↔ WS    │ │ stdio ↔ WS    │ │ WS Client     │
    └───────────────┘ └───────────────┘ └───────────────┘
```

**Benefits:**
- ✅ No race conditions with SQLite + WAL mode
- ✅ Real-time sync across all connected clients
- ✅ Automatic daemon lifecycle management
- ✅ Persistent conversation history

> **Default runtime**: daemon/proxy architecture is the default and recommended mode. `--legacy` is maintained for compatibility and is deprecated.

## Configuration

### Setting Up API Keys

```bash
npx ai-consultation-mcp --config
```

This opens a web UI where you can:
- Add/update API keys for all supported providers
- Test API key validity
- Set default and fallback models
- View conversation history in real-time
- Manage RAG documents and memory notes

### Supported Providers

| Provider | Models | API Key |
|----------|--------|---------|
| **OpenAI** | `gpt-5.2`, `gpt-5.2-pro` | [Get API Key](https://platform.openai.com/) |
| **DeepSeek** | `deepseek-reasoner` (default), `deepseek-chat` | [Get API Key](https://platform.deepseek.com/) |

### Model Features

| Model | Provider | Context | Max Output | Features |
|-------|----------|---------|------------|----------|
| gpt-5.2 | OpenAI | 400K | 400K | Reasoning, flagship quality |
| gpt-5.2-pro | OpenAI | 400K | 400K | More compute, higher quality |
| deepseek-chat | DeepSeek | 128K | 8K | Fast, very affordable |
| deepseek-reasoner | DeepSeek | 64K | 64K | Chain-of-thought |

## Usage

Once configured, your AI assistant can use the following tools:

### consult_agent

Get a second opinion from another AI model.

```
Parameters:
- question (required): The question or problem to get advice on
- mode (optional): Consultation mode - debug, analyzeCode, reviewArchitecture, validatePlan, explainConcept, general
- context (optional): Additional context like code snippets or error messages
- docIds (optional): Restrict RAG to these document IDs
- docTitles (optional): Restrict RAG to matching document titles
```

### continue_conversation

Continue an existing consultation conversation.

```
Parameters:
- conversationId (required): The conversation ID from a previous consultation
- message (required): Your follow-up message
- docIds (optional): Restrict RAG to these document IDs
- docTitles (optional): Restrict RAG to matching document titles
```

### end_conversation

End an active consultation conversation.

```
Parameters:
- conversationId (required): The conversation ID to end
```

### rag_search

Search RAG documents with optional filters.

```
Parameters:
- query (required): Search query
- docIds (optional): Restrict to document IDs
- docTitles (optional): Restrict to document titles
- folder (optional): Restrict to folder
- topK (optional): Number of results (default 4)
- minScore (optional): Minimum similarity score (default 0.35)
```

### rag_list_docs

List available RAG documents.

```
Parameters:
- folder (optional): Restrict to folder
```

### rag_list_folders

List available RAG folders.

### rag_list_memories

List structured memory notes.

### rag_get_doc_chunks

Get all chunks for a document.

```
Parameters:
- documentId (required)
```

### rag_add_memory

Add a memory note (embedded and searchable by RAG).

```
Parameters:
- category (required): architecture | backend | db | auth | config | flow | other
- title (required): Short memory title
- content (required): Memory content
```

### rag_upload_files

Upload local files to the RAG index using file paths.

```
Parameters:
- paths (required): Array of file paths to upload
- ifExists (optional): skip | allow | replace (default: skip)
- folder (optional): Folder name
```

**Example**
```
{
  "tool": "rag_upload_files",
  "paths": ["Architecture/trendyol-go-api-context7.md", "docs/migros.md"],
  "ifExists": "skip",
  "folder": "food/migros"
}
```

### rag_update_doc_folder

Update a document folder.

```
Parameters:
- documentId (required)
- folder (required)
```

### rag_bulk_update_folders

Bulk update document folders.

```
Parameters:
- mappings (required): [{ documentId, folder }]
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

## RAG / Memory

The MCP server includes a local RAG (Retrieval-Augmented Generation) pipeline for contextual consultations.
Folders (namespaces) can be used to scope documents. A common flow is:
1) `rag_list_folders`
2) `rag_list_docs` with `folder`
3) `rag_search` with `folder` and/or specific `docIds`

### Start Local Embedding Server

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r scripts/embedding_server_requirements.txt
python scripts/embedding_server.py
```

The server listens on `http://127.0.0.1:7999/embed` by default. You can override with `RAG_EMBED_URL`.

### Add Memory Notes

```json
{
  "tool": "rag_add_memory",
  "category": "auth",
  "title": "Login flow",
  "content": "POST /auth/login -> validate -> issue JWT -> response Authorization header"
}
```

### Web UI RAG Features

- Upload multiple documents (txt, md, pdf, docx)
- Select documents to scope searches
- RAG Test with topK/minScore controls
- Real-time document management

## Development

```bash
# Clone the repo
git clone https://github.com/menesekinci/ai-consultation-mcp.git
cd ai-consultation-mcp

# Install dependencies
npm install

# Run in development mode
npm run dev

# Run daemon in development mode
npm run dev:daemon

# Build for production
npm run build

# Run tests
npm test
```

## Security

- **API Key Encryption**: All API keys are encrypted at rest using AES-256-GCM
- **Local-only**: Web UI only accessible on localhost
- **No Logging**: API keys are never logged
- **SQLite WAL Mode**: ACID-compliant database operations prevent data corruption

## License

MIT
