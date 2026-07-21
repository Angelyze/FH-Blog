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
/** Public-facing editor voice — real fan-site host, not a corporate newsroom bot */
const AUTHOR_NAME = 'Angelyze';
const AUTHOR_SITE_URL = 'https://www.fallouthub.blog';
const AUTHOR_COMMUNITY = {
  discord: 'https://discord.gg/BHX5BTgQmv',
  app: 'FH Companion',
  socials: 'Facebook, X, Instagram, Steam, Twitch, and YouTube under Fallout Hub / Vault-Tec Inc. / Fallout Pages'
};

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
  { name: 'Xbox Wire', url: 'https://news.xbox.com/en-us/feed/', weight: 1.5, category: 'news', tier: 'official', kind: 'rss', requiresFalloutMatch: true },
  { name: 'Bethesda — YouTube', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCvZHe-SP3xC7DdOk4Ri8QBw', weight: 1.5, category: 'news', tier: 'official', kind: 'rss', requiresFalloutMatch: true },
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
  'avowed', 'elder', 'scrolls', 'starfield', 'xbox', 'microsoft', 'studio',
  'remaster', 'remasters', 'preproduction', 'raven'
]);

const TOPIC_ANCHOR_TOKENS = new Set(['fallout', ...SPECIFIC_TOPIC_ANCHORS]);

// Same studio mega-package (e.g. FO5 + remasters + Raven Rock + Obsidian collab) — one core story
const MEGA_EVENT_SIGNALS = [
  'fallout 5', 'fallout5',
  'remaster', 'remasters',
  'pre-production', 'preproduction', 'pre production',
  'raven rock',
  'creation engine 3', 'creation engine',
  'new vegas remaster', 'fallout 3 remaster'
];

// Distinct follow-up questions fans still need after the core package is covered
const FOLLOW_UP_BEAT_RULES = [
  {
    key: 'platform-exclusivity',
    pattern: /\b(exclusive|exclusivity|exclusives|console exclusive|xbox exclusive|multiplatform|multi-platform|platform exclusive|game pass|xbox game pass|still isn'?t revealing|won'?t (?:say|comment|reveal)|not commenting|too early to comment|silent on)\b/i
  },
  {
    key: 'pricing',
    pattern: /\b(price|pricing|pre-?order|preorder|msrp|\$\d+)\b/i
  },
  {
    key: 'trailer-gameplay',
    pattern: /\b(gameplay trailer|reveal trailer|official trailer|first gameplay|gameplay reveal)\b/i
  },
  {
    key: 'hard-schedule',
    pattern: /\b(delay(?:ed)?|launch window|ships in|coming 20\d\d|release window|dated for|set to launch)\b/i
  }
];

// Thin theory/buzz — useful as context, not as a standalone lead once the package is covered
const WEAK_PACKAGE_BUZZ_PATTERNS = [
  /\bfans think\b/i,
  /\bfan theor(?:y|ies)\b/i,
  /\btheor(?:y|ies|ize|izing)\b/i,
  /\bspeculat(?:e|es|ion|ing)\b/i,
  /\bfigured out\b/i,
  /\bsparks?\b/i,
  /\bbuzz\b/i,
  /\bcould mean\b/i,
  /\bmight mean\b/i,
  /\bthink they(?:'ve| have)\b/i,
  /\brelease (?:date )?theory\b/i,
  /\bdate theory\b/i,
  /\bseems to (?:hint|suggest)\b/i,
  /\bpossibly (?:hinting|suggesting)\b/i
];

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

export function getMegaEventSignals(item = {}) {
  const haystack = `${item.title || ''} ${item.description || ''} ${item.articleTitle || ''}`.toLowerCase();
  return MEGA_EVENT_SIGNALS.filter((signal) => haystack.includes(signal));
}

function historyEntryAsItem(entry = {}) {
  return {
    title: entry.title || '',
    description: entry.articleTitle || entry.description || '',
    articleTitle: entry.articleTitle || ''
  };
}

/** True when two items are angles on the same studio mega-announcement package. */
export function shareMegaEventPackage(itemA = {}, itemB = {}) {
  const signalsA = new Set(getMegaEventSignals(itemA));
  const signalsB = new Set(getMegaEventSignals(itemB));
  if (signalsA.size === 0 || signalsB.size === 0) return false;

  const shared = [...signalsA].filter((signal) => signalsB.has(signal));
  // Two shared package signals (e.g. fallout 5 + remaster) = same core package
  if (shared.length >= 2) return true;
  // Extremely specific one-off beats (unique enough to own the package alone)
  if (shared.includes('raven rock')) return true;
  return false;
}

export function isPackageRelated(item = {}) {
  return getMegaEventSignals(item).length > 0
    || /\b(fallout 5|fallout5|remaster|roadmap|raven rock)\b/i.test(
      `${item.title || ''} ${item.description || ''} ${item.articleTitle || ''}`
    );
}

/** Fan theories / pure buzz about the FO5-remaster package — context, not a full lead. */
export function isWeakPackageBuzz(item = {}) {
  if (!isPackageRelated(item)) return false;
  const haystack = `${item.title || ''} ${item.description || ''} ${item.articleTitle || ''}`;
  return WEAK_PACKAGE_BUZZ_PATTERNS.some((pattern) => pattern.test(haystack));
}

/** Distinct fan-value beats (exclusivity, pricing, trailer…) beyond the core package. */
export function getFollowUpBeatKeys(item = {}) {
  const haystack = `${item.title || ''} ${item.description || ''} ${item.articleTitle || ''}`;
  const beats = [];

  for (const rule of FOLLOW_UP_BEAT_RULES) {
    if (!rule.pattern.test(haystack)) continue;
    // Fan "release date theory" is buzz, not a hard schedule beat
    if (rule.key === 'hard-schedule' && isWeakPackageBuzz(item)) continue;
    beats.push(rule.key);
  }

  return beats;
}

export function hasDistinctFollowUpBeat(item = {}) {
  return getFollowUpBeatKeys(item).length > 0;
}

export function shareFollowUpBeats(itemA = {}, itemB = {}) {
  const beatsA = new Set(getFollowUpBeatKeys(itemA));
  if (beatsA.size === 0) return false;
  return getFollowUpBeatKeys(itemB).some((beat) => beatsA.has(beat));
}

export function historyCoversMegaPackage(item = {}, historyEntries = []) {
  if (!isPackageRelated(item)) return false;

  return historyEntries.some((entry) => {
    const historyItem = historyEntryAsItem(entry);
    if (shareMegaEventPackage(item, historyItem)) return true;
    if (entry.articleTitle && shareMegaEventPackage(item, {
      title: entry.articleTitle,
      description: entry.title || ''
    })) {
      return true;
    }
    return false;
  });
}

export function historyCoversFollowUpBeat(item = {}, historyEntries = []) {
  if (!hasDistinctFollowUpBeat(item)) return false;
  return historyEntries.some((entry) => shareFollowUpBeats(item, historyEntryAsItem(entry)));
}

/**
 * Whether this item should not lead a new article.
 * Core package rehashes and weak theories stay blocked after the mega-news post;
 * distinct follow-ups (e.g. Xbox exclusivity) remain eligible for fans.
 */
export function isTopicCovered(item = {}, historyEntries = []) {
  const fingerprint = getStoryKey(item);
  const topicFingerprint = getStoryTopicKey(item);

  for (const entry of historyEntries) {
    if (entry.fingerprint === fingerprint || entry.topicFingerprint === topicFingerprint) {
      return true;
    }

    const historyItem = historyEntryAsItem(entry);
    const titleSimilar = (
      (entry.title && item.title && areTopicsSimilar(entry.title, item.title))
      || (entry.articleTitle && item.title && areTopicsSimilar(entry.articleTitle, item.title))
    );

    if (titleSimilar) {
      // Similar wording but a different fan-value beat (e.g. exclusivity vs confirmation)
      if (hasDistinctFollowUpBeat(item) && !shareFollowUpBeats(item, historyItem)) {
        continue;
      }
      return true;
    }
  }

  // Weak theory/buzz about an already-covered package → never lead alone
  if (isWeakPackageBuzz(item) && historyCoversMegaPackage(item, historyEntries)) {
    return true;
  }

  // Distinct follow-up already written → block; new beat → allow
  if (hasDistinctFollowUpBeat(item)) {
    return historyCoversFollowUpBeat(item, historyEntries);
  }

  // Pure package rehash (no new beat) after the core story ran
  if (historyCoversMegaPackage(item, historyEntries)) {
    return true;
  }

  return false;
}

/** Related weak buzz / soft package chatter that can enrich a stronger lead. */
export function isBuzzEnrichmentCandidate(item = {}, mainStory = {}, historyEntries = []) {
  if (!item?.title || !mainStory?.title) return false;
  if (item.link && mainStory.link && item.link === mainStory.link) return false;
  if (item.contentType && mainStory.contentType && item.contentType !== mainStory.contentType) {
    return false;
  }

  // Franchise follow-ups (exclusivity about "new Fallout games") can still absorb FO5/remaster buzz
  const related = shareMegaEventPackage(item, mainStory)
    || areTopicsSimilar(item.title, mainStory.title)
    || (isPackageRelated(item) && isPackageRelated(mainStory))
    || (isWeakPackageBuzz(item) && isPackageRelated(item) && (
      hasDistinctFollowUpBeat(mainStory) || isPackageRelated(mainStory)
    ));

  if (!related) return false;

  // Prefer true weak buzz, or covered package angles that still add fan context
  if (isWeakPackageBuzz(item)) return true;
  if (isTopicCovered(item, historyEntries) && !hasDistinctFollowUpBeat(item)) return true;

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
  const titleAsItem = { title, description: title, articleTitle: title };

  return historyEntries.some((entry) => {
    if (entry.coveredAt < cutoff) return false;

    // Distinct follow-up beat in the new title → not a title duplicate of the core package
    if (hasDistinctFollowUpBeat(titleAsItem) && !shareFollowUpBeats(titleAsItem, historyEntryAsItem(entry))) {
      return false;
    }

    if (entry.articleTitle && areTopicsSimilar(entry.articleTitle, title, { allowAnchorMatch: false })) return true;
    if (entry.title && areTopicsSimilar(entry.title, title, { allowAnchorMatch: false })) return true;

    // Block regenerated package rehash titles that share mega signals without a new beat
    if (!hasDistinctFollowUpBeat(titleAsItem)
      && shareMegaEventPackage(titleAsItem, historyEntryAsItem(entry))) {
      return true;
    }

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
// Reddit custom RSS feeds return ~25 entries; one daily fetch keeps rate-limit risk low.
const REDDIT_CUSTOM_FEED_ITEM_LIMIT = Number.parseInt(process.env.REDDIT_CUSTOM_FEED_ITEM_LIMIT || '25', 10);
const REDDIT_CUSTOM_FEED_MAX_RANK = Number.parseInt(process.env.REDDIT_CUSTOM_FEED_MAX_RANK || '30', 10);
// Room for full Reddit feed plus press/official candidates without crowding the editorial pool.
const COLLECTED_ITEM_POOL_LIMIT = Number.parseInt(process.env.COLLECTED_ITEM_POOL_LIMIT || '45', 10);

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
  if (rank > REDDIT_CUSTOM_FEED_MAX_RANK) return false;

  if (hasRedditEngagementMetrics(item)) {
    return meetsEngagementThreshold(item);
  }

  return true;
}

export function passesCommunityQualityGate(item = {}, { useCustomFeedRules } = {}) {
  const customFeedRules = useCustomFeedRules ?? hasRedditCustomFeed();
  if (customFeedRules) return passesCustomRedditFeedQualityGate(item);
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
  let score = getAdjustedCandidateScore(item, historyEntries)
    + getContentTypeRotationBonus(item.contentType, typeCounts);

  // Fan-first ranking: official studio confirmations beat soft community filler
  if (item.sourceTier === 'official') score += 2.5;
  if (hasOfficialConfirmationSignals(item) && !isWeakPackageBuzz(item)) score += 3.5;

  // Distinct follow-ups (exclusivity, pricing, etc.) stay valuable after the core package
  if (hasDistinctFollowUpBeat(item) && !historyCoversFollowUpBeat(item, historyEntries)) {
    score += 2.8;
  }

  // Weak theories should not outrank real news when the package is already covered
  if (isWeakPackageBuzz(item) && historyCoversMegaPackage(item, historyEntries)) {
    score -= 4;
  }

  return score;
}

export function getGenerationBatchLimit(contentType = 'news') {
  return GENERATION_BATCH_LIMITS[contentType] || 1;
}

/** Distinctive project / franchise hooks used for relatedness + research queries. */
const RESEARCH_PROJECT_PATTERNS = [
  /\bbakersfield\b/i,
  /\braven rock\b/i,
  /\bfallout 5\b|\bfallout5\b/i,
  /\bnew vegas\b|\bfnv\b/i,
  /\bfallout 76\b|\bfo76\b/i,
  /\bfallout 4\b|\bfo4\b/i,
  /\bfallout 3\b|\bfo3\b/i,
  /\bfallout shelter\b/i,
  /\bcreation club\b/i,
  /\bobsidian\b/i,
  /\bbethesda\b/i
];

/**
 * Pull entities from a lead for relatedness checks and deep research queries.
 */
export function extractLeadEntities(item = {}) {
  const title = String(item.title || '');
  const description = String(item.description || '');
  const haystack = `${title} ${description}`;
  let redditAuthor = null;

  const authorMatch = haystack.match(/\bu\/([A-Za-z0-9_-]{2,32})\b/i);
  if (authorMatch) redditAuthor = authorMatch[1];

  if (!redditAuthor && item.link) {
    try {
      const url = new URL(item.link);
      const pathAuthor = url.pathname.match(/\/(?:user|u)\/([^/?#]+)/i);
      if (pathAuthor) redditAuthor = decodeURIComponent(pathAuthor[1]);
    } catch {
      // ignore bad links
    }
  }

  if (!redditAuthor && /reddit/i.test(item.source || '')) {
    const fromSource = String(item.source).match(/\bu\/([A-Za-z0-9_-]+)/i);
    if (fromSource) redditAuthor = fromSource[1];
  }

  const projectKeys = RESEARCH_PROJECT_PATTERNS
    .filter((pattern) => pattern.test(haystack))
    .map((pattern) => pattern.source.replace(/\\b/g, '').replace(/\|/g, ' ').slice(0, 40));

  const properNames = [...haystack.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g)]
    .map((match) => match[1])
    .filter((name) => !/^(Fallout|The|This|That|With|From|About)$/i.test(name))
    .slice(0, 8);

  return {
    redditAuthor: redditAuthor || null,
    projectKeys,
    properNames,
    contentType: item.contentType || 'news'
  };
}

/** Single artist / single project leads deserve a feature, not a mixed roundup. */
export function isSingleSubjectFeatureLead(item = {}) {
  const entities = extractLeadEntities(item);
  if (entities.redditAuthor) return true;
  if (/\b(fan art|fanart|artwork|drawing|illustration|cosplay|\[oc\]|\boc\b)\b/i.test(item.title || '')) {
    return true;
  }
  if (item.contentType === 'news' && entities.projectKeys.length >= 1) {
    // One clear franchise project hook and thin multi-outlet package → feature candidate
    return true;
  }
  return false;
}

/**
 * True only when item is the same story (or same creator/project) as the lead.
 * Prevents padding articles with unrelated same-type headlines.
 */
export function isStrictlyRelatedToLead(item = {}, mainStory = {}) {
  if (!item?.title || !mainStory?.title) return false;
  if (item.link && mainStory.link && item.link === mainStory.link) return true;
  if (item.title === mainStory.title && item.source === mainStory.source) return true;

  if (shareMegaEventPackage(item, mainStory)) return true;
  if (shareFollowUpBeats(item, mainStory)) return true;
  if (areTopicsSimilar(item.title, mainStory.title, { allowAnchorMatch: true })) return true;

  const mainEntities = extractLeadEntities(mainStory);
  const itemEntities = extractLeadEntities(item);

  if (mainEntities.redditAuthor && itemEntities.redditAuthor
    && mainEntities.redditAuthor.toLowerCase() === itemEntities.redditAuthor.toLowerCase()) {
    return true;
  }

  if (mainEntities.projectKeys.length > 0 && itemEntities.projectKeys.length > 0) {
    const sharedProject = mainEntities.projectKeys.some((key) => itemEntities.projectKeys.includes(key));
    // Same distinctive project + overlapping title tokens is enough
    if (sharedProject && areTopicsSimilar(item.title, mainStory.title, { allowAnchorMatch: false })) {
      return true;
    }
    // Bakersfield + Bakersfield coverage from another outlet
    if (sharedProject && mainEntities.projectKeys.some((key) => /bakersfield|raven rock|fallout 5|fallout5/i.test(key))) {
      const keyNeedle = mainEntities.projectKeys.find((key) => /bakersfield|raven|fallout 5|fallout5/i.test(key));
      if (keyNeedle && new RegExp(keyNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(`${item.title} ${item.description}`)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Intentional community multi-highlight day (several high-value posts), not a single-artist feature.
 */
export function shouldAllowCommunityMultiHighlight(mainStory = {}, candidates = []) {
  if ((mainStory.contentType || 'news') !== 'community') return false;
  if (isSingleSubjectFeatureLead(mainStory)) return false;

  const highValue = candidates.filter((item) => (
    item.contentType === 'community'
    && hasHighValueCommunitySignals(item)
    && item.title !== mainStory.title
  ));

  return highValue.length >= 2;
}

export function getBatchUsableTextLength(items = []) {
  return items.reduce((sum, item) => sum + String(item.description || '').length, 0);
}

/**
 * Thin feed batch → deep research a single topic instead of mixing unrelated stories.
 */
export function needsDeepResearch(batch = [], { minTextChars = 900 } = {}) {
  if (!Array.isArray(batch) || batch.length === 0) return false;

  const feedItems = batch.filter((item) => item.enrichmentRole !== 'research');
  const lead = feedItems[0];
  if (!lead) return false;

  const secondaries = feedItems.slice(1).filter((item) => isStrictlyRelatedToLead(item, lead));
  const textLen = getBatchUsableTextLength(feedItems);

  // True multi-outlet same-story package — write as package brief, not a mixed digest
  if (secondaries.length >= 2) return false;
  // One strong related secondary with enough combined text
  if (secondaries.length >= 1 && textLen >= minTextChars) return false;

  // Intentional community multi-highlight with enough material
  if (lead.contentType === 'community' && feedItems.length >= 3 && textLen >= Math.floor(minTextChars * 0.7)) {
    return false;
  }

  return true;
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
  const allowCommunityRoundup = shouldAllowCommunityMultiHighlight(mainStory, candidates);

  const baseFilters = (item) => {
    if (item.contentType !== contentType) return false;
    if (!isEligibleForGeneration(item)) return false;
    if (item.publishedAt && item.publishedAt < Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000) {
      return false;
    }
    if (item.sourceKind === 'reddit' && !passesCommunityQualityGate(item)) {
      return false;
    }
    return true;
  };

  const pool = candidates
    .filter(baseFilters)
    .filter((item) => !isTopicCovered(item, historyEntries))
    .filter((item) => {
      if (isStrictlyRelatedToLead(item, mainStory)) return true;
      // Intentional community multi-highlight only — never pad news/mods with unrelated filler
      if (allowCommunityRoundup && hasHighValueCommunitySignals(item)) return true;
      return false;
    })
    .sort((a, b) => {
      const relatedA = isStrictlyRelatedToLead(a, mainStory) ? 2 : 0;
      const relatedB = isStrictlyRelatedToLead(b, mainStory) ? 2 : 0;
      if (relatedB !== relatedA) return relatedB - relatedA;
      return getAdjustedCandidateScore(b, historyEntries) - getAdjustedCandidateScore(a, historyEntries);
    });

  // Buzz only when it is still about the same story/package (never random filler)
  const buzzPool = candidates
    .filter(baseFilters)
    .filter((item) => isBuzzEnrichmentCandidate(item, mainStory, historyEntries))
    .filter((item) => isStrictlyRelatedToLead(item, mainStory) || shareMegaEventPackage(item, mainStory))
    .sort((a, b) => getAdjustedCandidateScore(b, historyEntries) - getAdjustedCandidateScore(a, historyEntries));

  const selected = [mainStory];
  const usedTopics = new Set([mainTopic]);

  const tryAdd = (item) => {
    if (selected.length >= limit) return false;
    const topicKey = getStoryTopicKey(item);
    if (usedTopics.has(topicKey)) return false;
    if (item.link === mainStory.link && item.title === mainStory.title) return false;
    if (selected.some((existing) => existing.link && item.link && existing.link === item.link)) return false;

    selected.push({
      ...item,
      enrichmentRole: isWeakPackageBuzz(item) ? 'buzz' : (item.enrichmentRole || 'source')
    });
    usedTopics.add(topicKey);
    return true;
  };

  for (const item of pool) {
    if (selected.length >= limit) break;
    tryAdd(item);
  }

  for (const item of buzzPool) {
    if (selected.length >= limit) break;
    tryAdd(item);
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

/**
 * Meme / shitpost "announcements" that must never become news features.
 * Example: "Todd confirms Fallout 6 on Xbox Palantir 2 for October 23, 2077".
 */
export function isObviousSatireOrFakeAnnouncement(item = {}) {
  const title = String(item.title || '');
  const haystack = `${title} ${item.description || ''}`;

  // Far-future or in-universe joke years with announcement framing
  if (/\b(2077|208\d|209\d|21\d{2})\b/.test(haystack)
    && /\b(confirm|announc|release|exclusive|fallout day|launch)\b/i.test(haystack)) {
    return true;
  }

  // Impossible / meme hardware and products
  if (/\bpalantir\b|\bxbox\s+palantir|\bsteam\s*deck\s*3\b|\bps6\s+pro\b|\bnintendo\s+switch\s*3\s+fallout\b/i.test(haystack)) {
    return true;
  }

  // Common meme typos with announcement framing
  if (/\bocotober\b|\boctober\s+32\b|\bjanurary\b/i.test(haystack)
    && /\b(confirm|announc|release|exclusive)\b/i.test(haystack)) {
    return true;
  }

  // "Fallout 6/7/69" confirmation from community-only sources
  const fromCommunity = isCommunitySourcedItem(item);
  if (fromCommunity
    && /\b(confirm|confirms|confirmed|officially|announces|announced)\b/i.test(title)
    && /\bfallout\s*(6|7|8|9|69|420)\b/i.test(title)) {
    return true;
  }

  return false;
}

/** Community-only "Todd/Bethesda confirms…" with no press/official source in the item itself. */
export function isUncorroboratedStudioClaim(item = {}) {
  if (!isCommunitySourcedItem(item)) return false;
  if (isObviousSatireOrFakeAnnouncement(item)) return true;

  const title = String(item.title || '');
  const haystack = `${title} ${item.description || ''}`;

  const hasStudioActor = /\b(todd howard|bethesda|obsidian|microsoft|xbox wire|zenimax)\b/i.test(haystack);
  const hasConfirmVerb = /\b(confirm|confirms|confirmed|officially|announces|announced|reveal|reveals|revealed)\b/i.test(haystack);
  const hasBigClaim = /\b(fallout\s*[5-9]|fallout\s*6|remaster|exclusive|release date|xbox exclusive|ps5 exclusive)\b/i.test(haystack);

  return hasStudioActor && hasConfirmVerb && hasBigClaim;
}

export function isCommunitySourcedItem(item = {}) {
  if (!item) return false;
  if (item.enrichmentRole === 'research') {
    return item.sourceTier === 'community'
      || item.sourceKind === 'reddit'
      || /reddit/i.test(item.source || '');
  }
  return item.sourceTier === 'community'
    || item.contentType === 'community'
    || item.sourceKind === 'reddit'
    || /reddit/i.test(item.source || '');
}

/** True when the batch includes real press or official (not community-only Reddit). */
export function batchHasReliableCorroboration(newsItems = []) {
  if (!Array.isArray(newsItems)) return false;
  return newsItems.some((item) => {
    if (!item || item.enrichmentRole === 'buzz') return false;
    if (item.sourceTier === 'official') return true;
    if (item.sourceTier === 'press' && item.sourceKind !== 'reddit') return true;
    if (item.enrichmentRole === 'research' && item.sourceTier === 'press') return true;
    if (item.enrichmentRole === 'research' && resolveOutletFromLink(item.link)) return true;
    return false;
  });
}

export function isEligibleForGeneration(item = {}) {
  if (isObviousSatireOrFakeAnnouncement(item)) return false;
  // Community "studio confirms X" without being a known joke still must not lead alone
  if (isUncorroboratedStudioClaim(item)) return false;

  if (item.sourceKind === 'reddit') return true;
  if (/wiki|mutants allowed|duck and cover|steam community|steam —/i.test(item.source || '')) return true;
  if (!hasFalloutFocus(item)) return false;
  if (item.contentType === 'news' && item.sourceTier === 'press') {
    return hasFalloutTitleMention(item.title);
  }
  return true;
}

const NOISE_TERMS = ['rumor', 'rumour', 'leak', 'leaked', 'speculation', 'datamine', 'insider claims', 'allegedly'];

// Soft industry chatter only — do NOT include phrases that also appear in official studio notes
// (e.g. "in development", "working on a new"), or confirmed news gets mislabeled as press-report.
const REPORT_SIGNALS = [
  'report', 'reportedly', 'according to sources', 'sources say', 'sources tell', 'insider',
  'claims that', 'said to be', 'is said to', 'people familiar', 'people with knowledge',
  'unconfirmed', 'could be', 'may be', 'shelving', 'shelved', 'greenlit', 're-focusing',
  'shifting focus', '– report', '- report'
];

const CONFIRMED_PRESS_SIGNALS = [
  'patch notes', 'now available', 'out now', 'launches today', 'is live', 'now live',
  'release date', 'official trailer', 'premiere date', 'maintenance update', 'scheduled for',
  'season begins', 'update is available', 'available to download'
];

// Press covering a first-party studio announcement (Bethesda X, studio note, official blog, etc.)
const OFFICIAL_CONFIRMATION_SIGNALS = [
  'officially confirmed', 'officially announced', 'officially in', 'now officially',
  'has confirmed', 'have confirmed', 'confirms that', 'confirmed that', 'confirms fallout',
  'bethesda confirmed', 'bethesda confirms', 'bethesda announced', 'bethesda announces',
  'studio confirmed', 'studio confirms', 'studio announced', 'studio announces',
  'in a statement', 'in an official', 'official statement', 'official announcement',
  'studio note', 'note from bethesda', 'a note from bethesda', 'from bethesda game studios',
  'happy to confirm', 'we can confirm', 'we are happy to confirm',
  'pre-production', 'preproduction', 'pre production',
  're-confirmed', 'reconfirmed', 'officially re-confirmed'
];

const REPORTING_OUTLETS = [
  'Bloomberg', 'IGN', 'Kotaku', 'Eurogamer', 'VGC', 'GamesRadar', 'GameSpot', 'Polygon',
  'The Verge', 'PC Gamer', 'PCGamesN', 'Rock Paper Shotgun', 'Shacknews', 'DualShockers',
  'Video Games Chronicle', 'Aftermath', 'GamesIndustry', 'The Gamer', 'Insider Gaming',
  'Wccftech', 'Siliconera', 'Engadget'
];

const UPSTREAM_REPORTING_OUTLETS = ['Bloomberg'];

const LINK_HOST_TO_OUTLET = Object.fromEntries(
  CONTENT_SOURCES
    .filter((source) => source.url)
    .map((source) => {
      try {
        return [new URL(source.url).hostname.replace(/^www\./, '').toLowerCase(), source.name];
      } catch {
        return null;
      }
    })
    .filter(Boolean)
);

const KNOWN_REPORTING_OUTLETS = new Set([
  ...REPORTING_OUTLETS,
  ...CONTENT_SOURCES.map((source) => source.name)
]);

function outletMentionedInText(text = '', outlet = '') {
  const escaped = outlet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (outlet.length <= 3) {
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  }
  return text.toLowerCase().includes(outlet.toLowerCase());
}

function resolveOutletFromLink(link = '') {
  if (!link) return null;
  try {
    const host = new URL(link).hostname.replace(/^www\./, '').toLowerCase();
    return LINK_HOST_TO_OUTLET[host] || null;
  } catch {
    return null;
  }
}

function formatOutletList(outlets = []) {
  if (outlets.length === 0) return 'the original report';
  if (outlets.length === 1) return outlets[0];
  if (outlets.length === 2) return `${outlets[0]} and ${outlets[1]}`;
  return `${outlets.slice(0, -1).join(', ')}, and ${outlets.at(-1)}`;
}

function scoreItem(item, source) {
  const haystack = `${item.title} ${item.description}`.toLowerCase();
  const keywordHits = FALLOUT_KEYWORDS.filter((keyword) => haystack.includes(keyword));
  const contentType = detectContentType(item, source);

  let score = source.weight + keywordHits.length * 1.4;

  score += freshnessBonus(item.publishedAt);
  score += Math.min((item.description || '').length / 180, 1.8);
  score += engagementBonus(item);
  if (item.sourceKind === 'reddit' && !hasRedditEngagementMetrics(item)) score -= 2.5;

  if (source.tier === 'official') score += 3.2;
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
  if (isObviousSatireOrFakeAnnouncement(item) || isUncorroboratedStudioClaim(item)) score -= 25;
  // Prefer press/official confirmation coverage — not community meme "Todd confirms" posts
  if (hasOfficialConfirmationSignals(item) && !isCommunitySourcedItem({ ...item, sourceTier: source.tier || item.sourceTier, contentType })) {
    score += 4.5;
  }

  return score;
}

export function hasOfficialConfirmationSignals(item = {}) {
  const haystack = `${item.title} ${item.description}`.toLowerCase();
  if (NOISE_TERMS.some((term) => haystack.includes(term))) return false;
  return OFFICIAL_CONFIRMATION_SIGNALS.some((signal) => haystack.includes(signal));
}

export function hasRumorFramingSignals(item = {}) {
  const haystack = `${item.title} ${item.description}`.toLowerCase();
  const title = item.title || '';
  if (NOISE_TERMS.some((term) => haystack.includes(term))) return true;
  if (/\breport\b/i.test(title) || /[–-]\s*report/i.test(title)) return true;
  return REPORT_SIGNALS.some((signal) => haystack.includes(signal));
}

export function resolveReportingOutlet(item = {}) {
  const haystack = `${item.title} ${item.description}`;

  for (const outlet of UPSTREAM_REPORTING_OUTLETS) {
    if (outletMentionedInText(haystack, outlet)) return outlet;
  }

  const fromLink = resolveOutletFromLink(item.link);
  if (fromLink) return fromLink;

  if (item.source && KNOWN_REPORTING_OUTLETS.has(item.source)) {
    return item.source;
  }

  for (const outlet of REPORTING_OUTLETS) {
    if (UPSTREAM_REPORTING_OUTLETS.includes(outlet)) continue;
    if (outletMentionedInText(haystack, outlet)) return outlet;
  }

  return item.source || 'the original report';
}

export function resolveReportingOutletFromBatch(newsItems = []) {
  if (!Array.isArray(newsItems) || newsItems.length === 0) return 'the original report';
  if (newsItems.length === 1) return resolveReportingOutlet(newsItems[0]);

  const outlets = [];
  for (const item of newsItems) {
    const outlet = item.source?.trim();
    if (!outlet || outlets.includes(outlet)) continue;
    outlets.push(outlet);
  }

  if (outlets.length === 0) return resolveReportingOutlet(newsItems[0]);
  return formatOutletList(outlets);
}

function getCitedOutletNames(outletLabel = '') {
  return outletLabel
    .split(/,\s+and\s+|\s+and\s+/i)
    .flatMap((part) => part.split(/,\s*/))
    .map((part) => part.trim())
    .filter(Boolean);
}

export function sanitizeMisattributedPressText(text = '', citedOutletLabel = '') {
  if (!text || !citedOutletLabel) return text;

  const citedOutlets = new Set(getCitedOutletNames(citedOutletLabel));
  let sanitized = text;

  for (const outlet of REPORTING_OUTLETS) {
    if (citedOutlets.has(outlet)) continue;
    sanitized = sanitized.replace(
      new RegExp(`\\breported by ${outlet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'),
      `reported by ${citedOutletLabel}`
    );
  }

  return sanitized;
}

export function resolveReportingOutletFromSources(sources = [], newsItems = []) {
  const citedUrls = new Set(
    (Array.isArray(sources) ? sources : [])
      .map((source) => source?.url)
      .filter(Boolean)
  );

  if (citedUrls.size === 0) {
    return resolveReportingOutletFromBatch(newsItems);
  }

  const outlets = [];
  for (const item of newsItems) {
    if (!item?.link || !citedUrls.has(item.link)) continue;
    const outlet = item.source?.trim();
    if (!outlet || outlets.includes(outlet)) continue;
    outlets.push(outlet);
  }

  if (outlets.length === 0) {
    for (const source of sources) {
      const outlet = resolveOutletFromLink(source?.url) || source?.title;
      if (!outlet || outlets.includes(outlet)) continue;
      outlets.push(outlet);
    }
  }

  if (outlets.length === 0) return resolveReportingOutlet(newsItems[0] || {});
  return formatOutletList(outlets);
}

export function detectTrustLevel(item = {}, source = {}) {
  const tier = source.tier || item.sourceTier;
  const category = source.category || item.contentType;
  const normalized = {
    ...item,
    sourceTier: tier,
    contentType: category || item.contentType
  };

  if (tier === 'official') return 'official';
  // Community / Reddit never becomes confirmed from "officially confirms" wording alone
  if (category === 'mods' || category === 'community' || isCommunitySourcedItem(normalized)) {
    return 'community-highlight';
  }

  // Fan theories / soft buzz must never inherit "confirmed studio news" framing
  if (isWeakPackageBuzz(item) || item.enrichmentRole === 'buzz') {
    return 'press-report';
  }

  // Press rewriting a first-party studio announcement → confirmed for fans, not a leak
  if (hasOfficialConfirmationSignals(item) && !isWeakPackageBuzz(item)) return 'confirmed';

  const haystack = `${item.title} ${item.description}`.toLowerCase();
  const title = item.title || '';

  const isReportTitle = /\breport\b/i.test(title) || /[–-]\s*report/i.test(title);
  const hasReportSignal = isReportTitle || REPORT_SIGNALS.some((signal) => haystack.includes(signal));
  const hasConfirmedSignal = CONFIRMED_PRESS_SIGNALS.some((signal) => haystack.includes(signal));

  if (hasReportSignal && !hasConfirmedSignal) return 'press-report';
  if (hasConfirmedSignal && !hasReportSignal) return 'confirmed';
  if (hasReportSignal && hasConfirmedSignal) return 'press-report';

  // Soft industry chatter about future projects — only when framed as report/rumor
  if (hasRumorFramingSignals(item)
    && /\b(obsidian|bethesda|microsoft|xbox|developer|studio)\b/.test(haystack)
    && /\b(new game|sequel|spin-off|fallout 5|project|return to)\b/.test(haystack)) {
    return 'press-report';
  }

  // Platform silence / exclusivity follow-ups are industry reporting, not studio confirmation
  if (hasDistinctFollowUpBeat(item) && getFollowUpBeatKeys(item).includes('platform-exclusivity')) {
    return 'press-report';
  }

  return tier === 'press' ? 'press-report' : 'confirmed';
}

const TRUST_RANK = {
  official: 4,
  confirmed: 3,
  'press-report': 2,
  'community-highlight': 1
};

export function detectTrustLevelForBatch(newsItems = []) {
  if (!Array.isArray(newsItems) || newsItems.length === 0) return 'confirmed';

  const lead = newsItems[0];
  const leadLevel = lead.trustLevel || detectTrustLevel(lead, {
    tier: lead.sourceTier,
    category: lead.contentType
  });

  // Pure community batches stay community — never upgrade via "confirms" wording
  if (!batchHasReliableCorroboration(newsItems)) {
    if (newsItems.every((item) => isCommunitySourcedItem(item) || item.enrichmentRole === 'buzz')) {
      return 'community-highlight';
    }
  }

  // Lead is a distinct follow-up or weak buzz → trust follows the lead, not package rehash support
  if (lead && (hasDistinctFollowUpBeat(lead) || isWeakPackageBuzz(lead) || lead.enrichmentRole === 'buzz')) {
    if (leadLevel === 'official' && batchHasReliableCorroboration(newsItems)) return 'official';
    if (leadLevel === 'confirmed' && !batchHasReliableCorroboration(newsItems)) {
      return isCommunitySourcedItem(lead) ? 'community-highlight' : 'press-report';
    }
    return leadLevel;
  }

  const levels = newsItems.map((item) => (
    item.trustLevel || detectTrustLevel(item, { tier: item.sourceTier, category: item.contentType })
  ));

  if (levels.includes('official') && batchHasReliableCorroboration(newsItems)) return 'official';

  // Only non-community sources can push the batch to "confirmed"
  const confirmedLike = newsItems.filter((item) => (
    !isCommunitySourcedItem(item)
    && hasOfficialConfirmationSignals(item)
    && !isWeakPackageBuzz(item)
    && item.enrichmentRole !== 'buzz'
  )).length;
  if (confirmedLike > 0) return 'confirmed';
  if (levels.includes('confirmed') && batchHasReliableCorroboration(newsItems)) return 'confirmed';

  if (levels.includes('press-report')) return 'press-report';
  if (levels.includes('community-highlight')) return 'community-highlight';
  return levels[0] || leadLevel || 'confirmed';
}

export function prioritizeGenerationBatch(newsItems = []) {
  if (!Array.isArray(newsItems) || newsItems.length <= 1) return newsItems;

  const lead = newsItems[0];
  // Keep the editorial lead first so exclusivity (etc.) is not buried under package rehashes
  if (lead && (hasDistinctFollowUpBeat(lead) || isWeakPackageBuzz(lead))) {
    const rest = newsItems.slice(1).sort((a, b) => {
      const buzzA = a.enrichmentRole === 'buzz' || isWeakPackageBuzz(a) ? 0 : 1;
      const buzzB = b.enrichmentRole === 'buzz' || isWeakPackageBuzz(b) ? 0 : 1;
      if (buzzB !== buzzA) return buzzB - buzzA;
      return (b.score ?? 0) - (a.score ?? 0);
    });
    return [lead, ...rest];
  }

  return [...newsItems].sort((a, b) => {
    const trustA = TRUST_RANK[detectTrustLevel(a, { tier: a.sourceTier, category: a.contentType })] || 0;
    const trustB = TRUST_RANK[detectTrustLevel(b, { tier: b.sourceTier, category: b.contentType })] || 0;
    if (trustB !== trustA) return trustB - trustA;

    const confA = hasOfficialConfirmationSignals(a) && !isWeakPackageBuzz(a) ? 1 : 0;
    const confB = hasOfficialConfirmationSignals(b) && !isWeakPackageBuzz(b) ? 1 : 0;
    if (confB !== confA) return confB - confA;

    return (b.score ?? 0) - (a.score ?? 0);
  });
}

export function resolveStoryAttribution(newsItems = [], trustLevel = 'confirmed') {
  const batch = Array.isArray(newsItems) ? newsItems.filter(Boolean) : [];
  if (batch.length === 0) return 'the original report';

  const officialItems = batch.filter((item) => item.sourceTier === 'official' || item.tier === 'official');
  if (trustLevel === 'official' && officialItems.length > 0) {
    return resolveReportingOutletFromBatch(officialItems);
  }

  const pressOutlets = [];
  for (const item of batch) {
    const name = item.source?.trim();
    if (!name || pressOutlets.includes(name)) continue;
    if (item.sourceTier === 'official') continue;
    pressOutlets.push(name);
  }

  const coversOfficial = trustLevel === 'official'
    || trustLevel === 'confirmed'
    || batch.some((item) => hasOfficialConfirmationSignals(item));

  const studioInCopy = batch.some((item) => (
    /\bbethesda\b/i.test(`${item.title} ${item.description}`)
  ));

  if (coversOfficial && studioInCopy) {
    if (pressOutlets.length === 0) return 'Bethesda Game Studios';
    if (pressOutlets.length === 1) return `Bethesda Game Studios (via ${pressOutlets[0]})`;
    return `Bethesda Game Studios (via ${formatOutletList(pressOutlets.slice(0, 3))})`;
  }

  return resolveReportingOutletFromBatch(batch);
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
      return 'Confirmed news — studio-confirmed facts (and reliable coverage of them). Dates or extra details may still be TBA.';
    case 'press-report':
      return 'Press report — based on journalism cited below; not yet confirmed by the developer or publisher.';
    case 'community-highlight':
      return 'Community highlight — fan-created content, not official Bethesda news.';
    default:
      return 'Prepared from sourced material listed below.';
  }
}

export function ensureTrustKeyFacts(keyFacts = [], mainStory = {}, trustLevel = 'confirmed', newsItems = [], resolvedSources = []) {
  const facts = [...keyFacts];
  const batch = newsItems.length > 0 ? newsItems : [mainStory];
  // Prefer outlets that actually appear in the article sources list (drop unused lead items).
  const citedItems = resolvedSources.length > 0
    ? batch.filter((item) => resolvedSources.some((source) => source.url === item.link))
    : batch;
  const attributionItems = citedItems.length > 0 ? citedItems : batch;
  const outlet = trustLevel === 'press-report' && resolvedSources.length > 0 && citedItems.length > 0
    ? resolveReportingOutletFromSources(resolvedSources, batch)
    : resolveStoryAttribution(attributionItems, trustLevel);

  if (trustLevel === 'press-report') {
    const disclaimer = `Reported by ${outlet}; not yet confirmed by the developer or publisher.`;
    const withoutStaleDisclaimer = facts.filter((fact) => (
      !/^Reported by .*; not yet confirmed/i.test(fact)
      && !/not yet confirmed by the developer or publisher/i.test(fact)
      && !/^Confirmed via official/i.test(fact)
      && !/^Source: official/i.test(fact)
    ));
    withoutStaleDisclaimer.unshift(disclaimer);
    return withoutStaleDisclaimer.slice(0, 6);
  }

  if (trustLevel === 'official' || trustLevel === 'confirmed') {
    const coversOfficial = trustLevel === 'official'
      || attributionItems.some((item) => hasOfficialConfirmationSignals(item))
      || /\bbethesda\b/i.test(`${mainStory.title} ${mainStory.description}`);
    const officialFact = coversOfficial
      ? `Confirmed via official Bethesda communications; coverage from ${resolveReportingOutletFromBatch(attributionItems)}.`
      : `Source: ${outlet}.`;
    const withoutStale = facts.filter((fact) => (
      !/^Reported by .*; not yet confirmed/i.test(fact)
      && !/not yet confirmed by the developer or publisher/i.test(fact)
      && !/^Confirmed via official/i.test(fact)
      && !/^Source: official/i.test(fact)
    ));
    withoutStale.unshift(officialFact);
    return withoutStale.slice(0, 6);
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
  if (shareMegaEventPackage(item, mainStory)) return true;

  const mainHaystack = `${mainStory.title} ${mainStory.description}`.toLowerCase();
  const itemHaystack = `${item.title} ${item.description}`.toLowerCase();
  const turmoilSignals = [
    'layoff', 'zenimax', 'bethesda', 'xbox', 'studio cut', 'warn act', 'restructur', 'job cut', 'microsoft'
  ];
  const responseSignals = [
    'protest', 'union', 'workers rally', 'onebgs', 'modder', 'same dna', 'studio dna'
  ];
  const mainHasTurmoil = turmoilSignals.some((signal) => mainHaystack.includes(signal));
  if (!mainHasTurmoil) return true;

  if (turmoilSignals.some((signal) => itemHaystack.includes(signal))) return true;
  if (responseSignals.some((signal) => itemHaystack.includes(signal))) return true;
  if (/\bobsidian\b/.test(itemHaystack) && /\b(dna|director|studio)\b/.test(itemHaystack)) return true;

  return false;
}

export function resolveArticleSources(sources = [], newsItems = []) {
  const mainStory = newsItems[0] || {};
  const allowedItems = newsItems.filter((item) => item?.link);
  const allowedUrls = new Map(allowedItems.map((item) => [item.link, item]));
  const multiSourceBrief = newsItems.length > 1;
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

  if (!multiSourceBrief || resolved.length === 0) {
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
  }

  const includesPrimary = resolved.some((source) => source.url === mainStory.link);
  const finalized = !multiSourceBrief || includesPrimary
    ? ensurePrimarySource(resolved, mainStory)
    : resolved;

  return finalized.slice(0, 4);
}

export function validateArticleTrust(article = {}, newsItems = []) {
  const mainStory = newsItems[0] || {};
  const trustLevel = detectTrustLevelForBatch(newsItems);
  const sources = resolveArticleSources(article.sources, newsItems);
  const citedOutlet = resolveStoryAttribution(newsItems, trustLevel);
  const keyFacts = ensureTrustKeyFacts(article.keyFacts, mainStory, trustLevel, newsItems, sources);
  const intro = trustLevel === 'press-report'
    ? sanitizeMisattributedPressText(article.intro, citedOutlet)
    : sanitizeOverhedgedOfficialCopy(article.intro, trustLevel);
  const subtitle = trustLevel === 'press-report'
    ? sanitizeMisattributedPressText(article.subtitle, citedOutlet)
    : sanitizeOverhedgedOfficialCopy(article.subtitle, trustLevel);
  const sections = Array.isArray(article.sections)
    ? article.sections.map((section) => ({
      ...section,
      body: trustLevel === 'press-report'
        ? sanitizeMisattributedPressText(section.body, citedOutlet)
        : sanitizeOverhedgedOfficialCopy(section.body, trustLevel)
    }))
    : article.sections;

  return {
    ...article,
    trustLevel,
    contentType: article.contentType || mainStory.contentType || 'news',
    keyFacts,
    intro,
    subtitle,
    sections,
    sources,
    seoDescription: ensureSeoDescription({ ...article, trustLevel, contentType: article.contentType || mainStory.contentType || 'news', intro, subtitle })
  };
}

/** Soften leftover leak-style hedging when the batch is actually official/confirmed. */
export function sanitizeOverhedgedOfficialCopy(text = '', trustLevel = 'confirmed') {
  if (!text || (trustLevel !== 'confirmed' && trustLevel !== 'official')) return text;

  return text
    .replace(/\bthis press report\b/gi, 'this official update')
    .replace(/\bpress report\b/gi, 'official update')
    .replace(/\bnot yet confirmed by the developer or publisher\b/gi, 'with release windows still unannounced')
    .replace(/\bnot been confirmed by the developer or publisher\b/gi, 'still lack firm release windows')
    .replace(/\bunconfirmed by the developer(?:\/publisher)?\b/gi, 'without announced release dates')
    .replace(/\breportedly\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Who is writing: a real Fallout fan running a long-lived community hub.
 * Sourced from fallouthub.blog About + community footprint (not a faceless wire service).
 */
export function getAuthorVoiceGuide(contentType = 'news') {
  const typeNote = contentType === 'community'
    ? `You are sharing community work the way a fellow fan would in Discord or on the blog — proud of the scene, not writing a corporate "creator spotlight" press kit.`
    : contentType === 'mods'
      ? `You are recommending mods the way a veteran player would: practical, specific, and honest about who the mod is for.`
      : `You are breaking news for players who live this franchise — clear, useful, and human, never a wire rewrite.`;

  return `WHO YOU ARE (write as this person — first person is OK in intro/conclusion/cta):
- You are ${AUTHOR_NAME}, the human editor behind ${BRAND_NAME} (${AUTHOR_SITE_URL}) — a long-running Fallout fan website and community hub, not a corporate outlet
- Your world is the whole franchise: classics (1/2/Tactics), FO3, New Vegas, FO4, 76, Shelter, the TV show, mods, lore, and fan creations
- You also run community spaces (${AUTHOR_COMMUNITY.socials}), a Discord, and the ${AUTHOR_COMMUNITY.app} app — you talk like someone who actually hangs out with fans
- You sound like a knowledgeable Fallout friend who runs a site: warm, direct, occasionally dry or wry, never corporate
- You respect creators by name and link; you never steal credit or oversell fan work as official news

${typeNote}

NATURAL VOICE (mandatory — posts must not sound AI-generated):
- Write like a human blog post a fan would enjoy reading out loud — professional enough for a serious site, casual enough for Discord
- Prefer concrete detail over empty praise: what the art shows, what the player hated (Cazadors), what Xbox actually refused to answer
- Vary sentence length and section length. Not every section needs the same 5-sentence shape
- One real opinion or reaction per piece is good ("this is the kind of hype-posting I get", "honestly the remake thread is mostly hope") when grounded in the sources
- Keep light Fallout flavor only when it fits — do not force "see you in the wastes" every time
- Contractions are fine (it's, don't, we're). Second person ("you'll care if…") is fine

BANNED BOT PHRASES (never use these or close paraphrases):
- treasure trove, buzzing with excitement, fever pitch, absolute best, incredible passion/depth
- wonderful reminder, vibrant as ever, keep exploring keep creating
- testament to, showcases the incredible, in today's wasteland, dive into / diving into
- "Welcome back to Fallout Hub, where we…" template intros
- "Why fans are talking about this:" essay closers that restate the whole post
- stacking synonyms (stunning + gorgeous + striking + beautiful) for the same thing
- explaining jokes or memes like a teacher ("this kind of satirical meta-humor is a staple…")

STRUCTURE THAT FEELS HUMAN:
- Open with the interesting thing, not a brand mission statement
- Community roundups: uneven sections OK — longer on the best item, shorter on memes
- Do not end every section with a moral about "what this proves about the community"
- CTA should sound like a real question you'd ask in comments or Discord, not a classroom prompt`;
}

function getContentTypeGuidance(contentType, trustLevel = 'confirmed') {
  const trustGuidance = trustLevel === 'press-report'
    ? `TRUST LEVEL: PRESS REPORT (unconfirmed by developer/publisher)
- This story is based on journalism, NOT an official announcement
- The intro MUST make clear this is reported by [outlet] and not confirmed by the developer/publisher — in natural wording, not a legal disclaimer stamp on every sentence
- Attribute claims clearly but vary phrasing — do not open more than two sections with "According to the report"
- Use hedging language: "reportedly", "is said to", "the report claims" where appropriate
- When Bethesda or Xbox news affects Fallout, keep the franchise impact in every section — not just Elder Scrolls
- Do NOT invent background details, past quotes, or related rumors not present in the source summaries
- keyFacts MUST include: "Reported by [outlet]; not yet confirmed by the developer or publisher."
- The conclusion MUST remind readers that official confirmation is still pending`
    : trustLevel === 'official'
      ? `TRUST LEVEL: OFFICIAL
- This comes from an official Bethesda or platform source — write with confidence for fans
- Lead with what Bethesda/the official channel confirmed; cite that source first
- Only hedge details that are still missing (dates, windows, unstated scope) — never hedge that the announcement itself is real
- Do not frame this as a leak or unconfirmed press report`
      : trustLevel === 'community-highlight'
        ? `TRUST LEVEL: COMMUNITY HIGHLIGHT
- Make clear this is fan-created content, not official news — say it like a fan host, not a compliance footer`
        : `TRUST LEVEL: CONFIRMED NEWS
- These are established facts from official studio communications and reliable coverage of them
- Lead with what Bethesda/the studio confirmed — press outlets are secondary coverage, not the origin of the news
- Write with confidence for fans: Fallout 5 pre-production, remasters, Obsidian collabs, expansions, etc. are facts when sources say confirmed
- ONLY hedge release dates, exact windows, or details the studio explicitly left unannounced
- NEVER say "not yet confirmed by the developer" when the sources describe an official confirmation
- keyFacts MUST open with a confirmed-via-official framing, not a press-report disclaimer
- Sources should list the strongest coverage URLs; mention official Bethesda channels in keyFacts when the copy supports it`;

  switch (contentType) {
    case 'mods':
      return `${trustGuidance}

CONTENT TYPE: MOD SPOTLIGHT
- Explain what the mod changes for players in practical terms
- Credit the creator and point readers to the original mod page or thread
- Mention game, platform, or compatibility details only if present in the sources
- Help readers decide whether it is worth checking out
- Never present mods as official Bethesda content
- Sound like a player who installs mods, not a store listing`;
    case 'community':
      return `${trustGuidance}

CONTENT TYPE: COMMUNITY HIGHLIGHT
- Spotlight fan creativity: art, cosplay, builds, lore discussion, memes, or projects worth seeing
- Credit the creator or community thread clearly (username + subreddit/link when known)
- Say why YOU (as a Fallout Hub host) bothered to share it — one specific reason beats three empty adjectives
- Let Reddit/community voice show through lightly; do not sanitize every meme into museum language
- Frame as community-driven, not official news`;
    default:
      return `${trustGuidance}

CONTENT TYPE: NEWS
- Accuracy and attribution come first — this is why readers trust ${BRAND_NAME}
- Only state facts supported by the provided sources
- Separate confirmed information from fan reaction or interpretation
- If details are limited, say so honestly instead of filling gaps
- Explain impact for players in plain language, not industry-speak`;
  }
}

function getContentTypeLabel(contentType, trustLevel = 'confirmed') {
  if (trustLevel === 'press-report') return 'Press Report';
  if (trustLevel === 'official') return 'Official Update';
  if (trustLevel === 'confirmed' && contentType === 'news') return 'Official News';

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
  return newsItems.slice(0, 8)
    .map((item, index) => {
      const ageLabel = item.publishedAt
        ? `${Math.max(1, Math.round((Date.now() - item.publishedAt) / (1000 * 60 * 60)))}h ago`
        : 'recent';
      const itemTrust = item.trustLevel || detectTrustLevel(item, { tier: item.sourceTier, category: item.contentType });
      const summary = buildStorySummaryForPrompt(item);
      let role = 'Role: SUPPORTING SOURCE — weave in where it strengthens the main story';
      if (item.enrichmentRole === 'research') {
        role = 'Role: DEEP RESEARCH CONTEXT — same topic/creator/project only; use for background and depth, never for unrelated Fallout news';
      } else if (item.enrichmentRole === 'buzz' || isWeakPackageBuzz(item)) {
        role = 'Role: FAN BUZZ / SOFT CONTEXT only — mention briefly if useful; never treat as confirmed fact';
      } else if (index === 0) {
        role = 'Role: MAIN STORY — lead the article with this';
      }
      return `${index + 1}. ${item.title}
   Source: ${item.source}
   Type: ${getContentTypeLabel(item.contentType || 'news', itemTrust)}
   Trust: ${getTrustLabel(itemTrust)}
   ${role}
   Published: ${ageLabel}
   Summary: ${summary}${item.link ? `\n   URL: ${item.link}` : ''}`;
    })
    .join('\n\n');
}

function buildPromptTrustSection(trustLevel, reportingOutlet, { multiSource = false } = {}) {
  const attributionRule = multiSource
    ? `- Attribution for this package: ${reportingOutlet}. Name press outlets only for URLs in your sources array; when trust is confirmed/official, lead with Bethesda/the studio`
    : `- Primary attribution: ${reportingOutlet}`;

  const trustRule = trustLevel === 'press-report'
    ? '- If trustLevel is "press-report", every section making a claim must attribute it to the cited outlet(s) or "the report"'
    : trustLevel === 'confirmed' || trustLevel === 'official'
      ? '- If trustLevel is "confirmed" or "official", state studio-confirmed facts confidently; cite press as coverage of the announcement, not as unconfirmed rumors'
      : '- If trustLevel is "community-highlight", make clear this is fan-created content';

  return `TRUST AND EDITORIAL STANDARDS:
- Use ONLY the material below. Never invent facts, dates, quotes, patch notes, or creator names.
- trustLevel for this post: ${trustLevel} (${getTrustLabel(trustLevel)})
${attributionRule}
${trustRule}
- Fans come first: prioritize clarity, accuracy, and usefulness over hedging that confuses confirmed news with leaks
- If a detail is missing from the sources, say "details are still limited" or "no release window yet" instead of guessing
- Include a keyFacts array with 3-5 bullet points a busy reader can scan in 10 seconds
- Accuracy never means sounding like a robot — keep the ${AUTHOR_NAME} / ${BRAND_NAME} human voice while staying factual`;
}

function buildSharedArticleRequirements(contentType, trustLevel, reportingOutlet, { multiSource = false } = {}) {
  let introAttribution;
  let subtitleRule;
  let conclusionRule;

  if (trustLevel === 'press-report') {
    introAttribution = multiSource
      ? 'attribute each claim to the specific cited outlet(s) in your sources array and note it is not confirmed by the developer/publisher — in plain human wording'
      : `make clear early that this is reported by ${reportingOutlet} and not confirmed by the developer/publisher, without stiff disclaimer language`;
    subtitleRule = 'for press-report, hint it is based on reporting without sounding like a legal notice';
    conclusionRule = 'for press-report, note official confirmation is still pending in a natural way';
  } else if (trustLevel === 'confirmed' || trustLevel === 'official') {
    introAttribution = multiSource
      ? `open with what Bethesda/the studio confirmed, then note coverage from the cited outlets (${reportingOutlet})`
      : `open with the official confirmation and credit ${reportingOutlet}; do not call this unconfirmed`;
    subtitleRule = 'for confirmed/official, frame as real studio news fans can act on — still human, not a press-release reprint';
    conclusionRule = 'for confirmed/official, remind fans that dates/windows may still be TBA without casting doubt on the confirmation itself';
  } else {
    introAttribution = 'hook like a human host sharing something cool with friends — no brand mission statement';
    subtitleRule = 'one natural sentence on why this is worth a click';
    conclusionRule = 'close like a person wrapping a post, not a template';
  }

  return `ARTICLE REQUIREMENTS:
- seoDescription: a standalone meta description of 120-160 characters (target exactly 150). Natural human phrasing, not keyword stuffing.
- title: specific, ${MIN_TITLE_CHARS}-${MAX_TITLE_CHARS} characters — sound like a real blog headline a Fallout fan would click, not "Brand Community Spotlight: Keyword, Keyword, and Keyword"
- subtitle: one sentence; ${subtitleRule}
- intro: 2-4 sentences; ${introAttribution}. Do NOT start with "Welcome back to ${BRAND_NAME}" or similar template
- keyFacts: 3-5 short scannable bullet points (only facts supported by sources)
- sections: 4 to 6 sections (4 is fine if the material is thin). Each has "heading" and "body". Bodies may vary in length (about 50-130 words) — uneven is more human than identical blocks
- takeaway: one sharp line in your voice — an insight, not a slogan
- conclusion: 2-3 sentences; ${conclusionRule}. Optional light nod to the wider ${BRAND_NAME} community only if it fits naturally
- cta: one conversational question you'd actually ask readers in comments or Discord
- contentType: "${contentType}"
- trustLevel: "${trustLevel}"
- sources: array of {title, url, type} using ONLY URLs from SOURCE MATERIAL below — omit tangential supporting links
- Write ONLY about the source material provided. Do not invent stories or add topics that are not listed in the summaries below

Return valid JSON only with these fields: title, seoDescription, subtitle, intro, keyFacts, sections, conclusion, takeaway, cta, contentType, trustLevel, sources`;
}

function isFeatureGenerationMode(newsItems = []) {
  if (!Array.isArray(newsItems) || newsItems.length === 0) return false;
  if (newsItems[0]?.generationMode === 'feature') return true;
  const researchCount = newsItems.filter((item) => item.enrichmentRole === 'research').length;
  const feedCount = newsItems.filter((item) => item.enrichmentRole !== 'research' && item.enrichmentRole !== 'buzz').length;
  return researchCount > 0 && feedCount <= 2;
}

function buildFeaturePrompt(newsItems, context) {
  const mainStory = newsItems[0];
  const contentType = mainStory.contentType || 'news';
  const trustLevel = detectTrustLevelForBatch(newsItems);
  const reportingOutlet = resolveStoryAttribution(newsItems, trustLevel);

  return `You are ${AUTHOR_NAME}, writing a FULL FEATURE article for ${BRAND_NAME} — the kind of deep, satisfying post games media writes when one story is worth the whole page.

Goal: a miracle-read for Fallout fans about ONE topic. Not a mixed news dump. Not filler.

${getAuthorVoiceGuide(contentType)}

${getContentTypeGuidance(contentType, trustLevel)}

SINGLE-TOPIC FEATURE RULES:
- Lead with the hook: ${mainStory.title}
- Build the entire article around this subject (project, creator, mod, or announcement)
- Use DEEP RESEARCH CONTEXT for background: creator portfolio, project history, studio context, related coverage of the SAME story
- Do NOT drag in unrelated Fallout headlines just to add length
- Structure like a real feature: what happened, who/what it is, why fans care, context, what is still unknown
- If research is thin, say so honestly and still write the best possible focused piece from what you have
- Credit every claim to sources in the material below

${buildPromptTrustSection(trustLevel, reportingOutlet, { multiSource: newsItems.length > 1 })}

SOURCE MATERIAL (one story + related research only):
${context}

MAIN SUBJECT: ${mainStory.title}

${buildSharedArticleRequirements(contentType, trustLevel, reportingOutlet, { multiSource: false })}`;
}

function buildNewsPrompt(newsItems, context) {
  const mainStory = newsItems[0];
  const trustLevel = detectTrustLevelForBatch(newsItems);
  const reportingOutlet = resolveStoryAttribution(newsItems, trustLevel);
  const isMultiAngle = newsItems.length > 1
    && newsItems.filter((item) => item.enrichmentRole !== 'research').length > 1;

  const hasBuzz = newsItems.some((item) => item.enrichmentRole === 'buzz' || isWeakPackageBuzz(item));
  const buzzRule = hasBuzz
    ? `- Items marked FAN BUZZ / SOFT CONTEXT are for color only (fan theories, date speculation, social buzz). Mention briefly if useful; never treat as confirmed fact`
    : '';
  const followUpRule = hasDistinctFollowUpBeat(mainStory)
    ? `- This is a DISTINCT FOLLOW-UP beat (e.g. exclusivity, pricing, trailer), not a rehash of the original FO5/remaster confirmation. Lead with the new question fans care about`
    : '';

  const formatRules = isMultiAngle
    ? `NEWS BRIEF RULES (${newsItems.length} sourced angles — SAME STORY ONLY):
- Lead with the strongest fan-relevant fact: ${mainStory.title}
- Weave ONLY related angles (same package / same announcement). Never pad with unrelated Fallout news
- When this package is an official studio confirmation covered by multiple outlets, treat it as ONE confirmed story
- Separate confirmed studio facts from still-unknown details (dates, exact scope)
- Say why a player should care in practical terms with no empty hype
${followUpRule}
${buzzRule}`
    : `NEWS WRITING RULES:
- Lead with the most newsworthy confirmed or reported fact first
- Name the game, platform, studio, or show when known from sources
- Separate official/confirmed facts from pure press-report rumors and fan reaction
- Sound like a careful fan-site editor: clear and professional, not stiff wire copy
- Help readers understand timing, scope, and what is still unknown
- Prioritize usefulness for players over industry-insider jargon
${followUpRule}
${buzzRule}`;

  return `You are ${AUTHOR_NAME}, writing for ${BRAND_NAME} — a Fallout NEWS post your community will trust and actually want to read.
Goal: accurate, clear, shareable, honest about confirmed vs TBA — and unmistakably written by a human Fallout fan, not a bot.

${getAuthorVoiceGuide('news')}

${getContentTypeGuidance('news', trustLevel)}

${formatRules}

${buildPromptTrustSection(trustLevel, reportingOutlet, { multiSource: isMultiAngle })}

SOURCE MATERIAL (write only from these items — official, press, and community sources listed below):
${context}

MAIN STORY TO LEAD WITH: ${mainStory.title}

${buildSharedArticleRequirements('news', trustLevel, reportingOutlet, { multiSource: isMultiAngle })}`;
}

function buildModsPrompt(newsItems, context) {
  const mainStory = newsItems[0];
  const trustLevel = detectTrustLevelForBatch(newsItems);
  const reportingOutlet = resolveStoryAttribution(newsItems, trustLevel);
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

  return `You are ${AUTHOR_NAME}, writing ${isRoundup ? 'a MOD ROUNDUP' : 'a MOD SPOTLIGHT'} for ${BRAND_NAME} readers who want to know what is worth installing.

${getAuthorVoiceGuide('mods')}

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
  const trustLevel = detectTrustLevelForBatch(newsItems);
  const reportingOutlet = resolveStoryAttribution(newsItems, trustLevel);
  const isRoundup = newsItems.length > 1;

  const formatRules = isRoundup
    ? `COMMUNITY ROUNDUP RULES (${newsItems.length} highlights):
- Lead with the strongest community story: ${mainStory.title}
- Uneven sections are good — more space for the best piece (art, first playthrough), shorter for memes
- Credit each creator; keep Reddit energy where it fits without being crude beyond the sources
- Do not moralize every highlight ("this proves the community is vibrant")
- Do not mix in unrelated industry news or mod releases unless they are listed below
- Title should feel hand-picked, not "Community Spotlight: A, B, and C"`
    : `COMMUNITY HIGHLIGHT RULES:
- Celebrate the creator, build, artwork, cosplay, lore thread, or project clearly
- Open like you're sharing a cool find with friends, not issuing a press release
- One specific reason this stands out beats a paragraph of generic praise
- Credit the source thread or creator from the summaries
- Never frame fan work as official news or a Bethesda announcement`;

  return `You are ${AUTHOR_NAME}, hosting a community post on ${BRAND_NAME} — the same fan hub that runs Discord, socials, and the ${AUTHOR_COMMUNITY.app} app.
Write like you personally picked these highlights for people who live Fallout, not like an AI summarizing Reddit.

${getAuthorVoiceGuide('community')}

${getContentTypeGuidance('community', trustLevel)}

${formatRules}

${buildPromptTrustSection(trustLevel, reportingOutlet)}

SOURCE MATERIAL (write only from these community items):
${context}

MAIN COMMUNITY STORY TO LEAD WITH: ${mainStory.title}

${buildSharedArticleRequirements('community', trustLevel, reportingOutlet)}`;
}

function buildPrompt(newsItems, { expansion = false, previousArticle = null, expansionAttempt = 0 } = {}) {
  const mainStory = newsItems[0];
  const contentType = mainStory.contentType || 'news';
  const contextText = buildPromptContext(newsItems);
  const previousWords = getArticleWordCount(previousArticle || {});
  const previousSections = Array.isArray(previousArticle?.sections) ? previousArticle.sections.length : 0;

  const expansionNote = expansion
    ? `IMPORTANT: Expansion rewrite #${expansionAttempt || 1}. The previous draft failed the ${BRAND_NAME} substance gate (too short / thin sections / bot-like).
Previous draft title: ${previousArticle?.title || 'unknown'}
Previous word count: ${previousWords} (MUST exceed ${MIN_ARTICLE_WORDS})
Previous section count: ${previousSections} (need at least 4 sections; each body ≥ ~35 words)
Grow the existing draft in ${AUTHOR_NAME}'s natural ${BRAND_NAME} voice — stay on the SAME topic; do not add unrelated Fallout news.
Add more concrete detail from the source summaries below. Do not invent facts.
Strip corporate/AI filler. Prefer longer, uneven section bodies over empty praise.
${expansionAttempt >= 2 ? 'Earlier expansions still failed — be more thorough and use more of the source material in every section.\n' : ''}\n`
    : '';

  let body;
  if (isFeatureGenerationMode(newsItems)) {
    body = buildFeaturePrompt(newsItems, contextText);
  } else {
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
  }

  return `${expansionNote}${body}`;
}

function buildFallbackArticle(newsItems) {
  const mainStory = newsItems[0];
  const supportingStories = newsItems.slice(1, 3);
  const supportText = supportingStories.map((item) => item.title).join(' and ');
  const trustLevel = detectTrustLevelForBatch(newsItems);
  const reportingOutlet = resolveStoryAttribution(newsItems, trustLevel);
  const isConfirmed = trustLevel === 'confirmed' || trustLevel === 'official';

  return {
    title: ensureArticleTitle(`${mainStory.title}: what it means for the Wasteland right now`, mainStory),
    subtitle: isConfirmed
      ? `Official Fallout news for fans, based on studio confirmation and coverage from ${reportingOutlet}.`
      : `A ${getContentTypeLabel(mainStory.contentType || 'news', trustLevel).toLowerCase()} from ${reportingOutlet}, explained for Fallout fans.`,
    intro: `Fallout fans have no shortage of headlines to track, but some stories cut through the noise more than others. ${mainStory.title} is one of those — worth reading closely whether you mainline Fallout 76, replay New Vegas, or follow the Prime Video series.`,
    keyFacts: [
      isConfirmed
        ? `Confirmed via official communications; coverage from ${resolveReportingOutletFromBatch(newsItems)}.`
        : `Source: ${reportingOutlet}`,
      `Topic: ${getContentTypeLabel(mainStory.contentType || 'news', trustLevel)}`,
      mainStory.description ? mainStory.description.slice(0, 120) : 'A notable Fallout development worth following.'
    ],
    sections: [
      {
        heading: 'What happened',
        body: isConfirmed
          ? `Bethesda and related coverage confirm the core of today's story: ${mainStory.title}. ${mainStory.description ? mainStory.description.slice(0, 200) + (mainStory.description.length > 200 ? '…' : '') : 'It is one of the stronger Fallout-related developments for fans right now.'}`
          : `The headline driving today's conversation is ${mainStory.title}, reported by ${reportingOutlet}. ${mainStory.description ? mainStory.description.slice(0, 200) + (mainStory.description.length > 200 ? '…' : '') : 'It is one of the stronger Fallout-related developments in recent coverage.'}`
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
    conclusion: isConfirmed
      ? 'The studio has spoken — the smart play now is to track dates and follow-ups as Bethesda and partners share more.'
      : 'For now, the smart play is to follow the story closely, stay skeptical of unconfirmed chatter, and see what official channels confirm next.',
    cta: 'Which part of this story matters most to you — the games, the show, or the wider franchise?',
    contentType: mainStory.contentType || 'news',
    trustLevel,
    sources: newsItems.slice(0, 4).map((item) => ({ title: item.title, url: item.link || 'https://fallout.fandom.com/wiki/Fallout_Wiki', type: item.sourceTier || 'press' }))
  };
}

function normalizeArticle(article, newsItems) {
  const orderedItems = prioritizeGenerationBatch(newsItems);
  const mainStory = orderedItems[0] || {};
  const contentType = article?.contentType || mainStory.contentType || 'news';
  const trustLevel = detectTrustLevelForBatch(orderedItems);
  const sections = Array.isArray(article?.sections) && article.sections.length > 0
    ? article.sections
    : [
        { heading: 'What is happening', body: 'The main story here is worth following because it gives fans a clearer sense of where the franchise is heading.' },
        { heading: 'Why fans should care', body: 'This matters because it affects expectations around upcoming Fallout content and fan discussion.' },
        { heading: 'What to watch next', body: 'The next step is to follow official updates and the broader conversation around the topic.' }
      ];

  const reportingOutlet = resolveStoryAttribution(orderedItems, trustLevel);
  const keyFacts = Array.isArray(article?.keyFacts) && article.keyFacts.length >= 3
    ? article.keyFacts
    : [
        `Source: ${reportingOutlet || 'Trusted Fallout coverage'}`,
        `Category: ${getContentTypeLabel(contentType, trustLevel)}`,
        mainStory.description ? mainStory.description.slice(0, 140) : 'A development Fallout fans should know about.'
      ];

  return validateArticleTrust({
    title: ensureArticleTitle(article?.title, mainStory),
    seoDescription: article?.seoDescription || '',
    subtitle: article?.subtitle || `What ${BRAND_NAME} readers should know right now.`,
    intro: article?.intro || 'Here is the latest Fallout story worth your time — and what is still up in the air.',
    keyFacts,
    sections,
    takeaway: article?.takeaway || 'Know what is confirmed, what is still TBA, and what actually matters for players.',
    conclusion: article?.conclusion || 'I will keep watching official channels and the community conversation as more details land.',
    cta: article?.cta || 'What part of this are you most interested in — or most skeptical about?',
    contentType,
    trustLevel,
    sources: resolveArticleSources(article?.sources, orderedItems)
  }, orderedItems);
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

/** Same rotation helper for model chains (and any list). */
export function rotateList(items = [], offset = 0) {
  return rotateApiKeys(items, offset);
}

/**
 * How many full generation passes to run until the article is substantive.
 * Each pass can walk models × keys. Override with GEMINI_SUBSTANTIVE_ATTEMPTS (1–12).
 */
export function getSubstantiveGenerationAttempts() {
  const fromEnv = Number.parseInt(process.env.GEMINI_SUBSTANTIVE_ATTEMPTS || '', 10);
  if (Number.isFinite(fromEnv) && fromEnv >= 1) {
    return Math.min(12, Math.max(1, fromEnv));
  }

  try {
    const keyCount = getGeminiApiKeys().length;
    // Enough passes to cycle keys and re-try expansion with different models
    return Math.min(8, Math.max(5, keyCount * 2 + 1));
  } catch {
    return 5;
  }
}

function scoreArticleSubstance(article = {}) {
  const words = getArticleWordCount(article);
  const sections = Array.isArray(article.sections) ? article.sections.length : 0;
  const shortSections = Array.isArray(article.sections)
    ? article.sections.filter((section) => (section.body || '').split(/\s+/).filter(Boolean).length < 35).length
    : 0;
  return words + sections * 40 - shortSections * 25;
}

/** What failed the substance gate — used for targeted expansion, not full rewrites. */
export function diagnoseArticleThinness(article = {}, { minWords = MIN_ARTICLE_WORDS, minSections = 4 } = {}) {
  const words = getArticleWordCount(article);
  const sections = Array.isArray(article.sections) ? article.sections : [];
  const shortSectionIndexes = sections
    .map((section, index) => ({
      index,
      heading: section.heading || `Section ${index + 1}`,
      words: (section.body || '').split(/\s+/).filter(Boolean).length
    }))
    .filter((entry) => entry.words < 35);

  return {
    words,
    wordDeficit: Math.max(0, minWords - words),
    sectionCount: sections.length,
    sectionsNeeded: Math.max(0, minSections - sections.length),
    shortSections: shortSectionIndexes,
    needsMoreWords: words < minWords,
    needsMoreSections: sections.length < minSections,
    needsLongerSections: shortSectionIndexes.length > 0
  };
}

/**
 * Grow a thin draft without starting over: keep solid copy, only flesh out weak spots.
 * Returns a full article object; mergeExpandedArticle() then protects good previous content.
 */
export function mergeExpandedArticle(previous = null, expanded = null) {
  if (!expanded && previous) return previous;
  if (!previous) return expanded;
  if (!expanded) return previous;

  const prevSections = Array.isArray(previous.sections) ? previous.sections : [];
  const nextSections = Array.isArray(expanded.sections) ? expanded.sections : [];
  const maxLen = Math.max(prevSections.length, nextSections.length);
  const mergedSections = [];

  for (let i = 0; i < maxLen; i += 1) {
    const prev = prevSections[i];
    const next = nextSections[i];
    if (!prev && next) {
      mergedSections.push(next);
      continue;
    }
    if (prev && !next) {
      mergedSections.push(prev);
      continue;
    }
    const prevWords = (prev.body || '').split(/\s+/).filter(Boolean).length;
    const nextWords = (next.body || '').split(/\s+/).filter(Boolean).length;
    // Prefer the longer body; keep the better heading if one is empty
    mergedSections.push({
      heading: (next.heading && next.heading.trim()) || prev.heading,
      body: nextWords >= prevWords ? (next.body || prev.body) : (prev.body || next.body)
    });
  }

  // If expansion added extra sections beyond previous, already included via maxLen.
  // If we still have fewer than 4, keep whatever we have (expansion should have added).

  const pickLonger = (a, b) => {
    const aw = countWords(a || '');
    const bw = countWords(b || '');
    return bw > aw ? b : a;
  };

  const merged = {
    ...previous,
    title: expanded.title && countChars(expanded.title) >= MIN_TITLE_CHARS ? expanded.title : previous.title,
    seoDescription: pickLonger(previous.seoDescription, expanded.seoDescription),
    subtitle: pickLonger(previous.subtitle, expanded.subtitle),
    intro: pickLonger(previous.intro, expanded.intro),
    keyFacts: Array.isArray(expanded.keyFacts) && expanded.keyFacts.length >= (previous.keyFacts?.length || 0)
      ? expanded.keyFacts
      : (previous.keyFacts || expanded.keyFacts),
    sections: mergedSections,
    takeaway: pickLonger(previous.takeaway, expanded.takeaway),
    conclusion: pickLonger(previous.conclusion, expanded.conclusion),
    cta: expanded.cta || previous.cta,
    contentType: expanded.contentType || previous.contentType,
    trustLevel: expanded.trustLevel || previous.trustLevel,
    sources: Array.isArray(expanded.sources) && expanded.sources.length > 0
      ? expanded.sources
      : previous.sources
  };

  // Never accept an expansion that got worse overall
  if (scoreArticleSubstance(merged) < scoreArticleSubstance(previous)) {
    return previous;
  }
  return merged;
}

function buildTargetedExpansionPrompt(newsItems, previousArticle, { expansionAttempt = 1 } = {}) {
  const contentType = newsItems[0]?.contentType || previousArticle?.contentType || 'news';
  const trustLevel = detectTrustLevelForBatch(newsItems);
  const diagnosis = diagnoseArticleThinness(previousArticle);
  const sourceContext = buildPromptContext(newsItems);
  const shortList = diagnosis.shortSections.length > 0
    ? diagnosis.shortSections.map((s) => `  - "${s.heading}" (~${s.words} words — grow to 50–100+ words using source detail)`).join('\n')
    : '  - (no short sections; deepen existing bodies and intro/conclusion instead)';

  const tasks = [];
  if (diagnosis.needsMoreWords) {
    tasks.push(`- Raise total article length from ~${diagnosis.words} to OVER ${MIN_ARTICLE_WORDS} words (deficit ~${diagnosis.wordDeficit}+ words)`);
  }
  if (diagnosis.needsMoreSections) {
    tasks.push(`- Add ${diagnosis.sectionsNeeded} more section(s) so there are at least 4 total (new headings must use source material only)`);
  }
  if (diagnosis.needsLongerSections) {
    tasks.push('- Expand the short section bodies listed below — do not replace solid long sections with shorter text');
  }
  if (tasks.length === 0) {
    tasks.push(`- Deepen the draft past ${MIN_ARTICLE_WORDS} words while keeping the same structure and voice`);
  }

  return `You are ${AUTHOR_NAME} editing an existing ${BRAND_NAME} draft. This is TARGETED EXPANSION pass #${expansionAttempt} — NOT a rewrite from scratch.

${getAuthorVoiceGuide(contentType)}

GOAL: Keep what already works. Only grow the thin parts until the article is publishable.

HARD RULES:
- Do NOT throw away the draft and start over
- Keep the same title unless it is vague or broken; small polish only
- Keep the same trustLevel, contentType, and source URLs (you may only drop clearly wrong sources)
- Preserve strong section bodies that are already long enough — expand them only if you can add real source detail
- Do NOT invent facts, quotes, dates, or creators not in SOURCE MATERIAL
- Stay in a natural human voice (no corporate AI filler)

CURRENT DRAFT JSON:
${JSON.stringify({
    title: previousArticle.title,
    seoDescription: previousArticle.seoDescription,
    subtitle: previousArticle.subtitle,
    intro: previousArticle.intro,
    keyFacts: previousArticle.keyFacts,
    sections: previousArticle.sections,
    takeaway: previousArticle.takeaway,
    conclusion: previousArticle.conclusion,
    cta: previousArticle.cta,
    contentType: previousArticle.contentType || contentType,
    trustLevel: previousArticle.trustLevel || trustLevel,
    sources: previousArticle.sources
  }, null, 2)}

THINNESS DIAGNOSIS:
- Word count: ${diagnosis.words} (need ≥ ${MIN_ARTICLE_WORDS})
- Sections: ${diagnosis.sectionCount} (need ≥ 4)
- Short sections to expand:
${shortList}

TASKS FOR THIS PASS:
${tasks.join('\n')}

SOURCE MATERIAL (only facts you may add):
${sourceContext}

Return the FULL updated article as valid JSON with the same fields:
title, seoDescription, subtitle, intro, keyFacts, sections, conclusion, takeaway, cta, contentType, trustLevel, sources
contentType must be "${contentType}" and trustLevel must be "${previousArticle.trustLevel || trustLevel}".`;
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

export function buildResearchQueryHints(lead = {}) {
  const entities = extractLeadEntities(lead);
  const hints = [
    lead.title,
    'Fallout'
  ].filter(Boolean);

  if (entities.redditAuthor) {
    hints.push(`u/${entities.redditAuthor} Fallout`);
    hints.push(`${entities.redditAuthor} Fallout artist`);
  }
  for (const key of entities.projectKeys.slice(0, 3)) {
    hints.push(`Fallout ${key}`);
  }
  for (const name of entities.properNames.slice(0, 3)) {
    hints.push(`${name} Fallout`);
  }

  return [...new Set(hints.map((hint) => String(hint).trim()).filter(Boolean))].slice(0, 8);
}

function researchHostAllowed(url = '') {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (!host) return false;
    // Block obvious junk / social login walls; allow major press + Reddit + wiki + studio
    if (/doubleclick|googlesyndication|facebook\.com\/login|twitter\.com\/i\/flow/i.test(url)) return false;
    return true;
  } catch {
    return false;
  }
}

export function shapeResearchSourceItem(entry = {}, lead = {}) {
  const title = cleanText(entry.title || entry.notes || 'Related Fallout coverage');
  const link = String(entry.url || entry.link || '').trim();
  if (!link || !researchHostAllowed(link)) return null;

  return {
    title: title.slice(0, 200),
    link,
    description: cleanText(entry.notes || entry.description || title).slice(0, MAX_STORY_BODY_CHARS),
    source: entry.source || 'Web research',
    sourceTier: entry.sourceTier || 'press',
    sourceKind: 'research',
    contentType: lead.contentType || 'news',
    enrichmentRole: 'research',
    relation: entry.relation || 'background',
    publishedAt: Date.now(),
    score: 1
  };
}

/**
 * Gemini + Google Search grounding to discover topic-related URLs (not unrelated Fallout filler).
 */
export async function discoverResearchLinksViaGemini(lead = {}, { maxLinks = 6 } = {}) {
  const hints = buildResearchQueryHints(lead);
  const prompt = `You are a research assistant for a Fallout fan website.
Find useful web sources about THIS topic only, plus closely related context (same project, same creator/artist, same studio history for this story).

DO NOT return unrelated Fallout headlines (other games, random mods, remaster packages, TV news) unless they are the same story.

Lead title: ${lead.title}
Lead summary: ${String(lead.description || '').slice(0, 800)}
Search hints: ${hints.join(' | ')}

Return JSON only:
{"sources":[{"title":"...","url":"https://...","notes":"1-2 factual sentences","relation":"same-project|same-creator|background|coverage"}]}
Maximum ${maxLinks} sources. Prefer official pages, serious press on this topic, creator portfolios/socials, and relevant wiki pages.`;

  const apiKeys = getGeminiApiKeys();
  const keyOffset = advanceGeminiKeyCursor(apiKeys.length);
  const rotatedKeys = rotateApiKeys(apiKeys, keyOffset);
  // Prefer models that commonly support search grounding
  const models = rotateList([
    'gemini-2.5-flash',
    'gemini-flash-latest',
    'gemini-2.0-flash',
    ...getGeminiModelChain()
  ], 0);
  const seenModels = new Set();
  const modelChain = models.filter((model) => {
    if (seenModels.has(model)) return false;
    seenModels.add(model);
    return true;
  });

  for (const model of modelChain) {
    for (const [keyIndex, apiKey] of rotatedKeys.entries()) {
      const keyLabel = getGeminiKeyLabel((keyOffset + keyIndex) % apiKeys.length);
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              tools: [{ google_search: {} }],
              generationConfig: {
                temperature: 0.2
              }
            })
          }
        );

        if (!response.ok) {
          const text = await response.text();
          if (shouldTryNextGeminiKey(response.status, text)) continue;
          if (shouldTryNextGeminiModel(response.status, text)) break;
          continue;
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n') || '';
        const groundingChunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const fromGrounding = groundingChunks
          .map((chunk) => ({
            title: chunk?.web?.title || chunk?.web?.domain || 'Related source',
            url: chunk?.web?.uri || chunk?.web?.url || '',
            notes: chunk?.web?.title || '',
            relation: 'coverage'
          }))
          .filter((entry) => entry.url);

        let fromJson = [];
        if (text) {
          try {
            const parsed = JSON.parse(extractJsonText(text));
            fromJson = Array.isArray(parsed?.sources) ? parsed.sources : [];
          } catch {
            // Grounding-only response is fine
          }
        }

        const merged = [...fromJson, ...fromGrounding]
          .map((entry) => shapeResearchSourceItem(entry, lead))
          .filter(Boolean);

        if (merged.length > 0) {
          console.log(`Research discovery succeeded with ${keyLabel} on ${model} (${merged.length} link(s)).`);
          return merged.slice(0, maxLinks);
        }
      } catch {
        // try next key/model
      }
    }
  }

  return [];
}

async function fetchRedditAuthorRecentPosts(author = '', lead = {}, { limit = 5 } = {}) {
  if (!author) return [];
  const url = `https://www.reddit.com/user/${encodeURIComponent(author)}/submitted.json?limit=${limit}&raw_json=1`;
  try {
    const response = await fetch(url, {
      headers: getRedditJsonRequestHeaders(null)
    });
    if (!response.ok) return [];
    const payload = await response.json();
    const children = payload?.data?.children || [];
    return children
      .map((child) => child?.data)
      .filter((post) => post?.title && /fallout|fnv|fo76|fo4|wasteland|vault/i.test(`${post.title} ${post.selftext || ''}`))
      .map((post) => shapeResearchSourceItem({
        title: post.title,
        url: post.permalink ? `https://www.reddit.com${post.permalink}` : post.url,
        notes: cleanText(post.selftext || post.title).slice(0, 1200),
        relation: 'same-creator',
        source: `u/${author}`,
        sourceTier: 'community'
      }, lead))
      .filter(Boolean)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Discover + fetch related context for a thin lead (topic + same creator/project only).
 */
export async function researchTopicSources(lead = {}, { maxItems = 5 } = {}) {
  if (!lead?.title) return [];
  if (String(process.env.DEEP_RESEARCH_ENABLED || 'true').toLowerCase() === 'false') {
    console.log('Deep research disabled via DEEP_RESEARCH_ENABLED=false.');
    return [];
  }

  const entities = extractLeadEntities(lead);
  const discovered = [];
  const seenUrls = new Set([lead.link].filter(Boolean));

  const geminiLinks = await discoverResearchLinksViaGemini(lead, { maxLinks: maxItems + 2 });
  for (const item of geminiLinks) {
    if (!item.link || seenUrls.has(item.link)) continue;
    seenUrls.add(item.link);
    discovered.push(item);
  }

  if (entities.redditAuthor) {
    const authorPosts = await fetchRedditAuthorRecentPosts(entities.redditAuthor, lead, { limit: 4 });
    for (const item of authorPosts) {
      if (!item.link || seenUrls.has(item.link)) continue;
      seenUrls.add(item.link);
      discovered.push(item);
    }
  }

  const enriched = [];
  for (const item of discovered.slice(0, maxItems + 2)) {
    // Skip if clearly off-topic vs lead after discovery
    if (!isStrictlyRelatedToLead(item, lead)
      && !shareMegaEventPackage(item, lead)
      && !(entities.redditAuthor && new RegExp(entities.redditAuthor, 'i').test(`${item.title} ${item.source} ${item.description}`))
      && !entities.projectKeys.some((key) => new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(`${item.title} ${item.description}`))) {
      // Allow research notes that mention the lead title tokens
      if (!areTopicsSimilar(item.title, lead.title, { allowAnchorMatch: true })) {
        continue;
      }
    }

    let detail = item;
    try {
      detail = await enrichStoryDetail(item);
    } catch {
      detail = item;
    }
    detail = {
      ...detail,
      enrichmentRole: 'research',
      sourceKind: detail.sourceKind || 'research'
    };
    enriched.push(detail);
    if (enriched.length >= maxItems) break;
    await sleep(300);
  }

  console.log(`Research kept ${enriched.length} source(s) for topic "${lead.title}".`);
  return enriched;
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
    let detail = `HTTP ${tokenResponse.status}`;
    try {
      const errBody = await tokenResponse.json();
      // Google returns error + error_description (no secrets) — helps diagnose expired/revoked tokens
      const code = errBody.error || 'unknown_error';
      const description = errBody.error_description || errBody.error_uri || '';
      detail = description ? `${code}: ${description}` : code;
    } catch {
      // ignore parse failures
    }
    throw new Error(
      `Failed to refresh Blogger access token (${detail}). `
      + 'Usually the GOOGLE_REFRESH_TOKEN is expired/revoked, or it does not match GOOGLE_CLIENT_ID/SECRET. '
      + 'Re-run OAuth for the blog owner account and update GitHub Secrets — you can stay in Testing mode.'
    );
  }

  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) {
    throw new Error('Failed to refresh Blogger access token (no access_token in response)');
  }
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
  const maxAttempts = getSubstantiveGenerationAttempts();
  console.log(`Gemini key pool: ${apiKeys.length} configured key(s), ${apiKeys.length > 1 ? 'using round-robin across generation calls' : 'single-key mode'}.`);
  console.log(`Gemini model chain (${models.length}): ${models.join(' → ')}`);
  console.log(`Substantive generation budget: 1 draft + up to ${maxAttempts - 1} targeted expansion(s) (models × keys each call).`);

  let bestArticle = null;
  let bestScore = -1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const isExpansion = attempt > 1 && bestArticle;
    // Pass 1 = full draft. Later passes = grow the best draft in place (not rewrite from scratch).
    const prompt = isExpansion
      ? buildTargetedExpansionPrompt(newsItems, bestArticle, { expansionAttempt: attempt - 1 })
      : buildPrompt(newsItems);

    const modelOffset = (attempt - 1) % Math.max(models.length, 1);
    const keyOffset = advanceGeminiKeyCursor(apiKeys.length);

    console.log(
      `Generation pass ${attempt}/${maxAttempts}`
      + ` (start model #${modelOffset + 1}/${models.length}, key offset ${keyOffset}`
      + `${isExpansion ? ', targeted expansion' : ', initial draft'})...`
    );

    let article;
    try {
      const raw = await callGemini(prompt, { contentType, modelOffset, keyOffset });
      article = normalizeArticle(raw, newsItems);
      if (isExpansion) {
        article = normalizeArticle(mergeExpandedArticle(bestArticle, article), newsItems);
      }
    } catch (error) {
      console.warn(`Generation pass ${attempt}/${maxAttempts} failed: ${error.message}`);
      if (bestArticle) continue;
      throw error;
    }

    const words = getArticleWordCount(article);
    const score = scoreArticleSubstance(article);
    const sections = Array.isArray(article.sections) ? article.sections.length : 0;
    const diagnosis = diagnoseArticleThinness(article);
    console.log(`Pass ${attempt} result: ${words} words, ${sections} section(s), substance score ${score}.`);

    if (score > bestScore) {
      bestArticle = article;
      bestScore = score;
    }

    if (isArticleSubstantive(article)) {
      console.log(`Article is substantive on pass ${attempt}/${maxAttempts} (${words} words).`);
      return article;
    }

    if (attempt < maxAttempts) {
      console.warn(
        `Still thin after pass ${attempt}/${maxAttempts} `
        + `(${words} words, need ≥${MIN_ARTICLE_WORDS}; `
        + `${diagnosis.shortSections.length} short section(s), `
        + `${diagnosis.sectionsNeeded} section(s) to add). `
        + 'Expanding weak parts with next model/key — not rewriting from scratch...'
      );
    }
  }

  if (bestArticle) {
    console.warn(
      `All ${maxAttempts} generation pass(es) finished; best draft is still thin `
      + `(${getArticleWordCount(bestArticle)} words). Returning best attempt for publish gate.`
    );
    return bestArticle;
  }

  throw new Error('Gemini produced no usable article after all generation passes.');
}

/**
 * Call Gemini walking models first, then every key for that model, then the next model.
 * That way a strong model can succeed on a fallback key before we drop to weaker models.
 */
async function callGemini(prompt, { contentType = 'news', modelOffset = 0, keyOffset = null } = {}) {
  const apiKeys = getGeminiApiKeys();
  const resolvedKeyOffset = keyOffset == null ? advanceGeminiKeyCursor(apiKeys.length) : keyOffset;
  const rotatedKeys = rotateApiKeys(apiKeys, resolvedKeyOffset);
  const models = rotateList(getGeminiModelChain(), modelOffset);
  const errors = [];

  for (const model of models) {
    for (const [keyIndex, apiKey] of rotatedKeys.entries()) {
      const keyLabel = getGeminiKeyLabel((resolvedKeyOffset + keyIndex) % apiKeys.length);

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
          // Quota/rate on this key → try next key for same model
          if (shouldTryNextGeminiKey(response.status, text)) continue;
          // Model broken/unavailable → skip remaining keys for this model
          if (shouldTryNextGeminiModel(response.status, text)) break;
          // Hard client error on this key — still try other keys/models
          continue;
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
        .slice(0, REDDIT_CUSTOM_FEED_ITEM_LIMIT);

      if (items.length === 0) {
        console.warn('Reddit custom feed fetched successfully but no items passed quality filters.');
      } else {
        console.log(`Reddit custom feed kept ${items.length}/${REDDIT_CUSTOM_FEED_ITEM_LIMIT} item(s) after quality filters.`);
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
    if (unique.some((existing) => (
      areTopicsSimilar(existing.title, item.title)
      || shareMegaEventPackage(existing, item)
    ))) continue;
    seenTopics.add(topicKey);
    unique.push(item);
  }

  return unique.slice(0, COLLECTED_ITEM_POOL_LIMIT);
}

export function getRedditCustomFeedItemLimit() {
  return REDDIT_CUSTOM_FEED_ITEM_LIMIT;
}

export function getCollectedItemPoolLimit() {
  return COLLECTED_ITEM_POOL_LIMIT;
}

export function getRedditCustomFeedMaxRank() {
  return REDDIT_CUSTOM_FEED_MAX_RANK;
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
      console.log(`Reddit custom feed fetched ${value.length} item(s).`);
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

export function getBloggerLabels(article = {}) {
  const labels = new Set();
  const trustLevel = article.trustLevel || 'confirmed';
  const contentType = article.contentType || 'news';
  const haystack = `${article.title || ''} ${article.subtitle || ''} ${article.intro || ''}`.toLowerCase();

  if (contentType === 'mods') labels.add('Mod Spotlight');
  else if (contentType === 'community') labels.add('Community Spotlight');
  else labels.add('News');

  if (trustLevel === 'press-report') labels.add('Press Report');
  if (trustLevel === 'official' || (trustLevel === 'confirmed' && contentType === 'news')) {
    labels.add('Official');
  }

  if (/\bfallout 76\b|\bfo76\b/.test(haystack)) labels.add('Fallout 76');
  if (/\bfallout 4\b|\bfo4\b/.test(haystack)) labels.add('Fallout 4');
  if (/\bnew vegas\b|\bfnv\b/.test(haystack)) labels.add('Fallout: New Vegas');
  if (/\bfallout 5\b/.test(haystack)) labels.add('Fallout 5');
  if (/\bfallout 3\b/.test(haystack)) labels.add('Fallout 3');
  if (/\bobsidian\b/.test(haystack)) labels.add('Obsidian');
  if (/\bbethesda\b/.test(haystack)) labels.add('Bethesda');
  if (/\bremaster/.test(haystack)) labels.add('Remaster');
  if (/\btv\b|\bprime\b|\bemmy/.test(haystack)) labels.add('Fallout TV Show');

  return [...labels].slice(0, 15);
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
  const generationBatch = prioritizeGenerationBatch(assembleGenerationItems(mainStory, contentItems, localHistory, {
    maxItems: batchLimit
  }));

  if (generationBatch.length === 0) {
    console.log('No fresh Fallout stories to post; skipping generation.');
    return;
  }

  // Don't spend Gemini budget on leads that will be blocked at publish time
  if (isTopicCovered(mainStory, localHistory)) {
    console.log(`Editorial pick already covered — skipping generation: "${mainStory.title}"`);
    return;
  }

  const editorialScore = getEditorialCandidateScore(mainStory, localHistory, getContentTypeCounts(localHistory));
  const beatKeys = getFollowUpBeatKeys(mainStory);
  console.log(`Editorial pick: ${mainStory.contentType} (score ${editorialScore.toFixed(1)}) — "${mainStory.title}"`);
  if (beatKeys.length > 0) {
    console.log(`Follow-up beat(s) for fans: ${beatKeys.join(', ')}`);
  }
  console.log(
    `Related-only batch: ${generationBatch.length}/${batchLimit} ${mainStory.contentType} item(s) `
    + `(no unrelated padding).`
  );

  const enrichedItems = await enrichStories(generationBatch);
  const qualityOk = (item) => {
    if (item.enrichmentRole === 'research') {
      return Boolean(item.title && (item.description || '').length >= 40);
    }
    return meetsMinimumSourceQuality(item) && isEligibleForGeneration(item);
  };
  const leadKey = `${mainStory.link || ''}|${mainStory.title || ''}`;
  const enrichedLead = enrichedItems.find((item) => `${item.link || ''}|${item.title || ''}` === leadKey)
    || enrichedItems[0];

  if (!enrichedLead || !qualityOk(enrichedLead)) {
    // Lead may be thin RSS — still allow if we can deep-research
    if (!enrichedLead?.title) {
      console.log('Only thin-source or off-topic stories available today; skipping generation.');
      return;
    }
  }

  // Keep editorial lead first so exclusivity (etc.) is never replaced by a package rehash
  let orderedSubstantive = [
    enrichedLead,
    ...prioritizeGenerationBatch(
      enrichedItems.filter((item) => item !== enrichedLead && qualityOk(item))
    )
  ].filter(Boolean);

  // Thin lead / few related sources → research that topic and write a single-topic feature
  if (needsDeepResearch(orderedSubstantive)) {
    console.log(`Deep research mode: thin related batch for "${enrichedLead.title}" — gathering topic context (not unrelated news).`);
    const researchItems = await researchTopicSources(enrichedLead, { maxItems: 5 });

    // "Todd/Bethesda confirms…" from Reddit with zero real corroboration → do not write as news
    const studioClaim = isUncorroboratedStudioClaim(enrichedLead)
      || isObviousSatireOrFakeAnnouncement(enrichedLead)
      || (
        isCommunitySourcedItem(enrichedLead)
        && hasOfficialConfirmationSignals(enrichedLead)
      );
    const researchedBatch = [enrichedLead, ...researchItems];
    if (studioClaim && !batchHasReliableCorroboration(researchedBatch)) {
      console.warn(
        `Blogger draft skipped: uncorroborated-studio-claim `
        + `(community/meme "confirmation" with ${researchItems.length} research source(s) and no press/official backup). `
        + `"${enrichedLead.title}"`
      );
      await fs.writeFile(OUTPUT_FILE, JSON.stringify({
        generatedAt: new Date().toISOString(),
        brand: BRAND_NAME,
        publishable: false,
        publishSkippedReason: 'uncorroborated-studio-claim',
        selectedNews: researchedBatch,
        article: null
      }, null, 2));
      console.log(`Draft output saved to ${OUTPUT_FILE}`);
      return;
    }

    orderedSubstantive = [
      {
        ...enrichedLead,
        generationMode: 'feature'
      },
      ...researchItems,
      ...orderedSubstantive.slice(1).filter((item) => isStrictlyRelatedToLead(item, enrichedLead))
    ];
    // Dedupe by link
    const seen = new Set();
    orderedSubstantive = orderedSubstantive.filter((item) => {
      const key = item.link || item.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    console.log(
      `Feature batch: 1 lead + ${researchItems.length} research source(s) `
      + `(${orderedSubstantive.length} total, related-only).`
    );
  } else {
    const batchTrust = detectTrustLevelForBatch(orderedSubstantive);
    const batchMode = orderedSubstantive.length > 1 ? 'multi-angle same-story package' : 'single spotlight';
    console.log(`Generation batch: ${orderedSubstantive.length} item(s) for ${batchMode} [${batchTrust}].`);
  }

  // Final safety: never treat pure community batches as official/confirmed news
  const batchTrust = detectTrustLevelForBatch(orderedSubstantive);
  console.log(`Trust for fans: ${batchTrust} — attribution: ${resolveStoryAttribution(orderedSubstantive, batchTrust)}`);

  let article;
  let generationError = null;
  let mode = 'llm-generated';

  try {
    article = await generateArticle(orderedSubstantive);
    article = normalizeArticle(article, orderedSubstantive);
    console.log(`LLM article generated successfully (${getArticleWordCount(article)} words, ${article.contentType}, ${article.trustLevel}).`);
  } catch (error) {
    generationError = error;
    mode = 'fallback-template';
    article = normalizeArticle(buildFallbackArticle(orderedSubstantive), orderedSubstantive);
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
  } else if (isTopicCovered(mainStory, localHistory) || isDuplicateArticleTitle(article.title, localHistory)) {
    publishSkippedReason = 'already-covered';
    console.warn(`Blogger draft skipped: "${article.title}" matches a recently covered story.`);
  } else {
    try {
      bloggerPost = await createBloggerDraft(article);
      if (bloggerPost) {
        console.log('Blogger draft created successfully.');
        // Mark lead + supporting angles. Buzz is marked too so it cannot re-lead later,
        // but distinct follow-up beats remain open until written as a lead.
        const historyStories = [
          ...orderedSubstantive,
          {
            title: article.title,
            description: orderedSubstantive.map((item) => item.title).join(' · '),
            source: BRAND_NAME,
            contentType: orderedSubstantive[0]?.contentType || 'news',
            link: orderedSubstantive[0]?.link || ''
          }
        ];
        await saveStoryHistory(localHistory, historyStories, article);
      }
    } catch (error) {
      bloggerError = error;
      console.warn(`Blogger draft skipped: ${error.message}`);
    }
  }

  const finalTrust = detectTrustLevelForBatch(orderedSubstantive);
  const output = {
    generatedAt: new Date().toISOString(),
    brand: BRAND_NAME,
    featuredContentType: orderedSubstantive[0]?.contentType || 'news',
    featuredTrustLevel: finalTrust,
    attribution: resolveStoryAttribution(orderedSubstantive, finalTrust),
    selectedNews: orderedSubstantive,
    followUpBeats: getFollowUpBeatKeys(mainStory),
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
