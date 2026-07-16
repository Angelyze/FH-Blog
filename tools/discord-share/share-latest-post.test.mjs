import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiscordPayload,
  buildPostExcerpt,
  getPostsToShare,
  parseBlogFeedItems,
  stripHtml
} from './share-latest-post.mjs';

const sampleFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title><![CDATA[Older Fallout 76 update recap]]></title>
      <link>https://www.fallouthub.blog/2026/07/older-post.html</link>
      <guid isPermaLink="true">https://www.fallouthub.blog/2026/07/older-post.html</guid>
      <pubDate>Mon, 13 Jul 2026 10:00:00 +0000</pubDate>
      <description><![CDATA[<p>Older coverage for returning players.</p>]]></description>
    </item>
    <item>
      <title><![CDATA[Fallout 4 modders add protest signs across the Commonwealth]]></title>
      <link>https://www.fallouthub.blog/2026/07/protest-mod-post.html</link>
      <guid isPermaLink="true">https://www.fallouthub.blog/2026/07/protest-mod-post.html</guid>
      <pubDate>Tue, 14 Jul 2026 12:00:00 +0000</pubDate>
      <description><![CDATA[<p>Modders turned Fallout 4 into a visible protest against recent layoffs.</p>]]></description>
    </item>
  </channel>
</rss>`;

test('parseBlogFeedItems extracts Blogger RSS posts in publish order', () => {
  const items = parseBlogFeedItems(sampleFeed);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Older Fallout 76 update recap');
  assert.equal(items[1].link, 'https://www.fallouthub.blog/2026/07/protest-mod-post.html');
  assert.ok(items[1].publishedAt > items[0].publishedAt);
});

test('getPostsToShare bootstraps without posting existing feed items', () => {
  const items = parseBlogFeedItems(sampleFeed);
  const result = getPostsToShare(items, { initialized: false, sharedPostIds: [] });

  assert.equal(result.mode, 'bootstrap');
  assert.equal(result.posts.length, 0);
  assert.equal(result.nextState.initialized, true);
  assert.equal(result.nextState.sharedPostIds.length, 2);
});

test('getPostsToShare returns only unseen posts after bootstrap', () => {
  const items = parseBlogFeedItems(sampleFeed);
  const result = getPostsToShare(items, {
    initialized: true,
    sharedPostIds: ['https://www.fallouthub.blog/2026/07/older-post.html']
  });

  assert.equal(result.mode, 'share');
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].title, 'Fallout 4 modders add protest signs across the Commonwealth');
});

test('buildDiscordPayload creates a Fallout Hub embed', () => {
  const payload = buildDiscordPayload({
    title: 'Fallout 4 modders add protest signs across the Commonwealth',
    link: 'https://www.fallouthub.blog/2026/07/protest-mod-post.html',
    description: '<p>Modders turned Fallout 4 into a visible protest against recent layoffs.</p>',
    publishedAt: Date.parse('Tue, 14 Jul 2026 12:00:00 +0000')
  });

  assert.equal(payload.username, 'Fallout Hub');
  assert.equal(payload.embeds[0].title, 'Fallout 4 modders add protest signs across the Commonwealth');
  assert.equal(payload.embeds[0].url, 'https://www.fallouthub.blog/2026/07/protest-mod-post.html');
  assert.equal(payload.embeds[0].color, 0xff9000);
  assert.match(payload.embeds[0].description, /visible protest/);
});

test('stripHtml and buildPostExcerpt clean Blogger summaries', () => {
  assert.equal(stripHtml('<p>Hello <strong>wasteland</strong></p>'), 'Hello wasteland');
  assert.match(
    buildPostExcerpt('<p>' + 'Fallout fans '.repeat(40) + '</p>'),
    /…$/
  );
});