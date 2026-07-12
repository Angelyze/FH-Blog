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
const REDDIT_USER_AGENT = 'FalloutHubBlogBot/1.0 (editorial automation; contact: fallout-hub)';
const REDDIT_FETCH_DELAY_MS = Number.parseInt(process.env.REDDIT_FETCH_DELAY_MS || '3000', 10);
const REDDIT_RATE_LIMIT_BACKOFF_MS = Number.parseInt(process.env.REDDIT_RATE_LIMIT_BACKOFF_MS || '3000', 10);
const PERSISTENT_BLOCK_FAILURE_STREAK = 2;
const FEED_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const NEXUS_FEED_HEADERS = {
  Referer: 'https://www.nexusmods.com/',
  Origin: 'https://www.nexusmods.com'
};
const BRAND_NAME = 'Fallout Hub';

const CONTENT_TYPES = ['news', 'mods', 'community'];

const CONTENT_SOURCES = [
  { name: 'IGN', url: 'https://www.ign.com/rss/articles/feed', weight: 1.45, category: 'news', tier: 'press', kind: 'rss' },
  { name: 'VGC', url: 'https://www.videogameschronicle.com/feed/', weight: 1.35, category: 'news', tier: 'press', kind: 'rss' },
  { name: 'GamesRadar', url: 'https://www.gamesradar.com/rss', weight: 1.3, category: 'news', tier: 'press', kind: 'rss' },
  { name: 'Eurogamer', url: 'https://www.eurogamer.net/rss', weight: 1.25, category: 'news', tier: 'press', kind: 'rss' },
  { name: 'GameSpot', url: 'https://www.gamespot.com/feeds/news/', weight: 1.2, category: 'news', tier: 'press', kind: 'rss' },
  { name: 'Polygon', url: 'https://www.polygon.com/feed/', weight: 1.15, category: 'news', tier: 'press', kind: 'rss' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', weight: 1.1, category: 'news', tier: 'press', kind: 'rss' },
  { name: 'Steam — Fallout 76', url: 'https://store.steampowered.com/feeds/news/app/22370/?l=english&cc=US', weight: 1.2, category: 'news', tier: 'official', kind: 'rss' },
  { name: 'Steam — Fallout 4', url: 'https://store.steampowered.com/feeds/news/app/377160/?l=english&cc=US', weight: 1.1, category: 'news', tier: 'official', kind: 'rss' },
  { name: 'Steam — New Vegas', url: 'https://store.steampowered.com/feeds/news/app/22380/?l=english&cc=US', weight: 1.05, category: 'news', tier: 'official', kind: 'rss' },
  { name: 'Xbox Wire', url: 'https://news.xbox.com/en-us/feed/', weight: 1.45, category: 'news', tier: 'official', kind: 'rss' },
  { name: 'Bethesda — YouTube', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCvZHe-SP3xC7DdOk4Ri8QBw', weight: 1.35, category: 'news', tier: 'official', kind: 'rss' },
  { name: 'Amazon Newsroom', url: 'https://www.aboutamazon.com/news/rss', weight: 1.15, category: 'news', tier: 'press', kind: 'rss' },
  { name: 'Nexus — Fallout 4', url: 'https://www.nexusmods.com/fallout4/rss', weight: 1.15, category: 'mods', tier: 'community', kind: 'rss', headers: NEXUS_FEED_HEADERS },
  { name: 'Nexus — New Vegas', url: 'https://www.nexusmods.com/falloutnewvegas/rss', weight: 1.1, category: 'mods', tier: 'community', kind: 'rss', headers: NEXUS_FEED_HEADERS },
  { name: 'Nexus — Fallout 76', url: 'https://www.nexusmods.com/fallout76/rss', weight: 1.1, category: 'mods', tier: 'community', kind: 'rss', headers: NEXUS_FEED_HEADERS },
  { name: 'Nexus — New Today', url: 'https://www.nexusmods.com/rss/newtoday', weight: 0.95, category: 'mods', tier: 'community', kind: 'rss', requiresFalloutMatch: true, headers: NEXUS_FEED_HEADERS },
  { name: 'Kotaku', url: 'https://kotaku.com/rss', weight: 1.05, category: 'news', tier: 'press', kind: 'rss' },
  { name: 'Rock Paper Shotgun', url: 'https://www.rockpapershotgun.com/feed/', weight: 1.0, category: 'news', tier: 'press', kind: 'rss' },
  { name: 'PC Gamer', url: 'https://www.pcgamer.com/feed/', weight: 1.0, category: 'news', tier: 'press', kind: 'rss' },
  { name: 'PCGamesN', url: 'https://www.pcgamesn.com/mainrss.xml', weight: 1.0, category: 'news', tier: 'press', kind: 'rss' },
  { name: 'Shacknews', url: 'https://www.shacknews.com/feed/rss', weight: 0.95, category: 'news', tier: 'press', kind: 'rss' },
  { name: 'DualShockers', url: 'https://www.dualshockers.com/feed/', weight: 0.95, category: 'news', tier: 'press', kind: 'rss' },
  { name: 'PlayStation Blog', url: 'https://blog.playstation.com/feed/', weight: 1.15, category: 'news', tier: 'official', kind: 'rss', excludeTitlePatterns: [
    /^share of the week/i,
    /^players'? choice/i,
    /playstation store:.*top downloads/i
  ] },
  { name: 'Google News — Bloomberg', url: 'https://news.google.com/rss/search?q=when:14d+Fallout+(Bethesda+OR+Xbox+OR+Obsidian+OR+Microsoft)&hl=en-US&gl=US&ceid=US:en', weight: 1.35, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true },
  { name: 'Google News — Business', url: 'https://news.google.com/rss/search?q=when:7d+(Fallout+OR+Bethesda)+(layoffs+OR+studio+OR+acquisition+OR+restructure)&hl=en-US&gl=US&ceid=US:en', weight: 1.25, category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true }
];

const REDDIT_SOURCES = [
  { name: 'r/fallout', subreddit: 'fallout', weight: 1.25, category: 'community', tier: 'community', kind: 'reddit', minScore: 150, minComments: 35 },
  { name: 'r/fo76', subreddit: 'fo76', weight: 1.2, category: 'community', tier: 'community', kind: 'reddit', minScore: 75, minComments: 20 },
  { name: 'r/falloutlore', subreddit: 'falloutlore', weight: 1.1, category: 'community', tier: 'community', kind: 'reddit', minScore: 100, minComments: 25 },
  { name: 'r/FalloutMods', subreddit: 'FalloutMods', weight: 1.45, category: 'mods', tier: 'community', kind: 'reddit', minScore: 80, minComments: 18 },
  { name: 'r/fo4', subreddit: 'fo4', weight: 1.3, category: 'mods', tier: 'community', kind: 'reddit', minScore: 60, minComments: 15 },
  { name: 'r/FalloutTV', subreddit: 'FalloutTV', weight: 1.2, category: 'community', tier: 'community', kind: 'reddit', minScore: 120, minComments: 30 },
  { name: 'r/fnv', subreddit: 'fnv', weight: 1.1, category: 'community', tier: 'community', kind: 'reddit', minScore: 80, minComments: 18 }
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

export function getTopicTokens(title = '') {
  return new Set(
    normalizeStoryText(title)
      .split(' ')
      .filter((token) => token.length > 2)
  );
}

export function areTopicsSimilar(titleA = '', titleB = '') {
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

export function isDuplicateArticleTitle(title = '', historyEntries = [], { withinDays = TITLE_HISTORY_DAYS } = {}) {
  const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;

  return historyEntries.some((entry) => {
    if (entry.coveredAt < cutoff) return false;
    if (entry.articleTitle && areTopicsSimilar(entry.articleTitle, title)) return true;
    if (entry.title && areTopicsSimilar(entry.title, title)) return true;
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

export function isNicheCommunityPost(item = {}) {
  const haystack = `${item.title} ${item.description}`.toLowerCase();
  return NICHE_COMMUNITY_PATTERNS.some((pattern) => haystack.includes(pattern));
}

function hasRedditEngagementMetrics(item = {}) {
  return item.redditScore != null || item.redditComments != null;
}

export function meetsEngagementThreshold(item = {}) {
  if (item.sourceKind !== 'reddit') return true;
  if (!hasRedditEngagementMetrics(item)) return true;

  const minScore = item.minScore ?? 50;
  const minComments = item.minComments ?? 10;
  return (item.redditScore ?? 0) >= minScore && (item.redditComments ?? 0) >= minComments;
}

export function meetsHighEngagementThreshold(item = {}) {
  if (item.sourceKind !== 'reddit') return true;
  if (!hasRedditEngagementMetrics(item)) return true;

  const minScore = Math.round((item.minScore ?? 50) * 2.5);
  const minComments = Math.round((item.minComments ?? 10) * 2);
  return (item.redditScore ?? 0) >= minScore && (item.redditComments ?? 0) >= minComments;
}

export function passesCommunityQualityGate(item = {}) {
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

export function compareCandidatePriority(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const engagementA = (a.redditScore ?? 0) + (a.redditComments ?? 0) * 2;
  const engagementB = (b.redditScore ?? 0) + (b.redditComments ?? 0) * 2;
  return engagementB - engagementA;
}

export function pickFeaturedStory(candidates = [], historyEntries = []) {
  const eligible = selectStoriesForGeneration(candidates, historyEntries, { storyLimit: 20 });
  if (eligible.length === 0) return [];

  const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const recentTypes = historyEntries
    .filter((entry) => entry.coveredAt >= weekAgo)
    .map((entry) => entry.contentType)
    .filter(Boolean);

  const typeCounts = { news: 0, mods: 0, community: 0 };
  for (const contentType of recentTypes) {
    typeCounts[contentType] = (typeCounts[contentType] || 0) + 1;
  }

  const preferredOrder = [...CONTENT_TYPES].sort((a, b) => typeCounts[a] - typeCounts[b]);
  let mainStory = null;

  for (const contentType of preferredOrder) {
    const matches = eligible
      .filter((item) => item.contentType === contentType)
      .sort(compareCandidatePriority);

    if (matches.length === 0) continue;

    mainStory = matches[0];
    break;
  }

  mainStory = mainStory || eligible.sort(compareCandidatePriority)[0];
  const mainTopic = getStoryTopicKey(mainStory);
  const supporting = eligible
    .filter((item) => getStoryTopicKey(item) !== mainTopic)
    .sort(compareCandidatePriority)
    .slice(0, 4);

  return [mainStory, ...supporting];
}

export function selectStoriesForGeneration(candidates = [], historyEntries = [], { storyLimit = 5 } = {}) {
  const eligible = candidates
    .filter((item) => {
      if (isTopicCovered(item, historyEntries)) return false;
      if (!meetsMinimumSourceQuality(item)) return false;

      if (item.publishedAt && item.publishedAt < Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000) {
        return false;
      }

      if (item.sourceKind === 'reddit' && !passesCommunityQualityGate(item)) {
        return false;
      }

      return true;
    })
    .sort((a, b) => b.score - a.score);

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
    const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const sourceMatch = block.match(/<source\b[^>]*>([\s\S]*?)<\/source>/i);

    const title = cleanText(titleMatch?.[1] || titleMatch?.[2] || '');
    const link = cleanText(linkMatch?.[1] || linkMatch?.[2] || '');
    const description = cleanText(descriptionMatch?.[1] || descriptionMatch?.[2] || '');
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
  'new vegas', 'fo76', 'fo4', 'fnv', 'prime video', 'fallout tv', 'fallout series', 'bethesda',
  'vault dweller', 'vault-tec', 'appalachia', 'wasteland', 'atomic shop',
  'expedition', 'season', 'brotherhood', 'ncr', 'institute', 'pip-boy',
  'nexus mod', 'mod release', 'lucy', 'the ghoul', 'vault boy', 'power armor',
  'cosplay', 'fan art', 'mod showcase', 'camp build', 'xbox', 'playstation', 'steam'
];

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
  'Video Games Chronicle'
];

function scoreItem(item, source) {
  const haystack = `${item.title} ${item.description}`.toLowerCase();
  const keywordHits = FALLOUT_KEYWORDS.filter((keyword) => haystack.includes(keyword));
  const contentType = detectContentType(item, source);

  let score = source.weight + keywordHits.length * 1.4;

  score += freshnessBonus(item.publishedAt);
  score += Math.min((item.description || '').length / 180, 1.8);
  score += engagementBonus(item);

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
    sources: ensurePrimarySource(article.sources, mainStory),
    seoDescription: ensureSeoDescription({ ...article, trustLevel, contentType: article.contentType || mainStory.contentType || 'news' })
  };
}

function getContentTypeGuidance(contentType, trustLevel = 'confirmed') {
  const trustGuidance = trustLevel === 'press-report'
    ? `TRUST LEVEL: PRESS REPORT (unconfirmed by developer/publisher)
- This story is based on journalism, NOT an official announcement
- The intro MUST state that this is reported by [outlet] and not confirmed by the developer/publisher
- Attribute claims throughout with "according to [outlet]" or "the report states" — never present claims as settled fact
- Use hedging language: "reportedly", "is said to", "the report claims" where appropriate
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
      const summary = item.description ? item.description.slice(0, 900) : 'No summary available.';
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
- sources: array of {title, url, type} where type is "official", "press", or "community"

Return valid JSON only with these fields: title, seoDescription, subtitle, intro, keyFacts, sections, conclusion, takeaway, cta, contentType, trustLevel, sources`;
}

function buildNewsPrompt(newsItems, context) {
  const mainStory = newsItems[0];
  const trustLevel = mainStory.trustLevel || detectTrustLevel(mainStory, { tier: mainStory.sourceTier, category: 'news' });
  const reportingOutlet = resolveReportingOutlet(mainStory);

  return `You are the lead editor of ${BRAND_NAME}, writing a Fallout NEWS brief fans will trust and share.

${getContentTypeGuidance('news', trustLevel)}

NEWS WRITING RULES:
- Lead with the most newsworthy confirmed or reported fact first
- Name the game, platform, studio, or show when known from sources
- Separate official facts from press reports and fan reaction
- Use an informative newsroom tone — not hype, not rumor-chasing
- Help readers understand timing, scope, and why the franchise conversation shifted

${buildPromptTrustSection(trustLevel, reportingOutlet)}

SHORTLISTED STORIES:
${context}

MAIN STORY TO LEAD WITH: ${mainStory.title}

${buildSharedArticleRequirements('news', trustLevel, reportingOutlet)}`;
}

function buildModsPrompt(newsItems, context) {
  const mainStory = newsItems[0];
  const trustLevel = mainStory.trustLevel || detectTrustLevel(mainStory, { tier: mainStory.sourceTier, category: 'mods' });
  const reportingOutlet = resolveReportingOutlet(mainStory);

  return `You are the lead editor of ${BRAND_NAME}, writing a MOD SPOTLIGHT for Fallout players deciding what to install next.

${getContentTypeGuidance('mods', trustLevel)}

MOD SPOTLIGHT RULES:
- Open with what the mod changes in practical gameplay or visuals
- Credit the creator/mod page and make clear this is community-made, not official Bethesda content
- Mention game, platform, requirements, or compatibility only if present in sources
- Explain who should care: returning players, screenshot fans, survivalists, lore hunters, etc.
- Avoid breaking-news tone — this is a useful recommendation, not an announcement

${buildPromptTrustSection(trustLevel, reportingOutlet)}

SHORTLISTED STORIES:
${context}

MAIN MOD TO SPOTLIGHT: ${mainStory.title}

${buildSharedArticleRequirements('mods', trustLevel, reportingOutlet)}`;
}

function buildCommunityPrompt(newsItems, context) {
  const mainStory = newsItems[0];
  const trustLevel = mainStory.trustLevel || detectTrustLevel(mainStory, { tier: mainStory.sourceTier, category: 'community' });
  const reportingOutlet = resolveReportingOutlet(mainStory);

  return `You are the lead editor of ${BRAND_NAME}, spotlighting something the Fallout community created and would enjoy sharing.

${getContentTypeGuidance('community', trustLevel)}

COMMUNITY HIGHLIGHT RULES:
- Celebrate the creator, build, artwork, cosplay, lore thread, or project clearly
- Make the opening feel human and shareable, not like a press release
- Explain why this stands out in the fandom and who will appreciate it
- Credit the source thread or creator path from the summaries
- Never frame fan work as official news or a Bethesda announcement

${buildPromptTrustSection(trustLevel, reportingOutlet)}

SHORTLISTED STORIES:
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
    title: `${mainStory.title}: what it means for the Wasteland right now`,
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
    title: article?.title || 'Why the latest Fallout news matters right now',
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
    sources: Array.isArray(article?.sources) && article.sources.length > 0
      ? article.sources
      : newsItems.slice(0, 4).map((item) => ({ title: item.title, url: item.link || 'https://fallout.fandom.com/wiki/Fallout_Wiki', type: item.sourceTier || 'press' }))
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
  const contentLabel = getContentTypeLabel(article.contentType || 'news', trustLevel);
  const trustNote = getTrustNote(trustLevel);

  const seoDescription = ensureSeoDescription(article);
  const seoCharCount = countChars(seoDescription);
  const seoHtml = `<!-- SEARCH_DESCRIPTION (${seoCharCount} chars): ${seoDescription} --><p><strong>Search description — copy into Blogger (${SEO_DESCRIPTION_TARGET_CHARS} characters):</strong></p><p>${escapeHtml(seoDescription)}</p><hr>`;

  const badgeHtml = `<p><em>${escapeHtml(BRAND_NAME)} · ${escapeHtml(contentLabel)}</em></p>`;
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
    ? `<hr><h3>Sources</h3><ul>${article.sources.map((source) => {
      const typeLabel = source.type ? ` (${source.type})` : '';
      return `<li><a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a>${escapeHtml(typeLabel)}</li>`;
    }).join('')}</ul>`
    : '';
  const editorialHtml = `<hr><p><strong>${escapeHtml(BRAND_NAME)} editorial standard:</strong> ${escapeHtml(trustNote)} We do not publish unconfirmed rumors as fact.</p>`;

  return `<article>${seoHtml}${badgeHtml}${disclaimerHtml}${subtitleHtml}${introHtml}${keyFactsHtml}${sectionsHtml}${takeawayHtml}${conclusionHtml}${ctaHtml}${sourcesHtml}${editorialHtml}</article>`;
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

export function extractArticleBodyText(html = '') {
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const contentMatch = html.match(/<div[^>]+class=["'][^"']*(?:entry-content|article-body|post-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  const block = articleMatch?.[1] || contentMatch?.[1] || html;
  const paragraphs = [...block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => cleanText(match[1]))
    .filter((paragraph) => paragraph.length > 80);

  return paragraphs.slice(0, 3).join(' ').slice(0, 2000);
}

async function enrichStoryDetail(item) {
  if (!item.link) return item;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
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
    const currentLength = (item.description || '').length;

    if (combined.length > currentLength) {
      return { ...item, description: combined.slice(0, 2000), enriched: true };
    }
  } catch {
    // Ignore enrichment failures and keep RSS summary.
  }

  return item;
}

export async function enrichStories(stories) {
  const topStories = stories.slice(0, 3);
  const enrichedTop = await Promise.all(topStories.map((story) => enrichStoryDetail(story)));
  return [...enrichedTop, ...stories.slice(3)];
}

async function loadStoryHistory() {
  try {
    const raw = await fs.readFile(HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const cutoff = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    return (Array.isArray(parsed?.entries) ? parsed.entries : []).filter((entry) => entry.coveredAt >= cutoff);
  } catch {
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

async function saveFeedHealth(sources = {}) {
  await fs.mkdir(path.dirname(FEED_HEALTH_FILE), { recursive: true });
  await fs.writeFile(FEED_HEALTH_FILE, JSON.stringify({
    updatedAt: new Date().toISOString(),
    sources
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

export function getRedditFetchStrategies({
  preferRss = process.env.REDDIT_PREFER_RSS === 'true' || process.env.CI === 'true',
  rssOnly = process.env.REDDIT_RSS_ONLY === 'true' || process.env.CI === 'true'
} = {}) {
  if (rssOnly) return ['rss'];
  return preferRss ? ['rss', 'json'] : ['json', 'rss'];
}

export function getActiveRedditSources() {
  const override = (process.env.REDDIT_SUBREDDITS || '').trim();
  if (!override) return REDDIT_SOURCES;

  const allowed = new Set(
    override.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean)
  );

  return REDDIT_SOURCES.filter((source) => allowed.has(source.subreddit.toLowerCase()));
}

function buildRedditRequestHeaders() {
  return buildFeedRequestHeaders();
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

  const merged = [...existingEntries, ...newEntries];
  const cutoff = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const byFingerprint = new Map();

  for (const entry of merged.filter((item) => item.coveredAt >= cutoff)) {
    byFingerprint.set(entry.fingerprint, entry);
  }

  await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
  await fs.writeFile(HISTORY_FILE, JSON.stringify({ entries: [...byFingerprint.values()] }, null, 2));
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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY');
  }

  const primaryModels = parseModelList(process.env.GEMINI_MODEL || 'gemini-2.0-flash');
  const fallbackModels = parseModelList(process.env.GEMINI_MODEL_FALLBACK || 'gemini-2.0-flash-lite');
  const tertiaryModels = parseModelList(process.env.GEMINI_MODEL_FALLBACK_2 || 'gemini-flash-latest');
  const models = [...primaryModels, ...fallbackModels, ...tertiaryModels].filter((model, index, all) => model && all.indexOf(model) === index);
  const errors = [];

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
        errors.push(`${model}: ${message}`);
        continue;
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) {
        throw new Error('Gemini returned empty content');
      }

      const jsonText = extractJsonText(text);
      return JSON.parse(jsonText);
    } catch (error) {
      errors.push(`${model}: ${error.message}`);
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

function isRelevantFalloutItem(item, source) {
  const title = normalizeSyndicatedTitle(item.title || '', item.feedSource || '');
  if (isFeedTitleExcluded(title, source)) return false;

  const haystack = `${title} ${item.description} ${item.link || ''}`.toLowerCase();
  const hasRelevantKeyword = FALLOUT_KEYWORDS.some((term) => haystack.includes(term)) || haystack.includes('fallout');
  const hasNoise = NOISE_TERMS.some((term) => haystack.includes(term));

  if (source.requiresFalloutMatch) {
    return hasRelevantKeyword && !hasNoise;
  }

  if (source.kind === 'reddit' || source.category === 'community' || source.category === 'mods') {
    return !hasNoise;
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
      const description = cleanText(post.selftext || post.title || '').slice(0, 1200);

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
    .map((item) => {
      const title = cleanText(item.title || '');
      const link = item.link || '';
      const description = cleanText(item.description || item.title || '').slice(0, 1200);
      const isModeratorPost = REDDIT_MOD_POST_PATTERNS.some((pattern) => pattern.test(title));

      return {
        title,
        link,
        description,
        publishedAt: item.publishedAt,
        redditScore: null,
        redditComments: null,
        isStickied: isModeratorPost,
        over18: false,
        sourceKind: 'reddit',
        minScore: source.minScore,
        minComments: source.minComments
      };
    })
    .filter((item) => item.title);
}

async function fetchRedditJsonItems(source) {
  const url = `https://www.reddit.com/r/${source.subreddit}/hot.json?limit=25`;
  const request = () => fetch(url, {
    headers: {
      'User-Agent': REDDIT_USER_AGENT,
      Accept: 'application/json'
    }
  });

  let response = await request();
  if (response.status === 429) {
    const retryAfterSec = Number.parseInt(response.headers.get('retry-after') || '3', 10);
    await sleep(Math.min(retryAfterSec, 10) * 1000);
    response = await request();
  }

  if (!response.ok) {
    throw new Error(`Reddit request failed (${response.status})`);
  }

  const payload = await response.json();
  return parseRedditListing(payload, source);
}

async function fetchRedditRssItems(source) {
  const subreddit = source.subreddit;
  const xml = await fetchFeed(`https://old.reddit.com/r/${subreddit}/hot/.rss`, {
    headers: buildRedditRequestHeaders(),
    fallbackUrls: [
      `https://www.reddit.com/r/${subreddit}/hot/.rss`,
      `https://old.reddit.com/r/${subreddit}/.rss`
    ]
  });
  return parseRedditRssFeed(xml, source);
}

async function fetchRedditSourceItems(source) {
  const strategies = getRedditFetchStrategies();
  const errors = [];

  for (const strategy of strategies) {
    try {
      const items = strategy === 'rss'
        ? await fetchRedditRssItems(source)
        : await fetchRedditJsonItems(source);

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

  const rssResults = await Promise.allSettled(
    rssJobs.map(({ source }) => fetchRssSourceItems(source))
  );

  for (const [index, result] of rssResults.entries()) {
    recordSourceResult(rssJobs[index].source.name, result);
  }

  for (const [index, { source }] of redditJobs.entries()) {
    if (index > 0 && REDDIT_FETCH_DELAY_MS > 0) {
      await sleep(REDDIT_FETCH_DELAY_MS);
    }

    try {
      const value = await fetchRedditSourceItems(source);
      recordSourceResult(source.name, { status: 'fulfilled', value });
    } catch (error) {
      recordSourceResult(source.name, { status: 'rejected', reason: error });
    }
  }

  await saveFeedHealth(feedHealth);

  if (feedErrors.length > 0) {
    console.warn(`Feed warnings (${feedErrors.length}):`);
    for (const line of formatFeedWarnings(feedErrors)) {
      console.warn(line);
    }
  }

  const unhealthy = getUnhealthyFeedSources(feedHealth);
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

function getBloggerLabels(article = {}) {
  const labels = [BRAND_NAME];
  const contentType = article.contentType || 'news';

  if (contentType === 'mods') labels.push('Mod Spotlight');
  else if (contentType === 'community') labels.push('Community Highlight');
  else labels.push('News');

  if (article.trustLevel === 'press-report') labels.push('Press Report');
  if (article.trustLevel === 'official') labels.push('Official');

  return [...new Set(labels)];
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

  const enrichedItems = await enrichStories(featuredItems);
  const substantiveItems = enrichedItems.filter((item) => meetsMinimumSourceQuality(item));

  if (substantiveItems.length === 0) {
    console.log('Only thin-source stories available today; skipping generation.');
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
    console.warn(`Blogger draft skipped: ${publishSkippedReason}`);
  } else if (isTopicCovered(substantiveItems[0], localHistory)) {
    publishSkippedReason = 'already-covered';
    console.warn(`Blogger draft skipped: featured story "${substantiveItems[0].title}" was already covered.`);
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
