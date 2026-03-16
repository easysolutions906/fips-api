import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS_PATH = join(__dirname, 'data', 'keys.json');

// --- Plans ---

const PLANS = {
  free: { name: 'Free', lookupsPerDay: 100, batchLimit: 10, ratePerMinute: 10 },
  starter: { name: 'Starter', lookupsPerDay: 1000, batchLimit: 50, ratePerMinute: 30 },
  pro: { name: 'Pro', lookupsPerDay: 10000, batchLimit: 100, ratePerMinute: 60 },
  business: { name: 'Business', lookupsPerDay: 50000, batchLimit: 200, ratePerMinute: 200 },
  enterprise: { name: 'Enterprise', lookupsPerDay: 200000, batchLimit: 500, ratePerMinute: 500 },
};

// --- Key storage (JSON file) ---

const loadKeys = () => {
  if (!existsSync(KEYS_PATH)) { return {}; }
  return JSON.parse(readFileSync(KEYS_PATH, 'utf-8'));
};

const saveKeys = (keys) => {
  writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2) + '\n');
};

// --- Usage tracking (in-memory, resets daily) ---

const usage = new Map();

const today = () => new Date().toISOString().slice(0, 10);

const getUsage = (identifier) => {
  const current = usage.get(identifier);
  const d = today();
  if (!current || current.date !== d) {
    usage.set(identifier, { date: d, lookups: 0 });
    return usage.get(identifier);
  }
  return current;
};

const incrementUsage = (identifier, count = 1) => {
  const u = getUsage(identifier);
  u.lookups += count;
};

// --- Rate limiting (sliding window per minute) ---

const rateBuckets = new Map();

const checkRateLimit = (identifier, maxPerMinute) => {
  const now = Date.now();
  const window = 60000;
  const bucket = rateBuckets.get(identifier) || [];
  const recent = bucket.filter((t) => now - t < window);
  rateBuckets.set(identifier, recent);

  if (recent.length >= maxPerMinute) {
    return { allowed: false, retryAfterMs: window - (now - recent[0]) };
  }

  recent.push(now);
  return { allowed: true };
};

// --- Key management ---

const createKey = (plan = 'pro', email = null, stripeCustomerId = null) => {
  const keys = loadKeys();
  const apiKey = `fips_${randomUUID().replace(/-/g, '')}`;

  keys[apiKey] = {
    plan,
    email,
    stripeCustomerId,
    createdAt: new Date().toISOString(),
    active: true,
  };

  saveKeys(keys);
  return { apiKey, plan, ...PLANS[plan] };
};

const revokeKey = (apiKey) => {
  const keys = loadKeys();
  if (keys[apiKey]) {
    keys[apiKey].active = false;
    keys[apiKey].revokedAt = new Date().toISOString();
    saveKeys(keys);
    return true;
  }
  return false;
};

const validateKey = (apiKey) => {
  if (!apiKey) { return null; }
  const keys = loadKeys();
  const entry = keys[apiKey];
  if (!entry || !entry.active) { return null; }
  return { ...entry, ...PLANS[entry.plan] };
};

// --- Express middleware ---

const authMiddleware = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;

  const keyData = validateKey(apiKey);
  const plan = keyData ? PLANS[keyData.plan] : PLANS.free;
  const identifier = apiKey || `ip:${clientIp}`;

  // Rate limit check
  const rateCheck = checkRateLimit(identifier, plan.ratePerMinute);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfterMs: rateCheck.retryAfterMs,
      plan: keyData ? keyData.plan : 'free',
      limit: `${plan.ratePerMinute}/minute`,
    });
  }

  // Daily usage check
  const u = getUsage(identifier);
  if (u.lookups >= plan.lookupsPerDay) {
    return res.status(429).json({
      error: 'Daily lookup limit exceeded',
      used: u.lookups,
      limit: plan.lookupsPerDay,
      plan: keyData ? keyData.plan : 'free',
      resetsAt: `${today()}T23:59:59Z`,
      upgrade: apiKey ? 'Contact support to upgrade your plan' : 'Add an API key to increase your limit',
    });
  }

  req.plan = plan;
  req.planName = keyData ? keyData.plan : 'free';
  req.identifier = identifier;
  req.apiKey = apiKey || null;

  next();
};

export {
  PLANS,
  loadKeys,
  createKey,
  revokeKey,
  validateKey,
  authMiddleware,
  incrementUsage,
};
