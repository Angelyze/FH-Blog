import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areTopicsSimilar,
  assembleGenerationItems,
  buildArticleHtml,
  buildStorySummaryForPrompt,
  extractArticleBodyText,
  countChars,
  countWords,
  detectContentType,
  detectTrustLevel,
  ensureSeoDescription,
  ensureTrustKeyFacts,
  extractFeedItems,
  freshnessBonus,
  getArticleWordCount,
  getBloggerInsertUrl,
  getStoryFingerprint,
  getStoryTopicFingerprint,
  getStoryTopicKey,
  hasFalloutFocus,
  hasFalloutTitleMention,
  isEligibleForGeneration,
  isRelevantFalloutItem,
  getTitleValidationIssue,
  formatFeedWarnings,
  getRedditFetchStrategies,
  getRedditUserAgent,
  hasRedditOAuthCredentials,
  getUnhealthyFeedSources,
  isFeedTitleExcluded,
  isPersistentlyBlockedFeedError,
  isRateLimitedFeedError,
  resolveFeedItemLink,
  shouldSkipFeedSource,
  isArticleSubstantive,
  isDuplicateArticleTitle,
  isTopicCovered,
  isPublishableArticle,
  ensureArticleTitle,
  isTitleLengthValid,
  trimTitleToMaxChars,
  compareCandidatePriority,
  getAdjustedCandidateScore,
  getEditorialCandidateScore,
  getGeminiApiKeys,
  getGeminiModelChain,
  getSourceDiversityAdjustment,
  getRedditPostJsonUrl,
  isGeminiQuotaError,
  rotateApiKeys,
  isRedditPostLink,
  parseRedditPostDetailPayload,
  meetsEngagementThreshold,
  meetsMinimumSourceQuality,
  passesRssRedditQualityGate,
  passesCommunityQualityGate,
  parseRedditListing,
  parseRedditRssFeed,
  parseRssDate,
  pickFeaturedStory,
  recordFeedHealthResult,
  resolveArticleSources,
  resolveReportingOutlet,
  selectStoriesForGeneration,
  trimToCharCount
} from './generate.mjs';

test('selectStoriesForGeneration skips previously covered topics across sources', () => {
  const item = { source: 'IGN', title: 'Fallout 76 gets a big update', link: 'https://example.com/1', contentType: 'news', description: 'Bethesda has rolled out a major Fallout 76 update with new seasonal content, balance changes, and quality-of-life fixes for players.' };
  const history = [{ topicFingerprint: getStoryTopicKey(item), coveredAt: Date.now() }];

  const items = [
    item,
    { source: 'GamesRadar', title: 'Fallout 76 gets a big update', link: 'https://example.com/2', contentType: 'news', description: 'Another outlet reports the same Fallout 76 update with additional commentary from the community and official channels.' },
    { source: 'Eurogamer', title: 'Bethesda teases more Fallout news', link: 'https://example.com/3', contentType: 'news', description: 'Bethesda has hinted at more Fallout announcements coming later this year, including possible updates for Fallout 76 and broader franchise plans.' }
  ];

  const fresh = selectStoriesForGeneration(items, history);

  assert.deepEqual(fresh.map((story) => story.title), ['Bethesda teases more Fallout news']);
});

test('selectStoriesForGeneration rejects thin RSS summaries', () => {
  const items = [
    { source: 'IGN', title: 'Fallout update', link: 'https://example.com/thin', contentType: 'news', description: 'Short blurb.' },
    { source: 'Eurogamer', title: 'Fallout 76 season launch brings new rewards', link: 'https://example.com/rich', contentType: 'news', description: 'The new Fallout 76 season introduces fresh rewards, daily challenges, quality-of-life improvements, and a revised progression track for returning players.' }
  ];

  const fresh = selectStoriesForGeneration(items, []);

  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].title, 'Fallout 76 season launch brings new rewards');
});

test('assembleGenerationItems never mixes content types in one generation batch', () => {
  const mainStory = {
    source: 'IGN',
    title: 'Fallout Season 2 earns nine Emmy nods',
    link: 'https://example.com/emmys',
    contentType: 'news',
    description: 'The Fallout Prime Video series picked up nine Emmy nominations across craft and performance categories this week, giving the adaptation another high-profile awards-season moment.'
  };

  const candidates = [
    mainStory,
    {
      source: 'Aftermath',
      title: 'Fallout studio Obsidian defends its RPG DNA after Xbox shifts',
      link: 'https://example.com/obsidian',
      contentType: 'news',
      sourceTier: 'press',
      description: 'Aftermath reports on Obsidian leadership messaging after recent Xbox portfolio changes and what it means for Fallout and RPG fans watching the studio closely.'
    },
    {
      source: 'r/FalloutMods',
      title: 'New Vegas assassin faction mod released',
      link: 'https://example.com/mod',
      contentType: 'mods',
      description: 'A New Vegas mod adds a Dark Brotherhood-style assassin faction with new quests, contracts, and stealth-focused progression for returning players.'
    }
  ];

  const batch = assembleGenerationItems(mainStory, candidates, [], { maxItems: 5 });
  assert.equal(batch.length, 2);
  assert.ok(batch.every((item) => item.contentType === 'news'));
  assert.equal(batch[0].title, mainStory.title);
});

test('assembleGenerationItems builds a mod roundup from same-type candidates only', () => {
  const mainStory = {
    source: 'r/FalloutMods',
    title: 'New Vegas assassin faction mod released',
    link: 'https://example.com/mod-1',
    contentType: 'mods',
    description: 'A New Vegas mod adds a Dark Brotherhood-style assassin faction with new quests and contracts.'
  };

  const candidates = [
    mainStory,
    {
      source: 'r/fo4',
      title: 'Fallout 4 settlement overhaul mod',
      link: 'https://example.com/mod-2',
      contentType: 'mods',
      description: 'A settlement overhaul mod for Fallout 4 adds new build pieces, lighting presets, and clutter packs.'
    },
    {
      source: 'IGN',
      title: 'Xbox portfolio reset continues',
      link: 'https://example.com/news',
      contentType: 'news',
      description: 'Industry coverage of Xbox portfolio changes across first-party studios.'
    },
    {
      source: 'r/FalloutMods',
      title: 'FNV weapon pack expansion',
      link: 'https://example.com/mod-3',
      contentType: 'mods',
      description: 'A weapon pack expansion for Fallout New Vegas adds lore-friendly firearms and custom animations.'
    }
  ];

  const batch = assembleGenerationItems(mainStory, candidates, [], { maxItems: 5 });
  assert.equal(batch.length, 3);
  assert.equal(batch[0].title, mainStory.title);
  assert.ok(batch.every((item) => item.contentType === 'mods'));
});

test('pickFeaturedStory prefers the strongest candidate even if that type was posted recently', () => {
  const history = Array.from({ length: 4 }).map(() => ({
    contentType: 'news',
    coveredAt: Date.now() - (24 * 60 * 60 * 1000)
  }));

  const items = [
    {
      source: 'Steam — Fallout 76',
      sourceTier: 'official',
      contentType: 'news',
      score: 22,
      title: 'Fallout 76 season update is live with new rewards',
      link: 'https://example.com/season',
      description: 'Bethesda has launched a new Fallout 76 season with fresh daily challenges, seasonal rewards, quality-of-life fixes, and a revised progression track for returning players.'
    },
    {
      source: 'r/FalloutMods',
      contentType: 'mods',
      score: 9,
      title: 'Small texture tweak mod',
      link: 'https://example.com/mod',
      description: 'A minor texture tweak mod for Fallout 4 adjusts a handful of weapon skins for players who want a subtle visual refresh.'
    }
  ];

  const [featured] = pickFeaturedStory(items, history);
  assert.equal(featured.contentType, 'news');
});

test('pickFeaturedStory can still favor an underused type when scores are close', () => {
  const items = [
    { source: 'IGN', title: 'Fallout 76 patch notes arrive', link: 'https://example.com/news', contentType: 'news', description: 'Bethesda has published new Fallout 76 patch notes with balance updates, bug fixes, seasonal content, and quality-of-life improvements for players returning this week.' },
    { source: 'r/FalloutMods', title: 'New Appalachia overhaul mod released', link: 'https://example.com/mod', contentType: 'mods', description: 'A major visual overhaul mod for Fallout 76 has released on Nexus with updated textures, lighting, weather tweaks, and optional performance presets for PC players.' },
    { source: 'r/fallout', title: 'Incredible Vault Dweller cosplay from Dragon Con', link: 'https://example.com/cosplay', contentType: 'community', description: 'A fan shared an detailed Vault Dweller cosplay build with handmade pip-boy, weathered armor, and screen-accurate props from the Fallout TV series.' }
  ];

  const history = Array.from({ length: 4 }).map(() => ({
    contentType: 'news',
    coveredAt: Date.now() - (24 * 60 * 60 * 1000)
  }));

  const featured = pickFeaturedStory(items, history);

  assert.equal(featured[0].contentType, 'mods');
});

test('getEditorialCandidateScore gives underused content types a small boost', () => {
  const typeCounts = { news: 4, mods: 0, community: 0 };
  const newsItem = { contentType: 'news', score: 10 };
  const modItem = { contentType: 'mods', score: 10 };

  assert.ok(
    getEditorialCandidateScore(modItem, [], typeCounts)
    > getEditorialCandidateScore(newsItem, [], typeCounts)
  );
});

test('hasFalloutFocus rejects comparison pieces led by another franchise', () => {
  assert.equal(
    hasFalloutFocus({
      title: 'Diablo 4 Update Will Drown You In Mythics',
      description: 'GameSpot compares the loot changes to Fallout 76 seasons and Xbox RPG strategy shifts.'
    }),
    false
  );
});

test('hasFalloutFocus accepts stories with Fallout in the headline', () => {
  assert.equal(
    hasFalloutFocus({
      title: 'Fallout 5, The Elder Scrolls 6, Blade, and More: What is going on at Bethesda?',
      description: 'IGN reports on sweeping Xbox layoffs across Bethesda studios.'
    }),
    true
  );
});

test('hasFalloutFocus accepts Fallout-led stories without a competing franchise title', () => {
  assert.equal(
    hasFalloutFocus({
      title: 'New Fallout Game Is New Focus For Obsidian Entertainment - Report',
      description: 'Bloomberg reports Obsidian is shifting priorities toward Fallout.'
    }),
    true
  );
});

test('hasFalloutTitleMention accepts shorthand game references', () => {
  assert.equal(hasFalloutTitleMention('Major FO76 update lands today'), true);
  assert.equal(hasFalloutTitleMention('PlayStation Store Summer Sale arrives on July 15'), false);
});

test('isRelevantFalloutItem rejects off-topic press stories without Fallout in the headline', () => {
  const gameSpot = { name: 'GameSpot', category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true };

  assert.equal(
    isRelevantFalloutItem({
      title: 'Diablo 4 Update Will Drown You In Mythics',
      description: 'GameSpot compares the loot changes to Fallout 76 seasons.'
    }, gameSpot),
    false
  );

  assert.equal(
    isRelevantFalloutItem({
      title: 'The Elder Scrolls 6 Devs Fear More Delays After Layoffs',
      description: 'Sources mention Bethesda may reprioritize Fallout afterward.'
    }, gameSpot),
    false
  );

  assert.equal(
    isRelevantFalloutItem({
      title: 'PlayStation Store Summer Sale arrives on July 15',
      description: 'The sale includes discounts on Fallout 4 and Fallout 76.'
    }, { name: 'PlayStation Blog', category: 'news', tier: 'press', kind: 'rss', requiresFalloutMatch: true }),
    false
  );
});

test('isRelevantFalloutItem accepts dedicated Fallout community forums without repeating Fallout in every title', () => {
  const nma = { name: 'No Mutants Allowed', category: 'community', tier: 'community', kind: 'rss', dedicatedFallout: true };

  assert.equal(
    isRelevantFalloutItem({
      title: 'Classic Fallout 2 modding thread',
      description: 'Discussion about sfall scripting tweaks.'
    }, nma),
    true
  );
});

test('isEligibleForGeneration blocks press stories that only mention Fallout in the body', () => {
  assert.equal(
    isEligibleForGeneration({
      contentType: 'news',
      sourceTier: 'press',
      source: 'GameSpot',
      title: 'Reset Xbox To What, Exactly?',
      description: 'Aftermath discusses Xbox strategy and what it means for Fallout fans.'
    }),
    false
  );

  assert.equal(
    isEligibleForGeneration({
      contentType: 'news',
      sourceTier: 'press',
      source: 'IGN',
      title: 'Fallout 5 and The Elder Scrolls 6 updates amid Xbox layoffs',
      description: 'IGN reports on sweeping studio changes.'
    }),
    true
  );
});

test('detectContentType identifies mods and community posts', () => {
  assert.equal(
    detectContentType({ title: 'New lighting overhaul for Fallout 4', description: 'Nexus release' }, { category: 'mods' }),
    'mods'
  );
  assert.equal(
    detectContentType({ title: 'My Vault Dweller cosplay [OC]', description: 'Finished just in time for the con.' }, { category: 'community' }),
    'community'
  );
});

test('meetsMinimumSourceQuality accepts descriptive Reddit titles', () => {
  assert.equal(
    meetsMinimumSourceQuality({
      contentType: 'community',
      title: 'Handmade Power Armor cosplay with working Pip-Boy',
      description: 'Built over six months.'
    }),
    true
  );
});

test('extractFeedItems parses Atom feeds', () => {
  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Fallout fan art</title><link href="https://example.com/post"/><published>2026-07-12T08:00:00Z</published><summary>A detailed painting of the Mojave.</summary></entry></feed>`;
  const items = extractFeedItems(xml);

  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Fallout fan art');
  assert.equal(items[0].link, 'https://example.com/post');
});

test('freshnessBonus prefers newer stories', () => {
  const recent = Date.now() - (12 * 60 * 60 * 1000);
  const stale = Date.now() - (15 * 24 * 60 * 60 * 1000);

  assert.ok(freshnessBonus(recent) > freshnessBonus(stale));
});

test('parseRssDate parses standard RSS dates', () => {
  const parsed = parseRssDate('Sun, 12 Jul 2026 08:00:00 GMT');
  assert.ok(Number.isFinite(parsed));
});

test('isArticleSubstantive rejects short generic drafts', () => {
  const thin = {
    intro: 'Fallout news is here.',
    sections: [{ heading: 'Update', body: 'There was an update.' }],
    conclusion: 'That is all.',
    takeaway: 'Updates matter.'
  };

  assert.equal(isArticleSubstantive(thin), false);
  assert.ok(getArticleWordCount(thin) < 650);
});

test('buildArticleHtml includes trust markers, key facts, and linked sources', () => {
  const html = buildArticleHtml({
    title: 'Fallout 76 season update breakdown',
    subtitle: 'What changed and why it matters this week.',
    intro: 'A new season is live.',
    keyFacts: ['Season 18 is live', 'New daily challenges added', 'Quality-of-life fixes included'],
    sections: [{ heading: 'What changed', body: 'Players get new rewards and revised challenge tracks designed to make the seasonal loop feel fresher for returning players.' }],
    takeaway: 'Live-service Fallout lives and dies on update cadence.',
    conclusion: 'Worth logging in this week.',
    cta: 'Are you jumping back in?',
    contentType: 'news',
    trustLevel: 'confirmed',
    seoDescription: 'Fallout 76 Season 18 is live with new daily challenges, refreshed rewards, and quality-of-life fixes that could bring returning players back to Appalachia this week.',
    sources: [{ title: 'IGN', url: 'https://example.com/story', type: 'press' }]
  });

  assert.match(html, /Search description — copy into Blogger \(150 characters\)/);
  assert.match(html, /<!-- SEARCH_DESCRIPTION \(\d+ chars\):/);
  assert.doesNotMatch(html, /Fallout Hub · News Brief/);
  assert.match(html, /<h3>Key facts<\/h3>/);
  assert.match(html, /editorial standard/);
  assert.match(html, /<a href="https:\/\/example.com\/story">IGN<\/a>/);
  assert.doesNotMatch(html, /<h2>/);
});

test('buildArticleHtml shows press-report disclaimer and label', () => {
  const html = buildArticleHtml({
    title: 'Obsidian reportedly returns to Fallout',
    subtitle: 'What Bloomberg reported — and what is not confirmed yet.',
    intro: 'According to Bloomberg, Obsidian may be refocusing on Fallout.',
    keyFacts: ['Reported by Bloomberg; not yet confirmed by the developer or publisher.'],
    sections: [{ heading: 'What the report says', body: 'According to Bloomberg, Obsidian is shifting its priorities toward a new Fallout project, though neither Obsidian nor Xbox has confirmed the report.' }],
    takeaway: 'This is a story to watch, not a confirmed announcement.',
    conclusion: 'Official confirmation is still pending.',
    cta: 'What would you want from a new Obsidian Fallout game?',
    contentType: 'news',
    trustLevel: 'press-report',
    seoDescription: 'Bloomberg reports Obsidian may refocus on Fallout, but neither Obsidian nor Xbox has confirmed the story yet — here is what fans should know for now.',
    sources: [{ title: 'Bloomberg report', url: 'https://example.com/bloomberg', type: 'press' }]
  });

  assert.doesNotMatch(html, /Fallout Hub · Press Report/);
  assert.match(html, /Editorial note:/);
  assert.match(html, /not<\/strong> been confirmed by the developer or publisher/);
  assert.doesNotMatch(html, /editorial standard/);
});

test('resolveArticleSources drops tangential supporting links', () => {
  const newsItems = [
    {
      title: 'Xbox layoffs hit Bethesda Game Studios and ZeniMax',
      link: 'https://example.com/layoffs',
      sourceTier: 'press'
    },
    {
      title: 'Elder Scrolls Online roadmap shifts after Xbox layoffs',
      link: 'https://example.com/eso',
      description: 'ZeniMax Online Studios changed its roadmap following the latest round of layoffs.',
      sourceTier: 'press'
    },
    {
      title: 'What will another Obsidian Fallout game even look like?',
      link: 'https://example.com/opinion',
      sourceTier: 'press'
    }
  ];

  const sources = resolveArticleSources([
    { title: 'Layoffs story', url: 'https://example.com/layoffs', type: 'press' },
    { title: 'ESO roadmap', url: 'https://example.com/eso', type: 'press' },
    { title: 'Obsidian opinion', url: 'https://example.com/opinion', type: 'press' }
  ], newsItems);

  assert.equal(sources.length, 2);
  assert.deepEqual(sources.map((source) => source.url), [
    'https://example.com/layoffs',
    'https://example.com/eso'
  ]);
});

test('detectTrustLevel marks industry reports as press-report', () => {
  const item = {
    title: 'New Fallout Game Is New Focus For Obsidian Entertainment – Report',
    description: 'Bloomberg reports that Obsidian is shelving other projects to focus on Fallout.'
  };

  assert.equal(
    detectTrustLevel(item, { tier: 'press', category: 'news' }),
    'press-report'
  );
});

test('detectTrustLevel marks official patch notes as confirmed', () => {
  const item = {
    title: 'Fallout 76 patch notes are now live for update 1.18',
    description: 'The update is available to download today with balance changes and bug fixes.'
  };

  assert.equal(
    detectTrustLevel(item, { tier: 'press', category: 'news' }),
    'confirmed'
  );
});

test('ensureTrustKeyFacts adds disclaimer for press-report stories', () => {
  const facts = ensureTrustKeyFacts(
    ['Obsidian is reportedly refocusing on Fallout.'],
    { title: 'Obsidian Fallout report', source: 'GamesRadar', description: 'Bloomberg report coverage' },
    'press-report'
  );

  assert.match(facts[0], /Reported by Bloomberg; not yet confirmed/);
});

test('ensureSeoDescription builds a fallback near 150 characters', () => {
  const description = ensureSeoDescription({
    title: 'Fallout 76 Season 18 launches with new rewards',
    intro: 'A short intro.',
    sections: [
      { heading: 'Details', body: 'Fallout fans are watching a major update that changes seasonal rewards, daily challenges, and progression pacing across Appalachia.' }
    ]
  });

  assert.ok(countChars(description) >= 120);
  assert.ok(countChars(description) <= 160);
});

test('trimToCharCount trims at a word boundary', () => {
  const trimmed = trimToCharCount('Fallout 76 Season 18 is live with new daily challenges, refreshed rewards, and quality-of-life fixes for returning players in Appalachia this week.', 150);
  assert.ok(countChars(trimmed) <= 150);
  assert.doesNotMatch(trimmed, /\s$/);
});

test('areTopicsSimilar matches paraphrased headlines', () => {
  assert.equal(
    areTopicsSimilar('Fallout 76 Season 18 goes live', 'Season 18 is now live in Fallout 76'),
    true
  );
  assert.equal(
    areTopicsSimilar('Fallout 76 Season 18 goes live', 'Bethesda announces new Fallout TV details'),
    false
  );
  assert.equal(
    areTopicsSimilar(
      'Obsidian reportedly shifts focus back to Fallout',
      'Bloomberg: Obsidian refocusing on a new Fallout game'
    ),
    true
  );
});

test('selectStoriesForGeneration skips fuzzy topic matches in history', () => {
  const history = [{
    title: 'Fallout 76 Season 18 goes live',
    topicFingerprint: 'deadbeef',
    coveredAt: Date.now()
  }];

  const items = [
    { source: 'IGN', title: 'Season 18 is now live in Fallout 76', link: 'https://example.com/1', contentType: 'news', description: 'Bethesda has rolled out Fallout 76 Season 18 with new seasonal rewards, daily challenges, quality-of-life fixes, and progression updates for returning players.' },
    { source: 'Eurogamer', title: 'Bethesda teases more Fallout news', link: 'https://example.com/2', contentType: 'news', description: 'Bethesda has hinted at more Fallout announcements coming later this year, including possible updates for Fallout 76 and broader franchise plans.' }
  ];

  const fresh = selectStoriesForGeneration(items, history);
  assert.deepEqual(fresh.map((story) => story.title), ['Bethesda teases more Fallout news']);
});

test('meetsEngagementThreshold rejects Reddit RSS items without score metadata by default', () => {
  assert.equal(
    meetsEngagementThreshold({
      sourceKind: 'reddit',
      redditScore: null,
      redditComments: null,
      minScore: 150,
      minComments: 35,
      title: 'Random Fallout 76 chat thread',
      description: 'Just sharing some thoughts.'
    }),
    false
  );
});

test('passesRssRedditQualityGate allows top hot mod posts with release signals', () => {
  assert.equal(
    passesRssRedditQualityGate({
      sourceKind: 'reddit',
      redditFeedRank: 2,
      title: 'New Appalachia overhaul mod released on Nexus',
      description: 'A major visual overhaul with updated textures and lighting.'
    }),
    true
  );
});

test('passesRssRedditQualityGate rejects discussion threads and low-effort posts', () => {
  assert.equal(
    passesRssRedditQualityGate({
      sourceKind: 'reddit',
      redditFeedRank: 1,
      title: 'Fallout 76 Season 18 discussion thread',
      description: 'Players are comparing the new seasonal rewards.'
    }),
    false
  );
  assert.equal(
    passesRssRedditQualityGate({
      sourceKind: 'reddit',
      redditFeedRank: 1,
      title: 'Thoughts on the latest Fallout update?',
      description: 'What do you think about the changes?'
    }),
    false
  );
});

test('passesRssRedditQualityGate allows high-value community posts in the top hot slots', () => {
  assert.equal(
    passesRssRedditQualityGate({
      sourceKind: 'reddit',
      redditFeedRank: 1,
      title: 'Incredible Vault Dweller cosplay [OC]',
      description: 'Built over six months with a working Pip-Boy.'
    }),
    true
  );
});

test('passesCommunityQualityGate blocks RSS Reddit posts beyond the top hot slots', () => {
  assert.equal(
    passesCommunityQualityGate({
      sourceKind: 'reddit',
      redditFeedRank: 5,
      title: 'New Appalachia overhaul mod released on Nexus',
      description: 'A major visual overhaul with updated textures and lighting.'
    }),
    false
  );
});

test('compareCandidatePriority prefers Reddit items with engagement metrics', () => {
  const withMetrics = {
    sourceKind: 'reddit',
    score: 8,
    redditScore: 420,
    redditComments: 55
  };
  const withoutMetrics = {
    sourceKind: 'reddit',
    score: 12,
    redditScore: null,
    redditComments: null
  };

  assert.ok(compareCandidatePriority(withMetrics, withoutMetrics) < 0);
});

test('getSourceDiversityAdjustment penalizes recently used outlets', () => {
  const history = [
    { source: 'GameSpot', coveredAt: Date.now() - 24 * 60 * 60 * 1000 },
    { source: 'GameSpot', coveredAt: Date.now() - 2 * 24 * 60 * 60 * 1000 },
    { source: 'IGN', coveredAt: Date.now() - 3 * 24 * 60 * 60 * 1000 }
  ];

  const gameSpotPenalty = getSourceDiversityAdjustment({ source: 'GameSpot', sourceTier: 'press', contentType: 'news' }, history);
  const aftermathBonus = getSourceDiversityAdjustment({ source: 'Aftermath', sourceTier: 'press', contentType: 'news' }, history);

  assert.ok(gameSpotPenalty < aftermathBonus);
});

test('pickFeaturedStory prefers a fresh outlet over an overused syndicated source', () => {
  const history = [
    { source: 'GameSpot', coveredAt: Date.now() - 24 * 60 * 60 * 1000, contentType: 'news' },
    { source: 'GameSpot', coveredAt: Date.now() - 2 * 24 * 60 * 60 * 1000, contentType: 'news' },
    { source: 'IGN', coveredAt: Date.now() - 3 * 24 * 60 * 60 * 1000, contentType: 'news' },
    { source: 'GameSpot', coveredAt: Date.now() - 4 * 24 * 60 * 60 * 1000, contentType: 'news' }
  ];

  const candidates = [
    {
      source: 'GameSpot',
      sourceTier: 'press',
      sourceKind: 'rss',
      contentType: 'news',
      score: 14,
      title: 'Bethesda confirms new Fallout 76 season roadmap details',
      description: 'Bethesda has outlined the next Fallout 76 season with new rewards, challenges, and quality-of-life updates for Appalachian players.'
    },
    {
      source: 'Aftermath',
      sourceTier: 'press',
      sourceKind: 'rss',
      contentType: 'news',
      score: 12.5,
      title: 'Inside the Bethesda union response after Xbox layoffs hit Fallout teams',
      description: 'Aftermath reports on how Bethesda Game Studios workers responded after Xbox layoffs, including Fallout team morale and union demonstrations.'
    }
  ];

  const [featured] = pickFeaturedStory(candidates, history);
  assert.equal(featured.source, 'Aftermath');
  assert.ok(getAdjustedCandidateScore(featured, history) > getAdjustedCandidateScore(candidates[0], history));
});

test('parseRedditRssFeed maps subreddit RSS into story items', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Fallout 76 Season 18 discussion thread</title>
    <link href="https://www.reddit.com/r/fo76/comments/abc/season-18-thread/" />
    <updated>2026-07-12T12:00:00+00:00</updated>
    <content type="html">Players are comparing the new seasonal rewards and daily challenge changes.</content>
  </entry>
</feed>`;

  const items = parseRedditRssFeed(xml, { minScore: 75, minComments: 20 });
  assert.equal(items.length, 1);
  assert.equal(items[0].sourceKind, 'reddit');
  assert.equal(items[0].redditScore, null);
  assert.equal(items[0].redditFeedRank, 1);
  assert.match(items[0].description, /seasonal rewards/);
});

test('parseRedditListing maps hot posts into story items', () => {
  const payload = {
    data: {
      children: [{
        kind: 't3',
        data: {
          title: 'Incredible Vault Dweller cosplay [OC]',
          selftext: 'Built over six months with a working Pip-Boy.',
          url: 'https://www.reddit.com/r/fallout/comments/abc/test/',
          permalink: '/r/fallout/comments/abc/test/',
          score: 420,
          num_comments: 55,
          created_utc: 1_700_000_000,
          stickied: false,
          over_18: false
        }
      }]
    }
  };

  const items = parseRedditListing(payload, { minScore: 100, minComments: 20 });
  assert.equal(items.length, 1);
  assert.equal(items[0].redditScore, 420);
  assert.equal(items[0].sourceKind, 'reddit');
  assert.match(items[0].description, /working Pip-Boy/);
});

test('isTitleLengthValid enforces SEO-friendly title bounds', () => {
  assert.equal(isTitleLengthValid('Fallout 76 Season 18 adds new daily challenges'), true);
  assert.equal(isTitleLengthValid('Short'), false);
  assert.equal(isTitleLengthValid('A'.repeat(71)), false);
});

test('trimTitleToMaxChars shortens long headlines at word boundaries', () => {
  const longTitle = 'Obsidian Entertainment is reportedly shifting its focus back to Fallout after shelving other projects, sources say';
  const trimmed = trimTitleToMaxChars(longTitle);
  assert.ok(trimmed.length <= 70);
  assert.ok(isTitleLengthValid(trimmed));
});

test('ensureArticleTitle normalizes LLM headlines into publishable bounds', () => {
  const mainStory = {
    title: 'Obsidian Entertainment is reportedly shifting its focus back to Fallout after shelving other projects',
    contentType: 'news'
  };

  const normalized = ensureArticleTitle(
    'Report: Obsidian Entertainment is reportedly shifting its focus back to Fallout after shelving other projects',
    mainStory
  );

  assert.ok(isTitleLengthValid(normalized));
  assert.ok(normalized.length >= 20);
});

test('ensureArticleTitle expands titles that are too short', () => {
  const normalized = ensureArticleTitle('Fallout report', {
    title: 'Obsidian may return to Fallout',
    contentType: 'news'
  });

  assert.ok(isTitleLengthValid(normalized));
  assert.match(normalized, /Fallout/i);
});

test('isTopicCovered matches source headlines against prior article titles', () => {
  const history = [{
    articleTitle: 'Obsidian reportedly shifts focus back to Fallout',
    coveredAt: Date.now() - (2 * 24 * 60 * 60 * 1000)
  }];

  assert.equal(
    isTopicCovered({
      title: 'Bloomberg: Obsidian refocusing on a new Fallout game',
      link: 'https://example.com/report'
    }, history),
    true
  );
});

test('isDuplicateArticleTitle catches near-duplicate published titles', () => {
  const history = [{
    articleTitle: 'Fallout 76 Season 18 adds new daily challenges',
    coveredAt: Date.now() - (2 * 24 * 60 * 60 * 1000)
  }];

  assert.equal(
    isDuplicateArticleTitle('Season 18 brings new daily challenges to Fallout 76', history),
    true
  );
  assert.equal(
    isDuplicateArticleTitle('New Fallout TV season 2 teaser breakdown', history),
    false
  );
});

test('isDuplicateArticleTitle also compares against covered source headlines', () => {
  const history = [{
    title: 'Fallout 76 Season 18 patch notes are live',
    coveredAt: Date.now() - (2 * 24 * 60 * 60 * 1000)
  }];

  assert.equal(
    isDuplicateArticleTitle('Season 18 patch notes go live for Fallout 76', history),
    true
  );
});

test('isFeedTitleExcluded filters recurring platform blog noise', () => {
  const source = {
    excludeTitlePatterns: [/^share of the week/i, /^players'? choice/i]
  };

  assert.equal(isFeedTitleExcluded('Share of the Week: Portraits', source), true);
  assert.equal(isFeedTitleExcluded('Fallout 76 comes to PlayStation Plus', source), false);
});

test('formatFeedWarnings lists every feed error on its own line', () => {
  const lines = formatFeedWarnings(['IGN: timeout', 'Nexus — Fallout 4: blocked by bot protection']);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /IGN: timeout/);
});

test('getTitleValidationIssue reports specific title problems', () => {
  const history = [{ articleTitle: 'Fallout 76 Season 18 goes live', coveredAt: Date.now() }];
  assert.equal(getTitleValidationIssue('Why the latest Fallout news matters right now', history), 'vague-title');
  assert.equal(getTitleValidationIssue('Tiny', history), 'title-length');
  assert.equal(getTitleValidationIssue('Fallout 76 Season 18 goes live today', history), 'duplicate-title');
});

test('recordFeedHealthResult tracks streaks and unhealthy feeds', () => {
  let health = {};
  health = recordFeedHealthResult(health, 'IGN', { success: true, itemCount: 2 });
  health = recordFeedHealthResult(health, 'IGN', { success: false, error: 'timeout' });
  health = recordFeedHealthResult(health, 'IGN', { success: false, error: 'timeout' });
  health = recordFeedHealthResult(health, 'IGN', { success: false, error: 'timeout' });

  const unhealthy = getUnhealthyFeedSources(health);
  assert.equal(unhealthy.length, 1);
  assert.equal(unhealthy[0].name, 'IGN');
  assert.equal(unhealthy[0].failureStreak, 3);
});

test('shouldSkipFeedSource skips feeds after repeated failures', () => {
  const health = {
    'Nexus — Fallout 4': { failureStreak: 3, lastError: 'blocked by bot protection' },
    IGN: { failureStreak: 2, lastError: 'timeout' }
  };

  assert.equal(shouldSkipFeedSource('Nexus — Fallout 4', health), true);
  assert.equal(shouldSkipFeedSource('IGN', health), false);
});

test('shouldSkipFeedSource skips persistently blocked feeds after two failures', () => {
  const health = {
    'Nexus — Fallout 4': { failureStreak: 2, lastError: 'Feed request failed (403)' }
  };

  assert.equal(shouldSkipFeedSource('Nexus — Fallout 4', health), true);
});

test('getRedditFetchStrategies prefers RSS in CI environments', () => {
  assert.deepEqual(getRedditFetchStrategies({ preferRss: true }), ['rss', 'json']);
  assert.deepEqual(getRedditFetchStrategies({ preferRss: false }), ['json', 'rss']);
  assert.deepEqual(getRedditFetchStrategies({ rssOnly: true }), ['rss']);
});

test('getRedditFetchStrategies uses JSON first for the primary subreddit even in CI', () => {
  assert.deepEqual(
    getRedditFetchStrategies({ rssOnly: true, source: { primary: true } }),
    ['json', 'rss']
  );
});

test('getRedditFetchStrategies prefers OAuth when credentials are configured', () => {
  const previousId = process.env.REDDIT_CLIENT_ID;
  const previousSecret = process.env.REDDIT_CLIENT_SECRET;

  process.env.REDDIT_CLIENT_ID = 'test-client-id';
  process.env.REDDIT_CLIENT_SECRET = 'test-client-secret';

  try {
    assert.deepEqual(getRedditFetchStrategies({ rssOnly: true }), ['oauth-json', 'rss']);
    assert.equal(hasRedditOAuthCredentials(), true);
  } finally {
    if (previousId === undefined) delete process.env.REDDIT_CLIENT_ID;
    else process.env.REDDIT_CLIENT_ID = previousId;
    if (previousSecret === undefined) delete process.env.REDDIT_CLIENT_SECRET;
    else process.env.REDDIT_CLIENT_SECRET = previousSecret;
  }
});

test('getRedditUserAgent follows Reddit platform format', () => {
  const previous = process.env.REDDIT_USER_AGENT;
  delete process.env.REDDIT_USER_AGENT;
  process.env.REDDIT_USERNAME = 'FalloutHubEditor';

  try {
    assert.match(getRedditUserAgent(), /web:fallout-hub-blog:v1\.0\.0 \(by \/u\/FalloutHubEditor\)/);
  } finally {
    if (previous === undefined) delete process.env.REDDIT_USER_AGENT;
    else process.env.REDDIT_USER_AGENT = previous;
    delete process.env.REDDIT_USERNAME;
  }
});

test('isRateLimitedFeedError detects Reddit throttling', () => {
  assert.equal(isRateLimitedFeedError('Reddit request failed (429)'), true);
  assert.equal(isRateLimitedFeedError('Feed request failed (403)'), false);
});

test('isPersistentlyBlockedFeedError detects bot protection failures', () => {
  assert.equal(isPersistentlyBlockedFeedError('Feed request failed (403)'), true);
  assert.equal(isPersistentlyBlockedFeedError('blocked by bot protection'), true);
});

test('resolveFeedItemLink normalizes relative feed links', () => {
  assert.equal(
    resolveFeedItemLink('/article/149991/summer-games-done-quick', 'https://www.shacknews.com/feed/rss'),
    'https://www.shacknews.com/article/149991/summer-games-done-quick'
  );
  assert.equal(
    resolveFeedItemLink('https://www.ign.com/articles/fallout', 'https://www.ign.com/rss/articles/feed'),
    'https://www.ign.com/articles/fallout'
  );
});

test('isPublishableArticle rejects fallback and thin drafts', () => {
  const sectionBody = 'Fallout 76 players are getting new seasonal rewards, revised daily challenges, and quality-of-life fixes that make the live-service loop feel fresher for returning vault dwellers across Appalachia this week. The update also reshapes how fans farm cores, complete dailies, and talk about endgame pacing online. '.repeat(4);
  const substantive = {
    title: 'Fallout 76 Season 18 adds new daily challenges and rewards',
    intro: 'Season 18 is live with enough changes to matter for returning players who follow Bethesda\'s live-service roadmap and seasonal progression across Appalachia.',
    sections: Array.from({ length: 5 }).map((_, index) => ({
      heading: `Section ${index + 1}`,
      body: `${sectionBody} Section ${index + 1} adds more context about why this seasonal shift matters for builds, public events, and the broader Fallout 76 conversation right now.`
    })),
    conclusion: 'Worth watching as the community digests the full patch notes and reward track over the next few days.',
    takeaway: 'Cadence matters for live-service Fallout more than most fans admit between major expansions.'
  };

  assert.ok(getArticleWordCount(substantive) >= 650);
  assert.equal(isPublishableArticle(substantive, { mode: 'llm-generated', historyEntries: [] }), true);
  assert.equal(isPublishableArticle(substantive, { mode: 'fallback-template', historyEntries: [] }), false);
  assert.equal(
    isPublishableArticle({ ...substantive, title: 'Why the latest Fallout news matters right now' }, { mode: 'llm-generated', historyEntries: [] }),
    false
  );
  assert.equal(
    isPublishableArticle({ ...substantive, title: 'A'.repeat(71) }, { mode: 'llm-generated', historyEntries: [] }),
    false
  );
});

test('resolveReportingOutlet prefers outlet named in the story', () => {
  assert.equal(
    resolveReportingOutlet({ title: 'Obsidian Fallout pivot – Report', description: 'Bloomberg says Obsidian is refocusing.' }),
    'Bloomberg'
  );
});

test('getBloggerInsertUrl requests draft creation via query parameter', () => {
  assert.equal(
    getBloggerInsertUrl('123456789'),
    'https://www.googleapis.com/blogger/v3/blogs/123456789/posts?isDraft=true'
  );
});

test('getStoryTopicFingerprint matches same headline across sources', () => {
  const a = getStoryTopicFingerprint({ title: 'Fallout 76 Season 18 goes live' });
  const b = getStoryTopicFingerprint({ title: 'Fallout 76 Season 18 goes live' });
  const c = getStoryTopicFingerprint({ title: 'Bethesda announces new Fallout TV details' });

  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('getStoryFingerprint differs when source or link changes', () => {
  const a = getStoryFingerprint({ source: 'IGN', title: 'Fallout update', link: 'https://example.com/1' });
  const b = getStoryFingerprint({ source: 'Eurogamer', title: 'Fallout update', link: 'https://example.com/2' });

  assert.notEqual(a, b);
});

test('getRedditPostJsonUrl converts Reddit permalinks into JSON endpoints', () => {
  const link = 'https://www.reddit.com/r/fallout/comments/abc123/my-long-post-title/';
  assert.equal(
    getRedditPostJsonUrl(link),
    'https://www.reddit.com/r/fallout/comments/abc123/my-long-post-title.json?raw_json=1'
  );
  assert.equal(
    getRedditPostJsonUrl(link, { oauth: true }),
    'https://oauth.reddit.com/r/fallout/comments/abc123/my-long-post-title.json?raw_json=1'
  );
  assert.equal(isRedditPostLink(link), true);
  assert.equal(getRedditPostJsonUrl('https://www.ign.com/articles/fallout'), null);
});

test('parseRedditPostDetailPayload returns the full selftext body', () => {
  const longBody = 'This is a detailed mod breakdown.'.repeat(80);
  const payload = [{
    data: {
      children: [{
        kind: 't3',
        data: {
          title: 'Huge Fallout 4 overhaul released',
          selftext: longBody,
          is_self: true,
          score: 512,
          num_comments: 88
        }
      }]
    }
  }];

  const detail = parseRedditPostDetailPayload(payload);
  assert.equal(detail.title, 'Huge Fallout 4 overhaul released');
  assert.equal(detail.description, longBody);
  assert.equal(detail.redditScore, 512);
  assert.equal(detail.redditComments, 88);
  assert.equal(detail.isSelf, true);
});

test('parseRedditListing keeps long selftext instead of truncating at 1200 characters', () => {
  const longBody = 'Vault dweller field report.'.repeat(120);
  const payload = {
    data: {
      children: [{
        kind: 't3',
        data: {
          title: 'My Appalachia camp build',
          selftext: longBody,
          permalink: '/r/fo76/comments/xyz/camp/',
          score: 240,
          num_comments: 42,
          created_utc: 1_700_000_000
        }
      }]
    }
  };

  const [item] = parseRedditListing(payload, { minScore: 50, minComments: 10 });
  assert.equal(item.description.length, longBody.length);
});

test('extractFeedItems prefers full RSS content:encoded over short descriptions', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Fallout 76 update goes live</title>
      <link>https://example.com/fallout-76-update</link>
      <description><![CDATA[Short teaser.]]></description>
      <content:encoded><![CDATA[<p>${'Full article body with patch notes and seasonal details. '.repeat(20)}</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;

  const [item] = extractFeedItems(xml);
  assert.match(item.description, /patch notes and seasonal details/);
  assert.ok(item.description.length > 200);
});

test('buildStorySummaryForPrompt keeps long enriched summaries for article generation', () => {
  const longDescription = 'Season breakdown with rewards, systems, and community reaction. '.repeat(120);
  const summary = buildStorySummaryForPrompt({ description: longDescription });

  assert.ok(summary.length > 3000);
  assert.match(summary, /community reaction/);
});

test('getGeminiApiKeys uses main, fallback, and fallback-2 secret names', () => {
  const previous = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_API_KEY_FALLBACK: process.env.GEMINI_API_KEY_FALLBACK,
    GEMINI_API_KEY_FALLBACK_2: process.env.GEMINI_API_KEY_FALLBACK_2
  };

  process.env.GEMINI_API_KEY = 'main-key';
  process.env.GEMINI_API_KEY_FALLBACK = 'fallback-key';
  delete process.env.GEMINI_API_KEY_FALLBACK_2;

  assert.deepEqual(getGeminiApiKeys(), ['main-key', 'fallback-key']);

  process.env.GEMINI_API_KEY_FALLBACK_2 = 'fallback-key-2';
  assert.deepEqual(getGeminiApiKeys(), ['main-key', 'fallback-key', 'fallback-key-2']);

  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test('rotateApiKeys preserves order while starting from the cursor offset', () => {
  assert.deepEqual(rotateApiKeys(['a', 'b', 'c'], 0), ['a', 'b', 'c']);
  assert.deepEqual(rotateApiKeys(['a', 'b', 'c'], 1), ['b', 'c', 'a']);
  assert.deepEqual(rotateApiKeys(['a', 'b', 'c'], 4), ['b', 'c', 'a']);
});

test('isGeminiQuotaError detects quota and rate-limit responses', () => {
  assert.equal(isGeminiQuotaError(429, ''), true);
  assert.equal(isGeminiQuotaError(403, 'Quota exceeded for metric'), true);
  assert.equal(isGeminiQuotaError(500, 'RESOURCE_EXHAUSTED'), true);
  assert.equal(isGeminiQuotaError(400, 'invalid argument'), false);
});

test('getGeminiModelChain defaults to all non-pro Flash models best to worst', () => {
  const previous = {
    GEMINI_MODEL_CHAIN: process.env.GEMINI_MODEL_CHAIN,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    GEMINI_MODEL_FALLBACK: process.env.GEMINI_MODEL_FALLBACK,
    GEMINI_MODEL_FALLBACK_2: process.env.GEMINI_MODEL_FALLBACK_2
  };

  delete process.env.GEMINI_MODEL_CHAIN;
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_MODEL_FALLBACK;
  delete process.env.GEMINI_MODEL_FALLBACK_2;

  const models = getGeminiModelChain();
  assert.deepEqual(models, [
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
  ]);
  assert.ok(!models.some((model) => /pro/i.test(model)));

  process.env.GEMINI_MODEL_CHAIN = 'gemini-flash-latest,gemini-2.0-flash-lite';
  assert.deepEqual(getGeminiModelChain(), ['gemini-flash-latest', 'gemini-2.0-flash-lite']);

  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
