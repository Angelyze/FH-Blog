import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDiscordPayload,
  buildPostExcerpt,
  extractMetaTags,
  extractSearchDescriptionComment,
  getPostsToShare,
  parseBlogFeedItems,
  pickBestDescription,
  preferFullSizeBloggerImage,
  stripHtml,
} from "./share-latest-post.mjs";

test("stripHtml removes tags and collapses whitespace", () => {
  assert.equal(stripHtml("<p>Hello <b>world</b></p>"), "Hello world");
});

test("buildPostExcerpt truncates long text", () => {
  assert.equal(buildPostExcerpt("  a   b  "), "a b");
  const long = "x".repeat(500);
  assert.ok(buildPostExcerpt(long, { maxChars: 280 }).endsWith("…"));
  assert.ok(buildPostExcerpt(long, { maxChars: 280 }).length <= 281);
});

test("extractMetaTags handles attribute order and single quotes", () => {
  const html = `
    <meta content="Eyebot pod blurb" property="og:description" />
    <meta name='twitter:image' content='https://example.com/big.jpg' />
    <meta property="og:image" content="https://example.com/og.jpg">
  `;
  const tags = extractMetaTags(html);
  assert.equal(tags.get("og:description"), "Eyebot pod blurb");
  assert.equal(tags.get("twitter:image"), "https://example.com/big.jpg");
  assert.equal(tags.get("og:image"), "https://example.com/og.jpg");
});

test("extractSearchDescriptionComment reads Blogger SEARCH_DESCRIPTION", () => {
  const html = `<!-- SEARCH_DESCRIPTION (150 chars): A Fallout 4 veteran with 2,000 hours just discovered the Eyebot pod settlement item, proving we still find new things in the game nine years later! -->`;
  assert.match(
    extractSearchDescriptionComment(html) || "",
    /Eyebot pod settlement item/,
  );
});

test("extractSearchDescriptionComment handles RSS entity-encoded comments", () => {
  const encoded =
    "&lt;!--SEARCH_DESCRIPTION (147 chars): A Fallout 4 veteran with 2,000 hours just discovered the Eyebot pod settlement item, proving we still find new things in the game nine years later!--&gt;";
  assert.match(
    extractSearchDescriptionComment(encoded) || "",
    /Eyebot pod settlement item/,
  );
});

test("preferFullSizeBloggerImage upgrades s72 and w640 crops", () => {
  assert.equal(
    preferFullSizeBloggerImage(
      "https://blogger.googleusercontent.com/img/b/R29/s72-c/photo.jpg",
    ),
    "https://blogger.googleusercontent.com/img/b/R29/s1600/photo.jpg",
  );
  assert.equal(
    preferFullSizeBloggerImage(
      "https://blogger.googleusercontent.com/img/b/R29/w640-h360-p-k-no-nu/photo.jpg",
    ),
    "https://blogger.googleusercontent.com/img/b/R29/s1600/photo.jpg",
  );
});

test("pickBestDescription prefers SEO-length over long RSS body", () => {
  const longRss = "x".repeat(800);
  const seo =
    "A Fallout 4 veteran with 2,000 hours just discovered the Eyebot pod settlement item.";
  const best = pickBestDescription({
    feedDescription: longRss,
    ogDescription: seo,
  });
  assert.equal(best.description, seo);
  assert.equal(best.source, "og:description");
});

test("pickBestDescription uses search description comment when better", () => {
  const feed = "x".repeat(600);
  const comment =
    "A Fallout 4 veteran with 2,000 hours just discovered the Eyebot pod settlement item, proving we still find new things in the game nine years later!";
  const best = pickBestDescription({
    feedDescription: feed,
    searchDescriptionComment: comment,
  });
  assert.equal(best.description, comment);
  assert.equal(best.source, "SEARCH_DESCRIPTION comment");
});

test("getPostsToShare bootstraps then shares new ids only", () => {
  const items = [
    { id: "a", title: "A", link: "https://example.com/a" },
    { id: "b", title: "B", link: "https://example.com/b" },
  ];
  const boot = getPostsToShare(items, { initialized: false });
  assert.equal(boot.mode, "bootstrap");
  assert.deepEqual(boot.nextState.sharedPostIds, ["a", "b"]);

  const share = getPostsToShare(
    [...items, { id: "c", title: "C", link: "https://example.com/c" }],
    { initialized: true, sharedPostIds: ["a", "b"] },
  );
  assert.equal(share.mode, "share");
  assert.equal(share.posts.length, 1);
  assert.equal(share.posts[0].id, "c");
});

test("parseBlogFeedItems reads RSS item fields", () => {
  const xml = `<?xml version="1.0"?>
  <rss version="2.0">
    <channel>
      <item>
        <title>Hello World</title>
        <link>https://example.com/p/hello</link>
        <guid>tag:blogger.com,1999:blog-123.post-456</guid>
        <pubDate>Fri, 20 Mar 2026 10:00:00 +0000</pubDate>
        <description><![CDATA[<p>Short summary</p>]]></description>
      </item>
    </channel>
  </rss>`;
  const entries = parseBlogFeedItems(xml);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, "Hello World");
  assert.equal(entries[0].link, "https://example.com/p/hello");
  assert.equal(entries[0].description, "Short summary");
  assert.equal(entries[0].id, "tag:blogger.com,1999:blog-123.post-456");
});

test("parseBlogFeedItems prefers SEARCH_DESCRIPTION and upgrades Blogger image sizes", () => {
  const seo =
    "A Fallout 4 veteran with 2,000 hours just discovered the Eyebot pod settlement item, proving we still find new things in the game nine years later!";
  const xml = `<?xml version="1.0"?>
  <rss version="2.0">
    <channel>
      <item>
        <title>After 2,000 Hours</title>
        <link>https://www.fallouthub.blog/2026/07/after.html</link>
        <guid>tag:blogger.com,1999:blog-1.post-2</guid>
        <pubDate>Mon, 27 Jul 2026 09:54:33 +0000</pubDate>
        <description>&lt;!--SEARCH_DESCRIPTION (147 chars): ${seo}--&gt;&lt;p&gt;Long body that should not become the Discord blurb because we have SEO text.&lt;/p&gt;&lt;img src=&quot;https://blogger.googleusercontent.com/img/b/R29/w640-h360/photo.jpg&quot; /&gt;</description>
      </item>
    </channel>
  </rss>`;
  const entries = parseBlogFeedItems(xml);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].searchDescription, seo);
  assert.equal(entries[0].description, seo);
  assert.equal(
    entries[0].imageUrl,
    "https://blogger.googleusercontent.com/img/b/R29/s1600/photo.jpg",
  );
});

test("buildDiscordPayload includes large image and SEO description", () => {
  const payload = buildDiscordPayload({
    title: "After 2,000 Hours",
    link: "https://www.fallouthub.blog/2026/03/after.html",
    ogDescription:
      "A Fallout 4 veteran with 2,000 hours just discovered the Eyebot pod settlement item.",
    imageUrl:
      "https://blogger.googleusercontent.com/img/b/R29/s1600/hero.jpg",
    publishedAt: Date.parse("2026-03-20T12:00:00.000Z"),
  });
  assert.equal(payload.embeds[0].title, "After 2,000 Hours");
  assert.equal(
    payload.embeds[0].description,
    "A Fallout 4 veteran with 2,000 hours just discovered the Eyebot pod settlement item.",
  );
  assert.equal(
    payload.embeds[0].image.url,
    "https://blogger.googleusercontent.com/img/b/R29/s1600/hero.jpg",
  );
  assert.equal(payload.username, "Fallout Hub");
});
