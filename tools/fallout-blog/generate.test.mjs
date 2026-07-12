import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildArticleHtml,
  detectContentType,
  extractFeedItems,
  freshnessBonus,
  getArticleWordCount,
  getBloggerInsertUrl,
  getStoryFingerprint,
  getStoryTopicFingerprint,
  getStoryTopicKey,
  isArticleSubstantive,
  meetsMinimumSourceQuality,
  parseRssDate,
  pickFeaturedStory,
  selectStoriesForGeneration
} from './generate.mjs';

test('selectStoriesForGeneration skips previously covered topics across sources', () => {
  const item = { source: 'IGN', title: 'Fallout 76 gets a big update', link: 'https://example.com/1', contentType: 'news', description: 'Bethesda has rolled out a major Fallout 76 update with new seasonal content, balance changes, and quality-of-life fixes for players.' };
  const history = [{ topicFingerprint: getStoryTopicKey(item), coveredAt: Date.now() }];

  const items = [
    item,
    { source: 'GamesRadar', title: 'Fallout 76 gets a big update', link: 'https://example.com/2', contentType: 'news', description: 'Another outlet reports the same Fallout 76 update with additional commentary from the community and official channels.' },
    { source: 'Eurogamer', title: 'Bethesda teases more Fallout news', link: 'https://example.com/3', contentType: 'news', description: 'Bethesda has hinted at more Fallout announcements coming later this year, including possible updates for Fallout 76 and broader franchise plans.' }
  ];

  const fresh = selectStoriesForGeneration(items, history);

  assert.deepEqual(fresh.map((story) => story.title), ['Bethesda teases more Fallout news']);
});

test('selectStoriesForGeneration rejects thin RSS summaries', () => {
  const items = [
    { source: 'IGN', title: 'Fallout update', link: 'https://example.com/thin', contentType: 'news', description: 'Short blurb.' },
    { source: 'Eurogamer', title: 'Fallout 76 season launch brings new rewards', link: 'https://example.com/rich', contentType: 'news', description: 'The new Fallout 76 season introduces fresh rewards, daily challenges, quality-of-life improvements, and a revised progression track for returning players.' }
  ];

  const fresh = selectStoriesForGeneration(items, []);

  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].title, 'Fallout 76 season launch brings new rewards');
});

test('pickFeaturedStory rotates toward underused content types', () => {
  const items = [
    { source: 'IGN', title: 'Fallout 76 patch notes arrive', link: 'https://example.com/news', contentType: 'news', description: 'Bethesda has published new Fallout 76 patch notes with balance updates, bug fixes, seasonal content, and quality-of-life improvements for players returning this week.' },
    { source: 'r/FalloutMods', title: 'New Appalachia overhaul mod released', link: 'https://example.com/mod', contentType: 'mods', description: 'A major visual overhaul mod for Fallout 76 has released on Nexus with updated textures, lighting, weather tweaks, and optional performance presets for PC players.' },
    { source: 'r/fallout', title: 'Incredible Vault Dweller cosplay from Dragon Con', link: 'https://example.com/cosplay', contentType: 'community', description: 'A fan shared an detailed Vault Dweller cosplay build with handmade pip-boy, weathered armor, and screen-accurate props from the Fallout TV series.' }
  ];

  const history = Array.from({ length: 4 }).map(() => ({
    contentType: 'news',
    coveredAt: Date.now() - (24 * 60 * 60 * 1000)
  }));

  const featured = pickFeaturedStory(items, history);

  assert.equal(featured[0].contentType, 'mods');
});

test('detectContentType identifies mods and community posts', () => {
  assert.equal(
    detectContentType({ title: 'New lighting overhaul for Fallout 4', description: 'Nexus release' }, { category: 'mods' }),
    'mods'
  );
  assert.equal(
    detectContentType({ title: 'My Vault Dweller cosplay [OC]', description: 'Finished just in time for the con.' }, { category: 'community' }),
    'community'
  );
});

test('meetsMinimumSourceQuality accepts descriptive Reddit titles', () => {
  assert.equal(
    meetsMinimumSourceQuality({
      contentType: 'community',
      title: 'Handmade Power Armor cosplay with working Pip-Boy',
      description: 'Built over six months.'
    }),
    true
  );
});

test('extractFeedItems parses Atom feeds', () => {
  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Fallout fan art</title><link href="https://example.com/post"/><published>2026-07-12T08:00:00Z</published><summary>A detailed painting of the Mojave.</summary></entry></feed>`;
  const items = extractFeedItems(xml);

  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Fallout fan art');
  assert.equal(items[0].link, 'https://example.com/post');
});

test('freshnessBonus prefers newer stories', () => {
  const recent = Date.now() - (12 * 60 * 60 * 1000);
  const stale = Date.now() - (15 * 24 * 60 * 60 * 1000);

  assert.ok(freshnessBonus(recent) > freshnessBonus(stale));
});

test('parseRssDate parses standard RSS dates', () => {
  const parsed = parseRssDate('Sun, 12 Jul 2026 08:00:00 GMT');
  assert.ok(Number.isFinite(parsed));
});

test('isArticleSubstantive rejects short generic drafts', () => {
  const thin = {
    intro: 'Fallout news is here.',
    sections: [{ heading: 'Update', body: 'There was an update.' }],
    conclusion: 'That is all.',
    takeaway: 'Updates matter.'
  };

  assert.equal(isArticleSubstantive(thin), false);
  assert.ok(getArticleWordCount(thin) < 650);
});

test('buildArticleHtml includes trust markers, key facts, and linked sources', () => {
  const html = buildArticleHtml({
    title: 'Fallout 76 season update breakdown',
    subtitle: 'What changed and why it matters this week.',
    intro: 'A new season is live.',
    keyFacts: ['Season 18 is live', 'New daily challenges added', 'Quality-of-life fixes included'],
    sections: [{ heading: 'What changed', body: 'Players get new rewards and revised challenge tracks designed to make the seasonal loop feel fresher for returning players.' }],
    takeaway: 'Live-service Fallout lives and dies on update cadence.',
    conclusion: 'Worth logging in this week.',
    cta: 'Are you jumping back in?',
    contentType: 'news',
    trustLevel: 'confirmed',
    sources: [{ title: 'IGN', url: 'https://example.com/story', type: 'press' }]
  });

  assert.match(html, /Fallout Hub · News Brief/);
  assert.match(html, /<h3>Key facts<\/h3>/);
  assert.match(html, /editorial standard/);
  assert.match(html, /<a href="https:\/\/example.com\/story">IGN<\/a>/);
  assert.doesNotMatch(html, /<h2>/);
});

test('getBloggerInsertUrl requests draft creation via query parameter', () => {
  assert.equal(
    getBloggerInsertUrl('123456789'),
    'https://www.googleapis.com/blogger/v3/blogs/123456789/posts?isDraft=true'
  );
});

test('getStoryTopicFingerprint matches same headline across sources', () => {
  const a = getStoryTopicFingerprint({ title: 'Fallout 76 Season 18 goes live' });
  const b = getStoryTopicFingerprint({ title: 'Fallout 76 Season 18 goes live' });
  const c = getStoryTopicFingerprint({ title: 'Bethesda announces new Fallout TV details' });

  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('getStoryFingerprint differs when source or link changes', () => {
  const a = getStoryFingerprint({ source: 'IGN', title: 'Fallout update', link: 'https://example.com/1' });
  const b = getStoryFingerprint({ source: 'Eurogamer', title: 'Fallout update', link: 'https://example.com/2' });

  assert.notEqual(a, b);
});
