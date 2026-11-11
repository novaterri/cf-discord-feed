const assert = require('assert');
const { run, htmlToText } = require('./check.js');
const NOW = Date.parse('2026-11-12T12:00:00Z');
function api(mods, opts = {}) {
  const posts = [], calls = [];
  const fetch = async (url, o) => {
    calls.push(url);
    if (url.startsWith('https://discord')) { posts.push(JSON.parse(o.body)); const bad = opts.failAfter != null && posts.length > opts.failAfter; return { ok: !bad, status: bad ? 500 : 204 }; }
    assert.strictEqual(o.headers['x-api-key'], 'KEY');
    if (url.includes('/games?')) return { ok: true, json: async () => ({ data: [{ id: 99, slug: 'sims4' }, { id: 777, slug: 'inzoi' }] }) };
    if (url.includes('/mods/search?')) { assert.ok(url.includes('gameId=777') && url.includes('sortField=3')); const idx = +url.match(/index=(\d+)/)[1]; return { ok: true, json: async () => ({ data: mods.slice(idx, idx + 50) }) }; }
    if (/\/changelog$/.test(url)) return { ok: true, json: async () => ({ data: '<p>Fixed <b>calls</b></p>' }) };
    throw new Error('unexpected ' + url);
  };
  return { fetch, posts, calls };
}
const mod = (id, name, created, modified, files) => ({ id, name, dateCreated: created, dateModified: modified, summary: name + ' summary',
  authors: [{ name: 'Someone' }], links: { websiteUrl: 'https://www.curseforge.com/inzoi/mods/m' + id }, latestFiles: files });
const file = (id, date) => ({ id, displayName: 'v' + id, fileDate: date, releaseType: 1 });
(async () => {
  const env = { CF_API_KEY: 'KEY', DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/x' };
  const config = { watchGame: { on: true, gameSlug: 'inzoi', lookbackDays: 3, maxPagesPerRun: 10 }, projects: [], botName: 'Soft Latte Updates' };
  const o = { env, config, noWrite: true, noExit: true, gapMs: 0, now: NOW };
  // run 1 (first run): remembers, posts nothing; old mods beyond lookback are ignored
  let A = api([mod(1, 'Grapevine', '2026-09-01T00:00:00Z', '2026-11-11T10:00:00Z', [file(100, '2026-11-11T10:00:00Z')]),
               mod(2, 'Old Thing', '2026-01-01T00:00:00Z', '2026-10-01T00:00:00Z', [file(200, '2026-10-01T00:00:00Z')])]);
  let r = await run({ ...o, fetch: A.fetch, state: {} });
  assert.strictEqual(A.posts.length, 0); assert.ok(r.state.seenFiles.includes(100)); assert.ok(!r.state.seenFiles.includes(200)); assert.strictEqual(r.state.gameId, 777);
  // run 2: a brand-new mod + an update to Grapevine -> 2 posts, oldest first, right labels/links
  A = api([mod(3, 'Coffee Menu', '2026-11-12T08:00:00Z', '2026-11-12T09:00:00Z', [file(300, '2026-11-12T09:00:00Z')]),
           mod(1, 'Grapevine', '2026-09-01T00:00:00Z', '2026-11-12T07:00:00Z', [file(101, '2026-11-12T07:00:00Z'), file(100, '2026-11-11T10:00:00Z')])]);
  r = await run({ ...o, fetch: A.fetch, state: r.state });
  assert.strictEqual(A.posts.length, 2);
  assert.strictEqual(A.posts[0].embeds[0].title, 'Update: Grapevine');
  assert.ok(A.posts[0].embeds[0].url.endsWith('/m1/files/101')); assert.ok(A.posts[0].embeds[0].description.includes('Fixed calls'));
  assert.strictEqual(A.posts[1].embeds[0].title, 'New mod: Coffee Menu'); assert.ok(A.posts[1].embeds[0].url.endsWith('/m3'));
  assert.ok(!A.calls.some(u => u.includes('/games?')), 'game id cached');
  // run 3: same data -> nothing; then a second file for the new mod -> "Update", not "New mod" again
  A = api([mod(3, 'Coffee Menu', '2026-11-12T08:00:00Z', '2026-11-12T10:00:00Z', [file(301, '2026-11-12T10:00:00Z'), file(300, '2026-11-12T09:00:00Z')])]);
  r = await run({ ...o, fetch: A.fetch, state: r.state });
  assert.strictEqual(A.posts.length, 1); assert.strictEqual(A.posts[0].embeds[0].title, 'Update: Coffee Menu');
  // Discord fails after 1 post: first remembered, second retried next run
  A = api([mod(4, 'A', '2026-01-01T00:00:00Z', '2026-11-12T11:00:00Z', [file(400, '2026-11-12T10:30:00Z'), file(401, '2026-11-12T11:00:00Z')])], { failAfter: 1 });
  r = await run({ ...o, fetch: A.fetch, state: r.state });
  assert.strictEqual(r.posted, 1); assert.strictEqual(r.problems, 1); assert.ok(r.state.seenFiles.includes(400)); assert.ok(!r.state.seenFiles.includes(401));
  A = api([mod(4, 'A', '2026-01-01T00:00:00Z', '2026-11-12T11:00:00Z', [file(400, '2026-11-12T10:30:00Z'), file(401, '2026-11-12T11:00:00Z')])]);
  r = await run({ ...o, fetch: A.fetch, state: r.state });
  assert.strictEqual(A.posts.length, 1); assert.ok(A.posts[0].embeds[0].title.includes('A'));
  // paging: 120 recent mods -> 3 pages read
  const many = Array.from({ length: 120 }, (_, i) => mod(1000 + i, 'M' + i, '2026-01-01T00:00:00Z', '2026-11-12T11:00:00Z', [file(5000 + i, '2026-11-12T11:00:00Z')]));
  A = api(many); r = await run({ ...o, fetch: A.fetch, state: r.state });
  assert.strictEqual(A.posts.length, 120); assert.strictEqual(A.calls.filter(u => u.includes('/mods/search?')).length, 3);
  await assert.rejects(run({ ...o, fetch: A.fetch, env: {}, state: {} }));
  assert.strictEqual(htmlToText('a<br>b&nbsp;c'), 'a\nb c');
  console.log('all tests passed');
})().catch(e => { console.error(e); process.exit(1); });
