# MCP FIPS Server

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for looking up US counties by FIPS code, name, or state. Covers all 50 states, DC, and territories.

## Tools (4 total)

| Tool | Description |
|------|-------------|
| `fips_lookup` | Look up a county by its 5-digit FIPS code |
| `fips_search` | Search counties by name, optionally filtered by state |
| `fips_state` | List all counties in a state by FIPS code or abbreviation |
| `fips_stats` | Get database statistics: total counties, states, and counts by state |

## Install

```bash
npx @easysolutions906/mcp-fips
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "fips": {
      "command": "npx",
      "args": ["-y", "@easysolutions906/mcp-fips"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "fips": {
      "command": "npx",
      "args": ["-y", "@easysolutions906/mcp-fips"]
    }
  }
}
```

## REST API

Set `PORT` env var to run as an HTTP server.

- `GET /lookup?fips=06037` -- look up county by FIPS code
- `GET /search?name=los+angeles&state=CA` -- search counties by name
- `GET /state/:code` -- list all counties in a state (e.g., `/state/CA`)
- `POST /lookup/batch` -- batch lookup multiple FIPS codes
- `GET /stats` -- county counts by state

## Data Source

US Census Bureau FIPS county codes. Run `npm run build-data` to regenerate from the latest Census data.

## Transport

- **stdio** (default) -- for local use with Claude Desktop and Cursor
- **HTTP** -- set `PORT` env var to start in Streamable HTTP mode on `/mcp`
