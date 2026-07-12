import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'artifacts');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'latest-draft.json');

const NEWS_SOURCES = [
  { name: 'IGN', url: 'https://www.ign.com/rss/articles', weight: 1.45 },
  { name: 'GamesRadar', url: 'https://www.gamesradar.com/rss', weight: 1.25 },
  { name: 'Eurogamer', url: 'https://www.eurogamer.net/rss', weight: 1.2 },
  { name: 'VGC', url: 'https://www.videogameschronicle.com/feed/', weight: 1.15 },
  { name: 'GameSpot', url: 'https://www.gamespot.com/feeds/news/', weight: 1.15 },
  { name: 'Polygon', url: 'https://www.polygon.com/rss/index.xml', weight: 1.1 },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', weight: 1.05 },
  { name: 'Bethesda Softworks', url: 'https://bethesda.net/en/rss', weight: 1.35 },
  { name: 'Bethesda Blog', url: 'https://www.bethesda.net/en/rss', weight: 1.3 },
  { name: 'Steam News', url: 'https://store.steampowered.com/feeds/news/app/22370/?l=english&cc=US', weight: 1.1 },
  { name: 'Nexus Mods', url: 'https://www.nexusmods.com/news/rss', weight: 1.05 },
  { name: 'Kotaku', url: 'https://kotaku.com/rss', weight: 1.05 },
  { name: 'Rock Paper Shotgun', url: 'https://www.rockpapershotgun.com/feed/', weight: 1.0 },
  { name: 'PC Gamer', url: 'https://www.pcgamer.com/feed/', weight: 1.0 }
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

export function getDedupLabel(item = {}) {
  return `fallout-story-${getStoryFingerprint(item).slice(0, 16)}`;
}

export function filterFreshStories(items = [], history = []) {
  const seen = new Set(history.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (typeof entry === 'object' && entry) {
      return entry.id || entry.label || entry.fingerprint || entry.value;
    }
    return '';
  }));

  return items.filter((item) => {
    const fingerprint = getStoryFingerprint(item);
    return !seen.has(fingerprint);
  });
}

function extractItems(xmlText) {
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  const items = [];
  let match;

  while ((match = itemRegex.exec(xmlText))) {
    const block = match[1];
    const titleMatch = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link><!\[CDATA\[([\s\S]*?)\]\]><\/link>|<link>([\s\S]*?)<\/link>/i);
    const descriptionMatch = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([\s\S]*?)<\/description>/i);

    const title = cleanText(titleMatch?.[1] || titleMatch?.[2] || '');
    const link = cleanText(linkMatch?.[1] || linkMatch?.[2] || '');
    const description = cleanText(descriptionMatch?.[1] || descriptionMatch?.[2] || '');

    if (title) {
      items.push({ title, link, description });
    }
  }

  return items;
}

const FALLOUT_KEYWORDS = [
  'fallout 76', 'fallout 4', 'fallout 3', 'fallout 5', 'fallout 2', 'fallout 1',
  'new vegas', 'fo76', 'prime video', 'fallout tv', 'fallout series', 'bethesda',
  'vault dweller', 'vault-tec', 'appalachia', 'wasteland', 'atomic shop',
  'expedition', 'season', 'brotherhood', 'ncr', 'institute', 'pip-boy',
  'nexus mod', 'mod showcase', 'lucy', 'the ghoul', 'vault boy'
];

const NOISE_TERMS = ['rumor', 'rumour', 'leak', 'leaked', 'speculation', 'datamine', 'insider claims', 'allegedly'];

function scoreItem(item, source) {
  const haystack = `${item.title} ${item.description}`.toLowerCase();
  const keywordHits = FALLOUT_KEYWORDS.filter((keyword) => haystack.includes(keyword));

  let score = source.weight + keywordHits.length * 1.4;

  if (haystack.includes('fallout')) score += 1.5;
  if (haystack.includes('official') || haystack.includes('announced') || haystack.includes('confirmed')) score += 1.4;
  if (haystack.includes('trailer') || haystack.includes('premiere')) score += 0.9;
  if (haystack.includes('expansion') || haystack.includes('update') || haystack.includes('patch')) score += 0.9;
  if (haystack.includes('mod') || haystack.includes('nexus')) score += 0.7;
  if (haystack.includes('season') && haystack.includes('fallout')) score += 1.0;
  if (NOISE_TERMS.some((term) => haystack.includes(term))) score -= 4;

  return score;
}

function buildPrompt(newsItems) {
  const mainStory = newsItems[0];
  const contextStories = newsItems.slice(0, 4);
  const contextText = contextStories
    .map((item, index) => `${index + 1}. ${item.title}\n   Source: ${item.source}${item.description ? `\n   Summary: ${item.description.slice(0, 220)}` : ''}${item.link ? `\n   URL: ${item.link}` : ''}`)
    .join('\n\n');

  return `You are the lead editor of a Fallout fan blog. Your readers know the games (Fallout 3, New Vegas, Fallout 4, Fallout 76), follow the Prime Video series, care about mods, and track Bethesda's direction for the franchise.

Use ONLY the stories below. Do not invent facts, dates, quotes, patch notes, or unconfirmed details.

SHORTLISTED STORIES:
${contextText}

MAIN STORY TO LEAD WITH: ${mainStory.title}

Write one polished article in English that feels like premium fan-site journalism — not a generic AI summary or press-release rewrite.

VOICE AND STYLE:
- Casual, confident, and conversational, like a magazine piece written by someone who actually plays Fallout
- Assume readers know Vault-Tec, the Brotherhood, NCR, Appalachia, and the TV show cast — explain only when a detail helps newcomers
- Connect the news to what fans care about: gameplay impact, live-service updates, lore implications, modding, TV tie-ins, and franchise momentum
- Light Wasteland flavor is fine; forced roleplay or excessive slang is not
- Lead with the most important fact. Every paragraph must earn its place — no filler

ARTICLE REQUIREMENTS:
- title: specific, useful, and clickable without being spammy or vague
- intro: 2-3 sentences that hook readers and explain why this matters today
- sections: exactly 4 or 5 sections, each with "heading" and "body" (2-4 sentences). Include:
  * what happened (clear facts)
  * why Fallout fans should care (player/community impact)
  * franchise context or lore connection where genuinely relevant
  * what to watch next (official channels, upcoming beats, community reaction)
- takeaway: one standout insight sentence (not a fake quote or attributed statement)
- conclusion: 1-2 sentences wrapping up the story
- cta: one conversational question inviting comments from the community
- sources: array of {title, url} for every story you referenced (use provided URLs)

QUALITY BAR:
- Focus on the main story; use other items as supporting context only
- Skip rumor framing entirely — if something is unconfirmed, do not present it as news
- Reference specific games, updates, or show elements when the story touches them
- Do not repeat the headline verbatim in every paragraph

Return valid JSON only with these fields: title, intro, sections, conclusion, takeaway, cta, sources`;
}

function buildFallbackArticle(newsItems) {
  const mainStory = newsItems[0];
  const supportingStories = newsItems.slice(1, 3);
  const supportText = supportingStories.map((item) => item.title).join(' and ');

  return {
    title: `${mainStory.title}: what it means for the Wasteland right now`,
    intro: `Fallout fans have no shortage of headlines to track, but some stories cut through the noise more than others. ${mainStory.title} is one of those — worth reading closely whether you mainline Fallout 76, replay New Vegas, or follow the Prime Video series.`,
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
    sources: newsItems.slice(0, 4).map((item) => ({ title: item.title, url: item.link || 'https://fallout.fandom.com/wiki/Fallout_Wiki' }))
  };
}

function normalizeArticle(article, newsItems) {
  const sections = Array.isArray(article?.sections) && article.sections.length > 0
    ? article.sections
    : [
        { heading: 'What is happening', body: 'The main story here is worth following because it gives fans a clearer sense of where the franchise is heading.' },
        { heading: 'Why fans should care', body: 'This matters because it affects expectations around upcoming Fallout content and fan discussion.' },
        { heading: 'What to watch next', body: 'The next step is to follow official updates and the broader conversation around the topic.' }
      ];

  return {
    title: article?.title || 'Why the latest Fallout news matters right now',
    intro: article?.intro || 'The latest Fallout headlines are worth following because they can shape the conversation around the franchise in the days ahead.',
    sections,
    takeaway: article?.takeaway || 'The best Fallout coverage explains not just what happened, but why players and fans should care.',
    conclusion: article?.conclusion || 'The best takeaway is to stay close to official updates and trusted coverage until more details arrive.',
    cta: article?.cta || 'What do you think is the most interesting part of this story?',
    sources: Array.isArray(article?.sources) && article.sources.length > 0
      ? article.sources
      : newsItems.slice(0, 4).map((item) => ({ title: item.title, url: item.link || 'https://fallout.fandom.com/wiki/Fallout_Wiki' }))
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildArticleHtml(article) {
  const introHtml = article.intro ? `<p>${escapeHtml(article.intro)}</p>` : '';
  const sectionsHtml = Array.isArray(article.sections)
    ? article.sections.map((section) => `<h3>${escapeHtml(section.heading)}</h3><p>${escapeHtml(section.body)}</p>`).join('')
    : '';
  const takeawayHtml = article.takeaway
    ? `<blockquote><p><strong>Takeaway:</strong> ${escapeHtml(article.takeaway)}</p></blockquote>`
    : '';
  const conclusionHtml = article.conclusion ? `<p>${escapeHtml(article.conclusion)}</p>` : '';
  const ctaHtml = article.cta ? `<p><em>${escapeHtml(article.cta)}</em></p>` : '';
  const sourcesHtml = Array.isArray(article.sources) && article.sources.length > 0
    ? `<hr><h3>Sources</h3><ul>${article.sources.map((source) => `<li><a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a></li>`).join('')}</ul>`
    : '';

  return `<article>${introHtml}${sectionsHtml}${takeawayHtml}${conclusionHtml}${ctaHtml}${sourcesHtml}</article>`;
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

async function callGemini(prompt, newsItems = []) {
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
            temperature: 0.75,
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
      return normalizeArticle(JSON.parse(jsonText), newsItems);
    } catch (error) {
      errors.push(`${model}: ${error.message}`);
    }
  }

  throw new Error(errors.join(' | '));
}

async function fetchNewsItems() {
  const collected = [];

  for (const source of NEWS_SOURCES) {
    try {
      const response = await fetch(source.url);
      if (!response.ok) continue;
      const xml = await response.text();
      const items = extractItems(xml);
      const relevant = items
        .filter((item) => {
          const haystack = `${item.title} ${item.description}`.toLowerCase();
          const hasRelevantKeyword = FALLOUT_KEYWORDS.some((term) => haystack.includes(term)) || haystack.includes('fallout');
          const hasNoise = NOISE_TERMS.some((term) => haystack.includes(term));
          return hasRelevantKeyword && !hasNoise;
        })
        .map((item) => ({ ...item, source: source.name, score: scoreItem(item, source) }))
        .sort((a, b) => b.score - a.score);

      collected.push(...relevant.slice(0, 3));
    } catch {
      // Ignore individual feed failures and continue.
    }
  }

  const unique = [];
  const seen = new Set();
  for (const item of collected.sort((a, b) => b.score - a.score)) {
    const key = `${item.title}-${item.source}`.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }

  return unique.slice(0, 6);
}

async function findExistingBloggerPost(blogId, accessToken, label) {
  const response = await fetch(`https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts?labels=${encodeURIComponent(label)}&maxResults=10`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return Array.isArray(data?.items) ? data.items[0] || null : null;
}

async function createBloggerDraft(article, newsItems = []) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const blogId = process.env.BLOGGER_BLOG_ID;

  if (!clientId || !clientSecret || !refreshToken || !blogId) {
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
  const accessToken = tokenData.access_token;

  const mainStory = Array.isArray(newsItems) && newsItems.length > 0 ? newsItems[0] : null;
  const dedupLabel = mainStory ? getDedupLabel(mainStory) : null;
  if (dedupLabel) {
    const existingPost = await findExistingBloggerPost(blogId, accessToken, dedupLabel);
    if (existingPost) {
      throw new Error('Duplicate story already exists in Blogger');
    }
  }

  const postBody = {
    kind: 'blogger#post',
    title: article.title,
    content: buildArticleHtml(article),
    labels: ['fallout', 'automation', 'auto-generated', dedupLabel].filter(Boolean)
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

async function loadRecentStoryHistory() {
  try {
    const raw = await fs.readFile(OUTPUT_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.selectedNews) ? parsed.selectedNews.map((item) => getStoryFingerprint(item)) : [];
  } catch {
    return [];
  }
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const newsItems = await fetchNewsItems();
  const previousStoryHistory = await loadRecentStoryHistory();
  const freshNewsItems = filterFreshStories(newsItems, previousStoryHistory);

  if (freshNewsItems.length === 0) {
    console.log('No fresh Fallout stories to post; skipping generation.');
    return;
  }

  const prompt = buildPrompt(freshNewsItems);

  let article;
  let generationError = null;

  try {
    article = await callGemini(prompt, freshNewsItems);
    article = normalizeArticle(article, freshNewsItems);
    console.log('LLM article generated successfully.');
  } catch (error) {
    generationError = error;
    article = buildFallbackArticle(freshNewsItems);
    console.warn(`LLM generation failed, using fallback article: ${error.message}`);
  }

  let bloggerPost = null;
  let bloggerError = null;

  try {
    bloggerPost = await createBloggerDraft(article, freshNewsItems);
    if (bloggerPost) {
      console.log('Blogger draft created successfully.');
    }
  } catch (error) {
    bloggerError = error;
    console.warn(`Blogger draft skipped: ${error.message}`);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    selectedNews: freshNewsItems,
    article,
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
