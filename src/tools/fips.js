import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '..', 'data', 'fips.json');

const fipsMap = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
const totalCounties = Object.keys(fipsMap).length;

// Build indexes for search
const byState = {};
Object.values(fipsMap).forEach((entry) => {
  const key = entry.stateFips;
  if (!byState[key]) { byState[key] = []; }
  byState[key].push(entry);
});

// State abbreviation to FIPS mapping
const abbrToStateFips = {};
Object.values(fipsMap).forEach((entry) => {
  abbrToStateFips[entry.stateAbbr] = entry.stateFips;
});

const lookup = (fipsCode) => {
  if (!fipsCode || typeof fipsCode !== 'string') {
    return { found: false, error: 'FIPS code is required' };
  }

  const cleaned = fipsCode.trim().padStart(5, '0');

  if (!/^\d{5}$/.test(cleaned)) {
    return { found: false, fips: cleaned, error: 'FIPS code must be 5 digits (2 state + 3 county)' };
  }

  const entry = fipsMap[cleaned];
  if (!entry) {
    return { found: false, fips: cleaned, error: 'FIPS code not found' };
  }

  return { found: true, ...entry };
};

const search = (name, state = null, limit = 25) => {
  if (!name || typeof name !== 'string') {
    return { results: [], error: 'Search name is required' };
  }

  const needle = name.trim().toLowerCase();
  const maxResults = Math.min(Math.max(1, limit), 100);

  let candidates = Object.values(fipsMap);

  // Filter by state if provided
  if (state) {
    const stateUpper = state.trim().toUpperCase();
    const stateFips = abbrToStateFips[stateUpper] || stateUpper;
    candidates = candidates.filter(
      (e) => e.stateFips === stateFips || e.stateAbbr === stateUpper,
    );
  }

  // Score and filter matches
  const scored = candidates
    .map((entry) => {
      const countyLower = entry.county.toLowerCase();
      let score = 0;

      if (countyLower === needle) {
        score = 100;
      } else if (countyLower.startsWith(needle)) {
        score = 80;
      } else if (countyLower.includes(needle)) {
        score = 60;
      } else {
        // Try without "county"/"parish" suffix
        const bare = countyLower
          .replace(/ county$/, '')
          .replace(/ parish$/, '')
          .replace(/ borough$/, '')
          .replace(/ census area$/, '')
          .replace(/ municipality$/, '')
          .replace(/ municipio$/, '')
          .replace(/ city$/, '')
          .replace(/ district$/, '');

        if (bare === needle) {
          score = 90;
        } else if (bare.startsWith(needle)) {
          score = 70;
        } else if (bare.includes(needle)) {
          score = 50;
        }
      }

      return { entry, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((s) => s.entry);

  return { results: scored, total: scored.length };
};

const stateCounties = (stateCode) => {
  if (!stateCode || typeof stateCode !== 'string') {
    return { error: 'State code is required (2-digit FIPS or 2-letter abbreviation)' };
  }

  const cleaned = stateCode.trim().toUpperCase();
  const stateFips = abbrToStateFips[cleaned] || cleaned.padStart(2, '0');
  const counties = byState[stateFips];

  if (!counties || counties.length === 0) {
    return { found: false, stateCode: cleaned, error: 'No counties found for this state code' };
  }

  return {
    found: true,
    stateCode: stateFips,
    stateName: counties[0].state,
    stateAbbr: counties[0].stateAbbr,
    count: counties.length,
    counties: counties.sort((a, b) => a.county.localeCompare(b.county)),
  };
};

const stats = () => {
  const stateStats = Object.entries(byState)
    .map(([stateFips, counties]) => ({
      stateFips,
      state: counties[0].state,
      stateAbbr: counties[0].stateAbbr,
      counties: counties.length,
    }))
    .sort((a, b) => b.counties - a.counties);

  return {
    totalCounties,
    totalStates: stateStats.length,
    byState: stateStats,
  };
};

export { lookup, search, stateCounties, stats, totalCounties };
