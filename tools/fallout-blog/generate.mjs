import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'artifacts');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'latest-draft.json');
const HISTORY_FILE = path.join(ROOT, 'data', 'story-history.json');
const HISTORY_RETENTION_DAYS = 21;
const MIN_DESCRIPTION_LENGTH = 80;
const MIN_ARTICLE_WORDS = 650;
const BRAND_NAME = 'Fallout Hub';

const CONTENT_TYPES = ['news', 'mods', 'community'];

const CONTENT_SOURCES = [
  { name: 'Bethesda Softworks', url: 'https://bethesda.net/en/rss', weight: 1.65, category: 'news', tier: 'official' },
  { name: 'IGN', url: 'https://www.ign.com/rss/articles', weight: 1.45, category: 'news', tier: 'press' },
  { name: 'VGC', url: 'https://www.videogameschronicle.com/feed/', weight: 1.35, category: 'news', tier: 'press' },
  { name: 'GamesRadar', url: 'https://www.gamesradar.com/rss', weight: 1.3, category: 'news', tier: 'press' },
  { name: 'Eurogamer', url: 'https://www.eurogamer.net/rss', weight: 1.25, category: 'news', tier: 'press' },
  { name: 'GameSpot', url: 'https://www.gamespot.com/feeds/news/', weight: 1.2, category: 'news', tier: 'press' },
  { name: 'Polygon', url: 'https://www.polygon.com/rss/index.xml', weight: 1.15, category: 'news', tier: 'press' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', weight: 1.1, category: 'news', tier: 'press' },
  { name: 'Steam — Fallout 76', url: 'https://store.steampowered.com/feeds/news/app/22370/?l=english&cc=US', weight: 1.2, category: 'news', tier: 'official' },
  { name: 'Nexus Mods', url: 'https://www.nexusmods.com/news/rss', weight: 1.35, category: 'mods', tier: 'community' },
  { name: 'r/FalloutMods', url: 'https://www.reddit.com/r/FalloutMods/.rss', weight: 1.3, category: 'mods', tier: 'community' },
  { name: 'r/fo4', url: 'https://www.reddit.com/r/fo4/.rss', weight: 1.15, category: 'mods', tier: 'community' },
  { name: 'r/fallout', url: 'https://www.reddit.com/r/fallout/.rss', weight: 1.25, category: 'community', tier: 'community' },
  { name: 'r/fo76', url: 'https://www.reddit.com/r/fo76/.rss', weight: 1.2, category: 'community', tier: 'community' },
  { name: 'r/falloutlore', url: 'https://www.reddit.com/r/falloutlore/.rss', weight: 1.1, category: 'community', tier: 'community' },
  { name: 'Kotaku', url: 'https://kotaku.com/rss', weight: 1.05, category: 'news', tier: 'press' },
  { name: 'Rock Paper Shotgun', url: 'https://www.rockpapershotgun.com/feed/', weight: 1.0, category: 'news', tier: 'press' },
  { name: 'PC Gamer', url: 'https://www.pcgamer.com/feed/', weight: 1.0, category: 'news', tier: 'press' }
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

export function getArticleWordCount(article = {}) {
  const chunks = [
    article.subtitle,
    article.intro,
    article.conclusion,
    article.takeaway,
    ...(Array.isArray(article.keyFacts) ? article.keyFacts : []),
    ...(Array.isArray(article.sections) ? article.sections.map((section) => `${section.heading} ${section.body}`) : [])
  ];
  return chunks
    .filter(Boolean)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean)
    .length;
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

  if (item.enriched && descriptionLength >= MIN_DESCRIPTION_LENGTH) return true;
  if (item.contentType === 'community' || item.contentType === 'mods') {
    return descriptionLength >= 40 || titleLength >= 30;
  }
  return descriptionLength >= MIN_DESCRIPTION_LENGTH;
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
    mainStory = eligible.find((item) => item.contentType === contentType);
    if (mainStory) break;
  }

  mainStory = mainStory || eligible[0];
  const mainTopic = getStoryTopicKey(mainStory);
  const supporting = eligible.filter((item) => getStoryTopicKey(item) !== mainTopic).slice(0, 4);

  return [mainStory, ...supporting];
}

export function selectStoriesForGeneration(candidates = [], historyEntries = [], { storyLimit = 5 } = {}) {
  const coveredFingerprints = new Set();
  const coveredTopics = new Set();

  for (const entry of historyEntries) {
    if (entry.fingerprint) coveredFingerprints.add(entry.fingerprint);
    if (entry.topicFingerprint) coveredTopics.add(entry.topicFingerprint);
    if (typeof entry === 'string') coveredFingerprints.add(entry);
  }

  const eligible = candidates
    .filter((item) => {
      const fingerprint = getStoryKey(item);
      const topicFingerprint = getStoryTopicKey(item);
      if (coveredFingerprints.has(fingerprint) || coveredTopics.has(topicFingerprint)) return false;

      const descriptionLength = (item.description || '').length;
      if (!meetsMinimumSourceQuality(item)) return false;

      if (item.publishedAt && item.publishedAt < Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000) {
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

    const title = cleanText(titleMatch?.[1] || titleMatch?.[2] || '');
    const link = cleanText(linkMatch?.[1] || linkMatch?.[2] || '');
    const description = cleanText(descriptionMatch?.[1] || descriptionMatch?.[2] || '');
    const publishedAt = parseRssDate(pubDateMatch?.[1]);

    if (title) {
      items.push({ title, link, description, publishedAt });
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
  'The Verge', 'PC Gamer', 'Rock Paper Shotgun', 'Video Games Chronicle'
];

function scoreItem(item, source) {
  const haystack = `${item.title} ${item.description}`.toLowerCase();
  const keywordHits = FALLOUT_KEYWORDS.filter((keyword) => haystack.includes(keyword));
  const contentType = detectContentType(item, source);

  let score = source.weight + keywordHits.length * 1.4;

  score += freshnessBonus(item.publishedAt);
  score += Math.min((item.description || '').length / 180, 1.8);

  if (source.tier === 'official') score += 1.8;
  if (haystack.includes('fallout')) score += 1.5;
  if (haystack.includes('official') || haystack.includes('announced') || haystack.includes('confirmed')) score += 1.4;
  if (haystack.includes('trailer') || haystack.includes('premiere')) score += 0.9;
  if (haystack.includes('expansion') || haystack.includes('update') || haystack.includes('patch')) score += 0.9;
  if (contentType === 'mods' && (haystack.includes('release') || haystack.includes('update') || haystack.includes('overhaul'))) score += 1.2;
  if (contentType === 'community' && (haystack.includes('cosplay') || haystack.includes('[oc]') || haystack.includes('fan art'))) score += 1.3;
  if (haystack.includes('season') && haystack.includes('fallout')) score += 1.0;
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
    sources: ensurePrimarySource(article.sources, mainStory)
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

function buildPrompt(newsItems, { expansion = false, previousArticle = null } = {}) {
  const mainStory = newsItems[0];
  const contentType = mainStory.contentType || 'news';
  const trustLevel = mainStory.trustLevel || detectTrustLevel(mainStory, {
    tier: mainStory.sourceTier,
    category: contentType
  });
  const reportingOutlet = resolveReportingOutlet(mainStory);
  const contextStories = newsItems.slice(0, 5);
  const contextText = contextStories
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

  const expansionNote = expansion
    ? `\nIMPORTANT: The previous draft was too short and too generic. Rewrite it as a substantially deeper article.
Previous draft title: ${previousArticle?.title || 'unknown'}
Previous word count: ${getArticleWordCount(previousArticle || {})}
You must exceed ${MIN_ARTICLE_WORDS} words and include more concrete detail from the summaries below.\n`
    : '';

  return `${expansionNote}You are the lead editor of ${BRAND_NAME}, a Fallout fan blog built to be a trusted daily destination — accurate, useful, and worth sharing.

Your mission: help Fallout fans quickly understand what happened (or what is worth seeing), why it matters, and where to look next. Readers should feel confident sharing ${BRAND_NAME} posts because the facts are sourced, the framing is honest, and the value is clear.

${getContentTypeGuidance(contentType, trustLevel)}

TRUST AND EDITORIAL STANDARDS:
- Use ONLY the material below. Never invent facts, dates, quotes, patch notes, or creator names.
- trustLevel for this post: ${trustLevel} (${getTrustLabel(trustLevel)})
- Primary reporting outlet to attribute: ${reportingOutlet}
- If trustLevel is "press-report", every section making a claim must attribute it to ${reportingOutlet} or "the report"
- If trustLevel is "confirmed", write about established facts but still cite sources
- If trustLevel is "community-highlight", make clear this is fan-created content
- If a detail is missing from the sources, say "details are still limited" instead of guessing
- Include a keyFacts array with 3-5 bullet points a busy reader can scan in 10 seconds

SHORTLISTED STORIES:
${contextText}

MAIN STORY TO LEAD WITH: ${mainStory.title}

Write one polished article in English that fans would genuinely click, read, and share.

VOICE AND STYLE:
- Confident, warm, and knowledgeable — like a trusted fan-site editor, not a content farm
- Assume readers know Fallout, but explain enough context that newcomers still get value
- Lead with the single most compelling fact or hook, with honest framing about what is confirmed vs reported
- Every paragraph must deliver insight, not filler
- Make the post feel organically shareable: specific, useful, and clearly worth 3 minutes

ARTICLE REQUIREMENTS:
- title: specific and click-worthy without clickbait — make fans want to know more
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

Return valid JSON only with these fields: title, subtitle, intro, keyFacts, sections, conclusion, takeaway, cta, contentType, trustLevel, sources`;
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

  return `<article>${badgeHtml}${disclaimerHtml}${subtitleHtml}${introHtml}${keyFactsHtml}${sectionsHtml}${takeawayHtml}${conclusionHtml}${ctaHtml}${sourcesHtml}${editorialHtml}</article>`;
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

async function enrichStoryDetail(item) {
  if (!item.link) return item;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(item.link, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'FalloutBlogBot/1.0 (+https://github.com/)',
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

    if (excerpt.length > (item.description || '').length) {
      return { ...item, description: excerpt.slice(0, 1200), enriched: true };
    }
  } catch {
    // Ignore enrichment failures and keep RSS summary.
  }

  return item;
}

async function enrichStories(stories) {
  const enriched = [];
  for (const story of stories.slice(0, 3)) {
    enriched.push(await enrichStoryDetail(story));
  }
  return [...enriched, ...stories.slice(3)];
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

async function saveStoryHistory(existingEntries, selectedStories) {
  const now = Date.now();
  const newEntries = selectedStories.map((item) => ({
    fingerprint: getStoryKey(item),
    topicFingerprint: getStoryTopicKey(item),
    contentType: item.contentType || 'news',
    title: item.title,
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

async function generateArticle(newsItems) {
  const prompt = buildPrompt(newsItems);
  let article = normalizeArticle(await callGemini(prompt), newsItems);

  if (!isArticleSubstantive(article)) {
    console.warn(`Article too thin (${getArticleWordCount(article)} words). Requesting expanded version...`);
    const expansionPrompt = buildPrompt(newsItems, { expansion: true, previousArticle: article });
    article = normalizeArticle(await callGemini(expansionPrompt), newsItems);
  }

  return article;
}

async function callGemini(prompt) {
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
            temperature: 0.8,
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

async function fetchFeed(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': `${BRAND_NAME}Bot/1.0 (daily Fallout editorial automation)`,
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
    }
  });
  if (!response.ok) {
    throw new Error(`Feed request failed (${response.status})`);
  }
  return response.text();
}

function isRelevantFalloutItem(item, source) {
  const haystack = `${item.title} ${item.description}`.toLowerCase();
  const hasRelevantKeyword = FALLOUT_KEYWORDS.some((term) => haystack.includes(term)) || haystack.includes('fallout');
  const hasNoise = NOISE_TERMS.some((term) => haystack.includes(term));

  if (source.category === 'community' || source.category === 'mods') {
    return !hasNoise;
  }

  return hasRelevantKeyword && !hasNoise;
}

async function fetchContentItems() {
  const collected = [];

  for (const source of CONTENT_SOURCES) {
    try {
      const xml = await fetchFeed(source.url);
      const items = extractFeedItems(xml);
      const relevant = items
        .filter((item) => isRelevantFalloutItem(item, source))
        .map((item) => {
          const contentType = detectContentType(item, source);
          const trustLevel = detectTrustLevel(item, source);
          return {
            ...item,
            source: source.name,
            sourceTier: source.tier,
            contentType,
            trustLevel,
            score: scoreItem({ ...item, contentType }, source)
          };
        })
        .sort((a, b) => b.score - a.score);

      collected.push(...relevant.slice(0, 4));
    } catch {
      // Ignore individual feed failures and continue.
    }
  }

  const unique = [];
  const seenTopics = new Set();
  for (const item of collected.sort((a, b) => b.score - a.score)) {
    const topicKey = getStoryTopicKey(item);
    if (!seenTopics.has(topicKey)) {
      seenTopics.add(topicKey);
      unique.push(item);
    }
  }

  return unique.slice(0, 18);
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
    content: buildArticleHtml(article)
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
  const contentItems = await fetchContentItems();
  const localHistory = await loadStoryHistory();
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

  try {
    article = await generateArticle(substantiveItems);
    article = normalizeArticle(article, substantiveItems);
    console.log(`LLM article generated successfully (${getArticleWordCount(article)} words, ${article.contentType}, ${article.trustLevel}).`);
  } catch (error) {
    generationError = error;
    article = normalizeArticle(buildFallbackArticle(substantiveItems), substantiveItems);
    console.warn(`LLM generation failed, using fallback article: ${error.message}`);
  }

  let bloggerPost = null;
  let bloggerError = null;

  try {
    bloggerPost = await createBloggerDraft(article);
    if (bloggerPost) {
      console.log('Blogger draft created successfully.');
    }
  } catch (error) {
    bloggerError = error;
    console.warn(`Blogger draft skipped: ${error.message}`);
  }

  await saveStoryHistory(localHistory, substantiveItems.slice(0, 1));

  const output = {
    generatedAt: new Date().toISOString(),
    brand: BRAND_NAME,
    featuredContentType: substantiveItems[0]?.contentType || 'news',
    featuredTrustLevel: substantiveItems[0]?.trustLevel || 'confirmed',
    selectedNews: substantiveItems,
    article,
    articleWordCount: getArticleWordCount(article),
    isSubstantive: isArticleSubstantive(article),
    bloggerPost,
    generationError: generationError ? generationError.message : null,
    bloggerError: bloggerError ? bloggerError.message : null,
    mode: generationError ? 'fallback-template' : 'llm-generated'
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
