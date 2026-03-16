#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import * as fips from './tools/fips.js';
import { authMiddleware, createKey, revokeKey, PLANS, incrementUsage } from './keys.js';
import { createCheckoutSession, handleWebhook } from './stripe.js';

const server = new McpServer({
  name: 'mcp-fips',
  version: '1.0.0',
});

// --- FIPS Tools ---

server.tool(
  'fips_lookup',
  `Look up a US county by its 5-digit FIPS code. Returns county name, state, and state abbreviation. Database contains ${fips.totalCounties.toLocaleString()} counties.`,
  { fips: z.string().describe('5-digit FIPS code (e.g., "06037" for Los Angeles County, CA)') },
  async ({ fips: code }) => ({
    content: [{ type: 'text', text: JSON.stringify(fips.lookup(code), null, 2) }],
  }),
);

server.tool(
  'fips_search',
  'Search US counties by name. Optionally filter by state. Returns matching counties with their FIPS codes, sorted by relevance.',
  {
    name: z.string().describe('County name to search for (e.g., "Los Angeles", "Cook", "Harris")'),
    state: z.string().optional().describe('2-letter state abbreviation to filter by (e.g., "CA", "TX")'),
    limit: z.number().optional().describe('Max results to return (default 25, max 100)'),
  },
  async ({ name, state, limit }) => ({
    content: [{ type: 'text', text: JSON.stringify(fips.search(name, state, limit), null, 2) }],
  }),
);

server.tool(
  'fips_state',
  'List all counties in a US state by state FIPS code or 2-letter abbreviation. Returns county names and FIPS codes sorted alphabetically.',
  { code: z.string().describe('2-digit state FIPS code or 2-letter abbreviation (e.g., "06" or "CA" for California)') },
  async ({ code }) => ({
    content: [{ type: 'text', text: JSON.stringify(fips.stateCounties(code), null, 2) }],
  }),
);

server.tool(
  'fips_stats',
  'Get statistics about the FIPS county database: total counties, total states/territories, and county counts by state.',
  {},
  async () => ({
    content: [{ type: 'text', text: JSON.stringify(fips.stats(), null, 2) }],
  }),
);

// --- Start ---

const TOOL_COUNT = 4;

const main = async () => {
  const port = process.env.PORT;

  if (port) {
    const app = express();
    app.use(express.json());

    app.get('/health', (_req, res) => {
      res.json({ status: 'ok' });
    });

    app.get('/', (_req, res) => {
      res.json({
        name: 'FIPS County Code Lookup',
        version: '1.0.0',
        description: `Look up US counties by FIPS code, name, or state. ${fips.totalCounties.toLocaleString()} counties indexed.`,
        tools: TOOL_COUNT,
        transport: 'streamable-http',
        plans: PLANS,
        endpoints: {
          'GET /lookup': 'Look up county by FIPS code',
          'GET /search': 'Search counties by name',
          'GET /state/:code': 'List all counties in a state',
          'GET /stats': 'Database statistics',
          'POST /lookup/batch': 'Batch lookup multiple FIPS codes',
        },
      });
    });

    // --- FIPS endpoints ---

    app.get('/lookup', authMiddleware, (req, res) => {
      const { fips: code } = req.query;
      if (!code) {
        return res.status(400).json({ error: 'Missing required parameter: fips' });
      }
      incrementUsage(req.identifier);
      res.json(fips.lookup(code));
    });

    app.get('/search', authMiddleware, (req, res) => {
      const { name, state, limit } = req.query;
      if (!name) {
        return res.status(400).json({ error: 'Missing required parameter: name' });
      }
      incrementUsage(req.identifier);
      res.json(fips.search(name, state, limit ? parseInt(limit, 10) : undefined));
    });

    app.get('/state/:code', authMiddleware, (req, res) => {
      incrementUsage(req.identifier);
      res.json(fips.stateCounties(req.params.code));
    });

    app.get('/stats', (_req, res) => {
      res.json(fips.stats());
    });

    app.post('/lookup/batch', authMiddleware, (req, res) => {
      const { codes = [] } = req.body;

      if (codes.length === 0) {
        return res.status(400).json({ error: 'Provide at least one FIPS code in the "codes" array' });
      }

      if (codes.length > req.plan.batchLimit) {
        return res.status(400).json({
          error: `Batch size ${codes.length} exceeds your plan limit of ${req.plan.batchLimit}`,
          plan: req.planName,
        });
      }

      incrementUsage(req.identifier, codes.length);

      const results = codes.map((code) => fips.lookup(code));
      const found = results.filter((r) => r.found).length;

      res.json({
        results,
        summary: { total: codes.length, found, notFound: codes.length - found },
      });
    });

    // --- Stripe checkout ---
    app.post('/checkout', async (req, res) => {
      try {
        const { plan, success_url, cancel_url } = req.body;
        const session = await createCheckoutSession(plan, success_url, cancel_url);
        res.json(session);
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });

    // --- Stripe webhook ---
    app.post('/webhook/stripe', express.raw({ type: 'application/json' }), (req, res) => {
      try {
        const result = handleWebhook(req.body, req.headers['stripe-signature']);
        res.json({ received: true, result });
      } catch (err) {
        console.error('[webhook] Error:', err.message);
        res.status(400).json({ error: err.message });
      }
    });

    // --- Admin key management ---
    const adminAuth = (req, res, next) => {
      const secret = process.env.ADMIN_SECRET;
      if (!secret || req.headers['x-admin-secret'] !== secret) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      next();
    };

    app.post('/admin/keys', adminAuth, (req, res) => {
      const { plan, email } = req.body;
      const result = createKey(plan, email);
      res.json(result);
    });

    app.delete('/admin/keys/:key', adminAuth, (req, res) => {
      const revoked = revokeKey(req.params.key);
      res.json({ revoked });
    });

    // --- MCP transport ---
    const transports = {};

    app.post('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'];
      let transport = transports[sessionId];

      if (!transport) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });
        transport.onclose = () => {
          if (transport.sessionId) {
            delete transports[transport.sessionId];
          }
        };
        await server.connect(transport);
        transports[transport.sessionId] = transport;
      }

      await transport.handleRequest(req, res, req.body);
    });

    app.get('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'];
      const transport = transports[sessionId];
      if (!transport) {
        res.status(400).json({ error: 'No active session. Send a POST to /mcp first.' });
        return;
      }
      await transport.handleRequest(req, res);
    });

    app.delete('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'];
      const transport = transports[sessionId];
      if (!transport) {
        res.status(400).json({ error: 'No active session.' });
        return;
      }
      await transport.handleRequest(req, res);
    });

    app.listen(parseInt(port, 10), () => {
      console.log(`FIPS county lookup server running on HTTP port ${port}`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
};

main().catch((err) => {
  console.error('Failed to start FIPS server:', err);
  process.exit(1);
});
