const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

test('Overview has two independent latest-post cards for Signals and Morning AI News', () => {
  assert.match(html, /id="ov-discord-signals"/);
  assert.match(html, /id="ov-discord-ai-news"/);
  assert.match(html, /สัญญาณล่าสุด/);
  assert.match(html, /Morning AI News/);
});

test('Discord card renderer fetches latest public data, inserts content as text, and refreshes periodically', () => {
  assert.match(html, /async function loadDiscordCards\(/);
  assert.match(html, /fetch\(['"]\/discord-cards\.json/);
  assert.match(html, /\.textContent\s*=\s*card\.content/);
  assert.match(html, /setInterval\(loadDiscordCards,\s*60000\)/);
});

test('published cards data keeps the two channels separate with replacement metadata', () => {
  const cards = JSON.parse(fs.readFileSync(path.join(root, 'public/discord-cards.json'), 'utf8'));
  for (const key of ['signals', 'morningAiNews']) {
    assert.ok(cards[key] && typeof cards[key] === 'object', `${key} card exists`);
    assert.equal(cards[key].content, '');
    assert.equal(cards[key].updatedAt, null);
    assert.equal(typeof cards[key].discordUrl, 'string');
  }
});
