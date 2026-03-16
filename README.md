# FIPS County Code Lookup API + MCP Server

Look up US counties by FIPS code, name, or state. ~3,200 counties from all 50 states, DC, and territories.

## Endpoints

- `GET /` — API info
- `GET /health` — health check
- `GET /lookup?fips=06037` — look up by FIPS code
- `GET /search?name=los+angeles&state=CA` — search by county name
- `GET /state/:code` — list all counties in a state (e.g., `/state/06` or `/state/CA`)
- `POST /lookup/batch` — batch lookup multiple FIPS codes
- `GET /stats` — county count by state

## MCP Transport

- **Stdio**: run without `PORT` env var
- **Streamable HTTP**: set `PORT` env var, connect to `/mcp`

## Data Generation

```bash
npm run build-data
```

## Local Development

```bash
npm install
npm run build-data
npm run dev
```

## Deploy

```bash
# Railway
railway up
```
