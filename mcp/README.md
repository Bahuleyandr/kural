# Kural MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that
exposes the Kural TTS platform to MCP clients — Claude Code, Cursor, or
any other MCP-capable tool.

Like the Kural CLI, the MCP server is a thin adapter: it talks to a
running Kural backend over HTTP and never loads TTS/ASR models itself.

## Tools

| Tool | What it does |
|------|--------------|
| `list_voices` | List Kokoro and Supertonic voices, filterable by engine or language |
| `list_cloned_voices` | List cloned voices saved in the backend |
| `synthesize` | Synthesize text to a WAV/MP3 file with a built-in voice |
| `synthesize_with_cloned_voice` | Synthesize text using an existing cloned voice |
| `transcribe` | Transcribe a local audio/video file with offline ASR |

Voice **cloning** is intentionally not exposed — creating a cloned voice
is consent-gated in Kural and stays a deliberate human action in the
desktop app or CLI. This server can *use* existing clones but never
creates them.

## Installation

```bash
cd mcp
pip install -e .
```

This installs the `kural-mcp` console script.

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `KURAL_HOST` | `http://localhost:8000` | Kural backend base URL |
| `KURAL_API_KEY` | _(unset)_ | Shared secret — only needed if the backend sets `KURAL_API_KEY` |

The Kural backend must be running. Start it with `uvicorn app.main:app`
in `backend/`, or point `KURAL_HOST` at a remote instance.

## Wiring into Claude Code

Add to your MCP settings (`.mcp.json` in a project, or the user-level
config):

```json
{
  "mcpServers": {
    "kural": {
      "command": "kural-mcp",
      "env": {
        "KURAL_HOST": "http://localhost:8000"
      }
    }
  }
}
```

Then ask Claude to "synthesize this paragraph with a Hindi voice" or
"transcribe ~/clip.wav" and it will call the Kural backend.

## Development

```bash
cd mcp
pip install -e ".[dev]"
python -m pytest
```
