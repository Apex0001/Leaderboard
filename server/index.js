import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const app = express();
dotenv.config();
const PORT = Number(process.env.PORT) || 3001;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const publicDir = path.join(root, 'public');
const seedParticipantsFile = path.join(here, 'participants.json');
const dataDir = process.env.DATA_DIR || here;
fs.mkdirSync(dataDir, { recursive: true });
const participantsFile = path.join(dataDir, 'participants.json');
if (!fs.existsSync(participantsFile)) fs.copyFileSync(seedParticipantsFile, participantsFile);
let participants = JSON.parse(fs.readFileSync(participantsFile, 'utf8'));
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const loginAttempts = new Map();
app.use(express.json({ limit: '20kb' }));
const CACHE_TTL = 15 * 60 * 1000;
const cache = new Map();
const query = `query getUserProfile($username: String!) {
  matchedUser(username: $username) {
    username
    profile { userAvatar }
    submitStats: submitStatsGlobal { acSubmissionNum { difficulty count } }
  }
}`;

app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(express.static(publicDir, { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function clientKey(req) { return req.ip || req.socket.remoteAddress || 'unknown'; }
function checkWritePassword(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'Admin actions are not configured. Set ADMIN_PASSWORD in your deployment environment.' });
  }
  const key = clientKey(req);
  const now = Date.now();
  const record = loginAttempts.get(key);
  if (record && record.blockedUntil > now) {
    return res.status(429).json({ error: 'Too many incorrect password attempts. Try again later.' });
  }
  if (!safeEqual(req.body?.password, ADMIN_PASSWORD)) {
    const current = record && now - record.firstAt < 15 * 60 * 1000 ? record : { count: 0, firstAt: now, blockedUntil: 0 };
    current.count += 1;
    if (current.count >= 8) current.blockedUntil = now + 15 * 60 * 1000;
    loginAttempts.set(key, current);
    return res.status(current.blockedUntil > now ? 429 : 401).json({ error: current.blockedUntil > now ? 'Too many incorrect password attempts. Try again later.' : 'Incorrect password.' });
  }
  loginAttempts.delete(key);
  next();
}
function saveParticipants(nextParticipants) {
  const tempFile = `${participantsFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(nextParticipants, null, 2), { mode: 0o600 });
  fs.renameSync(tempFile, participantsFile);
  participants = nextParticipants;
  // Newly added or deleted users must not keep stale cached profile data.
  const currentUsernames = new Set(participants.map(person => person.username.toLowerCase()));
  for (const username of cache.keys()) if (!currentUsernames.has(username.toLowerCase())) cache.delete(username);
}
function parseLeetCodeProfile(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Enter a LeetCode profile URL or username.');
  let username = raw;
  if (/^https?:\/\//i.test(raw)) {
    let url;
    try { url = new URL(raw); } catch { throw new Error('Enter a valid LeetCode profile URL.'); }
    if (!['leetcode.com', 'www.leetcode.com'].includes(url.hostname.toLowerCase())) throw new Error('Profile URL must be on leetcode.com.');
    const match = url.pathname.match(/^\/u\/([a-zA-Z0-9_-]+)\/?$/);
    if (!match) throw new Error('Use a profile URL like https://leetcode.com/u/username/.');
    username = match[1];
  } else if (!/^[a-zA-Z0-9_-]{1,50}$/.test(raw)) {
    throw new Error('Enter a valid LeetCode username or profile URL.');
  }
  return { username, profileUrl: `https://leetcode.com/u/${encodeURIComponent(username)}/` };
}

async function getProfile(person) {
  const cached = cache.get(person.username);
  if (cached && Date.now() - cached.at < CACHE_TTL) return { ...cached.value, cached: true };
  try {
    const response = await fetch('https://leetcode.com/graphql/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': `https://leetcode.com/u/${encodeURIComponent(person.username)}/`,
        'User-Agent': 'Mozilla/5.0 ProudChitkariansLeaderboard/2.0'
      },
      body: JSON.stringify({ query, variables: { username: person.username } }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error(`LeetCode returned HTTP ${response.status}`);
    const payload = await response.json();
    const user = payload?.data?.matchedUser;
    if (!user) throw new Error('LeetCode profile is unavailable');
    const stats = user.submitStats?.acSubmissionNum || [];
    const countFor = difficulty => {
      const item = stats.find(entry => entry.difficulty === difficulty);
      return Number.isFinite(item?.count) ? item.count : 0;
    };
    const all = stats.find(item => item.difficulty === 'All');
    const value = {
      name: person.name,
      username: person.username,
      profileUrl: person.profileUrl,
      avatar: user.profile?.userAvatar || null,
      solved: Number.isFinite(all?.count) ? all.count : null,
      medium: countFor('Medium'),
      hard: countFor('Hard'),
      status: Number.isFinite(all?.count) ? 'ok' : 'unavailable'
    };
    cache.set(person.username, { at: Date.now(), value });
    return value;
  } catch (error) {
    console.warn(`Could not refresh ${person.username}: ${error.message}`);
    if (cached) return { ...cached.value, status: 'stale', cached: true };
    return { name: person.name, username: person.username, profileUrl: person.profileUrl, avatar: null, solved: null, medium: 0, hard: 0, status: 'unavailable' };
  }
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

app.get('/api/leaderboard', async (_req, res) => {
  try {
    const people = await mapLimit(participants, 4, getProfile);
    people.sort((a, b) => {
      if (a.solved == null && b.solved == null) return a.name.localeCompare(b.name);
      if (a.solved == null) return 1;
      if (b.solved == null) return -1;
      // Unique ranks: total solved first, then Medium, then Hard, then name.
      return b.solved - a.solved
        || (b.medium || 0) - (a.medium || 0)
        || (b.hard || 0) - (a.hard || 0)
        || a.name.localeCompare(b.name);
    });
    const ranked = people.map((person, index) => ({
      ...person,
      // Never share a rank. Profiles with unavailable totals remain unranked.
      rank: person.solved == null ? null : index + 1
    }));
    res.set('Cache-Control', 'no-store');
    res.json({ participants: ranked, updatedAt: new Date().toISOString(), refreshAfterMs: CACHE_TTL, source: 'LeetCode public GraphQL profile data' });
  } catch (error) {
    console.error('Leaderboard request failed:', error);
    res.status(500).json({ error: 'Unable to load the leaderboard right now.' });
  }
});
app.post('/api/admin/participants', checkWritePassword, (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Name must be between 2 and 80 characters.' });
    const { username, profileUrl } = parseLeetCodeProfile(req.body?.profileUrl || req.body?.username);
    if (participants.some(person => person.username.toLowerCase() === username.toLowerCase())) {
      return res.status(409).json({ error: 'That LeetCode account is already on the leaderboard.' });
    }
    const updated = [...participants, { name, username, profileUrl }];
    saveParticipants(updated);
    res.status(201).json({ ok: true, message: `${name} was added. Rankings will refresh now.`, participantCount: participants.length });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not add participant.' });
  }
});
app.delete('/api/admin/participants/:username', checkWritePassword, (req, res) => {
  const username = String(req.params.username || '');
  const existing = participants.find(person => person.username.toLowerCase() === username.toLowerCase());
  if (!existing) return res.status(404).json({ error: 'Participant not found.' });
  try {
    saveParticipants(participants.filter(person => person.username.toLowerCase() !== username.toLowerCase()));
    res.json({ ok: true, message: `${existing.name} was removed.`, participantCount: participants.length });
  } catch (error) {
    console.error('Could not save participant list:', error);
    res.status(500).json({ error: 'Could not save changes. Check server storage permissions.' });
  }
});
app.get('/api/health', (_req, res) => res.json({ ok: true, participants: participants.length }));
app.use((error, _req, res, next) => {
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Invalid request body.' });
  next(error);
});
app.get('*', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.listen(PORT, () => console.log(`Proud Chitkarians is running at http://localhost:${PORT}`));
