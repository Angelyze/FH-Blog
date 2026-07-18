import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiscordPayload,
  buildPostExcerpt,
  extractFirstImageUrl,
  getPostsToShare,
  parseBlogFeedItems,
  stripHtml
} from './share-latest-post.mjs';

const sampleFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
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
      <description><![CDATA[<p>Modders turned Fallout 4 into a visible protest against recent layoffs.</p><img src="https://blogger.googleusercontent.com/img/example-rss.jpg" />]]></description>
      <media:content url="https://blogger.googleusercontent.com/img/example-media.jpg" medium="image" />
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

test('parseBlogFeedItems pulls image URLs from media tags and description HTML', () => {
  const items = parseBlogFeedItems(sampleFeed);
  assert.equal(items[1].imageUrl, 'https://blogger.googleusercontent.com/img/example-media.jpg');
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

test('buildDiscordPayload creates a Fallout Hub embed with OG image', () => {
  const payload = buildDiscordPayload({
    title: 'Fallout 4 modders add protest signs across the Commonwealth',
    link: 'https://www.fallouthub.blog/2026/07/protest-mod-post.html',
    description: '<p>Modders turned Fallout 4 into a visible protest against recent layoffs.</p>',
    imageUrl: 'https://blogger.googleusercontent.com/img/b/example/w640-h360/cover.jpg',
    publishedAt: Date.parse('Tue, 14 Jul 2026 12:00:00 +0000')
  });

  assert.equal(payload.username, 'Fallout Hub');
  assert.equal(payload.embeds[0].title, 'Fallout 4 modders add protest signs across the Commonwealth');
  assert.equal(payload.embeds[0].url, 'https://www.fallouthub.blog/2026/07/protest-mod-post.html');
  assert.equal(payload.embeds[0].color, 0xff9000);
  assert.match(payload.embeds[0].description, /visible protest/);
  assert.equal(
    payload.embeds[0].image.url,
    'https://blogger.googleusercontent.com/img/b/example/w640-h360/cover.jpg'
  );
  assert.equal(payload.embeds[0].footer.text, 'fallouthub.blog');
});

test('buildDiscordPayload omits image when no OG image is available', () => {
  const payload = buildDiscordPayload({
    title: 'Fallout news without a cover',
    link: 'https://www.fallouthub.blog/2026/07/no-image.html',
    description: 'Still worth reading.'
  });

  assert.equal(payload.embeds[0].image, undefined);
});

test('extractFirstImageUrl finds og:image meta tags', () => {
  const html = `
    <html><head>
      <meta property="og:image" content="https://blogger.googleusercontent.com/img/b/og-cover.jpg" />
      <meta property="og:description" content="Studio confirms Fallout 5 pre-production." />
    </head></html>
  `;

  assert.equal(
    extractFirstImageUrl(html),
    'https://blogger.googleusercontent.com/img/b/og-cover.jpg'
  );
});

test('stripHtml and buildPostExcerpt clean Blogger summaries', () => {
  assert.equal(stripHtml('<p>Hello <strong>wasteland</strong></p>'), 'Hello wasteland');
  assert.match(
    buildPostExcerpt('<p>' + 'Fallout fans '.repeat(40) + '</p>'),
    /…$/
  );
});
