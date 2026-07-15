import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'artifacts');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'latest-draft.json');
const HISTORY_FILE = path.join(ROOT, 'data', 'story-history.json');
const FEED_HEALTH_FILE = path.join(ROOT, 'data', 'feed-health.json');
const MANUAL_SEEDS_FILE = path.join(ROOT, 'data', 'manual-seeds.json');
const MANUAL_SEED_RETENTION_DAYS = 14;
const HISTORY_RETENTION_DAYS = 21;
const TITLE_HISTORY_DAYS = 14;
const MIN_TITLE_CHARS = 20;
const MAX_TITLE_CHARS = 70;
const MIN_DESCRIPTION_LENGTH = 80;
const MIN_ARTICLE_WORDS = 650;
const SEO_DESCRIPTION_TARGET_CHARS = 150;
const SEO_DESCRIPTION_MIN_CHARS = 120;
const SEO_DESCRIPTION_MAX_CHARS = 160;
const TOPIC_SIMILARITY_THRESHOLD = 0.6;
const MAX_STORY_BODY_CHARS = 8000;
const MAX_PROMPT_SUMMARY_CHARS = 4000;
const ENRICH_FETCH_TIMEOUT_MS = 12000;
const REDDIT_FETCH_DELAY_MS = Number.parseInt(process.env.REDDIT_FETCH_DELAY_MS || '3000', 10);
const REDDIT_RATE_LIMIT_BACKOFF_MS = Number.parseInt(process.env.REDDIT_RATE_LIMIT_BACKOFF_MS || '3000', 10);
const PERSISTENT_BLOCK_FAILURE_STREAK = 2;
const FEED_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BRAND_NAME = 'Fallout Hub';

const CONTENT_TYPES = ['news', 'mods', 'community'];
const GENERATION_BATCH_LIMITS = {
  news: 5,
  mods: 5,
  community: 5
};
const CONTENT_TYPE_ROTATION_BONUS = 1.5;

const CONTENT_SOURCES = [
  { name: 'IGN', url: 'https://www.ign.com/rss/articles/feed', weight: 1.45, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'VGC', url: 'https://www.videogameschronicle.com/feed/', weight: 1.35, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'GamesRadar', url: 'https://www.gamesradar.com/rss', weight: 1.3, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'Eurogamer', url: 'https://www.eurogamer.net/rss', weight: 1.25, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'GameSpot', url: 'https://www.gamespot.com/feeds/news/', weight: 1.2, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'Polygon', url: 'https://www.polygon.com/feed/', weight: 1.15, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', weight: 1.1, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'Steam — Fallout 76', url: 'https://store.steampowered.com/feeds/news/app/1151340/?l=english&cc=US', weight: 1.2, category: 'news', tier: 'official', kind: 'rss', dedicatedFallout: true },
  { name: 'Steam — Fallout 4', url: 'https://store.steampowered.com/feeds/news/app/377160/?l=english&cc=US', weight: 1.1, category: 'news', tier: 'official', kind: 'rss', dedicatedFallout: true },
  { name: 'Steam — New Vegas', url: 'https://store.steampowered.com/feeds/news/app/22380/?l=english&cc=US', weight: 1.05, category: 'news', tier: 'official', kind: 'rss', dedicatedFallout: true },
  { name: 'Xbox Wire', url: 'https://news.xbox.com/en-us/feed/', weight: 1.45, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'Bethesda — YouTube', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCvZHe-SP3xC7DdOk4Ri8QBw', weight: 1.35, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'Amazon Newsroom', url: 'https://www.aboutamazon.com/news/rss', weight: 1.15, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'Kotaku', url: 'https://kotaku.com/rss', weight: 1.05, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'Rock Paper Shotgun', url: 'https://www.rockpapershotgun.com/feed/', weight: 1.0, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'PC Gamer', url: 'https://www.pcgamer.com/feed/', weight: 1.0, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'PCGamesN', url: 'https://www.pcgamesn.com/mainrss.xml', weight: 1.0, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'Shacknews', url: 'https://www.shacknews.com/feed/rss', weight: 0.95, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'DualShockers', url: 'https://www.dualshockers.com/feed/', weight: 0.95, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'PlayStation Blog', url: 'https://blog.playstation.com/feed/', weight: 1.15, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true, excludeTitlePatterns: [
    /^share of the week/i,
    /^players'? choice/i,
    /playstation store:.*top downloads/i,
    /playstation store.*summer sale/i,
    /summer sale arrives/i
  ] },
  { name: 'Aftermath', url: 'https://aftermath.site/rss/', weight: 1.25, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'GamesIndustry', url: 'https://www.gamesindustry.biz/feed', weight: 1.2, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'The Gamer', url: 'https://www.thegamer.com/feed/', weight: 1.05, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'Insider Gaming', url: 'https://insider-gaming.com/feed/', weight: 1.0, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'Wccftech', url: 'https://www.wccftech.com/feed/', weight: 0.95, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'Siliconera', url: 'https://www.siliconera.com/feed/', weight: 0.95, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'Engadget', url: 'https://www.engadget.com/rss.xml', weight: 0.9, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'Steam Community — Fallout 76', url: 'https://steamcommunity.com/games/1151340/rss/', weight: 1.15, category: 'news', tier: 'official', kind: 'rss', dedicatedFallout: true },
  { name: 'Steam Community — Fallout 4', url: 'https://steamcommunity.com/games/377160/rss/', weight: 1.1, category: 'mods', tier: 'official', kind: 'rss', dedicatedFallout: true },
  { name: 'Steam Community — New Vegas', url: 'https://steamcommunity.com/games/22380/rss/', weight: 1.0, category: 'news', tier: 'official', kind: 'rss', dedicatedFallout: true }
];

const REDDIT_SOURCES = [
  { name: 'r/fallout', subreddit: 'fallout', weight: 1.25, category: 'community', tier: 'community', kind: 'reddit', minScore: 150, minComments: 35, primary: true },
  { name: 'r/fo76', subreddit: 'fo76', weight: 1.2, category: 'community', tier: 'community', kind: 'reddit', minScore: 75, minComments: 20 },
  { name: 'r/falloutlore', subreddit: 'falloutlore', weight: 1.1, category: 'community', tier: 'community', kind: 'reddit', minScore: 100, minComments: 25 },
  { name: 'r/FalloutMods', subreddit: 'FalloutMods', weight: 1.45, category: 'mods', tier: 'community', kind: 'reddit', minScore: 80, minComments: 18 },
  { name: 'r/fo4', subreddit: 'fo4', weight: 1.3, category: 'mods', tier: 'community', kind: 'reddit', minScore: 60, minComments: 15 },
  { name: 'r/FalloutTV', subreddit: 'FalloutTV', weight: 1.2, category: 'community', tier: 'community', kind: 'reddit', minScore: 120, minComments: 30 },
  { name: 'r/fnv', subreddit: 'fnv', weight: 1.1, category: 'community', tier: 'community', kind: 'reddit', minScore: 80, minComments: 18 },
  { name: 'r/classicfallout', subreddit: 'classicfallout', weight: 1.05, category: 'community', tier: 'community', kind: 'reddit', minScore: 55, minComments: 12 }
];

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function stripHtml(value) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanText(value) {
  return decodeHtmlEntities(stripHtml(value || '')).trim();
}

function normalizeStoryText(value) {
  return (value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function getStoryFingerprint(item = {}) {
  const source = normalizeStoryText(item.source);
  const title = normalizeStoryText(item.title);
  let link = '';

  if (item.link) {
    try {
      const parsed = new URL(item.link);
      link = normalizeStoryText(parsed.hostname + parsed.pathname);
    } catch {
      link = normalizeStoryText(item.link);
    }
  }

  const seed = [source, title, link].filter(Boolean).join('|');
  return crypto.createHash('sha256').update(seed).digest('hex');
}

export function getStoryTopicFingerprint(item = {}) {
  const title = normalizeStoryText(item.title);
  return crypto.createHash('sha256').update(title).digest('hex');
}

export function getStoryTopicKey(item = {}) {
  return getStoryTopicFingerprint(item).slice(0, 16);
}

export function getStoryKey(item = {}) {
  return getStoryFingerprint(item).slice(0, 16);
}

export function parseRssDate(value) {
  if (!value) return null;
  const parsed = Date.parse(String(value).trim());
  return Number.isNaN(parsed) ? null : parsed;
}

export function freshnessBonus(publishedAt) {
  if (!publishedAt) return 0;
  const ageHours = (Date.now() - publishedAt) / (1000 * 60 * 60);
  if (ageHours <= 24) return 2.5;
  if (ageHours <= 72) return 1.5;
  if (ageHours <= 168) return 0.5;
  if (ageHours > 336) return -2.5;
  return 0;
}

export function countWords(value = '') {
  return String(value).split(/\s+/).filter(Boolean).length;
}

export function countChars(value = '') {
  return String(value).trim().length;
}

export function trimToCharCount(value = '', targetChars = SEO_DESCRIPTION_TARGET_CHARS) {
  const text = String(value).trim();
  if (text.length <= targetChars) return text;

  let trimmed = text.slice(0, targetChars);
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace > targetChars * 0.6) {
    trimmed = trimmed.slice(0, lastSpace);
  }

  return trimmed.trim();
}

export function buildSeoDescriptionFallback(article = {}) {
  const chunks = [
    article.title,
    article.subtitle,
    article.intro,
    ...(Array.isArray(article.keyFacts) ? article.keyFacts.slice(0, 2) : []),
    article.takeaway
  ].filter(Boolean);

  let text = chunks.join(' ').replace(/\s+/g, ' ').trim();

  if (countChars(text) > SEO_DESCRIPTION_MAX_CHARS) {
    return trimToCharCount(text, SEO_DESCRIPTION_TARGET_CHARS);
  }

  if (countChars(text) < SEO_DESCRIPTION_MIN_CHARS) {
    const paddingChunks = [
      `${BRAND_NAME} explains what Fallout fans need to know.`,
      'Sourced details and honest framing for the Wasteland.',
      'What happened, why it matters, and what to watch next.'
    ];

    for (const chunk of paddingChunks) {
      text = `${text} ${chunk}`.replace(/\s+/g, ' ').trim();
      if (countChars(text) >= SEO_DESCRIPTION_MIN_CHARS) break;
    }
  }

  return trimToCharCount(text, SEO_DESCRIPTION_TARGET_CHARS);
}

export function ensureSeoDescription(article = {}) {
  const candidate = (article.seoDescription || '').trim();
  const chars = countChars(candidate);

  if (chars >= SEO_DESCRIPTION_MIN_CHARS && chars <= SEO_DESCRIPTION_MAX_CHARS) {
    return candidate;
  }

  if (chars > SEO_DESCRIPTION_MAX_CHARS) {
    return trimToCharCount(candidate, SEO_DESCRIPTION_TARGET_CHARS);
  }

  return buildSeoDescriptionFallback(article);
}

const OUTLET_TITLE_PREFIX = /^(?:bloomberg|ign|gamespot|eurogamer|polygon|the verge|vgc|gamesradar|kotaku|aftermath|gamesindustry|insider gaming|the gamer|wccftech|siliconera|engadget|pc gamer|rock paper shotgun)\s*:\s*/i;

const SPECIFIC_TOPIC_ANCHORS = new Set([
  'obsidian', 'bethesda', 'zenimax', 'fo76', 'fnv', 'wasteland', 'vault',
  'appalachia', 'brotherhood', 'prime', 'amazon', 'nexus', 'layoff', 'layoffs',
  'avowed', 'elder', 'scrolls', 'starfield', 'xbox', 'microsoft', 'studio'
]);

const TOPIC_ANCHOR_TOKENS = new Set(['fallout', ...SPECIFIC_TOPIC_ANCHORS]);

export function normalizeTopicTitle(title = '') {
  return String(title).replace(OUTLET_TITLE_PREFIX, '').trim();
}

export function getTopicTokens(title = '') {
  return new Set(
    normalizeStoryText(normalizeTopicTitle(title))
      .split(' ')
      .filter((token) => token.length > 2)
  );
}

function getTopicAnchorTokens(title = '') {
  return new Set(
    normalizeStoryText(normalizeTopicTitle(title))
      .split(' ')
      .filter((token) => TOPIC_ANCHOR_TOKENS.has(token))
  );
}

export function shareStrongTopicAnchors(titleA = '', titleB = '') {
  const anchorsA = getTopicAnchorTokens(titleA);
  const anchorsB = getTopicAnchorTokens(titleB);
  const shared = [...anchorsA].filter((token) => anchorsB.has(token));
  const sharedSpecific = shared.filter((token) => SPECIFIC_TOPIC_ANCHORS.has(token));
  return shared.includes('fallout') && sharedSpecific.length >= 1;
}

export function areTopicsSimilar(titleA = '', titleB = '', { allowAnchorMatch = true } = {}) {
  if (allowAnchorMatch && shareStrongTopicAnchors(titleA, titleB)) return true;

  const tokensA = getTopicTokens(titleA);
  const tokensB = getTopicTokens(titleB);
  if (tokensA.size === 0 || tokensB.size === 0) return false;

  const intersection = [...tokensA].filter((token) => tokensB.has(token)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return intersection / union >= TOPIC_SIMILARITY_THRESHOLD;
}

export function isTopicCovered(item = {}, historyEntries = []) {
  const fingerprint = getStoryKey(item);
  const topicFingerprint = getStoryTopicKey(item);

  for (const entry of historyEntries) {
    if (entry.fingerprint === fingerprint || entry.topicFingerprint === topicFingerprint) {
      return true;
    }
    if (entry.title && item.title && areTopicsSimilar(entry.title, item.title)) {
      return true;
    }
    if (entry.articleTitle && item.title && areTopicsSimilar(entry.articleTitle, item.title)) {
      return true;
    }
  }

  return false;
}

const VAGUE_TITLE_PATTERNS = [
  /^why the latest fallout news matters/i,
  /^what it means for the wasteland/i,
  /^fallout fans have no shortage/i
];

export function isVagueTitle(title = '') {
  const normalized = String(title).trim();
  if (!normalized) return true;
  return VAGUE_TITLE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isTitleLengthValid(title = '') {
  const chars = countChars(title);
  return chars >= MIN_TITLE_CHARS && chars <= MAX_TITLE_CHARS;
}

export function trimTitleToMaxChars(title = '', maxChars = MAX_TITLE_CHARS) {
  const text = String(title).trim();
  if (countChars(text) <= maxChars) return text;

  let trimmed = text.slice(0, maxChars);
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace >= Math.floor(maxChars * 0.5)) {
    trimmed = trimmed.slice(0, lastSpace);
  }

  return trimmed.replace(/[,:;–—-]\s*$/u, '').trim();
}

export function ensureArticleTitle(title = '', mainStory = {}) {
  const sourceTitle = String(mainStory.title || '').trim();
  let candidate = String(title || '').trim();

  if (!candidate || isVagueTitle(candidate)) {
    candidate = sourceTitle || 'Latest Fallout news';
  }

  if (countChars(candidate) > MAX_TITLE_CHARS) {
    candidate = trimTitleToMaxChars(candidate);
  }

  if (countChars(candidate) < MIN_TITLE_CHARS) {
    const padding = mainStory.contentType === 'mods'
      ? ' — mod spotlight'
      : mainStory.contentType === 'community'
        ? ' — community highlight'
        : ' — what Fallout fans should know';
    candidate = trimTitleToMaxChars(`${candidate || sourceTitle}${padding}`);
  }

  if (countChars(candidate) < MIN_TITLE_CHARS && sourceTitle) {
    candidate = trimTitleToMaxChars(sourceTitle);
  }

  if (countChars(candidate) < MIN_TITLE_CHARS) {
    candidate = 'Fallout fans should know about this update';
  }

  if (countChars(candidate) > MAX_TITLE_CHARS) {
    candidate = trimTitleToMaxChars(candidate);
  }

  return candidate;
}

export function isDuplicateArticleTitle(title = '', historyEntries = [], { withinDays = TITLE_HISTORY_DAYS } = {}) {
  const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;

  return historyEntries.some((entry) => {
    if (entry.coveredAt < cutoff) return false;
    if (entry.articleTitle && areTopicsSimilar(entry.articleTitle, title, { allowAnchorMatch: false })) return true;
    if (entry.title && areTopicsSimilar(entry.title, title, { allowAnchorMatch: false })) return true;
    return false;
  });
}

export function getTitleValidationIssue(title = '', historyEntries = []) {
  if (!String(title).trim()) return 'empty-title';
  if (isVagueTitle(title)) return 'vague-title';
  if (!isTitleLengthValid(title)) return 'title-length';
  if (isDuplicateArticleTitle(title, historyEntries)) return 'duplicate-title';
  return null;
}

export function isValidArticleTitle(title = '', historyEntries = []) {
  return getTitleValidationIssue(title, historyEntries) === null;
}

export function isPublishableArticle(article = {}, { mode = 'llm-generated', historyEntries = [] } = {}) {
  if (mode !== 'llm-generated') return false;
  if (!isArticleSubstantive(article)) return false;
  if (!isValidArticleTitle(article.title, historyEntries)) return false;
  return true;
}

export function getArticleWordCount(article = {}) {
  const chunks = [
    article.subtitle,
    article.intro,
    article.conclusion,
    article.takeaway,
    ...(Array.isArray(article.keyFacts) ? article.keyFacts : []),
    ...(Array.isArray(article.sections) ? article.sections.map((section) => `${section.heading} ${section.body}`) : [])
  ];
  return countWords(chunks.filter(Boolean).join(' '));
}

export function isArticleSubstantive(article, { minWords = MIN_ARTICLE_WORDS, minSections = 4 } = {}) {
  if (!article || getArticleWordCount(article) < minWords) return false;
  if (!Array.isArray(article.sections) || article.sections.length < minSections) return false;
  return article.sections.every((section) => (section.body || '').split(/\s+/).filter(Boolean).length >= 35);
}

export function detectContentType(item = {}, source = {}) {
  if (source.category && CONTENT_TYPES.includes(source.category)) {
    return source.category;
  }
  if (item.contentType && CONTENT_TYPES.includes(item.contentType)) {
    return item.contentType;
  }

  const haystack = `${item.title} ${item.description}`.toLowerCase();

  if (/\b(mod|mods|nexus|overhaul|texture pack|load order|wabbajack|f4se|skse|xedit)\b/.test(haystack)) {
    return 'mods';
  }
  if (/\b(cosplay|fan art|artwork|drawing|painting|prop build|costume|screenshot|photo mode|fan project|oc\b|\[oc\])\b/.test(haystack)) {
    return 'community';
  }
  if (/\b(official|announced|patch notes|update|bethesda|dlc|season|trailer|prime video)\b/.test(haystack)) {
    return 'news';
  }

  return source.category || 'news';
}

export function meetsMinimumSourceQuality(item = {}) {
  const descriptionLength = (item.description || '').length;
  const titleLength = (item.title || '').length;

  if (item.sourceKind === 'reddit' && !passesCommunityQualityGate(item)) {
    return false;
  }

  if (item.enriched && descriptionLength >= MIN_DESCRIPTION_LENGTH) return true;
  if (item.contentType === 'community' || item.contentType === 'mods') {
    return descriptionLength >= 40 || titleLength >= 30;
  }
  return descriptionLength >= MIN_DESCRIPTION_LENGTH;
}

const NICHE_COMMUNITY_PATTERNS = [
  'load order', 'ini tweak', 'help me', 'any fix', 'crash fix', 'bug help', 'tech support',
  'mouse sensitivity', 'stutter', 'fps fix', 'vanilla plus', 'game pass question',
  'am i the only', 'does anyone else', 'is it just me', 'unpopular opinion', 'rate my',
  'which mod', 'best settings', 'how do i fix', 'why is my', 'question about'
];

const HIGH_VALUE_COMMUNITY_PATTERNS = [
  'cosplay', 'fan art', '[oc]', 'camp build', 'settlement build', 'screenshot', 'photo mode',
  'just finished', 'years in the making', 'life-size', 'prop build', 'costume', 'painted',
  'theory', 'lore discussion', 'viral', 'breakdown', 'restored', 'museum'
];

const RSS_REDDIT_MAX_HOT_RANK = 3;
const RSS_CUSTOM_FEED_MAX_RANK = 25;

const LOW_EFFORT_REDDIT_PATTERNS = [
  'discussion thread', 'megathread', 'daily thread', 'weekly thread', 'rant thread',
  'thoughts on', 'what do you think', 'anyone else', 'unpopular opinion',
  'looking for', 'recommend me', 'should i', 'is it worth', 'help me',
  'question about', 'quick question', 'noob question', 'new player',
  'rate my', 'roast my', 'fix my', 'bug report', 'glitch thread'
];

const RSS_MOD_SIGNAL_PATTERNS = [
  'released', 'release', 'updated', 'update', 'overhaul', 'nexus',
  'mod showcase', 'new mod', 'texture pack', 'wabbajack', 'load order',
  'f4se', 'xedit', 'reshade', 'compatibility', 'patch', 'port to'
];

export function isNicheCommunityPost(item = {}) {
  const haystack = `${item.title} ${item.description}`.toLowerCase();
  return NICHE_COMMUNITY_PATTERNS.some((pattern) => haystack.includes(pattern));
}

export function isLowEffortRedditPost(item = {}) {
  const title = item.title || '';
  const haystack = `${title} ${item.description}`.toLowerCase();
  if (/\?\s*$/.test(title.trim())) return true;
  return LOW_EFFORT_REDDIT_PATTERNS.some((pattern) => haystack.includes(pattern));
}

export function hasRssModSignals(item = {}) {
  const haystack = `${item.title} ${item.description}`.toLowerCase();
  return RSS_MOD_SIGNAL_PATTERNS.some((pattern) => haystack.includes(pattern));
}

export function hasHighValueCommunitySignals(item = {}) {
  const haystack = `${item.title} ${item.description}`.toLowerCase();
  return HIGH_VALUE_COMMUNITY_PATTERNS.some((pattern) => haystack.includes(pattern));
}

function hasRedditEngagementMetrics(item = {}) {
  return item.redditScore != null || item.redditComments != null;
}

export function passesRssRedditQualityGate(item = {}) {
  if (item.sourceKind !== 'reddit') return true;
  if (hasRedditEngagementMetrics(item)) return true;

  const rank = item.redditFeedRank ?? 99;
  if (rank > RSS_REDDIT_MAX_HOT_RANK) return false;
  if (isLowEffortRedditPost(item)) return false;

  const contentType = detectContentType(item);
  if (contentType === 'mods') return hasRssModSignals(item);
  if (contentType === 'community') {
    return hasHighValueCommunitySignals(item) && !isNicheCommunityPost(item);
  }

  return false;
}

export function meetsEngagementThreshold(item = {}) {
  if (item.sourceKind !== 'reddit') return true;
  if (!hasRedditEngagementMetrics(item)) return passesRssRedditQualityGate(item);

  const minScore = item.minScore ?? 50;
  const minComments = item.minComments ?? 10;
  return (item.redditScore ?? 0) >= minScore && (item.redditComments ?? 0) >= minComments;
}

export function meetsHighEngagementThreshold(item = {}) {
  if (item.sourceKind !== 'reddit') return true;
  if (!hasRedditEngagementMetrics(item)) return false;

  const minScore = Math.round((item.minScore ?? 50) * 2.5);
  const minComments = Math.round((item.minComments ?? 10) * 2);
  return (item.redditScore ?? 0) >= minScore && (item.redditComments ?? 0) >= minComments;
}

export function passesCustomRedditFeedQualityGate(item = {}) {
  if (item.sourceKind !== 'reddit') return true;
  if (item.isStickied || item.over18) return false;
  if (isLowEffortRedditPost(item)) return false;
  if (isNicheCommunityPost(item)) return false;

  const rank = item.redditFeedRank ?? 99;
  if (rank > RSS_CUSTOM_FEED_MAX_RANK) return false;

  if (hasRedditEngagementMetrics(item)) {
    return meetsEngagementThreshold(item);
  }

  return true;
}

export function passesCommunityQualityGate(item = {}, { useCustomFeedRules = false } = {}) {
  if (useCustomFeedRules) return passesCustomRedditFeedQualityGate(item);
  if (item.sourceKind !== 'reddit') return true;
  if (item.isStickied || item.over18) return false;
  if (!meetsEngagementThreshold(item)) return false;
  if (isNicheCommunityPost(item) && !meetsHighEngagementThreshold(item)) return false;
  return true;
}

export function engagementBonus(item = {}) {
  const score = item.redditScore ?? 0;
  const comments = item.redditComments ?? 0;
  if (!score && !comments) return 0;

  let bonus = Math.log10(Math.max(score, 1)) * 2.4 + Math.log10(Math.max(comments, 1)) * 1.8;
  if (score >= 250) bonus += 1.2;
  if (score >= 500) bonus += 1.5;
  if (score >= 1000) bonus += 2;
  if (comments >= 75) bonus += 1;
  if (comments >= 150) bonus += 1.5;
  return bonus;
}

const SOURCE_ROTATION_WINDOW_DAYS = 7;
const MAX_SOURCE_RECENCY_PENALTY = 5;

export function getRecentSourceUsage(historyEntries = [], { withinDays = SOURCE_ROTATION_WINDOW_DAYS } = {}) {
  const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;
  const counts = new Map();

  for (const entry of historyEntries) {
    if (!entry?.source || entry.coveredAt < cutoff) continue;
    counts.set(entry.source, (counts.get(entry.source) || 0) + 1);
  }

  return counts;
}

export function getSourceDiversityAdjustment(item = {}, historyEntries = []) {
  if (!historyEntries.length) return 0;

  const usage = getRecentSourceUsage(historyEntries);
  const sourceUses = usage.get(item.source) || 0;
  let adjustment = 0;

  adjustment -= Math.min(sourceUses * 1.75, MAX_SOURCE_RECENCY_PENALTY);

  if (item.contentType === 'community' || item.contentType === 'mods') adjustment += 1.5;
  if (item.sourceTier === 'official') adjustment += 1;
  if (item.sourceTier === 'community') adjustment += 1.2;
  if (sourceUses === 0 && item.sourceTier === 'press') adjustment += 0.6;

  return adjustment;
}

export function getAdjustedCandidateScore(item = {}, historyEntries = []) {
  return (item.score ?? 0) + getSourceDiversityAdjustment(item, historyEntries);
}

export function compareCandidatePriority(a, b, historyEntries = []) {
  const metricsA = a.sourceKind === 'reddit' && hasRedditEngagementMetrics(a) ? 1 : 0;
  const metricsB = b.sourceKind === 'reddit' && hasRedditEngagementMetrics(b) ? 1 : 0;
  if (metricsB !== metricsA) return metricsB - metricsA;

  const scoreA = getAdjustedCandidateScore(a, historyEntries);
  const scoreB = getAdjustedCandidateScore(b, historyEntries);
  if (scoreB !== scoreA) return scoreB - scoreA;

  const engagementA = (a.redditScore ?? 0) + (a.redditComments ?? 0) * 2;
  const engagementB = (b.redditScore ?? 0) + (b.redditComments ?? 0) * 2;
  return engagementB - engagementA;
}

export function getContentTypeCounts(historyEntries = [], { withinDays = 7 } = {}) {
  const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;
  const typeCounts = { news: 0, mods: 0, community: 0 };

  for (const entry of historyEntries) {
    if (entry.coveredAt < cutoff || !entry.contentType) continue;
    typeCounts[entry.contentType] = (typeCounts[entry.contentType] || 0) + 1;
  }

  return typeCounts;
}

export function getContentTypeRotationBonus(contentType = 'news', typeCounts = {}) {
  const counts = CONTENT_TYPES.map((type) => typeCounts[type] || 0);
  const minCount = counts.length > 0 ? Math.min(...counts) : 0;
  return (typeCounts[contentType] || 0) <= minCount ? CONTENT_TYPE_ROTATION_BONUS : 0;
}

export function getEditorialCandidateScore(item = {}, historyEntries = [], typeCounts = {}) {
  return getAdjustedCandidateScore(item, historyEntries)
    + getContentTypeRotationBonus(item.contentType, typeCounts);
}

export function getGenerationBatchLimit(contentType = 'news') {
  return GENERATION_BATCH_LIMITS[contentType] || 1;
}

export function pickFeaturedStory(candidates = [], historyEntries = []) {
  const eligible = selectStoriesForGeneration(candidates, historyEntries, { storyLimit: 20 });
  if (eligible.length === 0) return [];

  const typeCounts = getContentTypeCounts(historyEntries);
  const mainStory = [...eligible].sort((a, b) => {
    const scoreA = getEditorialCandidateScore(a, historyEntries, typeCounts);
    const scoreB = getEditorialCandidateScore(b, historyEntries, typeCounts);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return compareCandidatePriority(a, b, historyEntries);
  })[0];

  return [mainStory];
}

export function assembleGenerationItems(mainStory = {}, candidates = [], historyEntries = [], { maxItems = 1 } = {}) {
  if (!mainStory?.title) return [];

  const contentType = mainStory.contentType || 'news';
  const limit = Math.min(maxItems, getGenerationBatchLimit(contentType));
  const mainTopic = getStoryTopicKey(mainStory);

  const pool = candidates
    .filter((item) => item.contentType === contentType)
    .filter((item) => !isTopicCovered(item, historyEntries))
    .filter((item) => isEligibleForGeneration(item))
    .filter((item) => {
      if (item.publishedAt && item.publishedAt < Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000) {
        return false;
      }

      if (item.sourceKind === 'reddit' && !passesCommunityQualityGate(item)) {
        return false;
      }

      return true;
    })
    .sort((a, b) => getAdjustedCandidateScore(b, historyEntries) - getAdjustedCandidateScore(a, historyEntries));

  const selected = [mainStory];
  const usedTopics = new Set([mainTopic]);

  for (const item of pool) {
    if (selected.length >= limit) break;

    const topicKey = getStoryTopicKey(item);
    if (usedTopics.has(topicKey)) continue;
    if (item.link === mainStory.link && item.title === mainStory.title) continue;

    selected.push(item);
    usedTopics.add(topicKey);
  }

  return selected;
}

export function selectStoriesForGeneration(candidates = [], historyEntries = [], { storyLimit = 5 } = {}) {
  const eligible = candidates
    .filter((item) => {
      if (isTopicCovered(item, historyEntries)) return false;
      if (!meetsMinimumSourceQuality(item)) return false;
      if (!isEligibleForGeneration(item)) return false;

      if (item.publishedAt && item.publishedAt < Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000) {
        return false;
      }

      if (item.sourceKind === 'reddit' && !passesCommunityQualityGate(item)) {
        return false;
      }

      return true;
    })
    .sort((a, b) => getAdjustedCandidateScore(b, historyEntries) - getAdjustedCandidateScore(a, historyEntries));

  if (eligible.length === 0) return [];

  const selected = [];
  const usedTopics = new Set();

  for (const item of eligible) {
    if (selected.length >= storyLimit) break;
    const topicFingerprint = getStoryTopicKey(item);
    if (usedTopics.has(topicFingerprint)) continue;
    selected.push(item);
    usedTopics.add(topicFingerprint);
  }

  return selected;
}

function extractRssItems(xmlText) {
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  const items = [];
  let match;

  while ((match = itemRegex.exec(xmlText))) {
    const block = match[1];
    const titleMatch = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link><!\[CDATA\[([\s\S]*?)\]\]><\/link>|<link>([\s\S]*?)<\/link>/i);
    const descriptionMatch = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([\s\S]*?)<\/description>/i);
    const contentEncodedMatch = block.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>|<content:encoded>([\s\S]*?)<\/content:encoded>/i);
    const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const sourceMatch = block.match(/<source\b[^>]*>([\s\S]*?)<\/source>/i);

    const title = cleanText(titleMatch?.[1] || titleMatch?.[2] || '');
    const link = cleanText(linkMatch?.[1] || linkMatch?.[2] || '');
    const summary = cleanText(descriptionMatch?.[1] || descriptionMatch?.[2] || '');
    const fullContent = cleanText(contentEncodedMatch?.[1] || contentEncodedMatch?.[2] || '');
    const description = fullContent.length > summary.length ? fullContent : summary;
    const publishedAt = parseRssDate(pubDateMatch?.[1]);
    const feedSource = cleanText(sourceMatch?.[1] || '');

    if (title) {
      items.push({ title, link, description, publishedAt, feedSource });
    }
  }

  return items;
}

function extractAtomEntries(xmlText) {
  const entryRegex = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  const items = [];
  let match;

  while ((match = entryRegex.exec(xmlText))) {
    const block = match[1];
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link[^>]+href=["']([^"']+)["']/i);
    const summaryMatch = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    const contentMatch = block.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
    const publishedMatch = block.match(/<published>([\s\S]*?)<\/published>/i)
      || block.match(/<updated>([\s\S]*?)<\/updated>/i);

    const title = cleanText(titleMatch?.[1] || '');
    const link = cleanText(linkMatch?.[1] || '');
    const description = cleanText(summaryMatch?.[1] || contentMatch?.[1] || '');
    const publishedAt = parseRssDate(publishedMatch?.[1]);

    if (title) {
      items.push({ title, link, description, publishedAt });
    }
  }

  return items;
}

export function extractFeedItems(xmlText) {
  if (/<feed\b/i.test(xmlText) && /<entry\b/i.test(xmlText)) {
    return extractAtomEntries(xmlText);
  }
  return extractRssItems(xmlText);
}

function extractItems(xmlText) {
  return extractFeedItems(xmlText);
}

const FALLOUT_KEYWORDS = [
  'fallout 76', 'fallout 4', 'fallout 3', 'fallout 5', 'fallout 2', 'fallout 1',
  'new vegas', 'fo76', 'fo4', 'fnv', 'prime video', 'fallout tv', 'fallout series',
  'vault dweller', 'vault-tec', 'appalachia', 'atomic shop',
  'brotherhood of steel', 'ncr', 'institute', 'pip-boy',
  'nexus mod', 'mod release', 'lucy', 'the ghoul', 'vault boy', 'power armor',
  'mod showcase', 'camp build'
];

const FALLOUT_TITLE_MENTION_PATTERN = /\b(fallout(?:\s+(?:76|4|3|5|2|1|tv|series))?|fo76|fo4|fnv|new vegas)\b/i;

const OFF_TOPIC_PRESS_TITLE_PATTERNS = [
  /playstation store.*sale/i,
  /summer sale arrives/i,
  /^reset xbox\b/i,
  /^xbox kills\b/i,
  /^layoffs hit id software\b/i,
  /^microsoft pulls\b/i,
  /game pass lineup\b/i,
  /review & recap/i
];

const COMPETING_FRANCHISE_PATTERNS = [
  /\bdiablo(?:\s+\d+)?\b/i,
  /\bthe elder scrolls\b/i,
  /\belder scrolls(?:\s+online|\s+\d+)?\b/i,
  /\bstarfield\b/i,
  /\bavowed\b/i,
  /\bcall of duty\b/i,
  /\bworld of warcraft\b/i,
  /\boverwatch\b/i,
  /\bhalo(?:\s+\d+)?\b/i,
  /\bforza(?:\s+horizon|\s+motorsport)?\b/i,
  /\bgears of war\b/i,
  /\bdestiny(?:\s+\d+)?\b/i,
  /\bborderlands(?:\s+\d+)?\b/i,
  /\bthe witcher(?:\s+\d+)?\b/i,
  /\bassassin'?s creed\b/i,
  /\bx-men\b/i,
  /\btony hawk\b/i,
  /\bspider-noir\b/i
];

export function hasCompetingFranchiseInTitle(title = '') {
  return COMPETING_FRANCHISE_PATTERNS.some((pattern) => pattern.test(title));
}

export function hasFalloutFocus(item = {}) {
  const title = String(item.title || '');
  const haystack = `${title} ${item.description || ''} ${item.link || ''}`.toLowerCase();

  if (FALLOUT_TITLE_MENTION_PATTERN.test(title)) return true;
  if (hasCompetingFranchiseInTitle(title)) return false;

  return /\bfallout\b/i.test(haystack);
}

export function hasFalloutTitleMention(title = '') {
  return FALLOUT_TITLE_MENTION_PATTERN.test(String(title || ''));
}

function isDedicatedFalloutSource(source = {}) {
  return source.dedicatedFallout === true || source.kind === 'reddit';
}

export function isEligibleForGeneration(item = {}) {
  if (item.sourceKind === 'reddit') return true;
  if (/wiki|mutants allowed|duck and cover|steam community|steam —/i.test(item.source || '')) return true;
  if (!hasFalloutFocus(item)) return false;
  if (item.contentType === 'news' && item.sourceTier === 'press') {
    return hasFalloutTitleMention(item.title);
  }
  return true;
}

const NOISE_TERMS = ['rumor', 'rumour', 'leak', 'leaked', 'speculation', 'datamine', 'insider claims', 'allegedly'];

const REPORT_SIGNALS = [
  'report', 'reportedly', 'according to', 'sources say', 'sources tell', 'insider',
  'claims that', 'said to be', 'is said to', 'people familiar', 'people with knowledge',
  'unconfirmed', 'could be', 'may be', 'shelving', 'shelved', 'greenlit', 're-focusing',
  'shifting focus', 'in development', 'working on a new'
];

const CONFIRMED_PRESS_SIGNALS = [
  'patch notes', 'now available', 'out now', 'launches today', 'is live', 'now live',
  'release date', 'official trailer', 'premiere date', 'maintenance update', 'scheduled for',
  'season begins', 'update is available', 'available to download'
];

const REPORTING_OUTLETS = [
  'Bloomberg', 'IGN', 'Kotaku', 'Eurogamer', 'VGC', 'GamesRadar', 'GameSpot', 'Polygon',
  'The Verge', 'PC Gamer', 'PCGamesN', 'Rock Paper Shotgun', 'Shacknews', 'DualShockers',
  'Video Games Chronicle', 'Aftermath', 'GamesIndustry', 'The Gamer', 'Insider Gaming',
  'Wccftech', 'Siliconera', 'Engadget'
];

function scoreItem(item, source) {
  const haystack = `${item.title} ${item.description}`.toLowerCase();
  const keywordHits = FALLOUT_KEYWORDS.filter((keyword) => haystack.includes(keyword));
  const contentType = detectContentType(item, source);

  let score = source.weight + keywordHits.length * 1.4;

  score += freshnessBonus(item.publishedAt);
  score += Math.min((item.description || '').length / 180, 1.8);
  score += engagementBonus(item);
  if (item.sourceKind === 'reddit' && !hasRedditEngagementMetrics(item)) score -= 2.5;

  if (source.tier === 'official') score += 1.8;
  if (haystack.includes('fallout')) score += 1.5;
  if (haystack.includes('official') || haystack.includes('announced') || haystack.includes('confirmed')) score += 1.4;
  if (haystack.includes('trailer') || haystack.includes('premiere')) score += 0.9;
  if (haystack.includes('expansion') || haystack.includes('update') || haystack.includes('patch')) score += 0.9;
  if (contentType === 'mods' && (haystack.includes('release') || haystack.includes('update') || haystack.includes('overhaul'))) score += 1.2;
  if (HIGH_VALUE_COMMUNITY_PATTERNS.some((pattern) => haystack.includes(pattern))) score += 2.2;
  if (contentType === 'community' && (haystack.includes('cosplay') || haystack.includes('[oc]') || haystack.includes('fan art'))) score += 1.3;
  if (haystack.includes('season') && haystack.includes('fallout')) score += 1.0;
  if (isNicheCommunityPost(item)) score -= 3.5;
  if (NOISE_TERMS.some((term) => haystack.includes(term))) score -= 4;
  if (hasCompetingFranchiseInTitle(item.title || '') && !/\bfallout\b/i.test(item.title || '')) score -= 8;

  return score;
}

export function resolveReportingOutlet(item = {}) {
  const haystack = `${item.title} ${item.description} ${item.link || ''}`;

  for (const outlet of REPORTING_OUTLETS) {
    if (haystack.toLowerCase().includes(outlet.toLowerCase())) {
      return outlet;
    }
  }

  return item.source || 'the original report';
}

export function detectTrustLevel(item = {}, source = {}) {
  if (source.tier === 'official') return 'official';
  if (source.category === 'mods' || source.category === 'community') return 'community-highlight';

  const haystack = `${item.title} ${item.description}`.toLowerCase();
  const title = item.title || '';

  const isReportTitle = /\breport\b/i.test(title) || /[–-]\s*report/i.test(title);
  const hasReportSignal = isReportTitle || REPORT_SIGNALS.some((signal) => haystack.includes(signal));
  const hasConfirmedSignal = CONFIRMED_PRESS_SIGNALS.some((signal) => haystack.includes(signal));

  if (hasReportSignal && !hasConfirmedSignal) return 'press-report';
  if (hasConfirmedSignal && !hasReportSignal) return 'confirmed';

  if (hasReportSignal && hasConfirmedSignal) return 'press-report';

  if (/\b(obsidian|bethesda|microsoft|xbox|developer|studio)\b/.test(haystack)
    && /\b(new game|sequel|spin-off|fallout 5|project|return to)\b/.test(haystack)) {
    return 'press-report';
  }

  return source.tier === 'press' ? 'press-report' : 'confirmed';
}

export function getTrustLabel(trustLevel) {
  switch (trustLevel) {
    case 'official':
      return 'Official';
    case 'confirmed':
      return 'Confirmed News';
    case 'press-report':
      return 'Press Report';
    case 'community-highlight':
      return 'Community Highlight';
    default:
      return 'Editorial';
  }
}

export function getTrustNote(trustLevel) {
  switch (trustLevel) {
    case 'official':
      return 'Official source — verified announcement or update from Bethesda or an official channel.';
    case 'confirmed':
      return 'Confirmed news — coverage of official announcements, patch notes, or established facts.';
    case 'press-report':
      return 'Press report — based on journalism cited below; not yet confirmed by the developer or publisher.';
    case 'community-highlight':
      return 'Community highlight — fan-created content, not official Bethesda news.';
    default:
      return 'Prepared from sourced material listed below.';
  }
}

export function ensureTrustKeyFacts(keyFacts = [], mainStory = {}, trustLevel = 'confirmed') {
  const facts = [...keyFacts];
  const outlet = resolveReportingOutlet(mainStory);

  if (trustLevel === 'press-report') {
    const disclaimer = `Reported by ${outlet}; not yet confirmed by the developer or publisher.`;
    if (!facts.some((fact) => /not yet confirmed|not confirmed by/i.test(fact))) {
      facts.unshift(disclaimer);
    }
  }

  if (trustLevel === 'official') {
    const officialFact = `Source: official ${mainStory.source || 'channel'} announcement.`;
    if (!facts.some((fact) => /official/i.test(fact))) {
      facts.unshift(officialFact);
    }
  }

  return facts.slice(0, 6);
}

export function ensurePrimarySource(sources = [], mainStory = {}) {
  const list = Array.isArray(sources) ? [...sources] : [];
  const primaryUrl = mainStory.link;

  if (primaryUrl && !list.some((source) => source.url === primaryUrl)) {
    list.unshift({
      title: mainStory.title || resolveReportingOutlet(mainStory),
      url: primaryUrl,
      type: mainStory.sourceTier || 'press'
    });
  }

  return list;
}

function isSupportingSourceRelevant(item = {}, mainStory = {}) {
  if (areTopicsSimilar(item.title || '', mainStory.title || '')) return true;

  const mainHaystack = `${mainStory.title} ${mainStory.description}`.toLowerCase();
  const itemHaystack = `${item.title} ${item.description}`.toLowerCase();
  const eventSignals = ['layoff', 'zenimax', 'bethesda', 'xbox', 'studio cut', 'warn act', 'restructur', 'job cut'];
  const mainHasEvent = eventSignals.some((signal) => mainHaystack.includes(signal));
  if (!mainHasEvent) return true;

  return eventSignals.some((signal) => itemHaystack.includes(signal));
}

export function resolveArticleSources(sources = [], newsItems = []) {
  const mainStory = newsItems[0] || {};
  const allowedItems = newsItems.filter((item) => item?.link);
  const allowedUrls = new Map(allowedItems.map((item) => [item.link, item]));
  const seenUrls = new Set();
  const resolved = [];

  for (const source of Array.isArray(sources) ? sources : []) {
    const url = source?.url;
    if (!url || !allowedUrls.has(url) || seenUrls.has(url)) continue;
    const item = allowedUrls.get(url);
    if (url !== mainStory.link && !isSupportingSourceRelevant(item, mainStory)) continue;

    seenUrls.add(url);
    resolved.push({
      title: source.title || item.title,
      url,
      type: source.type || item.sourceTier || 'press'
    });
  }

  for (const item of allowedItems) {
    if (resolved.length >= 4) break;
    if (!item.link || seenUrls.has(item.link)) continue;
    if (item.link !== mainStory.link && !isSupportingSourceRelevant(item, mainStory)) continue;

    seenUrls.add(item.link);
    resolved.push({
      title: item.title,
      url: item.link,
      type: item.sourceTier || 'press'
    });
  }

  return ensurePrimarySource(resolved, mainStory).slice(0, 4);
}

export function validateArticleTrust(article = {}, newsItems = []) {
  const mainStory = newsItems[0] || {};
  const trustLevel = detectTrustLevel(mainStory, {
    tier: mainStory.sourceTier,
    category: mainStory.contentType
  });

  return {
    ...article,
    trustLevel,
    contentType: article.contentType || mainStory.contentType || 'news',
    keyFacts: ensureTrustKeyFacts(article.keyFacts, mainStory, trustLevel),
    sources: resolveArticleSources(article.sources, newsItems),
    seoDescription: ensureSeoDescription({ ...article, trustLevel, contentType: article.contentType || mainStory.contentType || 'news' })
  };
}

function getContentTypeGuidance(contentType, trustLevel = 'confirmed') {
  const trustGuidance = trustLevel === 'press-report'
    ? `TRUST LEVEL: PRESS REPORT (unconfirmed by developer/publisher)
- This story is based on journalism, NOT an official announcement
- The intro MUST state that this is reported by [outlet] and not confirmed by the developer/publisher
- Attribute claims clearly but vary phrasing — do not open more than two sections with "According to the report"
- Use hedging language: "reportedly", "is said to", "the report claims" where appropriate
- When Bethesda or Xbox news affects Fallout, keep the franchise impact in every section — not just Elder Scrolls
- Do NOT invent background details, past quotes, or related rumors not present in the source summaries
- keyFacts MUST include: "Reported by [outlet]; not yet confirmed by the developer or publisher."
- The conclusion MUST remind readers that official confirmation is still pending`
    : trustLevel === 'official'
      ? `TRUST LEVEL: OFFICIAL
- This comes from an official Bethesda or platform source — write with confidence
- Still cite the official source clearly`
      : trustLevel === 'community-highlight'
        ? `TRUST LEVEL: COMMUNITY HIGHLIGHT
- Make clear this is fan-created content, not official news`
        : `TRUST LEVEL: CONFIRMED NEWS
- Report on established facts from official announcements or patch notes
- Cite sources clearly; do not embellish beyond what sources support`;

  switch (contentType) {
    case 'mods':
      return `${trustGuidance}

CONTENT TYPE: MOD SPOTLIGHT
- Explain what the mod changes for players in practical terms
- Credit the creator and point readers to the original mod page or thread
- Mention game, platform, or compatibility details only if present in the sources
- Help readers decide whether it is worth checking out
- Never present mods as official Bethesda content`;
    case 'community':
      return `${trustGuidance}

CONTENT TYPE: COMMUNITY HIGHLIGHT
- Spotlight fan creativity: art, cosplay, builds, lore discussion, or projects worth seeing
- Credit the creator or community thread clearly
- Explain why this is interesting to Fallout fans and worth sharing
- Frame as community-driven, not official news`;
    default:
      return `${trustGuidance}

CONTENT TYPE: NEWS
- Accuracy and attribution come first — this is why readers trust ${BRAND_NAME}
- Only state facts supported by the provided sources
- Separate confirmed information from fan reaction or interpretation
- If details are limited, say so honestly instead of filling gaps`;
  }
}

function getContentTypeLabel(contentType, trustLevel = 'confirmed') {
  if (trustLevel === 'press-report') return 'Press Report';
  if (trustLevel === 'official') return 'Official Update';

  switch (contentType) {
    case 'mods':
      return 'Mod Spotlight';
    case 'community':
      return 'Community Highlight';
    default:
      return 'News Brief';
  }
}

function buildPromptContext(newsItems = []) {
  return newsItems.slice(0, 5)
    .map((item, index) => {
      const ageLabel = item.publishedAt
        ? `${Math.max(1, Math.round((Date.now() - item.publishedAt) / (1000 * 60 * 60)))}h ago`
        : 'recent';
      const itemTrust = item.trustLevel || detectTrustLevel(item, { tier: item.sourceTier, category: item.contentType });
      const summary = buildStorySummaryForPrompt(item);
      return `${index + 1}. ${item.title}
   Source: ${item.source}
   Type: ${getContentTypeLabel(item.contentType || 'news', itemTrust)}
   Trust: ${getTrustLabel(itemTrust)}
   Published: ${ageLabel}
   Summary: ${summary}${item.link ? `\n   URL: ${item.link}` : ''}`;
    })
    .join('\n\n');
}

function buildPromptTrustSection(trustLevel, reportingOutlet) {
  return `TRUST AND EDITORIAL STANDARDS:
- Use ONLY the material below. Never invent facts, dates, quotes, patch notes, or creator names.
- trustLevel for this post: ${trustLevel} (${getTrustLabel(trustLevel)})
- Primary reporting outlet to attribute: ${reportingOutlet}
- If trustLevel is "press-report", every section making a claim must attribute it to ${reportingOutlet} or "the report"
- If trustLevel is "confirmed", write about established facts but still cite sources
- If trustLevel is "community-highlight", make clear this is fan-created content
- If a detail is missing from the sources, say "details are still limited" instead of guessing
- Include a keyFacts array with 3-5 bullet points a busy reader can scan in 10 seconds`;
}

function buildSharedArticleRequirements(contentType, trustLevel, reportingOutlet) {
  return `ARTICLE REQUIREMENTS:
- seoDescription: a standalone meta description of 120-160 characters (target exactly 150). One or two tight sentences for Blogger/Google search snippets.
- title: specific, ${MIN_TITLE_CHARS}-${MAX_TITLE_CHARS} characters, click-worthy without clickbait — name the game, mod, event, or creator when possible
- subtitle: one sentence explaining the value proposition; for press-report, mention it is based on reporting
- intro: 3-4 sentences with a strong hook; if press-report, clearly state this is reported by ${reportingOutlet} and not confirmed by the developer/publisher
- keyFacts: 3-5 short scannable bullet points (only facts supported by sources)
- sections: exactly 5 or 6 sections, each with "heading" and "body" (4-6 sentences, roughly 80-130 words each)
- takeaway: one standout insight sentence fans might quote when sharing
- conclusion: 2-3 sentences with a clear final perspective; for press-report, note official confirmation is still pending
- cta: one conversational question that fits the content type
- contentType: "${contentType}"
- trustLevel: "${trustLevel}"
- sources: array of {title, url, type} using ONLY URLs from SOURCE MATERIAL below — omit tangential supporting links
- Write ONLY about the source material provided. Do not invent stories or add topics that are not listed in the summaries below

Return valid JSON only with these fields: title, seoDescription, subtitle, intro, keyFacts, sections, conclusion, takeaway, cta, contentType, trustLevel, sources`;
}

function buildNewsPrompt(newsItems, context) {
  const mainStory = newsItems[0];
  const trustLevel = mainStory.trustLevel || detectTrustLevel(mainStory, { tier: mainStory.sourceTier, category: 'news' });
  const reportingOutlet = resolveReportingOutlet(mainStory);
  const isMultiAngle = newsItems.length > 1;

  const formatRules = isMultiAngle
    ? `NEWS BRIEF RULES (${newsItems.length} sourced angles):
- Lead with the strongest headline: ${mainStory.title}
- Weave the other sourced items into one cohesive Fallout news brief — different outlets, official channels, or complementary angles are welcome
- Keep every section tied to material below; this is one briefing, not a random link dump
- Separate official facts from press reports and explain why fans should care`
    : `NEWS WRITING RULES:
- Lead with the most newsworthy confirmed or reported fact first
- Name the game, platform, studio, or show when known from sources
- Separate official facts from press reports and fan reaction
- Use an informative newsroom tone — not hype, not rumor-chasing
- Help readers understand timing, scope, and why the franchise conversation shifted`;

  return `You are the lead editor of ${BRAND_NAME}, writing a Fallout NEWS brief fans will trust and share.

${getContentTypeGuidance('news', trustLevel)}

${formatRules}

${buildPromptTrustSection(trustLevel, reportingOutlet)}

SOURCE MATERIAL (write only from these items — official, press, and community sources listed below):
${context}

MAIN STORY TO LEAD WITH: ${mainStory.title}

${buildSharedArticleRequirements('news', trustLevel, reportingOutlet)}`;
}

function buildModsPrompt(newsItems, context) {
  const mainStory = newsItems[0];
  const trustLevel = mainStory.trustLevel || detectTrustLevel(mainStory, { tier: mainStory.sourceTier, category: 'mods' });
  const reportingOutlet = resolveReportingOutlet(mainStory);
  const isRoundup = newsItems.length > 1;

  const formatRules = isRoundup
    ? `MOD ROUNDUP RULES (${newsItems.length} mods):
- This is ONE mod roundup article, not a news digest
- Lead with the main mod: ${mainStory.title}
- Give each mod clear coverage — what it changes, who it is for, and where to get it
- Use section headings that name the mods or their purpose
- Do not mention unrelated press news, studio drama, TV awards, or industry headlines`
    : `SINGLE MOD SPOTLIGHT RULES:
- Write only about this one mod — do not pad the article with unrelated news or other mods
- Open with what the mod changes in practical gameplay or visuals
- Credit the creator/mod page and make clear this is community-made, not official Bethesda content
- Mention game, platform, requirements, or compatibility only if present in sources
- Avoid breaking-news tone — this is a useful recommendation, not an announcement`;

  return `You are the lead editor of ${BRAND_NAME}, writing ${isRoundup ? 'a MOD ROUNDUP' : 'a MOD SPOTLIGHT'} for Fallout players deciding what to install next.

${getContentTypeGuidance('mods', trustLevel)}

${formatRules}

${buildPromptTrustSection(trustLevel, reportingOutlet)}

SOURCE MATERIAL (write ONLY about these mods — nothing else):
${context}

MAIN MOD TO LEAD WITH: ${mainStory.title}

${buildSharedArticleRequirements('mods', trustLevel, reportingOutlet)}`;
}

function buildCommunityPrompt(newsItems, context) {
  const mainStory = newsItems[0];
  const trustLevel = mainStory.trustLevel || detectTrustLevel(mainStory, { tier: mainStory.sourceTier, category: 'community' });
  const reportingOutlet = resolveReportingOutlet(mainStory);
  const isRoundup = newsItems.length > 1;

  const formatRules = isRoundup
    ? `COMMUNITY ROUNDUP RULES (${newsItems.length} highlights):
- Lead with the strongest community story: ${mainStory.title}
- Give each highlight clear credit and explain why fans would share it
- Keep the tone celebratory and human — this is fan culture, not a press release
- Do not mix in unrelated industry news or mod releases unless they are listed below`
    : `COMMUNITY HIGHLIGHT RULES:
- Celebrate the creator, build, artwork, cosplay, lore thread, or project clearly
- Make the opening feel human and shareable, not like a press release
- Explain why this stands out in the fandom and who will appreciate it
- Credit the source thread or creator path from the summaries
- Never frame fan work as official news or a Bethesda announcement`;

  return `You are the lead editor of ${BRAND_NAME}, spotlighting ${isRoundup ? 'the best Fallout community moments' : 'something the Fallout community created and would enjoy sharing'}.

${getContentTypeGuidance('community', trustLevel)}

${formatRules}

${buildPromptTrustSection(trustLevel, reportingOutlet)}

SOURCE MATERIAL (write only from these community items):
${context}

MAIN COMMUNITY STORY TO LEAD WITH: ${mainStory.title}

${buildSharedArticleRequirements('community', trustLevel, reportingOutlet)}`;
}

function buildPrompt(newsItems, { expansion = false, previousArticle = null } = {}) {
  const mainStory = newsItems[0];
  const contentType = mainStory.contentType || 'news';
  const contextText = buildPromptContext(newsItems);

  const expansionNote = expansion
    ? `IMPORTANT: The previous draft was too short and too generic. Rewrite it as a substantially deeper article.
Previous draft title: ${previousArticle?.title || 'unknown'}
Previous word count: ${getArticleWordCount(previousArticle || {})}
You must exceed ${MIN_ARTICLE_WORDS} words and include more concrete detail from the summaries below.\n\n`
    : '';

  let body;
  switch (contentType) {
    case 'mods':
      body = buildModsPrompt(newsItems, contextText);
      break;
    case 'community':
      body = buildCommunityPrompt(newsItems, contextText);
      break;
    default:
      body = buildNewsPrompt(newsItems, contextText);
      break;
  }

  return `${expansionNote}${body}`;
}

function buildFallbackArticle(newsItems) {
  const mainStory = newsItems[0];
  const supportingStories = newsItems.slice(1, 3);
  const supportText = supportingStories.map((item) => item.title).join(' and ');

  return {
    title: ensureArticleTitle(`${mainStory.title}: what it means for the Wasteland right now`, mainStory),
    subtitle: `A ${getContentTypeLabel(mainStory.contentType || 'news').toLowerCase()} from ${mainStory.source}, explained for Fallout fans.`,
    intro: `Fallout fans have no shortage of headlines to track, but some stories cut through the noise more than others. ${mainStory.title} is one of those — worth reading closely whether you mainline Fallout 76, replay New Vegas, or follow the Prime Video series.`,
    keyFacts: [
      `Source: ${mainStory.source}`,
      `Topic: ${getContentTypeLabel(mainStory.contentType || 'news')}`,
      mainStory.description ? mainStory.description.slice(0, 120) : 'A notable Fallout development worth following.'
    ],
    sections: [
      {
        heading: 'What happened',
        body: `The headline driving today's conversation is ${mainStory.title}, reported by ${mainStory.source}. ${mainStory.description ? mainStory.description.slice(0, 200) + (mainStory.description.length > 200 ? '…' : '') : 'It is one of the stronger Fallout-related developments in recent coverage.'}`
      },
      {
        heading: 'Why fans should pay attention',
        body: `Stories like this matter because Fallout is more than a single game now — it is a live franchise spanning classic RPGs, an ongoing online world, a major TV adaptation, and a massive modding community. When official or trusted coverage shifts, it often signals something fans will feel in-game, on-screen, or in the broader conversation around Bethesda's plans.`
      },
      {
        heading: 'How this fits the bigger picture',
        body: `The Fallout fandom reads between the lines by default, and for good reason. Updates, announcements, and even quiet industry moves can reshape expectations about content cadence, lore direction, and which parts of the IP Bethesda is investing in next. That context is what turns a headline into something genuinely useful.`
      },
      {
        heading: 'What to watch next',
        body: `Keep tabs on ${supportText || 'the next official Bethesda or Fallout channel update'} and how the community responds once more details land. That combination — official word plus fan reaction — is usually the fastest way to separate signal from noise in the Wasteland.`
      }
    ],
    takeaway: 'When Fallout coverage moves from background noise to front-page news, it is usually because something is about to matter to players — not just pundits.',
    conclusion: 'For now, the smart play is to follow the story closely, stay skeptical of unconfirmed chatter, and see what official channels confirm next.',
    cta: 'Which part of this story matters most to you — the games, the show, or the wider franchise?',
    contentType: mainStory.contentType || 'news',
    trustLevel: mainStory.trustLevel || detectTrustLevel(mainStory, { tier: mainStory.sourceTier, category: mainStory.contentType }),
    sources: newsItems.slice(0, 4).map((item) => ({ title: item.title, url: item.link || 'https://fallout.fandom.com/wiki/Fallout_Wiki', type: item.sourceTier || 'press' }))
  };
}

function normalizeArticle(article, newsItems) {
  const mainStory = newsItems[0] || {};
  const contentType = article?.contentType || mainStory.contentType || 'news';
  const trustLevel = detectTrustLevel(mainStory, { tier: mainStory.sourceTier, category: contentType });
  const sections = Array.isArray(article?.sections) && article.sections.length > 0
    ? article.sections
    : [
        { heading: 'What is happening', body: 'The main story here is worth following because it gives fans a clearer sense of where the franchise is heading.' },
        { heading: 'Why fans should care', body: 'This matters because it affects expectations around upcoming Fallout content and fan discussion.' },
        { heading: 'What to watch next', body: 'The next step is to follow official updates and the broader conversation around the topic.' }
      ];

  const keyFacts = Array.isArray(article?.keyFacts) && article.keyFacts.length >= 3
    ? article.keyFacts
    : [
        `Source: ${mainStory.source || 'Trusted Fallout coverage'}`,
        `Category: ${getContentTypeLabel(contentType, trustLevel)}`,
        mainStory.description ? mainStory.description.slice(0, 140) : 'A development Fallout fans should know about.'
      ];

  return validateArticleTrust({
    title: ensureArticleTitle(article?.title, mainStory),
    seoDescription: article?.seoDescription || '',
    subtitle: article?.subtitle || `Your daily ${getContentTypeLabel(contentType, trustLevel).toLowerCase()} from ${BRAND_NAME}.`,
    intro: article?.intro || 'The latest Fallout headlines are worth following because they can shape the conversation around the franchise in the days ahead.',
    keyFacts,
    sections,
    takeaway: article?.takeaway || 'The best Fallout coverage explains not just what happened, but why players and fans should care.',
    conclusion: article?.conclusion || 'The best takeaway is to stay close to official updates and trusted coverage until more details arrive.',
    cta: article?.cta || 'What do you think is the most interesting part of this story?',
    contentType,
    trustLevel: article?.trustLevel || trustLevel,
    sources: resolveArticleSources(article?.sources, newsItems)
  }, newsItems);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildArticleHtml(article) {
  const trustLevel = article.trustLevel || 'confirmed';
  const trustNote = getTrustNote(trustLevel);

  const seoDescription = ensureSeoDescription(article);
  const seoCharCount = countChars(seoDescription);
  const seoHtml = `<!-- SEARCH_DESCRIPTION (${seoCharCount} chars): ${seoDescription} --><p><strong>Search description — copy into Blogger (${SEO_DESCRIPTION_TARGET_CHARS} characters):</strong></p><p>${escapeHtml(seoDescription)}</p><hr>`;

  const disclaimerHtml = trustLevel === 'press-report'
    ? `<p><strong>Editorial note:</strong> This article is based on press reporting and has <strong>not</strong> been confirmed by the developer or publisher.</p>`
    : '';
  const subtitleHtml = article.subtitle ? `<p><strong>${escapeHtml(article.subtitle)}</strong></p>` : '';
  const introHtml = article.intro ? `<p>${escapeHtml(article.intro)}</p>` : '';
  const keyFactsHtml = Array.isArray(article.keyFacts) && article.keyFacts.length > 0
    ? `<h3>Key facts</h3><ul>${article.keyFacts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join('')}</ul>`
    : '';
  const sectionsHtml = Array.isArray(article.sections)
    ? article.sections.map((section) => `<h3>${escapeHtml(section.heading)}</h3><p>${escapeHtml(section.body)}</p>`).join('')
    : '';
  const takeawayHtml = article.takeaway
    ? `<blockquote><p><strong>Why fans are talking about this:</strong> ${escapeHtml(article.takeaway)}</p></blockquote>`
    : '';
  const conclusionHtml = article.conclusion ? `<p>${escapeHtml(article.conclusion)}</p>` : '';
  const ctaHtml = article.cta ? `<p><em>${escapeHtml(article.cta)}</em></p>` : '';
  const sourcesHtml = Array.isArray(article.sources) && article.sources.length > 0
    ? `<hr><h3>Sources</h3><ul>${article.sources.map((source) => (
      `<li><a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a></li>`
    )).join('')}</ul>`
    : '';
  const editorialHtml = trustLevel === 'press-report'
    ? ''
    : `<hr><p><strong>${escapeHtml(BRAND_NAME)} editorial standard:</strong> ${escapeHtml(trustNote)}</p>`;

  return `<article>${seoHtml}${disclaimerHtml}${subtitleHtml}${introHtml}${keyFactsHtml}${sectionsHtml}${takeawayHtml}${conclusionHtml}${ctaHtml}${sourcesHtml}${editorialHtml}</article>`;
}

export function getBloggerInsertUrl(blogId, { asDraft = true } = {}) {
  const base = `https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts`;
  return asDraft ? `${base}?isDraft=true` : base;
}

function extractJsonText(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  return trimmed;
}

function parseModelList(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function dedupeModelList(models = []) {
  return models.filter((model, index, all) => model && all.indexOf(model) === index);
}

// Text-only Flash models for generateContent, best quality → most budget (no Pro/TTS/image/video).
const DEFAULT_GEMINI_TEXT_MODELS = [
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b'
];

export function getGeminiModelChain() {
  const fromChain = parseModelList(process.env.GEMINI_MODEL_CHAIN);
  if (fromChain.length > 0) return dedupeModelList(fromChain);

  const legacy = [
    ...parseModelList(process.env.GEMINI_MODEL),
    ...parseModelList(process.env.GEMINI_MODEL_FALLBACK),
    ...parseModelList(process.env.GEMINI_MODEL_FALLBACK_2)
  ];

  if (legacy.length > 0) return dedupeModelList(legacy);
  return [...DEFAULT_GEMINI_TEXT_MODELS];
}

let geminiKeyCursor = 0;

export function getGeminiApiKeys() {
  const keys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_FALLBACK,
    process.env.GEMINI_API_KEY_FALLBACK_2
  ].map((entry) => entry?.trim()).filter(Boolean);

  const unique = [...new Set(keys)];
  if (unique.length === 0) {
    throw new Error('Missing GEMINI_API_KEY');
  }

  return unique;
}

export function rotateApiKeys(keys = [], offset = 0) {
  if (!Array.isArray(keys) || keys.length === 0) return [];
  const normalizedOffset = ((offset % keys.length) + keys.length) % keys.length;
  return [...keys.slice(normalizedOffset), ...keys.slice(0, normalizedOffset)];
}

function advanceGeminiKeyCursor(keyCount = 1) {
  const offset = geminiKeyCursor;
  geminiKeyCursor = (geminiKeyCursor + 1) % Math.max(keyCount, 1);
  return offset;
}

export function isGeminiQuotaError(status = 0, body = '') {
  const sample = String(body).toLowerCase();
  return status === 429
    || /resource_exhausted|quota exceeded|exceeded your current quota|rate limit/i.test(sample)
    || (status === 403 && /quota|rate limit/i.test(sample));
}

function isGeminiRetryableError(status = 0, body = '') {
  return isGeminiQuotaError(status, body) || status === 500 || status === 503 || status === 502;
}

function shouldTryNextGeminiKey(status = 0, body = '') {
  return isGeminiRetryableError(status, body);
}

function shouldTryNextGeminiModel(status = 0, body = '') {
  const sample = String(body).toLowerCase();
  if (shouldTryNextGeminiKey(status, body)) return true;
  return status === 404 || /not found|not supported|unknown model/i.test(sample);
}

const GEMINI_KEY_LABELS = ['main', 'fallback', 'fallback-2'];

function getGeminiKeyLabel(index = 0) {
  return GEMINI_KEY_LABELS[index] || `key-${index + 1}`;
}

export function buildStorySummaryForPrompt(item = {}, { maxChars = MAX_PROMPT_SUMMARY_CHARS } = {}) {
  const text = String(item.description || '').trim();
  if (!text) return 'No summary available.';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

function pickLongerDescription(current = '', candidate = '') {
  const left = String(current || '').trim();
  const right = String(candidate || '').trim();
  return right.length > left.length ? right : left;
}

function mergeEnrichedDescription(item = {}, candidateText = '', extra = {}) {
  const merged = pickLongerDescription(item.description, candidateText);
  if (merged.length <= (item.description || '').length) return item;

  return {
    ...item,
    ...extra,
    description: merged.slice(0, MAX_STORY_BODY_CHARS),
    enriched: true
  };
}

export function isRedditPostLink(link = '') {
  return Boolean(getRedditPostJsonUrl(link));
}

export function getRedditPostJsonUrl(link = '', { oauth = false } = {}) {
  try {
    const url = new URL(link);
    if (!/reddit\.com$/i.test(url.hostname.replace(/^www\./, '')) && !url.hostname.includes('reddit.com')) {
      return null;
    }

    const pathname = url.pathname.replace(/\/$/, '');
    if (!/\/comments\/[a-z0-9]+/i.test(pathname)) return null;

    const host = oauth ? 'oauth.reddit.com' : 'www.reddit.com';
    return `https://${host}${pathname}.json?raw_json=1`;
  } catch {
    return null;
  }
}

export function parseRedditPostDetailPayload(payload = []) {
  const post = payload?.[0]?.data?.children?.[0]?.data;
  if (!post) return null;

  const selftext = cleanText(post.selftext || '');
  const title = cleanText(post.title || '');
  const isSelf = Boolean(post.is_self);
  const externalUrl = !isSelf && post.url && !/reddit\.com/i.test(post.url) ? post.url : '';
  let description = selftext;

  if (!description && externalUrl) {
    description = `Link post pointing to ${externalUrl}.`;
  }

  return {
    title,
    description: description.slice(0, MAX_STORY_BODY_CHARS),
    redditScore: post.score ?? null,
    redditComments: post.num_comments ?? null,
    isSelf,
    externalUrl
  };
}

async function fetchRedditPostDetail(link = '') {
  const useOAuth = hasRedditOAuthCredentials();
  const jsonUrl = getRedditPostJsonUrl(link, { oauth: useOAuth });
  if (!jsonUrl) return null;

  const request = async (accessToken = null) => fetch(jsonUrl, {
    headers: getRedditJsonRequestHeaders(accessToken)
  });

  try {
    let accessToken = useOAuth ? await getRedditOAuthAccessToken() : null;
    let response = await request(accessToken);

    if (useOAuth && response.status === 401) {
      accessToken = await getRedditOAuthAccessToken({ forceRefresh: true });
      response = await request(accessToken);
    }

    if (!response.ok) return null;
    return parseRedditPostDetailPayload(await response.json());
  } catch {
    return null;
  }
}

export function extractArticleBodyText(html = '', { maxChars = MAX_STORY_BODY_CHARS } = {}) {
  const jsonLdBlocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];

  for (const block of jsonLdBlocks) {
    try {
      const raw = block.replace(/<script[^>]*>|<\/script>/gi, '').trim();
      const parsed = JSON.parse(raw);
      const nodes = Array.isArray(parsed) ? parsed : [parsed, ...(Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [])];
      for (const node of nodes) {
        const articleBody = cleanText(node?.articleBody || '');
        if (articleBody.length > 200) return articleBody.slice(0, maxChars);
      }
    } catch {
      // Try the next JSON-LD block.
    }
  }

  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const contentMatch = html.match(/<div[^>]+class=["'][^"']*(?:entry-content|article-body|post-content|article__content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  const block = articleMatch?.[1] || contentMatch?.[1] || html;
  const paragraphs = [...block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => cleanText(match[1]))
    .filter((paragraph) => paragraph.length > 40);

  return paragraphs.join(' ').slice(0, maxChars);
}

async function fetchArticlePageDetail(item = {}) {
  if (!item.link) return item;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ENRICH_FETCH_TIMEOUT_MS);
    const response = await fetch(item.link, {
      signal: controller.signal,
      headers: {
        'User-Agent': `${BRAND_NAME}Bot/1.0 (editorial enrichment)`,
        Accept: 'text/html,application/xhtml+xml'
      }
    });
    clearTimeout(timeout);

    if (!response.ok) return item;

    const html = await response.text();
    const ogDescription = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
    const metaDescription = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    const excerpt = cleanText(ogDescription?.[1] || metaDescription?.[1] || '');
    const bodyText = extractArticleBodyText(html);
    const combined = [excerpt, bodyText].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

    return mergeEnrichedDescription(item, combined);
  } catch {
    return item;
  }
}

export async function enrichStoryDetail(item) {
  if (!item.link) return item;

  let enrichedItem = item;

  if (item.sourceKind === 'reddit' || isRedditPostLink(item.link)) {
    const redditDetail = await fetchRedditPostDetail(item.link);
    if (redditDetail) {
      enrichedItem = mergeEnrichedDescription(enrichedItem, redditDetail.description, {
        redditScore: redditDetail.redditScore ?? enrichedItem.redditScore,
        redditComments: redditDetail.redditComments ?? enrichedItem.redditComments
      });

      if (!redditDetail.isSelf && redditDetail.externalUrl) {
        enrichedItem = await fetchArticlePageDetail({
          ...enrichedItem,
          link: redditDetail.externalUrl
        });
      }
    }

    return enrichedItem;
  }

  return fetchArticlePageDetail(item);
}

export async function enrichStories(stories, { limit = stories.length } = {}) {
  const targetStories = stories.slice(0, limit);
  const enriched = [];

  for (const story of targetStories) {
    enriched.push(await enrichStoryDetail(story));
    if (story.sourceKind === 'reddit' || isRedditPostLink(story.link)) {
      await sleep(400);
    }
  }

  return [...enriched, ...stories.slice(targetStories.length)];
}

function filterRetainedStoryHistoryEntries(entries = []) {
  const cutoff = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return entries.filter((entry) => entry?.coveredAt >= cutoff);
}

function stripConflictMarkers(text = '') {
  return text
    .replace(/^<<<<<<<[^\n]*\n/gm, '')
    .replace(/^=======\n/gm, '')
    .replace(/^>>>>>>>[^\n]*\n/gm, '');
}

function getLastCapturedValue(text = '', pattern) {
  const matches = [...text.matchAll(pattern)];
  return matches.at(-1)?.[1] ?? null;
}

function collapseDuplicateJsonProperties(text = '', properties = ['coveredAt', 'articleTitle', 'title', 'source', 'contentType', 'topicFingerprint']) {
  let result = text;

  for (const property of properties) {
    const linePattern = new RegExp(`^\\s*"${property}"\\s*:\\s*(?:"(?:\\\\.|[^"\\\\])*"|\\d+)\\s*,?\\s*$`, 'gm');
    const matches = [...result.matchAll(linePattern)];
    if (matches.length <= 1) continue;

    for (let index = 0; index < matches.length - 1; index += 1) {
      result = result.replace(matches[index][0], '');
    }
  }

  return result;
}

export function extractHistoryEntryFromFragment(fragment = '') {
  const cleaned = collapseDuplicateJsonProperties(stripConflictMarkers(fragment));
  const fingerprint = getLastCapturedValue(cleaned, /"fingerprint"\s*:\s*"([^"]+)"/g);
  const coveredAt = Number(getLastCapturedValue(cleaned, /"coveredAt"\s*:\s*(\d+)/g));

  if (!fingerprint || !Number.isFinite(coveredAt)) return null;

  return {
    fingerprint,
    topicFingerprint: getLastCapturedValue(cleaned, /"topicFingerprint"\s*:\s*"([^"]+)"/g) || fingerprint,
    contentType: getLastCapturedValue(cleaned, /"contentType"\s*:\s*"([^"]+)"/g) || 'news',
    title: getLastCapturedValue(cleaned, /"title"\s*:\s*"((?:\\.|[^"\\])*)"/g) || '',
    articleTitle: getLastCapturedValue(cleaned, /"articleTitle"\s*:\s*"((?:\\.|[^"\\])*)"/g) || null,
    source: getLastCapturedValue(cleaned, /"source"\s*:\s*"([^"]+)"/g) || '',
    coveredAt
  };
}

function collectSalvagedEntries(raw = '') {
  const stripped = collapseDuplicateJsonProperties(stripConflictMarkers(raw));
  const entries = [];
  const seen = new Set();

  const addEntry = (entry) => {
    if (!entry?.fingerprint || seen.has(entry.fingerprint)) return;
    seen.add(entry.fingerprint);
    entries.push(entry);
  };

  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed?.entries)) {
      for (const entry of parsed.entries) addEntry(entry);
      if (entries.length > 0) return entries;
    }
  } catch {
    // Fall back to per-entry extraction below.
  }

  const entryPattern = /\{[^{}]*"fingerprint"\s*:\s*"[^"]+"[\s\S]*?"coveredAt"\s*:\s*\d+\s*\}/g;
  let match;

  while ((match = entryPattern.exec(stripped)) !== null) {
    try {
      addEntry(JSON.parse(collapseDuplicateJsonProperties(stripConflictMarkers(match[0]))));
    } catch {
      addEntry(extractHistoryEntryFromFragment(match[0]));
    }
  }

  if (entries.length > 0) return entries;

  for (const segment of raw.split(/^<<<<<<<[^\n]*$/m)) {
    const cleaned = collapseDuplicateJsonProperties(stripConflictMarkers(segment));

    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed?.entries)) {
        for (const entry of parsed.entries) addEntry(entry);
        continue;
      }
    } catch {
      // Try fragment extraction on this segment.
    }

    let segmentMatch;
    const segmentPattern = /\{[^{}]*"fingerprint"\s*:\s*"[^"]+"[\s\S]*?"coveredAt"\s*:\s*\d+\s*\}/g;
    while ((segmentMatch = segmentPattern.exec(cleaned)) !== null) {
      try {
        addEntry(JSON.parse(collapseDuplicateJsonProperties(stripConflictMarkers(segmentMatch[0]))));
      } catch {
        addEntry(extractHistoryEntryFromFragment(segmentMatch[0]));
      }
    }
  }

  return entries;
}

export function salvageConflictedStoryHistory(raw = '') {
  return filterRetainedStoryHistoryEntries(collectSalvagedEntries(raw).filter(Boolean));
}

async function readStoryHistoryEntries() {
  const raw = await fs.readFile(HISTORY_FILE, 'utf8');

  if (/^<<<<<<< /m.test(raw)) {
    const salvaged = salvageConflictedStoryHistory(raw);
    if (salvaged.length > 0) {
      console.warn(`Story history contained git conflict markers; recovered ${salvaged.length} entr${salvaged.length === 1 ? 'y' : 'ies'}.`);
      return salvaged;
    }
  }

  const parsed = JSON.parse(raw);
  return Array.isArray(parsed?.entries) ? parsed.entries : [];
}

async function loadStoryHistory() {
  try {
    return filterRetainedStoryHistoryEntries(await readStoryHistoryEntries());
  } catch (error) {
    console.warn(`Story history unavailable (${error.message}); starting with empty history.`);
    return [];
  }
}

async function loadFeedHealth() {
  try {
    const raw = await fs.readFile(FEED_HEALTH_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed?.sources && typeof parsed.sources === 'object' ? parsed.sources : {};
  } catch {
    return {};
  }
}

async function saveFeedHealth(sources = {}, { activeNames = getActiveFeedSourceNames() } = {}) {
  await fs.mkdir(path.dirname(FEED_HEALTH_FILE), { recursive: true });
  await fs.writeFile(FEED_HEALTH_FILE, JSON.stringify({
    updatedAt: new Date().toISOString(),
    sources: pruneFeedHealth(sources, activeNames)
  }, null, 2));
}

export function recordFeedHealthResult(existing = {}, sourceName, { success, itemCount = 0, error = null } = {}) {
  const previous = existing[sourceName] || {
    successStreak: 0,
    failureStreak: 0,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    lastItemCount: 0
  };
  const now = Date.now();

  if (success) {
    return {
      ...existing,
      [sourceName]: {
        ...previous,
        successStreak: previous.failureStreak > 0 ? 1 : previous.successStreak + 1,
        failureStreak: 0,
        lastSuccessAt: now,
        lastError: null,
        lastItemCount: itemCount
      }
    };
  }

  return {
    ...existing,
    [sourceName]: {
      ...previous,
      successStreak: 0,
      failureStreak: previous.successStreak > 0 ? 1 : previous.failureStreak + 1,
      lastErrorAt: now,
      lastError: error || 'unknown error',
      lastItemCount: 0
    }
  };
}

export function getUnhealthyFeedSources(sources = {}, { minFailureStreak = 3 } = {}) {
  return Object.entries(sources)
    .filter(([name]) => shouldSkipFeedSource(name, sources, { minFailureStreak }))
    .map(([name, stats]) => ({ name, failureStreak: stats.failureStreak, lastError: stats.lastError }));
}

export function isPersistentlyBlockedFeedError(error = '') {
  return /403|blocked by bot protection/i.test(String(error));
}

export function isRateLimitedFeedError(error = '') {
  const message = String(error).toLowerCase();
  return message.includes('429') || message.includes('rate limit');
}

export function hasRedditOAuthCredentials() {
  return Boolean(process.env.REDDIT_CLIENT_ID?.trim() && process.env.REDDIT_CLIENT_SECRET?.trim());
}

export function getRedditUserAgent() {
  if (process.env.REDDIT_USER_AGENT?.trim()) return process.env.REDDIT_USER_AGENT.trim();
  const username = process.env.REDDIT_USERNAME?.trim() || 'FalloutHubBlog';
  return `web:fallout-hub-blog:v1.0.0 (by /u/${username})`;
}

export function getRedditFetchStrategies({
  preferRss = process.env.REDDIT_PREFER_RSS === 'true' || process.env.CI === 'true',
  rssOnly = process.env.REDDIT_RSS_ONLY === 'true' || process.env.CI === 'true',
  source = null
} = {}) {
  if (hasRedditOAuthCredentials()) return ['oauth-json', 'rss'];
  if (source?.primary) return ['json', 'rss'];
  if (rssOnly) return ['rss'];
  return preferRss ? ['rss', 'json'] : ['json', 'rss'];
}

export function getRedditCustomFeedSource() {
  const url = process.env.REDDIT_CUSTOM_FEED_URL?.trim();
  if (!url) return null;

  return {
    name: 'Reddit — Custom Fallout Feed',
    url,
    weight: 1.4,
    category: 'community',
    tier: 'community',
    kind: 'reddit',
    dedicatedFallout: true,
    isCustomFeed: true,
    minScore: 60,
    minComments: 15,
    primary: true
  };
}

export function hasRedditCustomFeed() {
  return Boolean(getRedditCustomFeedSource());
}

export function getActiveRedditSources() {
  if (hasRedditCustomFeed()) return [];

  const override = (process.env.REDDIT_SUBREDDITS || '').trim();
  if (!override) return REDDIT_SOURCES;

  const allowed = new Set(
    override.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean)
  );

  return REDDIT_SOURCES.filter((source) => allowed.has(source.subreddit.toLowerCase()));
}

export function getActiveFeedSourceNames() {
  const customReddit = getRedditCustomFeedSource();
  return new Set([
    ...CONTENT_SOURCES.map((source) => source.name),
    ...(customReddit ? [customReddit.name] : []),
    ...getActiveRedditSources().map((source) => source.name)
  ]);
}

export function pruneFeedHealth(feedHealth = {}, activeNames = new Set()) {
  const pruned = {};
  for (const [name, stats] of Object.entries(feedHealth)) {
    if (activeNames.has(name)) {
      pruned[name] = stats;
    }
  }
  return pruned;
}

let redditOAuthToken = null;
let redditOAuthExpiresAt = 0;

async function requestRedditAccessToken(grantParams) {
  const clientId = process.env.REDDIT_CLIENT_ID.trim();
  const clientSecret = process.env.REDDIT_CLIENT_SECRET.trim();
  return fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'User-Agent': getRedditUserAgent(),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(grantParams)
  });
}

async function getRedditOAuthAccessToken({ forceRefresh = false } = {}) {
  if (!hasRedditOAuthCredentials()) return null;
  if (!forceRefresh && redditOAuthToken && Date.now() < redditOAuthExpiresAt - 60_000) {
    return redditOAuthToken;
  }

  let response = await requestRedditAccessToken({ grant_type: 'client_credentials' });

  if (!response.ok) {
    const username = process.env.REDDIT_USERNAME?.trim();
    const password = process.env.REDDIT_PASSWORD?.trim();
    if (username && password) {
      response = await requestRedditAccessToken({
        grant_type: 'password',
        username,
        password
      });
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Reddit OAuth failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  redditOAuthToken = data.access_token;
  redditOAuthExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return redditOAuthToken;
}

function buildRedditRequestHeaders() {
  return {
    'User-Agent': getRedditUserAgent(),
    Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
  };
}

function getRedditJsonRequestHeaders(accessToken = null) {
  const headers = {
    'User-Agent': getRedditUserAgent(),
    Accept: 'application/json'
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function getRedditRateLimitBackoffMs(response, attempt = 0) {
  const retryAfterSec = Number.parseInt(response?.headers?.get?.('retry-after') || '5', 10);
  return Math.min(retryAfterSec, 30) * 1000 + attempt * REDDIT_RATE_LIMIT_BACKOFF_MS;
}

export function shouldSkipFeedSource(sourceName, feedHealth = {}, { minFailureStreak = 3 } = {}) {
  const stats = feedHealth[sourceName];
  const failureStreak = stats?.failureStreak || 0;
  const requiredStreak = isPersistentlyBlockedFeedError(stats?.lastError)
    ? Math.min(minFailureStreak, PERSISTENT_BLOCK_FAILURE_STREAK)
    : minFailureStreak;
  return failureStreak >= requiredStreak;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveFeedItemLink(link, feedUrl) {
  const trimmed = (link || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  try {
    const feed = new URL(feedUrl);
    return new URL(trimmed, feed.origin).href;
  } catch {
    return trimmed;
  }
}

async function saveStoryHistory(existingEntries, selectedStories, article = {}) {
  const now = Date.now();
  const newEntries = selectedStories.map((item) => ({
    fingerprint: getStoryKey(item),
    topicFingerprint: getStoryTopicKey(item),
    contentType: item.contentType || 'news',
    title: item.title,
    articleTitle: article.title || null,
    source: item.source,
    coveredAt: now
  }));

  let baseEntries = existingEntries;
  if (baseEntries.length === 0) {
    try {
      baseEntries = filterRetainedStoryHistoryEntries(await readStoryHistoryEntries());
    } catch {
      baseEntries = [];
    }
  }

  const merged = [...baseEntries, ...newEntries];
  const latestByTopic = new Map();

  for (const entry of filterRetainedStoryHistoryEntries(merged)) {
    const topicKey = entry.topicFingerprint || entry.fingerprint;
    const previous = latestByTopic.get(topicKey);
    if (!previous || entry.coveredAt >= previous.coveredAt) {
      latestByTopic.set(topicKey, entry);
    }
  }

  const entries = [...latestByTopic.values()].sort((a, b) => b.coveredAt - a.coveredAt);
  const payload = JSON.stringify({ entries }, null, 2);
  JSON.parse(payload);

  await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
  const tempFile = `${HISTORY_FILE}.tmp`;
  await fs.writeFile(tempFile, payload);
  await fs.rename(tempFile, HISTORY_FILE);
  console.log(`Story history saved: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`);
}

async function getBloggerAccessToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Blogger credentials');
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  if (!tokenResponse.ok) {
    throw new Error('Failed to refresh Blogger access token');
  }

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

function getGeminiTemperature(contentType = 'news') {
  if (contentType === 'community') return 0.65;
  if (contentType === 'mods') return 0.55;
  return 0.45;
}

async function generateArticle(newsItems) {
  const contentType = newsItems[0]?.contentType || 'news';
  const apiKeys = getGeminiApiKeys();
  const models = getGeminiModelChain();
  console.log(`Gemini key pool: ${apiKeys.length} configured key(s), ${apiKeys.length > 1 ? 'using round-robin across generation calls' : 'single-key mode'}.`);
  console.log(`Gemini model chain (${models.length}): ${models.join(' → ')}`);

  const prompt = buildPrompt(newsItems);
  let article = normalizeArticle(await callGemini(prompt, { contentType }), newsItems);

  if (!isArticleSubstantive(article)) {
    console.warn(`Article too thin (${getArticleWordCount(article)} words). Requesting expanded version...`);
    const expansionPrompt = buildPrompt(newsItems, { expansion: true, previousArticle: article });
    article = normalizeArticle(await callGemini(expansionPrompt, { contentType }), newsItems);
  }

  return article;
}

async function callGemini(prompt, { contentType = 'news' } = {}) {
  const apiKeys = getGeminiApiKeys();
  const keyOffset = advanceGeminiKeyCursor(apiKeys.length);
  const rotatedKeys = rotateApiKeys(apiKeys, keyOffset);

  const models = getGeminiModelChain();
  const errors = [];

  for (const [keyIndex, apiKey] of rotatedKeys.entries()) {
    const keyLabel = getGeminiKeyLabel((keyOffset + keyIndex) % apiKeys.length);

    for (const model of models) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: getGeminiTemperature(contentType),
              responseMimeType: 'application/json'
            }
          })
        });

        if (!response.ok) {
          const text = await response.text();
          const message = `Gemini API error ${response.status}: ${text}`;
          errors.push(`${keyLabel}/${model}: ${message}`);
          if (shouldTryNextGeminiModel(response.status, text)) continue;
          break;
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!text) {
          errors.push(`${keyLabel}/${model}: Gemini returned empty content`);
          continue;
        }

        const jsonText = extractJsonText(text);
        if (keyIndex > 0 || model !== models[0]) {
          console.log(`Gemini succeeded with ${keyLabel} on ${model}.`);
        }
        return JSON.parse(jsonText);
      } catch (error) {
        errors.push(`${keyLabel}/${model}: ${error.message}`);
      }
    }
  }

  throw new Error(errors.join(' | '));
}

function buildFeedRequestHeaders(extraHeaders = {}) {
  return {
    'User-Agent': FEED_USER_AGENT,
    Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    ...extraHeaders
  };
}

function isBlockedFeedPayload(text = '') {
  const sample = text.slice(0, 1200).toLowerCase();
  return sample.includes('just a moment') || sample.includes('cf-browser-verification') || sample.includes('attention required');
}

async function fetchFeed(url, { headers = {}, fallbackUrls = [] } = {}) {
  const candidates = [url, ...fallbackUrls].filter(Boolean);
  const errors = [];

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        headers: buildFeedRequestHeaders(headers)
      });

      if (!response.ok) {
        errors.push(`${response.status}`);
        continue;
      }

      const text = await response.text();
      if (isBlockedFeedPayload(text)) {
        errors.push('blocked by bot protection');
        continue;
      }

      return text;
    } catch (error) {
      errors.push(error.message || 'network error');
    }
  }

  throw new Error(`Feed request failed (${errors[errors.length - 1] || 'unknown error'})`);
}

export function isFeedTitleExcluded(title = '', source = {}) {
  const patterns = Array.isArray(source.excludeTitlePatterns) ? source.excludeTitlePatterns : [];
  return patterns.some((pattern) => pattern.test(title));
}

function normalizeSyndicatedTitle(title = '', feedSource = '') {
  if (!feedSource) return title;
  const outletSuffix = new RegExp(`\\s+[-–]\\s+${feedSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  return title.replace(outletSuffix, '').trim();
}

export function formatFeedWarnings(feedErrors = []) {
  return feedErrors.map((error) => `  - ${error}`);
}

export function isRelevantFalloutItem(item, source) {
  const title = normalizeSyndicatedTitle(item.title || '', item.feedSource || '');
  if (isFeedTitleExcluded(title, source)) return false;
  if (source.tier === 'press' && OFF_TOPIC_PRESS_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
    return false;
  }

  const normalizedItem = { ...item, title };
  const haystack = `${title} ${item.description} ${item.link || ''}`.toLowerCase();
  const hasRelevantKeyword = FALLOUT_KEYWORDS.some((term) => haystack.includes(term)) || haystack.includes('fallout');
  const hasNoise = NOISE_TERMS.some((term) => haystack.includes(term));

  if (isDedicatedFalloutSource(source)) {
    return !hasNoise;
  }

  if (!hasFalloutFocus(normalizedItem)) return false;

  if (source.category === 'news' && source.tier === 'press' && !hasFalloutTitleMention(title)) {
    return false;
  }

  if (source.requiresFalloutMatch || source.tier === 'press') {
    return hasRelevantKeyword && !hasNoise;
  }

  return hasRelevantKeyword && !hasNoise;
}

export function parseRedditListing(payload = {}, source = {}) {
  const children = Array.isArray(payload?.data?.children) ? payload.data.children : [];

  return children
    .filter((child) => child?.kind === 't3' && child.data)
    .map((child) => {
      const post = child.data;
      const permalink = post.permalink ? `https://www.reddit.com${post.permalink}` : '';
      const link = post.url && /^https?:\/\//i.test(post.url) ? post.url : permalink;
      const description = cleanText(post.selftext || post.title || '').slice(0, MAX_STORY_BODY_CHARS);

      return {
        title: cleanText(post.title || ''),
        link,
        description,
        publishedAt: post.created_utc ? post.created_utc * 1000 : null,
        redditScore: post.score ?? 0,
        redditComments: post.num_comments ?? 0,
        isStickied: Boolean(post.stickied),
        over18: Boolean(post.over_18),
        sourceKind: 'reddit',
        minScore: source.minScore,
        minComments: source.minComments
      };
    })
    .filter((item) => item.title);
}

function mapSourceItem(item, source) {
  const contentType = detectContentType(item, source);
  const trustLevel = detectTrustLevel(item, source);
  const link = resolveFeedItemLink(item.link, source.url);
  const title = normalizeSyndicatedTitle(item.title || '', item.feedSource || '');
  const description = item.feedSource && !(item.description || '').toLowerCase().includes(item.feedSource.toLowerCase())
    ? `${item.description || ''} Reported by ${item.feedSource}.`.trim()
    : (item.description || '');
  return {
    ...item,
    title,
    description,
    link,
    source: source.name,
    sourceTier: source.tier,
    sourceKind: source.kind || item.sourceKind || 'rss',
    contentType,
    trustLevel,
    score: scoreItem({ ...item, contentType }, source)
  };
}

async function loadManualSeedItems() {
  try {
    const raw = await fs.readFile(MANUAL_SEEDS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    const cutoff = Date.now() - MANUAL_SEED_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    return items
      .filter((item) => item?.title && item?.link)
      .filter((item) => {
        const publishedAt = item.publishedAt ? parseRssDate(item.publishedAt) : Date.now();
        return publishedAt >= cutoff;
      })
      .map((item) => mapSourceItem({
        title: item.title,
        link: item.link,
        description: item.description || item.title,
        publishedAt: item.publishedAt ? parseRssDate(item.publishedAt) : Date.now()
      }, {
        name: item.source || 'Manual Seed',
        url: item.link,
        weight: item.weight || 1.3,
        category: item.category || 'news',
        tier: item.tier || 'press',
        kind: 'rss'
      }));
  } catch {
    return [];
  }
}

async function fetchRssSourceItems(source) {
  const xml = await fetchFeed(source.url, {
    headers: source.headers,
    fallbackUrls: source.fallbackUrls
  });
  const items = extractFeedItems(xml);

  return items
    .filter((item) => isRelevantFalloutItem(item, source))
    .map((item) => mapSourceItem(item, source))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

const REDDIT_MOD_POST_PATTERNS = [
  /^a note about\b/i,
  /^low-effort/i,
  /^moderator announcement/i,
  /^announcement:/i
];

export function parseRedditRssFeed(xmlText = '', source = {}) {
  return extractFeedItems(xmlText)
    .map((item, index) => {
      const title = cleanText(item.title || '');
      const link = item.link || '';
      const description = cleanText(item.description || item.title || '').slice(0, MAX_STORY_BODY_CHARS);
      const isModeratorPost = REDDIT_MOD_POST_PATTERNS.some((pattern) => pattern.test(title));

      return {
        title,
        link,
        description,
        publishedAt: item.publishedAt,
        redditScore: null,
        redditComments: null,
        redditFeedRank: index + 1,
        isStickied: isModeratorPost,
        over18: false,
        sourceKind: 'reddit',
        minScore: source.minScore,
        minComments: source.minComments
      };
    })
    .filter((item) => item.title);
}

async function fetchRedditOAuthJsonItems(source) {
  const url = `https://oauth.reddit.com/r/${source.subreddit}/hot?limit=25&raw_json=1`;

  const request = async (accessToken) => fetch(url, {
    headers: getRedditJsonRequestHeaders(accessToken)
  });

  let accessToken = await getRedditOAuthAccessToken();
  let response = await request(accessToken);

  if (response.status === 401) {
    accessToken = await getRedditOAuthAccessToken({ forceRefresh: true });
    response = await request(accessToken);
  }

  if (!response.ok) {
    throw new Error(`Reddit OAuth request failed (${response.status})`);
  }

  return parseRedditListing(await response.json(), source);
}

async function fetchRedditJsonItems(source, { maxAttempts = 3 } = {}) {
  const url = `https://www.reddit.com/r/${source.subreddit}/hot.json?limit=25&raw_json=1`;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: getRedditJsonRequestHeaders() });

      if (response.status === 429) {
        lastError = new Error('Reddit request failed (429)');
        await sleep(getRedditRateLimitBackoffMs(response, attempt));
        continue;
      }

      if (!response.ok) {
        throw new Error(`Reddit request failed (${response.status})`);
      }

      return parseRedditListing(await response.json(), source);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts - 1 && !isRateLimitedFeedError(error.message)) {
        await sleep(REDDIT_RATE_LIMIT_BACKOFF_MS * (attempt + 1));
      }
    }
  }

  throw lastError || new Error('Reddit request failed (unknown error)');
}

async function fetchRedditRssItems(source, { maxAttempts = 3 } = {}) {
  const subreddit = source.subreddit;
  const candidates = [
    `https://old.reddit.com/r/${subreddit}/hot/.rss`,
    `https://www.reddit.com/r/${subreddit}/hot/.rss`,
    `https://old.reddit.com/r/${subreddit}/.rss`
  ];
  const errors = [];

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let rateLimited = false;

    for (const url of candidates) {
      try {
        const response = await fetch(url, { headers: buildRedditRequestHeaders() });

        if (response.status === 429) {
          errors.push('429');
          rateLimited = true;
          await sleep(getRedditRateLimitBackoffMs(response, attempt));
          break;
        }

        if (!response.ok) {
          errors.push(`${response.status}`);
          continue;
        }

        const text = await response.text();
        if (isBlockedFeedPayload(text)) {
          errors.push('blocked by bot protection');
          continue;
        }

        return parseRedditRssFeed(text, source);
      } catch (error) {
        errors.push(error.message || 'network error');
      }
    }

    if (!rateLimited && attempt < maxAttempts - 1) {
      await sleep(REDDIT_RATE_LIMIT_BACKOFF_MS * (attempt + 1));
    }
  }

  throw new Error(`Feed request failed (${errors[errors.length - 1] || 'unknown error'})`);
}

function normalizeRedditTitleKey(title = '') {
  return normalizeStoryText(title).slice(0, 120);
}

async function enrichRssItemsWithRedditJson(items = [], source, { skipIfJsonAttempted = false } = {}) {
  if (items.length === 0 || items.every((item) => hasRedditEngagementMetrics(item))) {
    return items;
  }

  const shouldEnrich = process.env.REDDIT_ENRICH_ENGAGEMENT !== 'false';
  if (!shouldEnrich || skipIfJsonAttempted) return items;

  try {
    const jsonItems = hasRedditOAuthCredentials()
      ? await fetchRedditOAuthJsonItems(source)
      : await fetchRedditJsonItems(source, { maxAttempts: 2 });
    const detailsByTitle = new Map(
      jsonItems.map((item) => [normalizeRedditTitleKey(item.title), item])
    );

    return items.map((item) => {
      const detail = detailsByTitle.get(normalizeRedditTitleKey(item.title));
      if (!detail) return item;
      return {
        ...item,
        redditScore: detail.redditScore ?? item.redditScore,
        redditComments: detail.redditComments ?? item.redditComments,
        description: pickLongerDescription(item.description, detail.description)
      };
    });
  } catch {
    return items;
  }
}

async function fetchRedditCustomFeedItems(source, { maxAttempts = 3 } = {}) {
  const errors = [];

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(source.url, { headers: buildRedditRequestHeaders() });

      if (response.status === 429) {
        errors.push('429');
        await sleep(getRedditRateLimitBackoffMs(response, attempt));
        continue;
      }

      if (!response.ok) {
        errors.push(`${response.status}`);
        continue;
      }

      const text = await response.text();
      if (isBlockedFeedPayload(text)) {
        errors.push('blocked by bot protection');
        continue;
      }

      const items = parseRedditRssFeed(text, source)
        .filter((item) => isRelevantFalloutItem(item, source))
        .filter((item) => passesCommunityQualityGate(item, { useCustomFeedRules: true }))
        .map((item) => mapSourceItem(item, source))
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);

      if (items.length === 0) {
        console.warn('Reddit custom feed fetched successfully but no items passed quality filters.');
      }

      return items;
    } catch (error) {
      errors.push(error.message || 'network error');
    }

    if (attempt < maxAttempts - 1) {
      await sleep(REDDIT_RATE_LIMIT_BACKOFF_MS * (attempt + 1));
    }
  }

  throw new Error(`Feed request failed (${errors[errors.length - 1] || 'unknown error'})`);
}

async function fetchRedditSourceItems(source) {
  const strategies = getRedditFetchStrategies({ source });
  const errors = [];
  let jsonAttempted = false;

  for (const strategy of strategies) {
    try {
      let items;
      if (strategy === 'oauth-json') {
        items = await fetchRedditOAuthJsonItems(source);
        jsonAttempted = true;
      } else if (strategy === 'rss') {
        items = await fetchRedditRssItems(source, { maxAttempts: source.primary ? 3 : 2 });
      } else {
        items = await fetchRedditJsonItems(source, { maxAttempts: source.primary ? 3 : 2 });
        jsonAttempted = true;
      }

      if (strategy === 'rss') {
        items = await enrichRssItemsWithRedditJson(items, source, { skipIfJsonAttempted: jsonAttempted });
      }

      return items
        .filter((item) => isRelevantFalloutItem(item, source))
        .filter((item) => passesCommunityQualityGate(item))
        .map((item) => mapSourceItem(item, source))
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
    } catch (error) {
      const message = error?.message || 'unknown error';
      errors.push(message);
      if (isRateLimitedFeedError(message)) {
        await sleep(REDDIT_RATE_LIMIT_BACKOFF_MS);
      } else if (isPersistentlyBlockedFeedError(message)) {
        await sleep(Math.max(REDDIT_FETCH_DELAY_MS, 2000));
      }
    }
  }

  throw new Error(`Feed request failed (${errors[errors.length - 1] || 'unknown error'})`);
}

function dedupeCollectedItems(collected = []) {
  const unique = [];
  const seenTopics = new Set();

  for (const item of collected.sort((a, b) => b.score - a.score)) {
    const topicKey = getStoryTopicKey(item);
    if (seenTopics.has(topicKey)) continue;
    if (unique.some((existing) => areTopicsSimilar(existing.title, item.title))) continue;
    seenTopics.add(topicKey);
    unique.push(item);
  }

  return unique.slice(0, 24);
}

async function fetchContentItems() {
  const sourceJobs = [
    ...CONTENT_SOURCES.map((source) => ({ source, kind: 'rss' })),
    ...getActiveRedditSources().map((source) => ({ source, kind: 'reddit' }))
  ];

  let feedHealth = await loadFeedHealth();
  const skippedFeeds = [];
  const cachedSourceCount = Object.keys(feedHealth).length;

  const activeFeedNames = getActiveFeedSourceNames();

  if (cachedSourceCount > 0) {
    const unhealthyOnLoad = getUnhealthyFeedSources(feedHealth)
      .filter((entry) => activeFeedNames.has(entry.name));
    console.log(`Feed health loaded: ${cachedSourceCount} source(s), ${unhealthyOnLoad.length} unhealthy.`);
  }

  const activeJobs = sourceJobs.filter(({ source }) => {
    if (shouldSkipFeedSource(source.name, feedHealth)) {
      skippedFeeds.push(source.name);
      return false;
    }
    return true;
  });

  if (skippedFeeds.length > 0) {
    console.warn(`Skipping unhealthy feeds (${skippedFeeds.length}): ${skippedFeeds.join(', ')}`);
  }

  const rssJobs = activeJobs.filter((job) => job.kind === 'rss');
  const redditJobs = activeJobs.filter((job) => job.kind === 'reddit');
  const customRedditSource = getRedditCustomFeedSource();

  if (customRedditSource) {
    console.log('Reddit custom feed configured; skipping individual subreddit sources.');
  } else if (redditJobs.length > 0) {
    if (hasRedditOAuthCredentials()) {
      console.log('Reddit OAuth credentials detected; using authenticated API requests.');
    } else if (process.env.CI === 'true') {
      console.warn('No Reddit OAuth credentials configured; unauthenticated Reddit requests are often rate-limited in CI.');
    }
  }

  const primaryRedditJobs = redditJobs.filter(({ source }) => source.primary);
  const secondaryRedditJobs = redditJobs.filter(({ source }) => !source.primary);
  const collected = [];
  const feedErrors = [];

  const recordSourceResult = (sourceName, result) => {
    if (result.status === 'fulfilled') {
      collected.push(...result.value);
      feedHealth = recordFeedHealthResult(feedHealth, sourceName, {
        success: true,
        itemCount: result.value.length
      });
      return;
    }

    const message = result.reason?.message || 'unknown error';
    feedErrors.push(`${sourceName}: ${message}`);
    feedHealth = recordFeedHealthResult(feedHealth, sourceName, {
      success: false,
      error: message
    });
  };

  if (customRedditSource && !shouldSkipFeedSource(customRedditSource.name, feedHealth)) {
    try {
      const value = await fetchRedditCustomFeedItems(customRedditSource);
      recordSourceResult(customRedditSource.name, { status: 'fulfilled', value });
      console.log(`Reddit custom feed returned ${value.length} item(s).`);
    } catch (error) {
      recordSourceResult(customRedditSource.name, { status: 'rejected', reason: error });
    }
  } else if (customRedditSource) {
    skippedFeeds.push(customRedditSource.name);
  }

  for (const { source } of primaryRedditJobs) {
    try {
      const value = await fetchRedditSourceItems(source);
      recordSourceResult(source.name, { status: 'fulfilled', value });
    } catch (error) {
      recordSourceResult(source.name, { status: 'rejected', reason: error });
    }
  }

  const rssResults = await Promise.allSettled(
    rssJobs.map(({ source }) => fetchRssSourceItems(source))
  );

  for (const [index, result] of rssResults.entries()) {
    recordSourceResult(rssJobs[index].source.name, result);
  }

  for (const [index, { source }] of secondaryRedditJobs.entries()) {
    if ((index > 0 || primaryRedditJobs.length > 0) && REDDIT_FETCH_DELAY_MS > 0) {
      await sleep(REDDIT_FETCH_DELAY_MS);
    }

    try {
      const value = await fetchRedditSourceItems(source);
      recordSourceResult(source.name, { status: 'fulfilled', value });
    } catch (error) {
      recordSourceResult(source.name, { status: 'rejected', reason: error });
    }
  }

  await saveFeedHealth(feedHealth, { activeNames: activeFeedNames });

  if (feedErrors.length > 0) {
    console.warn(`Feed warnings (${feedErrors.length}):`);
    for (const line of formatFeedWarnings(feedErrors)) {
      console.warn(line);
    }
  }

  const unhealthy = getUnhealthyFeedSources(feedHealth)
    .filter((entry) => activeFeedNames.has(entry.name));
  if (unhealthy.length > 0) {
    console.warn(`Unhealthy feeds (${unhealthy.length}): ${unhealthy.map((entry) => `${entry.name} (${entry.failureStreak}x, ${entry.lastError})`).join(', ')}`);
  }

  const manualItems = await loadManualSeedItems();
  if (manualItems.length > 0) {
    console.log(`Loaded ${manualItems.length} manual seed item(s).`);
  }

  return {
    items: dedupeCollectedItems([...collected, ...manualItems]),
    feedHealth,
    feedErrors,
    unhealthyFeeds: unhealthy,
    skippedFeeds
  };
}

function getBloggerLabels() {
  return [];
}

async function createBloggerDraft(article) {
  const blogId = process.env.BLOGGER_BLOG_ID;

  if (!blogId || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REFRESH_TOKEN) {
    throw new Error('Missing Blogger credentials');
  }

  const accessToken = await getBloggerAccessToken();

  const postBody = {
    kind: 'blogger#post',
    title: article.title,
    content: buildArticleHtml(article),
    labels: getBloggerLabels(article)
  };

  const response = await fetch(getBloggerInsertUrl(blogId, { asDraft: true }), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(postBody)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Blogger API error ${response.status}: ${text}`);
  }

  return response.json();
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const { items: contentItems, feedHealth, feedErrors, unhealthyFeeds, skippedFeeds } = await fetchContentItems();
  const localHistory = await loadStoryHistory();
  console.log(`Story history loaded: ${localHistory.length} entr${localHistory.length === 1 ? 'y' : 'ies'}.`);
  const featuredItems = pickFeaturedStory(contentItems, localHistory);

  if (featuredItems.length === 0) {
    console.log('No fresh Fallout stories to post; skipping generation.');
    return;
  }

  const mainStory = featuredItems[0];
  const batchLimit = getGenerationBatchLimit(mainStory.contentType);
  const generationBatch = assembleGenerationItems(mainStory, contentItems, localHistory, {
    maxItems: batchLimit
  });

  if (generationBatch.length === 0) {
    console.log('No fresh Fallout stories to post; skipping generation.');
    return;
  }

  const editorialScore = getEditorialCandidateScore(mainStory, localHistory, getContentTypeCounts(localHistory));
  const batchMode = generationBatch.length > 1 ? 'multi-angle roundup' : 'single spotlight';
  console.log(`Editorial pick: ${mainStory.contentType} (score ${editorialScore.toFixed(1)}) — "${mainStory.title}"`);
  console.log(`Generation batch: ${generationBatch.length}/${batchLimit} ${mainStory.contentType} item(s) for ${batchMode}.`);

  const enrichedItems = await enrichStories(generationBatch);
  const substantiveItems = enrichedItems
    .filter((item) => meetsMinimumSourceQuality(item))
    .filter((item) => isEligibleForGeneration(item));

  if (substantiveItems.length === 0) {
    console.log('Only thin-source or off-topic stories available today; skipping generation.');
    return;
  }

  let article;
  let generationError = null;
  let mode = 'llm-generated';

  try {
    article = await generateArticle(substantiveItems);
    article = normalizeArticle(article, substantiveItems);
    console.log(`LLM article generated successfully (${getArticleWordCount(article)} words, ${article.contentType}, ${article.trustLevel}).`);
  } catch (error) {
    generationError = error;
    mode = 'fallback-template';
    article = normalizeArticle(buildFallbackArticle(substantiveItems), substantiveItems);
    console.warn(`LLM generation failed, using fallback article: ${error.message}`);
  }

  const publishable = isPublishableArticle(article, { mode, historyEntries: localHistory });
  let bloggerPost = null;
  let bloggerError = null;
  let publishSkippedReason = null;

  if (!publishable) {
    if (mode === 'fallback-template') {
      publishSkippedReason = 'fallback-template';
    } else if (!isArticleSubstantive(article)) {
      publishSkippedReason = 'article-not-substantive';
    } else {
      publishSkippedReason = getTitleValidationIssue(article.title, localHistory) || 'not-publishable';
    }
    const titleDetail = ['title-length', 'vague-title', 'duplicate-title', 'empty-title'].includes(publishSkippedReason)
      ? ` (${countChars(article.title)} chars: "${article.title}")`
      : '';
    console.warn(`Blogger draft skipped: ${publishSkippedReason}${titleDetail}`);
  } else if (isTopicCovered(substantiveItems[0], localHistory) || isDuplicateArticleTitle(article.title, localHistory)) {
    publishSkippedReason = 'already-covered';
    console.warn(`Blogger draft skipped: "${article.title}" matches a recently covered story.`);
  } else {
    try {
      bloggerPost = await createBloggerDraft(article);
      if (bloggerPost) {
        console.log('Blogger draft created successfully.');
        await saveStoryHistory(localHistory, substantiveItems.slice(0, 1), article);
      }
    } catch (error) {
      bloggerError = error;
      console.warn(`Blogger draft skipped: ${error.message}`);
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    brand: BRAND_NAME,
    featuredContentType: substantiveItems[0]?.contentType || 'news',
    featuredTrustLevel: substantiveItems[0]?.trustLevel || 'confirmed',
    selectedNews: substantiveItems,
    article,
    articleWordCount: getArticleWordCount(article),
    seoDescriptionCharCount: countChars(article.seoDescription),
    titleCharCount: countChars(article.title),
    isSubstantive: isArticleSubstantive(article),
    publishable,
    publishSkippedReason,
    feedHealthSummary: {
      totalSources: Object.keys(feedHealth).length,
      errorsToday: feedErrors.length,
      skippedFeeds,
      unhealthyFeeds
    },
    storyHistoryCount: localHistory.length,
    bloggerPost,
    generationError: generationError ? generationError.message : null,
    bloggerError: bloggerError ? bloggerError.message : null,
    mode
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Draft output saved to ${OUTPUT_FILE}`);
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
