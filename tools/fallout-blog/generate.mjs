import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'artifacts');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'latest-draft.json');

const NEWS_SOURCES = [
  { name: 'IGN', url: 'https://www.ign.com/rss/articles', weight: 1.4 },
  { name: 'GamesRadar', url: 'https://www.gamesradar.com/rss', weight: 1.2 },
  { name: 'Eurogamer', url: 'https://www.eurogamer.net/rss', weight: 1.2 },
  { name: 'VGC', url: 'https://www.videogameschronicle.com/feed/', weight: 1.1 },
  { name: 'GameSpot', url: 'https://www.gamespot.com/feeds/news/', weight: 1.1 }
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

function scoreItem(item, source) {
  const haystack = `${item.title} ${item.description}`.toLowerCase();
  const keywordHits = [
    'fallout', 'fallout 76', 'fo76', 'new vegas', 'prime video', 'bethesda', 'tv series', 'tv show', 'vault', 'game', 'release', 'update'
  ].filter((keyword) => haystack.includes(keyword));

  let score = source.weight + keywordHits.length * 1.3;

  if (haystack.includes('official') || haystack.includes('announced')) score += 1.2;
  if (haystack.includes('leak') || haystack.includes('rumor')) score -= 3;
  if (haystack.includes('trailer')) score += 0.6;
  if (haystack.includes('expansion') || haystack.includes('update')) score += 0.8;

  return score;
}

function buildPrompt(newsItems) {
  const mainStory = newsItems[0];
  const contextStories = newsItems.slice(0, 3);
  const contextText = contextStories
    .map((item) => `- ${item.title} (${item.source})${item.link ? ` — ${item.link}` : ''}`)
    .join('\n');

  return `You are writing a high-quality Fallout news article for a fan audience.\nUse the following shortlisted stories as the basis of the post:\n${contextText}\n\nWrite one polished article in English that feels like a real editorial post rather than a generic summary.\nRequirements:\n- Make the title specific, useful, and clickable without being spammy.\n- Focus on one main story and use the other items as supporting context.\n- Explain what happened, why it matters, and what fans should watch next.\n- Keep the tone casual, conversational, confident, and slightly magazine-like.\n- Avoid rumor-heavy language and do not invent facts.\n- Write a strong intro, 4-5 sections, and a short conclusion.\n- Include one compelling quote-like line in the middle of the article, framed as a takeaway or observation.\n- Include one light CTA at the end.\n- Return valid JSON only with these fields: title, intro, sections, conclusion, cta, sources.\n- Each section must have a heading and a body.\n- The article should feel like a helpful explainer and a genuinely interesting read.\n- The main story to focus on is: ${mainStory.title}`;
}

function buildFallbackArticle(newsItems) {
  const mainStory = newsItems[0];
  const supportingStories = newsItems.slice(1, 3);
  const supportText = supportingStories.map((item) => item.title).join(' and ');

  return {
    title: `Why ${mainStory.title} matters for Fallout fans`,
    intro: `The latest Fallout headlines are always worth a second look when they hint at where the franchise may be headed. This version uses the strongest available stories to explain the main development clearly and keep the bigger picture in view.`,
    sections: [
      {
        heading: 'What is happening',
        body: `The core of the story is ${mainStory.title}. That headline matters because it gives fans a clear window into the current direction of Fallout coverage, whether it is tied to a release, a franchise update, or a broader industry development.`
      },
      {
        heading: 'Why this matters',
        body: `For many fans, the value of a story like this is not just in the headline itself, but in what it suggests about the future. A single update can reshape expectations around timing, tone, and how much new Fallout content is really on the horizon.`
      },
      {
        heading: 'A useful takeaway',
        body: `The best way to think about it is simple: when the Fallout conversation starts to move, it is often because something bigger is brewing behind the scenes. That is why even a relatively quiet update can become important if it changes the mood of the fandom.`
      },
      {
        heading: 'What to watch next',
        body: `The smartest follow-up is to keep an eye on ${supportText || 'the next official update'} and the wider reaction once more details emerge. That usually gives fans a better read on what is real, what is meaningful, and what could still shift.`
      }
    ],
    conclusion: 'The clearest takeaway is that the most useful Fallout coverage is the kind that explains the story behind the headline, helping fans understand what matters now and why it deserves attention.',
    cta: 'What do you think is the most interesting part of this story?',
    sources: newsItems.slice(0, 3).map((item) => ({ title: item.title, url: item.link || 'https://fallout.fandom.com/wiki/Fallout_Wiki' }))
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
    title: article?.title || `Why the latest Fallout news matters right now`,
    intro: article?.intro || `The latest Fallout headlines are worth following because they can shape the conversation around the franchise in the days ahead.`,
    sections,
    conclusion: article?.conclusion || 'The best takeaway is to stay close to official updates and trusted coverage until more details arrive.',
    cta: article?.cta || 'What do you think is the most interesting part of this story?',
    sources: Array.isArray(article?.sources) && article.sources.length > 0
      ? article.sources
      : newsItems.slice(0, 3).map((item) => ({ title: item.title, url: item.link || 'https://fallout.fandom.com/wiki/Fallout_Wiki' }))
  };
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
          contents: [{ parts: [{ text: prompt }] }]
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
      return normalizeArticle(JSON.parse(jsonText), []);
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
          const hasRelevantKeyword = ['fallout', 'bethesda', 'prime video', 'tv show', 'new vegas', 'fo76', 'vault'].some((term) => haystack.includes(term));
          const hasNoise = ['rumor', 'leak', 'speculation'].some((term) => haystack.includes(term));
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

async function createBloggerDraft(article) {
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

  const bodySections = Array.isArray(article.sections)
    ? article.sections.map((section) => `<h3>${section.heading}</h3><p>${section.body}</p>`).join('')
    : '';
  const introHtml = article.intro ? `<p>${article.intro}</p>` : '';
  const conclusionHtml = article.conclusion ? `<p>${article.conclusion}</p>` : '';
  const ctaHtml = article.cta ? `<p><em>${article.cta}</em></p>` : '';
  const sourceList = Array.isArray(article.sources) && article.sources.length > 0
    ? `<h3>Sources</h3><ul>${article.sources.map((source) => `<li>${source.title} — <a href="${source.url}" target="_blank" rel="noopener noreferrer">${source.url}</a></li>`).join('')}</ul>`
    : '';

  const postBody = {
    kind: 'blogger#post',
    title: article.title,
    content: `
      <article>
        <h2>${article.title}</h2>
        ${introHtml}
        ${bodySections}
        ${conclusionHtml}
        ${ctaHtml}
        ${sourceList}
      </article>
    `,
    labels: ['fallout', 'automation', 'draft'],
    status: 'DRAFT'
  };

  const response = await fetch(`https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts`, {
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
  const newsItems = await fetchNewsItems();
  const prompt = buildPrompt(newsItems);

  let article;
  let generationError = null;

  try {
    article = await callGemini(prompt);
    article = normalizeArticle(article, newsItems);
    console.log('LLM article generated successfully.');
  } catch (error) {
    generationError = error;
    article = buildFallbackArticle(newsItems);
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

  const output = {
    generatedAt: new Date().toISOString(),
    selectedNews: newsItems,
    article,
    bloggerPost,
    generationError: generationError ? generationError.message : null,
    bloggerError: bloggerError ? bloggerError.message : null,
    mode: generationError ? 'fallback-template' : 'llm-generated'
  };

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Draft output saved to ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
