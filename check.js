// Soft Latte CurseForge -> Discord feed.
// watchGame: every new inZOI mod and every new file on any inZOI mod. projects: extra single projects (optional).
// Secrets (GitHub: Settings -> Secrets and variables -> Actions): CF_API_KEY and DISCORD_WEBHOOK_URL.
const fs = require('fs');
const path = require('path');

const API = 'https://api.curseforge.com/v1';
const STATE_FILE = path.join(__dirname, 'state.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const RELEASE = { 1: 'Release', 2: 'Beta', 3: 'Alpha' };
const SEEN_MAX = 5000, NEW_MAX = 1000, PAGE = 50, POST_GAP_MS = 2200;

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function htmlToText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}
function cut(text, max) { text = String(text || ''); return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text; }
function hex(c, d) { return parseInt(String(c || d).replace('#', ''), 16); }

async function cf(fetchFn, key, url) {
  const res = await fetchFn(API + url, { headers: { 'x-api-key': key, Accept: 'application/json' } });
  if (!res.ok) throw new Error('CurseForge ' + res.status + ' for ' + url);
  return res.json();
}

function buildEmbed(mod, file, changelog, config, isNew) {
  const base = (mod.links && mod.links.websiteUrl) ? mod.links.websiteUrl.replace(/\/$/, '') : '';
  const authors = (mod.authors || []).map(a => a.name).filter(Boolean).join(', ');
  const fields = [];
  if (authors) fields.push({ name: 'By', value: cut(authors, 1024), inline: true });
  fields.push({ name: 'File', value: cut(file.displayName || file.fileName || ('#' + file.id), 1024), inline: true });
  if (RELEASE[file.releaseType] && file.releaseType !== 1) fields.push({ name: 'Type', value: RELEASE[file.releaseType], inline: true });
  const embed = {
    title: cut((isNew ? 'New mod: ' : 'Update: ') + mod.name, 256),
    url: base ? (isNew ? base : base + '/files/' + file.id) : undefined,
    color: isNew ? hex(config.newModColor, '#C98B6B') : hex(config.color, '#6F4E37'),
    fields,
    timestamp: file.fileDate || new Date().toISOString(),
  };
  const text = isNew ? (mod.summary || changelog) : (changelog || '');
  if (text) embed.description = cut(text, isNew ? 600 : 1000);
  if (mod.logo && mod.logo.thumbnailUrl) embed.thumbnail = { url: mod.logo.thumbnailUrl };
  return embed;
}

async function gameId(fetchFn, key, slug, state) {
  if (state.gameId && state.gameSlug === slug) return state.gameId;
  for (let index = 0; index < 2000; index += 50) {
    const r = await cf(fetchFn, key, '/games?index=' + index + '&pageSize=50');
    const g = (r.data || []).find(x => String(x.slug).toLowerCase() === slug.toLowerCase());
    if (g) { state.gameId = g.id; state.gameSlug = slug; return g.id; }
    if (!r.data || r.data.length < 50) break;
  }
  throw new Error('Game "' + slug + '" not found on CurseForge');
}

// The mods changed in the last lookbackDays, newest first (sortField 3 = last updated).
async function recentMods(fetchFn, key, gid, since, maxPages) {
  const out = [];
  for (let p = 0; p < maxPages; p++) {
    const r = await cf(fetchFn, key, '/mods/search?gameId=' + gid + '&sortField=3&sortOrder=desc&pageSize=' + PAGE + '&index=' + (p * PAGE));
    const list = r.data || [];
    let older = false;
    for (const m of list) { if (new Date(m.dateModified) < since) { older = true; break; } out.push(m); }
    if (older || list.length < PAGE) break;
  }
  return out;
}

async function run(opts) {
  opts = opts || {};
  const fetchFn = opts.fetch || fetch;
  const env = opts.env || process.env;
  const config = opts.config || readJson(CONFIG_FILE, { projects: [] });
  const state = opts.state || readJson(STATE_FILE, {});
  const gap = opts.gapMs != null ? opts.gapMs : POST_GAP_MS;
  const nowMs = opts.now || Date.now();
  const key = env.CF_API_KEY, hook = env.DISCORD_WEBHOOK_URL;
  if (!key) throw new Error('CF_API_KEY secret is missing');
  if (!hook) throw new Error('DISCORD_WEBHOOK_URL secret is missing');

  const seen = new Set(state.seenFiles || []);
  const announced = new Set(state.announcedNew || []);
  const firstRun = !state.started;
  const quiet = firstRun && !config.postExistingOnFirstRun;
  let posted = 0, problems = 0;

  // Gather candidates: [mod, file]
  const todo = [];
  const W = config.watchGame || {};
  if (W.on) {
    try {
      const gid = await gameId(fetchFn, key, W.gameSlug || 'inzoi', state);
      const since = new Date(nowMs - (W.lookbackDays || 3) * 864e5);
      for (const m of await recentMods(fetchFn, key, gid, since, W.maxPagesPerRun || 10)) {
        for (const f of (m.latestFiles || [])) if (f.isAvailable !== false && new Date(f.fileDate) >= since) todo.push([m, f]);
      }
    } catch (e) { problems++; console.error('Problem watching the game: ' + e.message); }
  }
  for (const p of config.projects || []) {
    const id = Number(p.id);
    if (!(id > 0)) continue;
    try {
      const mod = (await cf(fetchFn, key, '/mods/' + id)).data;
      const files = (await cf(fetchFn, key, '/mods/' + id + '/files?pageSize=20')).data || [];
      for (const f of files) if (f.isAvailable !== false) todo.push([mod, f]);
    } catch (e) { problems++; console.error('Problem with project ' + id + ': ' + e.message); }
  }

  const fresh = todo.filter(([, f]) => !seen.has(f.id))
    .sort((a, b) => new Date(a[1].fileDate) - new Date(b[1].fileDate));
  const done = new Set();
  for (const [mod, f] of fresh) {
    if (done.has(f.id)) continue;
    done.add(f.id);
    if (quiet) { seen.add(f.id); announced.add(mod.id); continue; }
    const isNew = !announced.has(mod.id) && (nowMs - new Date(mod.dateCreated || 0).getTime()) < 7 * 864e5;
    try {
      let changelog = '';
      if (!isNew) { try { changelog = htmlToText((await cf(fetchFn, key, '/mods/' + mod.id + '/files/' + f.id + '/changelog')).data); } catch (e) { changelog = ''; } }
      const body = { username: config.botName || 'Mod Updates', embeds: [buildEmbed(mod, f, changelog, config, isNew)] };
      let r = await fetchFn(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.status === 429) { await sleep(5000); r = await fetchFn(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
      if (!r.ok) throw new Error('Discord ' + r.status);
      seen.add(f.id); announced.add(mod.id); posted++;
      console.log('Posted ' + (isNew ? 'NEW ' : '') + mod.name + ' - ' + (f.displayName || f.id));
      if (gap) await sleep(gap);
    } catch (e) {
      problems++;
      console.error('Could not post ' + mod.name + ': ' + e.message + ' (tried again next run)');
      break;   // Discord trouble: stop for this run, keep the rest for next time
    }
  }
  if (quiet) console.log('First run: remembered ' + done.size + ' recent file(s) without posting');

  state.started = true;
  state.seenFiles = Array.from(seen).slice(-SEEN_MAX);
  state.announcedNew = Array.from(announced).slice(-NEW_MAX);
  if (!opts.noWrite) fs.writeFileSync(STATE_FILE, JSON.stringify(state) + '\n');
  console.log('Done: ' + posted + ' post(s), ' + problems + ' problem(s)');
  if (problems && !opts.noExit) process.exitCode = 1;
  return { posted, problems, state };
}

module.exports = { run, htmlToText, buildEmbed };
if (require.main === module) run().catch(e => { console.error(e.message); process.exit(1); });
