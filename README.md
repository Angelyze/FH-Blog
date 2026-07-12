# Fallout Blogger automation

This repository contains a starter automation for generating one daily Fallout news draft article and sending it to Blogger as a draft.

## What it does
- collects recent Fallout-related headlines from a small list of approved RSS feeds
- ranks the stories by relevance and freshness
- uses an LLM to turn the best story into a casual, conversational article draft
- creates a Blogger draft when the required credentials are available
- writes the result locally as a JSON file for manual review

## Local setup
1. Copy .env.example to .env and fill in your values.
2. Run `npm run fallout:generate`.

## Required secrets for GitHub Actions
- GEMINI_API_KEY
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REFRESH_TOKEN
- BLOGGER_BLOG_ID

## Blogger API setup
Follow the step-by-step OAuth flow described in the earlier instructions:
1. Create a Google Cloud project.
2. Enable the Blogger API.
3. Create OAuth Client ID credentials.
4. Configure the OAuth consent screen.
5. Authorize the Blogger scope using Google OAuth Playground.
6. Save the refresh token and blog ID as GitHub secrets.

## LLM setup
Use a Gemini API key from Google AI Studio and store it as `GEMINI_API_KEY`.
