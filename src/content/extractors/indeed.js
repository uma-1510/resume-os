// indeed.js — Extract job data from Indeed job listing pages

export function extractIndeedJob() {
  const job = {
    title: extractTitle(),
    company: extractCompany(),
    location: extractLocation(),
    description: extractDescription(),
    source: 'indeed',
    url: window.location.href,
  };

  if (!job.title || !job.description) return null;
  return job;
}

function extractTitle() {
  const selectors = [
    '[data-testid="jobsearch-JobInfoHeader-title"] span',
    '[data-testid="jobsearch-JobInfoHeader-title"]',
    '.jobsearch-JobInfoHeader-title',
    '.icl-u-xs-mb--xs.icl-u-xs-mt--none',
    'h1.jobsearch-JobInfoHeader-title',
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
    '[data-testid="inlineHeader-companyName"] a',
    '[data-testid="inlineHeader-companyName"]',
    '[data-company-name]',
    '.jobsearch-InlineCompanyRating-companyHeader a',
    '.icl-u-lg-mr--sm.icl-u-xs-mr--xs',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return '';
}

function extractLocation() {
  const selectors = [
    '[data-testid="job-location"]',
    '[data-testid="inlineHeader-companyLocation"]',
    '.jobsearch-JobInfoHeader-subtitle > div:last-child',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return '';
}

function extractDescription() {
  const selectors = [
    '#jobDescriptionText',
    '[id^="jobDescriptionText"]',
    '.jobsearch-jobDescriptionText',
    '[data-testid="jobDescriptionText"]',
    '.jobsearch-JobComponent-description',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim().length > 100) {
      return el.textContent.trim();
    }
  }
  return null;
}
