# Fan Editorial Automation Spec

**Purpose:** A complete blueprint so any engineer or LLM can rebuild this system for **any fandom / niche site**, not only Fallout Hub, and with **any CMS** (Blogger is one optional publish target).

**Reference implementation (this repo):**

| Path | Role |
|---|---|
| `tools/fallout-blog/generate.mjs` | Main pipeline: collect → rank → write → quality gate → publish adapter |
| `tools/fallout-blog/generate.test.mjs` | Unit tests for editorial logic |
| `tools/fallout-blog/repair-story-history.mjs` | Repair conflicted / invalid story history JSON |
| `tools/fallout-blog/commit-pipeline-state.mjs` | Conflict-safe git commit of pipeline state (CI) |
| `tools/discord-share/share-latest-post.mjs` | Optional: announce **published** posts via RSS → Discord |
| `data/story-history.json` | Dedup / coverage memory |
| `data/feed-health.json` | Per-source fetch health |
| `data/manual-seeds.json` | Optional first-party / official seeds |
| `data/discord-share-state.json` | Discord bootstrap + seen post IDs |
| `.github/workflows/fallout-blog.yml` | Daily draft generation |
| `.github/workflows/discord-blog-share.yml` | Daily announce of published posts |

**Runtime:** Node.js ≥ 20, ESM (`"type": "module"`), no heavy frameworks.

---

## 1. Product goals (north star)

Build a **daily editorial assistant** that produces **one high-quality draft article** for a fan community site:

1. **Best for fans** — accurate, useful, readable, not industry jargon sludge  
2. **Trustworthy** — distinguish official / confirmed / unconfirmed press / community  
3. **Not spammy** — one story per real event; no near-duplicate rewrites  
4. **Human voice** — sounds like a real fan-site host, not a generic LLM  
5. **Human-in-the-loop** — automation creates a **draft**; a human **publishes**  
6. **CMS-agnostic** — output is a structured article; publish is a pluggable adapter  

Secondary goals:

- Prefer **official confirmation framing** when studios speak; do not over-hedge confirmed news as leaks  
- Fold **weak buzz** (theories, speculation) into stronger posts as context, not standalone leads  
- Allow **distinct follow-ups** (exclusivity, pricing, trailers) after a mega-package story  
- Survive **CI races**, **API quotas**, and **thin LLM drafts**  

---

## 2. High-level architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                     SCHEDULER (CI cron / local)                   │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. COLLECT                                                       │
│    RSS / Atom / Reddit custom feed / official feeds / seeds      │
│    → normalize items { title, link, description, source, tier… } │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. FILTER & SCORE                                                │
│    relevance, quality gates, engagement, freshness, diversity    │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. EDITORIAL PICK                                                │
│    content-type rotation, underused-type boost, package rules    │
│    assemble multi-source batch (same type only)                  │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. ENRICH                                                        │
│    fetch full page / Reddit JSON for top batch items             │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4b. DEEP RESEARCH (when lead is thin / few related sources)      │
│    Google Search grounding + fetch related pages (same topic)    │
│    → single-topic FEATURE mode (not unrelated news padding)      │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. TRUST + ATTRIBUTION                                           │
│    official | confirmed | press-report | community-highlight     │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. GENERATE (LLM)                                                │
│    pass 1: full draft                                            │
│    pass 2..N: TARGETED expansion (grow thin parts, keep good)    │
│    models × API keys per call                                    │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. QUALITY GATE                                                  │
│    substantive? title valid? not already covered?                │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 8. PUBLISH ADAPTER (optional)                                    │
│    Blogger draft | WordPress draft | Ghost | file-only | …       │
│    On success → update story history                             │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 9. PERSIST STATE                                                 │
│    story-history, feed-health → git (conflict-safe)              │
└─────────────────────────────────────────────────────────────────┘

SEPARATE JOB (after human publishes):
  CMS public feed (RSS/Atom) → Discord / social webhook (only NEW posts)
```

### Separation of concerns

| Layer | Responsibility | Must not |
|---|---|---|
| **Collect** | Ingest raw items | Write articles |
| **Editorial** | Pick one story + batch | Call CMS |
| **Generate** | Structured article JSON | Hard-code Blogger |
| **Quality gate** | Accept / reject draft | Invent facts |
| **Publish adapter** | Create draft in CMS | Change editorial logic |
| **Announce adapter** | Share **published** URLs | Share drafts |

---

## 3. Domain model

### 3.1 Source item (collected story)

```ts
type SourceItem = {
  title: string;
  link?: string;
  description: string;       // summary / selftext / RSS body
  source: string;            // "IGN", "Reddit — Custom Feed", …
  sourceTier: 'official' | 'press' | 'community';
  sourceKind?: 'rss' | 'reddit' | 'manual';
  contentType: 'news' | 'mods' | 'community';
  publishedAt?: number;      // epoch ms
  score?: number;
  // Reddit extras
  scoreReddit?: number;
  comments?: number;
  rank?: number;             // position in feed (1 = top)
  enriched?: boolean;
  enrichmentRole?: 'source' | 'buzz';
  trustLevel?: TrustLevel;
};
```

### 3.2 Article (LLM output + normalized)

```ts
type Article = {
  title: string;                 // ~20–70 chars
  seoDescription: string;        // ~120–160 chars
  subtitle: string;
  intro: string;
  keyFacts: string[];            // 3–5 bullets
  sections: { heading: string; body: string }[];  // 4–6 preferred
  takeaway: string;
  conclusion: string;
  cta: string;                   // conversational question
  contentType: 'news' | 'mods' | 'community';
  trustLevel: TrustLevel;
  sources: { title: string; url: string; type?: string }[];
};

type TrustLevel =
  | 'official'              // first-party studio / platform channel
  | 'confirmed'             // studio confirmation covered by press (or hard confirmed facts)
  | 'press-report'          // unconfirmed industry reporting
  | 'community-highlight';  // fan content
```

### 3.3 Story history entry

```ts
type HistoryEntry = {
  fingerprint: string;       // hash(source + title + link)
  topicFingerprint: string;  // hash(normalized title topic)
  contentType: string;
  title: string;             // source headline
  articleTitle?: string;     // published/generated title
  source: string;
  coveredAt: number;         // epoch ms
};
```

Retention: **~21 days** for coverage; title-dup window **~14 days** (configurable).

### 3.4 Pipeline run output (`artifacts/latest-draft.json`)

Always write this locally even if publish is skipped:

```ts
type RunOutput = {
  generatedAt: string;
  brand: string;
  featuredContentType: string;
  featuredTrustLevel: TrustLevel;
  attribution: string;
  selectedNews: SourceItem[];
  followUpBeats?: string[];
  article: Article;
  articleWordCount: number;
  publishable: boolean;
  publishSkippedReason: string | null;
  // e.g. 'already-covered' | 'article-not-substantive' | 'fallback-template' | API errors
  bloggerPost?: unknown | null;   // rename to publishResult in portable forks
  mode: 'llm-generated' | 'fallback-template';
  // feed health summary, errors, etc.
};
```

---

## 4. Configuration (portable)

### 4.1 Brand / voice (customize per site)

```js
const BRAND_NAME = 'Your Site Name';
const AUTHOR_NAME = 'Editor display name';
const AUTHOR_SITE_URL = 'https://yoursite.example';
const AUTHOR_COMMUNITY = {
  discord: '…',
  app: 'optional app name',
  socials: 'list of community channels'
};
```

Voice guide should include:

- Who the writer is (human host, not wire service)  
- Franchise / niche coverage scope  
- **Banned bot phrases** (treasure trove, buzzing with excitement, testament to, …)  
- Structure rules (uneven sections, no template intros, real CTAs)  
- First person allowed in intro/conclusion/cta  

### 4.2 Content types

Default rotation set:

- `news` — press / official  
- `mods` — mod releases and tools  
- `community` — art, cosplay, discussion highlights  

Batch limits example: up to **5** same-type items per generation.

### 4.3 Numeric thresholds (defaults from this repo)

| Constant | Default | Meaning |
|---|---|---|
| `MIN_ARTICLE_WORDS` | 650 | Substance floor |
| `minSections` | 4 | Minimum section blocks |
| Section body min words | 35 | Per-section floor |
| `MIN_TITLE_CHARS` / `MAX_TITLE_CHARS` | 20 / 70 | SEO-friendly titles |
| SEO description | 120–160 (target 150) | Meta blurb |
| `HISTORY_RETENTION_DAYS` | 21 | Dedup window |
| `TOPIC_SIMILARITY_THRESHOLD` | 0.6 | Jaccard token similarity |
| Reddit custom feed keep | 25 | After quality filters |
| Collected pool | 45 | Cap on ranked candidates |
| `GEMINI_SUBSTANTIVE_ATTEMPTS` | ~5–7 (max 12) | Draft + expansion passes |

### 4.4 Environment variables

**LLM**

- `GEMINI_API_KEY` (required)  
- `GEMINI_API_KEY_FALLBACK`, `GEMINI_API_KEY_FALLBACK_2`  
- `GEMINI_MODEL_CHAIN` — optional comma list, best → worst  
- `GEMINI_SUBSTANTIVE_ATTEMPTS` — expansion budget  

**Collect**

- `REDDIT_CUSTOM_FEED_URL` — private multireddit/custom RSS (preferred over many subreddit hits)  
- `REDDIT_CUSTOM_FEED_ITEM_LIMIT`, `REDDIT_CUSTOM_FEED_MAX_RANK`  
- `COLLECTED_ITEM_POOL_LIMIT`  
- `REDDIT_FETCH_DELAY_MS`, `REDDIT_RATE_LIMIT_BACKOFF_MS`  

**Publish adapter (Blogger example — optional)**

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`  
- `BLOGGER_BLOG_ID`  

**Announce adapter (Discord example — optional)**

- `DISCORD_WEBHOOK_URL`  
- `BLOG_FEED_URL` — public CMS RSS of **published** posts only  

---

## 5. Collection logic

### 5.1 Press / official RSS

Maintain a list of sources:

```js
{ name, url, weight, category, tier, kind: 'rss',
  requiresFalloutMatch?: true,  // niche keyword must appear
  dedicatedFallout?: true,      // Steam app feeds etc.
  excludeTitlePatterns?: RegExp[] }
```

**Rules:**

- `requiresFalloutMatch: true` → drop items without franchise title/body signals  
- Press headlines without franchise in **title** → usually ineligible for generation  
- Official tier (Steam, Xbox Wire, studio YouTube) → higher score + trust  

### 5.2 Reddit

**Preferred:** one **custom feed / multireddit RSS** (`REDDIT_CUSTOM_FEED_URL`).

- Skip individual subreddit fetches when custom feed is set  
- Looser rank gate than single-sub “top 3 hot” (e.g. rank ≤ 30)  
- Still reject low-effort patterns, NSFW, thin titles  

**Optional:** Reddit JSON OAuth for enrichment / hot listings when credentials exist.

**Quality gates (conceptual):**

- Low-effort title patterns → reject  
- Engagement thresholds when score/comments exist  
- Without engagement metadata: only allow strong signals (mods release, high-value community) in early ranks  
- Custom feed gate: allow deeper ranks without metrics if title quality passes  

### 5.3 Manual seeds

`data/manual-seeds.json`:

```json
{
  "items": [{
    "title": "Studio note title",
    "link": "https://…",
    "description": "Key confirmed points…",
    "source": "Studio Name",
    "tier": "official",
    "category": "news"
  }]
}
```

Use when first-party posts appear on social **before** press RSS.

### 5.4 Feed health

Per source:

```json
{
  "successStreak": 0,
  "failureStreak": 0,
  "lastSuccessAt": null,
  "lastErrorAt": null,
  "lastError": null,
  "lastItemCount": 0
}
```

- Skip sources after repeated failures (e.g. streak ≥ 3)  
- Persistently blocked (Cloudflare) → skip sooner (e.g. streak ≥ 2)  
- Prune stale sources no longer in active list  

---

## 6. Relevance & eligibility

Implement franchise focus carefully:

1. **Title mention** of the franchise / shorthand (FO76, FNV, …)  
2. **Reject competing franchise leads** (other games dominating headline)  
3. **Press:** Fallout (or niche keyword) should be in the **headline**, not only body  
4. **Dedicated community forums** may allow titles without repeating the brand every time  
5. Off-topic press patterns (sales roundups, unrelated IPs) → exclude  

`isEligibleForGeneration(item)` combines focus + type + quality floors (`description` length ≥ 80 for press news, etc.).

---

## 7. Editorial selection

### 7.1 Scoring

Rough score stack:

- Source weight  
- Keyword hits  
- Freshness bonus (newer = higher)  
- Description richness  
- Engagement bonus (Reddit)  
- Official tier boost  
- Official confirmation language boost  
- High-value community patterns  
- Niche / noise penalties  
- Source diversity penalty if outlet used heavily in last N days  
- Content-type rotation bonus if type underused in recent history  
- Distinct follow-up beat boost when package already covered  
- Weak package buzz **penalty** when package already covered  

### 7.2 Pick featured story

1. Filter: not covered, quality OK, eligible, not ancient  
2. Sort by editorial score  
3. Return single lead  

### 7.3 Assemble generation batch

- Same `contentType` only (never mix news + mods in one article)  
- **Strict relatedness only** — secondary items must be the same story (mega-package, follow-up beat, topic similarity, same creator/project). Never pad with unrelated same-type headlines.  
- Cap at type limit (e.g. 5)  
- **Buzz enrichment:** only when still same package/story (`enrichmentRole: 'buzz'`)  
- **Community multi-highlight:** allowed only when intentional (several high-value community posts) and the lead is not a single-artist feature  

### 7.3b Deep single-topic research (thin leads)

When the related-only batch is still thin (one feed item, or little body text):

1. Run **deep research** on that topic (Gemini Google Search grounding + optional Reddit author posts)  
2. Fetch related pages for background (same project, same creator, same studio history)  
3. Attach as `enrichmentRole: 'research'` sources  
4. Write in **feature mode** — one full article like games media, not a mixed digest  

Disable with `DEEP_RESEARCH_ENABLED=false`.  

Do **not** deep-research when 2+ strictly related multi-outlet package sources already exist.  

### 7.4 Dedup & mega-events

**Fingerprints**

- `fingerprint` = hash(source + title + link)  
- `topicFingerprint` = hash(normalized title)  

**Similarity**

- Token Jaccard ≥ 0.6 **or** shared strong anchors (franchise + specific token)  

**Mega-package** (example: FO5 + remasters + Raven Rock)

- Shared ≥ 2 package signals → same core story  
- After core package covered:  
  - **Pure rehash** → blocked as lead  
  - **Weak buzz** (fan theories, “sparks buzz”) → blocked as lead; allowed as buzz enricher  
  - **Distinct follow-up beats** (exclusivity, pricing, trailer, hard schedule) → **allowed** until that beat is covered  

### 7.5 History write policy

Only after **successful publish adapter** call:

- Save **every** batch source angle + generated article title  
- Prevents multi-outlet packages from regenerating next day  

---

## 8. Trust detection

### 8.1 Per item

Priority sketch:

1. `tier === official` → `official`  
2. mods/community → `community-highlight`  
3. Weak package buzz → force `press-report` (never “confirmed studio news”)  
4. Official confirmation signals in text → `confirmed`  
5. Rumor / “– Report” framing → `press-report`  
6. Confirmed press signals (patch notes, now live) → `confirmed`  
7. Platform exclusivity follow-ups → usually `press-report`  
8. Default press → `press-report`  

### 8.2 Per batch

- If lead is distinct follow-up or buzz → trust follows **lead**, not supporting rehash  
- Else max trust wins (official > confirmed > press-report)  

### 8.3 Attribution strings

Examples:

- Press report: `Reported by Rock Paper Shotgun and GamesRadar`  
- Confirmed multi-outlet: `Bethesda Game Studios (via GameSpot and Kotaku)`  
- Use **cited sources** for disclaimers, not unused editorial leads  

### 8.4 Post-process sanitizers

- Replace misattributed outlet names when not in sources  
- Strip over-hedging on confirmed/official copy (“not yet confirmed by developer”)  

---

## 9. LLM generation

### 9.1 Prompt structure

For each content type, build:

1. **Author voice guide** (site-specific)  
2. **Trust guidance** for current trustLevel  
3. **Type rules** (news / mods / community)  
4. **Source material** list with roles: MAIN / SUPPORTING / BUZZ  
5. **JSON schema** requirements  

Return **JSON only** with Article fields.

### 9.2 Temperature

Example:

- community `0.65`  
- mods `0.55`  
- news `0.45`  

### 9.3 Model + key strategy

**Per API call (`callGemini`):**

```text
for model in rotate(modelChain, modelOffset):
  for key in rotate(apiKeys, keyOffset):
    try generate
    on quota → next key
    on model unavailable → next model
```

**Per article (`generateArticle`):**

```text
pass 1: full draft prompt
if not substantive:
  passes 2..N: TARGETED expansion prompt (not full rewrite)
  each pass: different modelOffset + keyOffset
  merge expansion into best draft (keep longer bodies)
keep best by substance score
```

### 9.4 Substance gate

Article is substantive only if **all** hold:

- Word count ≥ `MIN_ARTICLE_WORDS` (count intro, sections, keyFacts, takeaway, conclusion, subtitle)  
- ≥ 4 sections  
- Every section body ≥ 35 words  

### 9.5 Targeted expansion (critical design)

**Do not** rewrite from scratch just to hit word count (that discards better-model drafts).

Expansion prompt must:

- Include current draft JSON  
- List diagnosis (word deficit, short sections, missing sections)  
- Instruct: keep title/structure/strong bodies; only grow weak parts  
- Forbid inventing facts  

**Merge rules:**

- Per section: keep longer body  
- Prefer longer intro/conclusion  
- If merged score &lt; previous → keep previous  

### 9.6 Fallback template

If all LLM calls fail:

- Build a minimal structured template from source titles  
- Mode `fallback-template`  
- **Never publish** fallback (quality gate rejects)  

---

## 10. Quality gate before publish

```text
publishable =
  mode === 'llm-generated'
  AND isArticleSubstantive(article)
  AND valid title (length, not vague, not duplicate)
  AND lead not already covered
  AND article title not duplicate of recent history
```

Skip reasons (log clearly; job may still exit 0):

| Reason | Meaning |
|---|---|
| `article-not-substantive` | Failed word/section floors after expansions |
| `already-covered` | Topic/package/beat already in history |
| `fallback-template` | LLM failed |
| `duplicate-title` / `title-length` / `vague-title` | Title gate |
| Adapter errors | CMS OAuth / API failure |

**Important:** Green CI ≠ draft created. Always search logs for skip vs success.

---

## 11. Publish adapter (CMS-agnostic)

### 11.1 Interface

```ts
async function createDraft(article: Article, meta: {
  labels?: string[];
  html: string;
}): Promise<{ id: string; url?: string; raw?: unknown }>;
```

### 11.2 HTML builder

`buildArticleHtml(article)` should produce CMS-agnostic HTML:

- Optional SEO description helper block (or strip for pure CMS)  
- Subtitle, intro  
- Key facts list  
- Sections with headings  
- Takeaway, conclusion, CTA  
- Sources as links  
- Trust footer (“Press report” / “Official” / “Community highlight”)  

### 11.3 Labels / tags

Derive from content + trust + game keywords (FO76, New Vegas, Official, Press Report, …).

### 11.4 Blogger reference adapter (this repo)

- OAuth2 refresh → access token  
- `POST https://www.googleapis.com/blogger/v3/blogs/{blogId}/posts?isDraft=true`  
- Secrets: client id/secret, refresh token, blog id  
- On token failure: surface Google `error` + `error_description`  

### 11.5 Porting to another CMS

| CMS | Draft approach |
|---|---|
| WordPress | REST `posts` with `status: draft` + Application Password |
| Ghost | Admin API drafts |
| Hashnode / Medium | respective draft APIs |
| Static site | Write Markdown to `content/drafts/` and open PR |
| None | Only write `artifacts/latest-draft.json` |

Keep generate → gate → adapter boundaries clean.

---

## 12. Announce adapter (published only)

**Never** announce drafts.

Flow:

1. Poll public site RSS/Atom (`BLOG_FEED_URL`)  
2. Bootstrap once: mark all current IDs seen, post nothing  
3. Later: new IDs → Discord webhook embed (title, description, OG image, link)  
4. Persist `sharedPostIds`  

OG image: fetch post HTML for `og:image` / `twitter:image`; fallback RSS media.

---

## 13. CI / scheduling

### 13.1 Draft job

- Cron e.g. daily 06:00 UTC + `workflow_dispatch`  
- Steps: checkout → Node → repair history → generate → commit state  
- Secrets via env  
- Concurrency group per repo for the draft workflow  

### 13.2 Conflict-safe state commit

Problem: concurrent pushes conflict on `feed-health.json`.

Solution:

1. Snapshot files this run produced  
2. Commit  
3. Pull --rebase; on conflict: abort, reset to origin, restore snapshot, recommit  
4. Retry push (several attempts)  

### 13.3 Announce job

- Separate cron (e.g. 18:00 UTC)  
- Independent secrets  

---

## 14. Main pipeline pseudocode

```js
async function main() {
  const { items, feedHealth, feedErrors } = await fetchContentItems();
  await saveFeedHealth(feedHealth);

  const history = await loadStoryHistory();
  const [lead] = pickFeaturedStory(items, history);
  if (!lead) return log('No fresh stories');

  if (isTopicCovered(lead, history)) return log('Lead already covered');

  let batch = assembleGenerationItems(lead, items, history, { maxItems: limit });
  batch = prioritizeGenerationBatch(batch); // keep lead first if follow-up

  const enriched = await enrichStories(batch);
  const substantive = filter quality + keep lead first;

  let article = await generateArticle(substantive); // multi-pass + merge
  article = normalizeArticle(article, substantive);

  const publishable = isPublishableArticle(article, { history });
  let publishResult = null;
  let skip = null;

  if (!publishable) skip = diagnosePublishSkip(article);
  else if (isTopicCovered(lead, history) || isDuplicateArticleTitle(article.title, history))
    skip = 'already-covered';
  else {
    try {
      publishResult = await createDraft(article); // adapter
      await saveStoryHistory(history, [...substantive, articleAsItem], article);
    } catch (e) {
      skip = e.message;
    }
  }

  await writeArtifact({ article, publishable, skip, publishResult, selected: substantive });
}
```

---

## 15. Article JSON contract (for LLM implementers)

The model **must** return valid JSON:

```json
{
  "title": "string",
  "seoDescription": "string",
  "subtitle": "string",
  "intro": "string",
  "keyFacts": ["…"],
  "sections": [{ "heading": "…", "body": "…" }],
  "takeaway": "string",
  "conclusion": "string",
  "cta": "string",
  "contentType": "news|mods|community",
  "trustLevel": "official|confirmed|press-report|community-highlight",
  "sources": [{ "title": "…", "url": "https://…", "type": "press|official|community" }]
}
```

**Sources rule:** only URLs present in the provided source material.

---

## 16. Author voice contract (for LLM implementers)

Write as a **named human editor** of a **fan community site**:

- Professional but conversational  
- Concrete detail &gt; empty praise  
- Vary section length  
- One grounded opinion OK  
- Banned: corporate SEO filler, “Welcome back to Brand…”, moralizing every section  
- Community posts: preserve some internet texture; don’t museum-sanitize memes  
- News: clear confirmed vs TBA; never invent  

---

## 17. Testing strategy

Unit-test pure logic without network:

- Topic similarity / mega-package / follow-up beats  
- Trust detection + batch trust  
- Source resolution / attribution sanitizers  
- Substance gate + merge expansion  
- Reddit quality gates  
- History salvage / conflict repair  
- Feed health skip rules  
- Discord bootstrap / payload building  

Integration (optional, secrets required):

- Live generate against real feeds  
- Publish adapter dry-run  

---

## 18. Operational runbook

| Symptom | Likely cause | Action |
|---|---|---|
| Green job, no CMS draft | Skip reason in logs | Search `skipped` / `already-covered` / `not-substantive` |
| `article-not-substantive` | Thin sources or weak expansions | Check sources; raise attempts; improve enrichment |
| `already-covered` | Package/beat history | Expected for rehashes; follow-ups should still pass if beats work |
| `Failed to refresh … access token` | OAuth refresh dead | Re-auth CMS; secrets present ≠ valid |
| Feed health conflict in git | Concurrent main writes | Use conflict-safe commit script |
| Bot-sounding prose | Voice prompt weak | Strengthen banned phrases + author guide |
| Wrong outlet in “Reported by” | Lead ≠ cited sources | Attribute from resolved sources only |
| Official news hedged as leak | Trust misclassify | Confirmation signals + batch trust |

---

## 19. Porting checklist (new niche / new CMS)

1. Replace brand, author, site URL, community links  
2. Replace franchise keywords / competing IP patterns  
3. Replace `CONTENT_SOURCES` + Reddit custom feed  
4. Retune mega-event signals and follow-up beats for your niche  
5. Keep pipeline stages identical  
6. Implement `createDraft` for your CMS (or file output only)  
7. Point announce job at your **public** RSS  
8. Copy tests; adjust fixtures  
9. Document secrets for that CMS  

---

## 20. Design principles (do not abandon)

1. **Fans first** — usefulness and honesty over volume  
2. **One real story per day** — packages and rehashes are not free content  
3. **Trust is a product feature** — wrong hedging destroys credibility  
4. **Draft ≠ publish** — humans remain editors  
5. **Expand, don’t gamble** — preserve better drafts when lengthening  
6. **Adapters at the edge** — CMS and Discord are replaceable  
7. **State is part of the product** — history and feed health prevent chaos  
8. **Logs must explain skips** — silent success is a bug  

---

## 21. Reference command map (this repo)

```bash
npm test
npm run fallout:generate          # full pipeline
npm run fallout:repair-history    # fix story-history JSON
npm run fallout:commit-state      # CI: push data/*.json safely
npm run discord:share             # announce published posts
```

Artifact: `artifacts/latest-draft.json`  
State: `data/story-history.json`, `data/feed-health.json`, `data/discord-share-state.json`

---

## 22. Minimal file layout for a fork

```text
/
  package.json
  .env.example
  data/
    story-history.json
    feed-health.json
    manual-seeds.json
    discord-share-state.json      # if using announce
  tools/
    editorial/
      generate.mjs                # core pipeline
      generate.test.mjs
      repair-history.mjs
      commit-state.mjs
      adapters/
        blogger.mjs               # optional
        wordpress.mjs             # optional
        file-draft.mjs            # optional
    announce/
      share-latest.mjs            # optional RSS → Discord
  .github/workflows/
    editorial-draft.yml
    announce-published.yml
  docs/
    EDITORIAL-AUTOMATION-SPEC.md  # this file
```

---

## 23. License of ideas

This document describes **architecture and editorial logic** for rebuilding a fan-site automation. The reference code in this repository is the concrete Fallout Hub implementation; adapters and brand strings are intentionally local.

When copying for another project: **change brand, sources, and CMS**, keep the **pipeline contracts and quality philosophy**.

---

*End of spec. An implementer should be able to recreate collection, ranking, trust, generation, expansion-merge, history, publish adapters, and announce adapters from this document alone, using this repo only as a worked example.*
