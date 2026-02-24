#!/bin/bash

set -e

echo "🤖 Setting up embedding model..."

# Check if Ollama is installed
if ! command -v ollama &> /dev/null; then
    echo "📦 Ollama not found. Installing..."
    
    if command -v brew &> /dev/null; then
        brew install ollama
    elif command -v curl &> /dev/null; then
        # Linux installation
        curl -fsSL https://ollama.com/install.sh | sh
    else
        echo "⚠️  Please install Ollama manually: https://ollama.com/download"
        exit 0
    fi
fi

# Start Ollama serve in background (only if not already running)
if ! curl -s http://localhost:11434 > /dev/null 2>&1; then
    echo "🚀 Starting Ollama..."
    ollama serve &
    sleep 3
fi

# Pull embedding model
echo "📥 Pulling nomic-embed-text model (~274MB)..."
ollama pull nomic-embed-text

echo "✅ Embedding model ready!"
