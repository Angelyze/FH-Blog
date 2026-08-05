# Fallout Hub Blog automation

Daily editorial automation for the **Fallout Hub Blog** — a trusted Fallout fan destination covering news, mods, and community highlights.

**Full system blueprint (for humans or LLMs rebuilding this):** [`docs/EDITORIAL-AUTOMATION-SPEC.md`](docs/EDITORIAL-AUTOMATION-SPEC.md) — CMS-agnostic architecture, editorial logic, trust rules, generation/expansion, adapters, and porting checklist. Blogger is only one optional publish target.

## What it does
- Collects Fallout-related content from press, official channels, Steam, and a curated Reddit custom feed
- Rotates daily between **news**, **mod spotlights**, and **community highlights**
- Ranks stories by relevance, freshness, and source quality
- Enriches top stories with additional page context when available
- Uses Gemini to write substantive, shareable articles with key facts and sourced trust markers
- Saves each publishable article as a numbered HTML file under **`posts/`** for manual paste into Blogger (no Blogger API)
- Tracks a 21-day story history to avoid repeats

## Local setup
1. Copy `.env.example` to `.env` and fill in your values.
2. Add `REDDIT_CUSTOM_FEED_URL` with your private Fallout multireddit/custom feed `.rss` URL.
3. Run `npm run fallout:generate`.
4. Open the new file in `posts/` (e.g. `No.01 - Your Title.html`):
   - Copy **TITLE**, **SEARCH DESCRIPTION**, and **TAGS** from the HTML comment at the top into Blogger’s fields
   - Copy the `<article>…</article>` block into Blogger’s HTML compose view
5. Debug JSON (gitignored) is also written to `artifacts/latest-draft.json`.

## Required secrets for GitHub Actions
- `GEMINI_API_KEY`
- `REDDIT_CUSTOM_FEED_URL`
- `DISCORD_WEBHOOK_URL` (for the daily Discord blog share workflow)

Optional fallbacks:
- `GEMINI_API_KEY_FALLBACK`
- `GEMINI_API_KEY_FALLBACK_2`

## Editorial standards
Fallout Hub posts are designed to be:
- **Trustworthy** — facts sourced, rumors excluded, community content clearly labeled
- **Useful** — key facts up front, clear explanation of why fans should care
- **Shareable** — specific titles, strong hooks, and insight worth passing along

### Fan-first pipeline rules
- **Official > confirmed press coverage > unconfirmed press reports > community**
- Multi-outlet packages on one studio announcement (e.g. FO5 + remasters + Raven Rock) become **one** article
- Confirmed studio news is not hedged as a leak; only TBA dates/windows stay soft
- Optional: add a first-party link to `data/manual-seeds.json` with `"tier": "official"` when press is slow

## LLM setup
Use a Gemini API key from Google AI Studio and store it as `GEMINI_API_KEY`.

## Discord announcements
A separate workflow (`.github/workflows/discord-blog-share.yml`) checks the Blogger RSS feed once per day and posts newly **published** articles to your Discord server.

1. Create a Discord webhook for your announcement channel.
2. Add it to GitHub as `DISCORD_WEBHOOK_URL`.
3. The first successful run bootstraps silently (marks existing posts as seen, no spam).
4. After you publish a new post on Blogger, the next daily run shares it to Discord.