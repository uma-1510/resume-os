// linkedin.js — Extract job data from LinkedIn job listing pages
//
// WHY multiple fallback selectors:
//   LinkedIn updates their React frontend frequently. Class names and element
//   hierarchy change without notice. A single selector will break silently.
//   We try 3+ selectors per field in order of specificity, falling back to
//   increasingly broad approaches.

export function extractLinkedInJob() {
  const job = {
    title: extractTitle(),
    company: extractCompany(),
    location: extractLocation(),
    description: extractDescription(),
    source: 'linkedin',
    url: window.location.href,
  };

  // Return null if we couldn't extract the minimum required fields
  if (!job.title || !job.description) return null;
  return job;
}

function extractTitle() {
  const selectors = [
    // Current selectors (as of 2025)
    '.job-details-jobs-unified-top-card__job-title h1',
    '.top-card-layout__title',
    '.jobs-unified-top-card__job-title h1',
    'h1.jobs-unified-top-card__job-title',
    // Fallbacks
    '[data-test-job-title]',
    '.job-title',
    'h1',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return null;
}

function extractCompany() {
  const selectors = [
    '.job-details-jobs-unified-top-card__company-name a',
    '.job-details-jobs-unified-top-card__company-name',
    '.top-card-layout__card .topcard__org-name-link',
    '.jobs-unified-top-card__company-name a',
    '.jobs-unified-top-card__company-name',
    '[data-test-company-name]',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return '';
}

function extractLocation() {
  const selectors = [
    '.job-details-jobs-unified-top-card__bullet',
    '.jobs-unified-top-card__bullet',
    '.topcard__flavor--bullet',
    '[data-test-job-location]',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return '';
}

function extractDescription() {
  const selectors = [
    // #job-details is LinkedIn's current stable container (2025–2026)
    '#job-details',
    '.jobs-description__content .jobs-box__html-content',
    '.jobs-description-content__text',
    '.jobs-description__container',
    // Generic fallbacks
    '[data-test-job-description]',
    '.description__text',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim().length > 100) {
      return el.textContent.trim();
    }
  }
  return null;
}