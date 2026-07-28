import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');
const DEFAULT_STATE_FILE = path.join(ROOT_DIR, 'data/discord-share-state.json');
const DEFAULT_FEED_URL = 'https://www.fallouthub.blog/feeds/posts/default?alt=rss';
const DEFAULT_BRAND_NAME = 'Fallout Hub';
const DEFAULT_EMBED_COLOR = 0xff9000;
const DEFAULT_MAX_POSTS_PER_RUN = 3;
const DEFAULT_EXCERPT_CHARS = 280;
// Browser-like headers: Blogger sometimes serves thinner meta to unknown bots
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

export function stripHtml(text = '') {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseRssDate(value = '') {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function decodeXmlEntities(value = '') {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/gi, ' ');
}

/**
 * Upgrade Blogger CDN thumbnails to a large display size so Discord shows a full embed image.
 * e.g. /s72-w640-h360-c/ or /w640-h360-rw/ → /s1600/
 */
export function preferFullSizeBloggerImage(url = '') {
  if (!url || !/blogger\.googleusercontent\.com|googleusercontent\.com\/img/i.test(url)) {
    return url;
  }

  let next = url.trim();
  // Size path segments used by Blogger/Googleusercontent
  next = next.replace(/\/s\d+(?:-[a-z0-9-]+)?\//gi, '/s1600/');
  next = next.replace(/\/w\d+-h\d+(?:-[a-z0-9-]+)?\//gi, '/s1600/');
  // Query-style size params
  next = next.replace(/([?&])w=\d+/gi, '$1w=1600').replace(/([?&])h=\d+/gi, '$1h=1600');
  return next;
}

function getMetaAttribute(tag = '', names = []) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = tag.match(
      new RegExp(`(?:^|\\s)(?:${escaped})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
    );
    if (match) {
      return decodeXmlEntities(match[1] ?? match[2] ?? match[3] ?? '').trim();
    }
  }
  return null;
}

/**
 * Parse every <meta> tag and index by property/name (handles any attribute order).
 */
export function extractMetaTags(html = '') {
  const byKey = new Map();
  const metaRegex = /<meta\b[^>]*>/gi;
  let match;

  while ((match = metaRegex.exec(html))) {
    const tag = match[0];
    const key = (
      getMetaAttribute(tag, ['property', 'name', 'itemprop']) || ''
    ).toLowerCase();
    const content = getMetaAttribute(tag, ['content']);
    if (!key || !content) continue;
    if (!byKey.has(key)) byKey.set(key, content);
  }

  return byKey;
}

export function extractMetaContent(html = '', names = []) {
  const tags = extractMetaTags(html);
  for (const name of names) {
    const value = tags.get(String(name).toLowerCase());
    if (value) return value;
  }
  return null;
}

/**
 * Our generate.mjs HTML comment: <!-- SEARCH_DESCRIPTION (150 chars): ... -->
 * Also handles RSS entity-encoded forms: &lt;!--SEARCH_DESCRIPTION ...--&gt;
 */
export function extractSearchDescriptionComment(html = '') {
  if (!html) return null;
  // Decode first: Blogger RSS escapes markup in <description>
  const source = decodeXmlEntities(String(html));
  const match = source.match(
    /<!--\s*SEARCH_DESCRIPTION\s*(?:\([^)]*\))?\s*:\s*([\s\S]*?)\s*-->/i
  );
  if (!match?.[1]) return null;
  const value = decodeXmlEntities(match[1]).replace(/\s+/g, ' ').trim();
  return value || null;
}

/**
 * Prefer a short SEO blurb over long feed/body text.
 * Ideal Blogger search descriptions are ~120–160 chars; accept up to ~200.
 */
export function pickBestDescription({
  ogDescription = null,
  twitterDescription = null,
  metaDescription = null,
  searchDescriptionComment = null,
  feedDescription = null
} = {}) {
  const candidates = [
    { source: 'og:description', value: ogDescription },
    { source: 'twitter:description', value: twitterDescription },
    { source: 'meta description', value: metaDescription },
    { source: 'SEARCH_DESCRIPTION comment', value: searchDescriptionComment },
    { source: 'feed excerpt', value: feedDescription }
  ]
    .map((entry) => ({
      ...entry,
      value: entry.value ? stripHtml(String(entry.value)).replace(/\s+/g, ' ').trim() : ''
    }))
    .filter((entry) => entry.value.length > 0);

  if (candidates.length === 0) {
    return { description: null, source: 'none' };
  }

  const score = (text) => {
    const len = text.length;
    // Prefer classic SEO length
    if (len >= 110 && len <= 170) return 100 - Math.abs(150 - len) * 0.1;
    if (len >= 80 && len <= 220) return 70 - Math.abs(150 - len) * 0.15;
    if (len < 80) return 30 + len * 0.2;
    // Long body dumps are last resort
    return 20 - Math.min(len, 500) * 0.02;
  };

  let best = candidates[0];
  let bestScore = score(best.value);
  for (const candidate of candidates.slice(1)) {
    const next = score(candidate.value);
    if (next > bestScore) {
      best = candidate;
      bestScore = next;
    }
  }

  return { description: best.value, source: best.source };
}

export function extractFirstImageUrl(html = '') {
  if (!html) return null;

  const meta = extractMetaTags(html);
  const ogImage = meta.get('og:image')
    || meta.get('og:image:secure_url')
    || meta.get('twitter:image')
    || meta.get('twitter:image:src');
  if (ogImage && /^https?:\/\//i.test(ogImage)) {
    return preferFullSizeBloggerImage(ogImage);
  }

  const patterns = [
    /<media:content[^>]+url=["']([^"']+)["'][^>]*>/i,
    /<media:thumbnail[^>]+url=["']([^"']+)["'][^>]*>/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
    /<img[^>]+src=["']([^"']+)["']/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const url = decodeXmlEntities(match?.[1] || '').trim();
    if (url && /^https?:\/\//i.test(url)) {
      // Skip tiny icons / tracking pixels
      if (/icon|favicon|1x1|pixel|badge/i.test(url)) continue;
      return preferFullSizeBloggerImage(url);
    }
  }

  return null;
}

export function parseBlogFeedItems(xmlText = '') {
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  const items = [];
  let match;

  while ((match = itemRegex.exec(xmlText))) {
    const block = match[1];
    const titleMatch = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link><!\[CDATA\[([\s\S]*?)\]\]><\/link>|<link>([\s\S]*?)<\/link>/i);
    const guidMatch = block.match(/<guid[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/guid>/i);
    const descriptionMatch = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([\s\S]*?)<\/description>/i);
    const contentMatch = block.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>|<content:encoded>([\s\S]*?)<\/content:encoded>/i);
    const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);

    const title = stripHtml(titleMatch?.[1] || titleMatch?.[2] || '');
    const link = stripHtml(linkMatch?.[1] || linkMatch?.[2] || '');
    const id = stripHtml(guidMatch?.[1] || guidMatch?.[2] || link);
    const rawDescription = descriptionMatch?.[1] || descriptionMatch?.[2] || '';
    const rawContent = contentMatch?.[1] || contentMatch?.[2] || '';
    // Blogger often entity-encodes description HTML (&lt;img ...&gt;) — decode before parsing
    const decodedDescription = decodeXmlEntities(rawDescription);
    const decodedContent = decodeXmlEntities(rawContent);
    const searchDescription =
      extractSearchDescriptionComment(decodedDescription)
      || extractSearchDescriptionComment(decodedContent)
      || null;
    // Prefer SEO comment as the feed "description" when present (avoids dumping full post body into Discord)
    const description = searchDescription
      || stripHtml(decodedDescription || decodedContent);
    const publishedAt = parseRssDate(pubDateMatch?.[1]);
    // Prefer media:content / media:thumbnail on the item, then body/description images
    const imageUrl = preferFullSizeBloggerImage(
      extractFirstImageUrl(block)
      || extractFirstImageUrl(decodedContent)
      || extractFirstImageUrl(decodedDescription)
      || ''
    ) || null;

    if (!title || !link || !id) continue;
    items.push({
      id,
      title,
      link,
      description,
      searchDescription,
      publishedAt,
      imageUrl
    });
  }

  return items.sort((a, b) => (a.publishedAt ?? 0) - (b.publishedAt ?? 0));
}

export function buildPostExcerpt(description = '', { maxChars = DEFAULT_EXCERPT_CHARS } = {}) {
  const text = stripHtml(description);
  if (!text) return 'A new post is live on Fallout Hub Blog.';
  if (text.length <= maxChars) return text;
  const trimmed = text.slice(0, maxChars);
  const lastSpace = trimmed.lastIndexOf(' ');
  return `${(lastSpace > 80 ? trimmed.slice(0, lastSpace) : trimmed).trim()}…`;
}

export function buildDiscordPayload(post = {}, {
  brandName = DEFAULT_BRAND_NAME,
  embedColor = DEFAULT_EMBED_COLOR
} = {}) {
  const timestamp = post.publishedAt ? new Date(post.publishedAt).toISOString() : undefined;
  const description = buildPostExcerpt(post.ogDescription || post.description);
  const imageUrl = post.imageUrl ? preferFullSizeBloggerImage(post.imageUrl) : null;

  const embed = {
    title: post.title,
    url: post.link,
    description,
    color: embedColor,
    footer: { text: 'fallouthub.blog' },
    ...(timestamp ? { timestamp } : {})
  };

  // Large OG image under the description (Discord layout: title → description → image → footer)
  if (imageUrl) {
    embed.image = { url: imageUrl };
  }

  return {
    username: brandName,
    embeds: [embed]
  };
}

export async function fetchPostOpenGraph(postUrl = '') {
  if (!postUrl) {
    return {
      imageUrl: null,
      ogDescription: null,
      twitterDescription: null,
      metaDescription: null,
      searchDescriptionComment: null,
      descriptionSource: 'none',
      imageSource: 'none',
      fetchOk: false
    };
  }

  try {
    const response = await fetch(postUrl, {
      headers: FETCH_HEADERS,
      redirect: 'follow'
    });
    if (!response.ok) {
      return {
        imageUrl: null,
        ogDescription: null,
        twitterDescription: null,
        metaDescription: null,
        searchDescriptionComment: null,
        descriptionSource: `fetch-failed:${response.status}`,
        imageSource: 'none',
        fetchOk: false
      };
    }

    const html = await response.text();
    const meta = extractMetaTags(html);
    const searchComment = extractSearchDescriptionComment(html);

    const rawImage = meta.get('og:image')
      || meta.get('og:image:secure_url')
      || meta.get('twitter:image')
      || meta.get('twitter:image:src')
      || extractFirstImageUrl(html);
    const imageUrl = rawImage ? preferFullSizeBloggerImage(rawImage) : null;
    let imageSource = 'none';
    if (meta.get('og:image') || meta.get('og:image:secure_url')) imageSource = 'og:image';
    else if (meta.get('twitter:image') || meta.get('twitter:image:src')) imageSource = 'twitter:image';
    else if (rawImage) imageSource = 'page-img';

    return {
      imageUrl,
      ogDescription: meta.get('og:description') || null,
      twitterDescription: meta.get('twitter:description') || null,
      metaDescription: meta.get('description') || null,
      searchDescriptionComment: searchComment,
      descriptionSource: 'page-meta',
      imageSource,
      fetchOk: true
    };
  } catch (error) {
    return {
      imageUrl: null,
      ogDescription: null,
      twitterDescription: null,
      metaDescription: null,
      searchDescriptionComment: null,
      descriptionSource: `error:${error.message || 'fetch'}`,
      imageSource: 'none',
      fetchOk: false
    };
  }
}

export async function enrichPostForDiscord(post = {}) {
  const og = await fetchPostOpenGraph(post.link);

  // Merge page meta + feed SEO comment (entity-encoded in RSS) + body fallback
  const picked = pickBestDescription({
    ogDescription: og.ogDescription,
    twitterDescription: og.twitterDescription,
    metaDescription: og.metaDescription,
    searchDescriptionComment:
      og.searchDescriptionComment
      || post.searchDescription
      || extractSearchDescriptionComment(post.description || ''),
    feedDescription: post.description
  });

  const imageUrl = preferFullSizeBloggerImage(
    og.imageUrl || post.imageUrl || ''
  ) || null;

  return {
    ...post,
    imageUrl,
    ogDescription: picked.description,
    descriptionSource: picked.source,
    imageSource: og.imageUrl
      ? og.imageSource
      : (imageUrl ? 'rss-image' : 'none')
  };
}

export function getPostsToShare(feedItems = [], state = {}, {
  maxPostsPerRun = DEFAULT_MAX_POSTS_PER_RUN
} = {}) {
  const shared = new Set(Array.isArray(state.sharedPostIds) ? state.sharedPostIds : []);

  if (!state.initialized) {
    return {
      mode: 'bootstrap',
      posts: [],
      nextState: {
        initialized: true,
        sharedPostIds: feedItems.map((item) => item.id),
        lastCheckedAt: Date.now()
      }
    };
  }

  const posts = feedItems
    .filter((item) => !shared.has(item.id))
    .slice(0, maxPostsPerRun);

  return {
    mode: posts.length > 0 ? 'share' : 'idle',
    posts,
    nextState: {
      initialized: true,
      sharedPostIds: [...shared, ...posts.map((item) => item.id)],
      lastCheckedAt: Date.now()
    }
  };
}

export async function loadShareState(stateFile = DEFAULT_STATE_FILE) {
  try {
    const raw = await fs.readFile(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      initialized: Boolean(parsed.initialized),
      sharedPostIds: Array.isArray(parsed.sharedPostIds) ? parsed.sharedPostIds : [],
      lastCheckedAt: parsed.lastCheckedAt ?? null
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { initialized: false, sharedPostIds: [], lastCheckedAt: null };
    }
    throw error;
  }
}

export async function saveShareState(state, stateFile = DEFAULT_STATE_FILE) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

export async function fetchBlogFeed(feedUrl = DEFAULT_FEED_URL) {
  const response = await fetch(feedUrl, {
    headers: {
      ...FETCH_HEADERS,
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`Blog feed request failed (${response.status})`);
  }

  return response.text();
}

export async function postToDiscordWebhook(webhookUrl, payload) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord webhook failed (${response.status}): ${text}`);
  }
}

export async function shareLatestBlogPosts({
  feedUrl = process.env.BLOG_FEED_URL || DEFAULT_FEED_URL,
  webhookUrl = process.env.DISCORD_WEBHOOK_URL,
  stateFile = process.env.DISCORD_SHARE_STATE_FILE || DEFAULT_STATE_FILE,
  maxPostsPerRun = Number.parseInt(process.env.DISCORD_SHARE_MAX_POSTS_PER_RUN || String(DEFAULT_MAX_POSTS_PER_RUN), 10),
  dryRun = process.env.DISCORD_SHARE_DRY_RUN === 'true'
} = {}) {
  if (!webhookUrl && !dryRun) {
    throw new Error('Missing DISCORD_WEBHOOK_URL');
  }

  const xml = await fetchBlogFeed(feedUrl);
  const feedItems = parseBlogFeedItems(xml);
  const state = await loadShareState(stateFile);
  const result = getPostsToShare(feedItems, state, { maxPostsPerRun });

  if (result.mode === 'bootstrap') {
    if (!dryRun) {
      await saveShareState(result.nextState, stateFile);
    }
    console.log(`Discord share bootstrap complete: marked ${result.nextState.sharedPostIds.length} existing post(s) as seen.`);
    return { ...result, sharedCount: 0 };
  }

  if (result.posts.length === 0) {
    if (!dryRun) {
      await saveShareState(result.nextState, stateFile);
    }
    console.log('No new Fallout Hub Blog posts to share on Discord.');
    return { ...result, sharedCount: 0 };
  }

  for (const post of result.posts) {
    const enriched = await enrichPostForDiscord(post);
    const payload = buildDiscordPayload(enriched);
    if (dryRun) {
      console.log(
        `[dry-run] Would share: ${post.title} (${post.link})`
        + ` [desc: ${enriched.descriptionSource || 'unknown'}]`
        + ` [image: ${enriched.imageSource || 'none'}]`
      );
      continue;
    }
    await postToDiscordWebhook(webhookUrl, payload);
    console.log(
      `Shared on Discord: ${post.title}`
      + ` (description via ${enriched.descriptionSource || 'unknown'}`
      + `${enriched.ogDescription ? `, ${enriched.ogDescription.length} chars` : ''}`
      + `; image via ${enriched.imageSource || 'none'})`
    );
  }

  if (!dryRun) {
    await saveShareState(result.nextState, stateFile);
  }

  return { ...result, sharedCount: result.posts.length };
}

async function main() {
  const result = await shareLatestBlogPosts();
  console.log(`Discord share finished (${result.mode}, shared ${result.sharedCount}).`);
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
