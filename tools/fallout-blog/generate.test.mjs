import test from 'node:test';
import assert from 'node:assert/strict';
import { filterFreshStories, getStoryFingerprint } from './generate.mjs';

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
