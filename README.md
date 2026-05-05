# AI Page Summarizer Chrome Extension

A local Manifest V3 Chrome extension that extracts readable content from the current page, sends it to a secure local AI proxy, displays a structured summary, caches results per URL, and can highlight key phrases in the page.

## Features

- Manifest V3 extension with popup, background service worker, content script, and options page.
- Readable-content extraction that prefers `article`, `main`, and article-like containers while removing nav, ads, comments, forms, cookie banners, and sidebar clutter.
- AI-generated bullet summary, key insights, estimated reading time, and highlight phrases.
- `chrome.storage.local` cache per URL and summary mode to avoid duplicate calls.
- Clean popup UI with loading state, errors, copy button, reset button, keyboard focus states, and dark/light mode support.
- Secure local proxy pattern so no API key is committed or bundled into the extension.

## Local Installation

This extension is meant to run locally. It should not be uploaded to the Chrome Web Store.

1. Clone or download this repository.
2. Start the AI proxy from the repository folder:

   ```bash
   OPENROUTER_API_KEY=sk-or-v1-your-key-here GEMINI_API_KEY=your-gemini-key-here npm run proxy
   ```

   Optional:

   ```bash
   OPENROUTER_MODEL=openai/gpt-4o-mini GEMINI_MODEL=gemini-2.5-flash OPENROUTER_API_KEY=sk-or-v1-your-key-here GEMINI_API_KEY=your-gemini-key-here npm run proxy
   ```

3. Open Chrome and go to `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select this repository folder.
7. Open an article page, click the extension icon, and press **Summarize Page**.

## Architecture

```text
manifest.json
src/
  background/service-worker.js  Receives trusted messages, calls the proxy, caches summaries.
  content/content-script.js     Extracts page content and safely highlights key phrases.
  popup/                        Extension popup UI and interaction logic.
  options/                      Settings for proxy URL, default length, and highlighting.
proxy/server.js                 Local Node proxy that calls the OpenAI Responses API.
```

Flow:

1. The popup asks the active tab's content script to extract readable page content.
2. The popup sends that extracted content to the background service worker.
3. The service worker checks `chrome.storage.local` for a cached summary.
4. If no cache exists, the service worker posts the page payload to the local proxy.
5. The proxy reads provider keys from the environment, calls OpenRouter first, and falls back to Gemini if needed.
6. The service worker returns normalized summary data to the popup.
7. The popup renders with `textContent`, and optional highlighting is performed by the content script using safe DOM text-node wrapping.

## AI Integration

The extension calls a local proxy at:

```text
http://127.0.0.1:8787/summarize
```

The proxy uses OpenRouter as the primary AI provider and Gemini as the fallback provider. Both integrations request structured JSON with:

- `bullets`
- `insights`
- `readingTimeMinutes`
- `keyPhrases`

Environment variables:

- `OPENROUTER_API_KEY`: primary provider key.
- `OPENROUTER_MODEL`: optional, defaults to `openai/gpt-4o-mini`.
- `GEMINI_API_KEY`: fallback provider key.
- `GEMINI_MODEL`: optional, defaults to `gemini-2.5-flash`.

You can change the proxy URL on the extension options page, but the extension only accepts `localhost` or `127.0.0.1` HTTP proxy URLs to avoid accidentally sending page content to an untrusted remote endpoint.

## Security Decisions

- No API keys are hardcoded in extension or proxy files.
- `.env` files are ignored by Git.
- The content script never receives API secrets.
- The proxy reads `OPENROUTER_API_KEY` and `GEMINI_API_KEY` from the local environment only.
- The popup never uses `innerHTML` for AI output; summary text is rendered with `textContent`.
- In-page highlights are created with DOM text nodes and `mark.textContent`, not HTML injection.
- Message handling validates known message types and normalizes payloads.
- Permissions are limited to `activeTab`, `storage`, and local proxy host access.
- The extension only runs content scripts on `http` and `https` pages.

## Trade-offs

- A local proxy is slightly more setup than calling OpenAI directly, but it keeps secrets out of the extension bundle.
- The readability extraction uses lightweight heuristics instead of a large parser, keeping the extension fast and dependency-free.
- Host access is limited to the local proxy. If you deploy a remote proxy, update `host_permissions` in `manifest.json` and review the security model first.
- The summary cache expires after 24 hours and is scoped by URL plus summary length.

## Development

Run syntax checks:

```bash
npm run check
```

Run the proxy:

```bash
OPENROUTER_API_KEY=sk-or-v1-your-key-here GEMINI_API_KEY=your-gemini-key-here npm run proxy
```

## React Popup Component

If you want to wire the popup yourself, use the standalone React component in `src/popup/Popup.tsx` with its styles in `src/popup/popup-component.css`.

```tsx
import Popup, { type PopupStatus, type SummaryResult } from "./Popup";

<Popup
  status="idle"
  pageTitle="Article title"
  summary={summary}
  errorMessage={errorMessage}
  onSummarize={summarizePage}
  onRetry={summarizePage}
  onCopy={copySummary}
  onClear={clearSummary}
/>;
```

Supported states are `idle`, `loading`, `result`, and `error`.

# page-sage
