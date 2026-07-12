import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'artifacts');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'latest-draft.json');

const sources = [
  'https://www.ign.com/rss/articles',
  'https://www.gamesradar.com/rss',
  'https://www.eurogamer.net/rss',
  'https://www.videogameschronicle.com/feed/'
];

function buildPrompt(headlines) {
  return `You are writing a casual, conversational Fallout news article for a fandom blog. \nWrite one polished article draft in English.\nUse the following headlines as the main source material:\n${headlines.join('\n')}\n\nRequirements:\n- Keep the tone balanced, casual, and readable.\n- Avoid rumor-heavy language.\n- Focus on what matters to Fallout fans.\n- Write a clear title, a short intro, 3-5 short sections, and a short conclusion.\n- Include a light CTA such as "What do you think about this?"\n- Do not invent facts.\nReturn JSON with fields: title, intro, sections, conclusion, cta, sources.`;
}

function buildFallbackArticle(headlines) {
  const topic = headlines[0] || 'the latest Fallout news';
  const safeHeadlines = headlines.slice(0, 3);

  return {
    title: `What Fallout fans should know about ${topic}`,
    intro: `Recent Fallout coverage has kept fans talking, and there is plenty to follow when a new update, release, or announcement lands. This draft keeps the focus on the developments that matter most without leaning into rumor or speculation.`,
    sections: safeHeadlines.map((headline, index) => ({
      heading: `Point ${index + 1}: ${headline}`,
      body: `This story is worth watching because it touches on the part of the Fallout community that is most likely to care right now. A good follow-up is to read the original report and compare it with any official clarification that follows.`
    })),
    conclusion: 'The best approach is to follow the official updates closely and keep an eye on how the wider Fallout community reacts, especially when a story has real implications for future releases or content.',
    cta: 'What do you think about this latest development?',
    sources: safeHeadlines.map((headline) => ({ title: headline, url: 'https://fallout.fandom.com/wiki/Fallout_Wiki' }))
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
  const tertiaryModels = parseModelList(process.env.GEMINI_MODEL_FALLBACK_2 || 'gemini-2.0-flash-exp');
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
      return JSON.parse(jsonText);
    } catch (error) {
      errors.push(`${model}: ${error.message}`);
    }
  }

  throw new Error(errors.join(' | '));
}

async function fetchHeadlines() {
  const results = [];

  for (const source of sources) {
    try {
      const response = await fetch(source);
      if (!response.ok) continue;
      const text = await response.text();
      const matches = [...text.matchAll(/<title>(.*?)<\/title>/gis)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
      results.push(...matches.slice(0, 3));
    } catch {
      // Ignore feed failures and continue.
    }
  }

  return results.slice(0, 8);
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

  const postBody = {
    kind: 'blogger#post',
    title: article.title,
    content: `
      <h2>${article.title}</h2>
      <p>${article.intro}</p>
      ${article.sections.map((section) => `<h3>${section.heading}</h3><p>${section.body}</p>`).join('')}
      <p>${article.conclusion}</p>
      <p><strong>${article.cta}</strong></p>
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
  const headlines = await fetchHeadlines();
  const prompt = buildPrompt(headlines);

  let article;
  let generationError = null;

  try {
    article = await callGemini(prompt);
    console.log('LLM article generated successfully.');
  } catch (error) {
    generationError = error;
    article = buildFallbackArticle(headlines);
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
    sourceHeadlines: headlines,
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
