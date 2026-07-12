import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArticleHtml, filterFreshStories, getBloggerInsertUrl, getStoryFingerprint } from './generate.mjs';

test('deduplicates stories by normalized source/title/link fingerprint', () => {
  const history = [
    { id: getStoryFingerprint({ source: 'IGN', title: 'Fallout 76 gets a big update', link: 'https://example.com/1' }), usedAt: Date.now() }
  ];

  const items = [
    { source: 'IGN', title: 'Fallout 76 gets a big update', link: 'https://example.com/1' },
    { source: 'GamesRadar', title: 'Bethesda teases more Fallout news', link: 'https://example.com/2' }
  ];

  const fresh = filterFreshStories(items, history);

  assert.deepEqual(fresh.map((item) => item.title), ['Bethesda teases more Fallout news']);
});

test('keeps a story when it is not in the recent history', () => {
  const history = [
    { id: getStoryFingerprint({ source: 'IGN', title: 'Old story', link: 'https://example.com/old' }), usedAt: Date.now() }
  ];

  const items = [
    { source: 'IGN', title: 'A brand new Fallout announcement', link: 'https://example.com/new' }
  ];

  const fresh = filterFreshStories(items, history);

  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].title, 'A brand new Fallout announcement');
});

test('buildArticleHtml includes takeaway blockquote and linked sources', () => {
  const html = buildArticleHtml({
    title: 'Fallout 76 season update breakdown',
    intro: 'A new season is live.',
    sections: [{ heading: 'What changed', body: 'Players get new rewards.' }],
    takeaway: 'Live-service Fallout lives and dies on update cadence.',
    conclusion: 'Worth logging in this week.',
    cta: 'Are you jumping back in?',
    sources: [{ title: 'IGN', url: 'https://example.com/story' }]
  });

  assert.match(html, /<blockquote><p><strong>Takeaway:<\/strong>/);
  assert.match(html, /<a href="https:\/\/example.com\/story">IGN<\/a>/);
  assert.doesNotMatch(html, /<h2>/);
});

test('getBloggerInsertUrl requests draft creation via query parameter', () => {
  assert.equal(
    getBloggerInsertUrl('123456789'),
    'https://www.googleapis.com/blogger/v3/blogs/123456789/posts?isDraft=true'
  );
});
