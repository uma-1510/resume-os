# ResumeOS · Chrome Extension

> Auto-tailor your resume to any job listing using Gemini AI.  
> Zero servers. Your data stays in your browser. Free tier.

---

## Architecture Summary

```
resumeos/
├── manifest.json              # MV3 · sidePanel · permissions
├── build.js                   # esbuild bundler config
├── package.json
├── src/
│   ├── background/
│   │   └── background.js      # Service worker: AI calls · docx · storage
│   ├── content/
│   │   ├── content.js         # URL detection · MutationObserver · badge
│   │   ├── content.css        # Badge styles
│   │   └── extractors/
│   │       ├── linkedin.js    # LinkedIn DOM extractor (3+ fallback selectors)
│   │       └── indeed.js      # Indeed DOM extractor (3+ fallback selectors)
│   ├── sidepanel/
│   │   ├── sidepanel.html     # Shell: 3-tab nav
│   │   ├── sidepanel.js       # Tab routing · keyword analysis · download trigger
│   │   └── sidepanel.css      # Full UI (dark navy, teal accent)
│   └── utils/
│       ├── ai.js              # Gemini SDK wrapper + error parsing
│       ├── keywords.js        # TF-IDF extraction · cosine similarity
│       ├── docx.js            # Resume JSON → .docx (docx.js)
│       ├── memory.js          # Session write · aggregate · preference summary
│       ├── prompts.js         # System prompt + memory injection
│       └── resume-parser.js   # mammoth.js wrapper (.docx→text) · PDF rejection
└── dist/                      # Build output (generated)
    ├── background.js
    └── content.js
```

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Build

```bash
# One-time build
npm run build

# Watch mode (rebuilds on file changes)
npm run dev
```

### 3. Load in Chrome

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `resumeos/` folder (the root, not `dist/`)

### 4. Configure the extension

1. Click the ResumeOS icon in your toolbar (or navigate to a new tab)
2. The side panel opens on the Settings tab
3. Enter your name, Gemini API key, and upload your base resume
4. Click **Save Settings** — the key is validated live before saving

### Get a free Gemini API key

1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Sign in with a Google account
3. Create a new API key
4. Free tier: **15 requests/minute, 1500 requests/day**

---

## Key Design Decisions

### Why no backend / auth?
Auth requires a backend to verify tokens, store accounts, and manage sessions. This contradicts the core value: zero servers, your data never leaves your browser. Everything is stored in `chrome.storage.local`.

### Why the Gemini SDK (not raw fetch)?
Direct `fetch()` to Gemini's REST endpoint from a browser extension fails with CORS errors. The `@google/generative-ai` SDK uses a request path Chrome's extension context permits. Bundle cost: ~85KB minified — acceptable.

### Why the download is triggered from sidepanel.js (not background.js)?
`chrome.downloads.download({ saveAs: true })` requires a user gesture. The gesture context is lost after an async AI call chain in background.js. Solution: background generates the `.docx` and returns base64 → side panel button click handler (which HAS the gesture) triggers the actual download.

### Why only .docx and .txt (no PDF)?
PDF text extraction breaks on multi-column layouts, decorative fonts, and image-based PDFs. mammoth.js for `.docx` is clean and reliable. On PDF upload, we show a clear error message instead of attempting bad extraction.

### Why TF-IDF for keyword analysis?
Simple word frequency counts "the", "and", "experience" as important. TF-IDF weights by rarity — so "pytorch" scores much higher than generic job posting filler words. The analysis runs instantly in the browser with zero API calls.

### Why "Keyword Match Score" not "ATS Score"?
Workday, Greenhouse, and Lever all parse differently. Calling it a keyword match score is accurate and still meaningful. Claiming to predict ATS outcomes would be misleading.

---

## How career memory works

After each confirmed download, the session is stored in `chrome.storage.local`:

```json
{
  "sessions": [{
    "id": 1708689123456,
    "date": "2026-02-23",
    "job": { "title": "ML Engineer", "company": "Anthropic", "source": "linkedin" },
    "targetRole": "ML Engineer",
    "keywordsUsed": ["pytorch", "rlhf", "distributed"],
    "bulletVerbs": ["Built", "Led", "Reduced"],
    "avgBulletLen": 19,
    "status": "tailored"
  }],
  "aggregate": {
    "totalSessions": 14,
    "targetRoles": { "ML Engineer": 8, "Data Scientist": 4 },
    "topKeywords": ["pytorch", "python", "distributed", "rlhf"],
    "topBulletVerbs": ["Built", "Led", "Reduced"],
    "avgBulletLen": 18,
    "preferenceSummary": "User targets ML Engineer roles. Prefers action-verb bullets averaging 18 words.",
    "summaryBuiltAt": 10
  }
}
```

Every 5 sessions, a preference summary is regenerated via a small Gemini call and injected into future rewrites as a system prompt context block.

---

## Known challenges

| Challenge | Mitigation |
|-----------|------------|
| LinkedIn/Indeed rotate DOM selectors | 3+ fallback selectors per field. Failure auto-falls through to manual paste. |
| API key validation at onboarding | Test call on Save — shows exact Gemini error inline if key is bad. |
| Gemini 429 rate limit | Caught explicitly. Shows friendly 60s wait message. Button disabled. |
| AI returns malformed JSON | Strip markdown fences. try/catch with user-friendly fallback. |
| saveAs gesture loss in async chain | Download triggered from side panel click handler, never from background. |
| API key stored as plaintext | Disclosed in Settings below the field. Same model as browser saved passwords. |

---

## Build phases

### Phase 1 (Week 1–2) — Core
- [x] Extension scaffold + manifest MV3
- [x] 3-tab side panel shell + nav indicator
- [x] Settings tab: name · API key · base resume
- [x] Onboarding gate
- [x] Gemini SDK integration + key validation
- [x] LinkedIn + Indeed extractors
- [x] Manual paste textarea
- [x] AI rewrite → preview render
- [x] .docx generation + Save-As download

### Phase 2 (Week 3–4) — Polish
- [ ] Keyword score ring + tag cloud (built, needs testing)
- [ ] Authenticity flag amber highlights
- [ ] Regenerate button + cost label
- [ ] 429 rate limit error handling
- [ ] mammoth.js .docx upload parser
- [ ] PDF rejection error message
- [ ] Floating badge on job pages
- [ ] History tab — session list + status updater
- [ ] Career memory write per session

### Phase 3 (Week 5–6) — Intelligence
- [ ] Preference summary generation (every 5 sessions)
- [ ] Memory injection into AI prompt
- [ ] Extractor health monitoring
- [ ] Chrome Web Store prep
