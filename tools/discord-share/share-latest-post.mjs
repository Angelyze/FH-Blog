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
const FETCH_HEADERS = {
  'User-Agent': 'FalloutHubBlogDiscordShare/1.0 (+https://www.fallouthub.blog)',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
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

function decodeXmlEntities(value = '') {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

export function extractFirstImageUrl(html = '') {
  if (!html) return null;

  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
    /<media:content[^>]+url=["']([^"']+)["'][^>]*>/i,
    /<media:thumbnail[^>]+url=["']([^"']+)["'][^>]*>/i,
    /<img[^>]+src=["']([^"']+)["']/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const url = decodeXmlEntities(match?.[1] || '').trim();
    if (url && /^https?:\/\//i.test(url)) return url;
  }

  return null;
}

export function extractMetaContent(html = '', names = []) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i')
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      const value = decodeXmlEntities(match?.[1] || '').trim();
      if (value) return value;
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
    const description = stripHtml(rawDescription || rawContent);
    const publishedAt = parseRssDate(pubDateMatch?.[1]);
    // Prefer media:content / media:thumbnail on the item, then body/description images
    const imageUrl = extractFirstImageUrl(block)
      || extractFirstImageUrl(rawContent)
      || extractFirstImageUrl(rawDescription);

    if (!title || !link || !id) continue;
    items.push({ id, title, link, description, publishedAt, imageUrl });
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
  const imageUrl = post.imageUrl || null;

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
  if (!postUrl) return { imageUrl: null, ogDescription: null };

  try {
    const response = await fetch(postUrl, { headers: FETCH_HEADERS });
    if (!response.ok) return { imageUrl: null, ogDescription: null };

    const html = await response.text();
    return {
      imageUrl: extractFirstImageUrl(html),
      ogDescription: extractMetaContent(html, ['og:description', 'twitter:description', 'description'])
    };
  } catch {
    return { imageUrl: null, ogDescription: null };
  }
}

export async function enrichPostForDiscord(post = {}) {
  const og = await fetchPostOpenGraph(post.link);
  return {
    ...post,
    imageUrl: og.imageUrl || post.imageUrl || null,
    ogDescription: og.ogDescription || null
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
      console.log(`[dry-run] Would share: ${post.title} (${post.link})${enriched.imageUrl ? ` [image: ${enriched.imageUrl}]` : ' [no image]'}`);
      continue;
    }
    await postToDiscordWebhook(webhookUrl, payload);
    console.log(`Shared on Discord: ${post.title}${enriched.imageUrl ? ' (with OG image)' : ' (no OG image found)'}`);
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
