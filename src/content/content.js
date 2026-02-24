// content.js — Content script: job detection + badge + relay
//
// WHY MutationObserver with debounce:
//   LinkedIn and Indeed are React SPAs. The job description doesn't exist
//   in the DOM on page load — it renders asynchronously after navigation.
//   We watch for DOM changes and wait 800ms of silence before trying to
//   extract. 800ms debounce avoids firing during rapid React re-renders.
//
// WHY this script only relays data (never calls AI or storage):
//   Content scripts run in the page's context. They CAN access the DOM,
//   but they CANNOT: call external APIs directly (CORS), use chrome.downloads,
//   or import npm packages. Their job is to extract and relay only.

import { extractLinkedInJob } from './extractors/linkedin.js';
import { extractIndeedJob } from './extractors/indeed.js';

const DEBOUNCE_MS = 800;
let debounceTimer = null;
let lastExtractedUrl = null;
let badgeEl = null;

//Determine which extractor to use
function getExtractor() {
  const host = window.location.hostname;
  if (host.includes('linkedin.com')) return extractLinkedInJob;
  if (host.includes('indeed.com')) return extractIndeedJob;
  return null;
}

//Attempt extraction and relay to background
function tryExtract() {
  const extractor = getExtractor();
  if (!extractor) return;

  // Don't re-extract the same URL (handles SPA navigation to same page)
  const currentUrl = window.location.href;
  if (currentUrl === lastExtractedUrl) return;

  const job = extractor();
  if (!job) {
    // Extraction failed — fall through to manual paste mode silently
    // The side panel's manual paste textarea is always available
    return;
  }

  lastExtractedUrl = currentUrl;

  // Relay to background.js which will broadcast to the side panel
  chrome.runtime.sendMessage({ action: 'JOB_DETECTED', data: job });

  // Show floating badge on the page
  showBadge(job);
}

// ─── MutationObserver setup ───────────────────────────────────────────────
const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(tryExtract, DEBOUNCE_MS);
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// Retry with increasing delays — LinkedIn's job description loads in a
// second async fetch after the page shell. 1s is often not enough.
// We try at 1s, 2.5s, and 5s to cover slow connections and lazy-loaded content.
[1000, 2500, 5000].forEach(delay => setTimeout(tryExtract, delay));

// ─── Floating badge ───────────────────────────────────────────────────────
// A small non-intrusive toast that appears when a job is detected.
// Clicking it opens the side panel.
// Auto-dismisses after 8 seconds.
//
// WHY 8 seconds: Long enough for the user to notice and click,
// short enough not to annoy users who don't need it right now.
function showBadge(job) {
  // Remove any existing badge
  if (badgeEl) badgeEl.remove();

  badgeEl = document.createElement('div');
  badgeEl.id = 'resumeos-badge';
  badgeEl.innerHTML = `
    <div class="ros-badge-icon">✦</div>
    <div class="ros-badge-text">
      <strong>ResumeOS</strong>
      <span>${job.title} at ${job.company || 'this company'} detected</span>
    </div>
    <button class="ros-badge-close" aria-label="Dismiss">×</button>
  `;

  document.body.appendChild(badgeEl);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      badgeEl.classList.add('ros-badge-visible');
    });
  });

  // Click badge body → open side panel
  badgeEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('ros-badge-close')) {
      dismissBadge();
      return;
    }
    chrome.runtime.sendMessage({ action: 'OPEN_SIDE_PANEL' });
    dismissBadge();
  });

  // Auto-dismiss
  setTimeout(dismissBadge, 8000);
}

function dismissBadge() {
  if (!badgeEl) return;
  badgeEl.classList.remove('ros-badge-visible');
  setTimeout(() => {
    badgeEl?.remove();
    badgeEl = null;
  }, 300);
}