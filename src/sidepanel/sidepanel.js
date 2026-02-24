// sidepanel.js — Main side panel controller
//
// Architecture principles enforced here:
//   • All AI calls go through background.js via chrome.runtime.sendMessage
//   • The download button click handler (not background) triggers chrome.downloads
//     to preserve the user gesture context needed for saveAs: true
//   • Settings tab is always present in tabs — it's not removed after onboarding
//   • On first load with onboardingDone=false → force Settings tab
//   • On subsequent loads → open Tailor tab by default

import { analyzeKeywords } from '../utils/keywords.js';


// Keyword compatibility adapter (NEW ENGINE → OLD UI)

function flattenKeywordAnalysis(analysis) {
  if (!analysis) {
    return {
      matched: [],
      missing: [],
      jdKeywords: []
    };
  }

  return {
    // approved keywords = matched
    matched: analysis.approvedKeywords || [],

    // merge all missing skills from skill graph
    missing: [
  ...(analysis.hardSkills?.skills || [])
    .filter(s => s.status === "missing")
    .map(s => s.name),

  ...(analysis.softSkills?.skills || [])
    .filter(s => s.status === "missing")
    .map(s => s.name),

  ...(analysis.otherSkills?.skills || [])
    .filter(s => s.status === "missing")
    .map(s => s.name),
],

    // keep JD keywords if present
    jdKeywords: analysis.jdKeywords || []
  };
}

// ─── State ────────────────────────────────────────────────────────────────
let state = {
  onboardingDone: false,
  detectedJob: null,       // { title, company, source, url, description }
  currentJob: null,        // resolved job (detected or manual paste)
  keywordAnalysis: null,   // { score, matched, missing, jdKeywords }
  pendingResume: null,     // resume JSON from AI (waiting for download confirmation)
  pendingDocx: null,       // { base64, filename } waiting for download click
  pendingSessionData: null, // data to record after confirmed download
  isLoading: false,
  activeTab: 'tailor',
};

// ─── DOM refs ─────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  // Status
  statusBadge: $('statusBadge'),
  statusText: $('statusText'),

  // Tabs
  tabTailor: $('tab-tailor'),
  tabHistory: $('tab-history'),
  tabSettings: $('tab-settings'),
  panelTailor: $('panel-tailor'),
  panelHistory: $('panel-history'),
  panelSettings: $('panel-settings'),

  // Onboarding
  onboardingBanner: $('onboardingBanner'),
  bannerGoToSettings: $('bannerGoToSettings'),

  // Job section
  detectedJobCard: $('detectedJobCard'),
  detectedSource: $('detectedSource'),
  detectedTitle: $('detectedTitle'),
  detectedCompany: $('detectedCompany'),
  noJobCard: $('noJobCard'),
  manualPasteSection: $('manualPasteSection'),
  jobDescTextarea: $('jobDescTextarea'),

  // Keywords
  keywordSection: $('keywordSection'),
  scoreRing: $('scoreRing'),
  scoreValue: $('scoreValue'),
  scoreSubtext: $('scoreSubtext'),
  keywordTags: $('keywordTags'),

  // Tailor button
  tailorBtnSection: $('tailorBtnSection'),
  tailorBtn: $('tailorBtn'),
  tailorBtnText: $('tailorBtnText'),

  // States
  loadingState: $('loadingState'),
  errorState: $('errorState'),
  errorMsg: $('errorMsg'),
  errorRetryBtn: $('errorRetryBtn'),

  // Preview
  previewState: $('previewState'),
  resumePreview: $('resumePreview'),
  authenticityWarn: $('authenticityWarn'),
  authenticityWarnText: $('authenticityWarnText'),
  downloadBtn: $('downloadBtn'),
  regenerateBtn: $('regenerateBtn'),
  filenamePreview: $('filenamePreview'),

  // History
  historyCount: $('historyCount'),
  historyList: $('historyList'),

  // Settings
  setupBanner: $('setupBanner'),
  settingsName: $('settingsName'),
  settingsApiKey: $('settingsApiKey'),
  toggleApiKeyVisibility: $('toggleApiKeyVisibility'),
  keyVisIcon: $('keyVisIcon'),
  keyValidationResult: $('keyValidationResult'),
  resumeStatus: $('resumeStatus'),
  resumeStatusIcon: $('resumeStatusIcon'),
  resumeStatusText: $('resumeStatusText'),
  resumeError: $('resumeError'),
  resumeFileInput: $('resumeFileInput'),
  resumePasteArea: $('resumePasteArea'),
  saveSettingsBtn: $('saveSettingsBtn'),
  saveSettingsBtnText: $('saveSettingsBtnText'),
  clearMemoryBtn: $('clearMemoryBtn'),

  // Status dropdown
  statusDropdown: $('statusDropdown'),
};

// ─── Init ─────────────────────────────────────────────────────────────────
async function init() {
  await loadSettings();
  setupTabListeners();
  setupJobListeners();
  setupSettingsListeners();
  setupMessageListener();

  // Route to correct tab on load
  if (!state.onboardingDone) {
    switchTab('settings');
    els.setupBanner.style.display = 'flex';
    els.onboardingBanner.classList.remove('hidden');
  } else {
    switchTab('tailor');
    els.setupBanner.style.display = 'none';
    els.onboardingBanner.classList.add('hidden');
  }

  // Load history
  loadHistory();
}

// ─── Load settings from storage ───────────────────────────────────────────
async function loadSettings() {
  const { data } = await msg('GET_SETTINGS');
  if (!data) return;

  state.onboardingDone = data.onboardingDone;
  els.settingsName.value = data.name || '';
  els.settingsApiKey.value = data.apiKey || '';

  if (data.baseResumeText) {
    els.resumeStatus.classList.remove('hidden');
    els.resumeStatus.classList.add('has-resume');
    els.resumeStatusIcon.textContent = '✓';
    els.resumeStatusText.textContent = 'Base resume loaded';
  }

  updateStatusBadge(data);
}

function updateStatusBadge(settings) {
  const { onboardingDone, apiKey, baseResumeText } = settings || {};
  if (!onboardingDone || !apiKey) {
    setStatus('Setup needed', 'amber');
  } else {
    setStatus('Gemini connected', 'green');
  }
}

function setStatus(text, type = 'green') {
  els.statusText.textContent = text;
  els.statusBadge.className = 'status-badge ' + type;
}

// ─── Tab switching ─────────────────────────────────────────────────────────
function switchTab(tabName) {
  state.activeTab = tabName;

  // Update tab buttons
  [els.tabTailor, els.tabHistory, els.tabSettings].forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });

  // Show/hide panels
  els.panelTailor.classList.toggle('hidden', tabName !== 'tailor');
  els.panelHistory.classList.toggle('hidden', tabName !== 'history');
  els.panelSettings.classList.toggle('hidden', tabName !== 'settings');

  // Refresh history when switching to it
  if (tabName === 'history') loadHistory();
}

function setupTabListeners() {
  [els.tabTailor, els.tabHistory, els.tabSettings].forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  els.bannerGoToSettings.addEventListener('click', () => switchTab('settings'));
}

// ─── Job detection listener ────────────────────────────────────────────────
function setupMessageListener() {
  // Listen for job detected relay from background (which got it from content script)
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'JOB_DETECTED_RELAY') {
      handleDetectedJob(message.data);
    }
  });
}

function handleDetectedJob(job) {
  state.detectedJob = job;

  // Show detected job card
  els.detectedJobCard.classList.remove('hidden');
  els.detectedTitle.textContent = job.title || '—';
  els.detectedCompany.textContent = job.company || '';
  els.detectedSource.textContent = job.source === 'linkedin' ? 'LinkedIn' : 'Indeed';
  els.noJobCard.classList.add('hidden');

  // Collapse the manual paste label (still visible but secondary)
  els.manualPasteSection.querySelector('.field-label').textContent = 'Or paste a different job description';

  // Run keyword analysis
  runKeywordAnalysis(job.description);
}

// ─── Job input listeners ───────────────────────────────────────────────────
function setupJobListeners() {
  // Initial state: no detected job
  els.noJobCard.classList.remove('hidden');

  let keywordDebounce = null;

  els.jobDescTextarea.addEventListener('input', () => {
    clearTimeout(keywordDebounce);
    keywordDebounce = setTimeout(() => {
      const text = els.jobDescTextarea.value.trim();
      if (text.length > 50) {
        runKeywordAnalysis(text);
      } else {
        els.keywordSection.classList.add('hidden');
        els.tailorBtn.disabled = true;
      }
    }, 600);
  });

  // Tailor button
  els.tailorBtn.addEventListener('click', handleTailorClick);

  // Download button — has user gesture → can use saveAs: true
  els.downloadBtn.addEventListener('click', handleDownloadClick);

  // Regenerate
  els.regenerateBtn.addEventListener('click', handleRegenerateClick);

  // Error retry
  els.errorRetryBtn.addEventListener('click', handleTailorClick);
}

// ─── Keyword analysis 
// ─── Skill Gap Analysis
async function runKeywordAnalysis(jobDescription) {

  const { data } = await msg('GET_SETTINGS');

  if (!data?.baseResumeText) {
    els.tailorBtn.disabled = false;
    return;
  }

  const analysis = analyzeKeywords(jobDescription, data.baseResumeText);
  state.keywordAnalysis = analysis;
  
  // Count total keywords in JD
// state.keywordAnalysis.jdKeywords = [
//   ...(analysis.hardSkills.skills || []).map(s => s.name),
//   ...(analysis.softSkills.skills || []).map(s => s.name),
//   ...(analysis.otherSkills.skills || []).map(s => s.name),
// ];

  renderSkillGapUI(analysis);

  els.keywordSection.classList.remove('hidden');
  els.tailorBtn.disabled = false;
}

// ─── Skill Gap Renderer (NEW)
function renderSkillGapUI(analysis) {

  els.keywordTags.innerHTML = '';

  renderImpactBlock(
    "High Impact",
    "Hard Skills",
    analysis.hardSkills,
  );

  renderImpactBlock(
    "Medium Impact",
    "Soft Skills",
    analysis.softSkills,
  );

  renderImpactBlock(
    "Low Impact",
    "Other Skills",
    analysis.otherSkills,
  );

  // renderMetaSignals(analysis);
}

function renderImpactBlock(impactLabel, title, data, level) {
  const skills = data?.skills || [];

const missing = skills
  .filter(s => s.status === "missing")
  .map(s => s.name);

const matched = skills
  .filter(s => s.status === "matched")
  .map(s => s.name);

  const container = document.createElement('div');
  container.className = `impact-block ${level}`;

  const header = document.createElement('div');
  header.className = 'impact-header';

  header.innerHTML = `
    <div class="impact-title">
      <div class="impact-level">${impactLabel}</div>
      <div class="impact-skill">${title}</div>
    </div>
  `;

  container.appendChild(header);

  if (missing.length > 0) {
    const desc = document.createElement('div');
    desc.className = 'impact-desc';
    desc.textContent =
      `${missing.length} ${title} Not Found: Adding these will significantly improve alignment.`;
    container.appendChild(desc);
  }

  const tagWrap = document.createElement('div');
  tagWrap.className = 'impact-tags';

  missing.forEach(skill => {
    const tag = document.createElement('span');
    tag.className = 'kw-tag missing';
    tag.textContent = skill;
    tagWrap.appendChild(tag);
  });

  matched.forEach(skill => {
    const tag = document.createElement('span');
    tag.className = 'kw-tag matched';
    tag.textContent = skill;
    tagWrap.appendChild(tag);
  });

  container.appendChild(tagWrap);
  els.keywordTags.appendChild(container);
}

// function renderMetaSignals(analysis) {

//   const meta = document.createElement('div');
//   meta.className = 'meta-signals';

//   // Job title match
//   const titleMsg = document.createElement('div');
//   titleMsg.className = 'meta-good';

//   titleMsg.textContent = analysis.titleMatch
//     ? "Great work! Job title found in your resume."
//     : "Job title not detected in resume.";

//   meta.appendChild(titleMsg);

//   // Degree gap
//   if (analysis.degreeGap === "phd_preferred") {
//     const warn = document.createElement('div');
//     warn.className = 'meta-warning';
//     warn.textContent =
//       "Be advised! Job prefers a Ph.D. but your resume does not list one.";
//     meta.appendChild(warn);
//   }

//   els.keywordTags.appendChild(meta);
// }


// ─── Resolve current job (detected or manual paste)
function resolveJobDescription() {
  const pastedText = els.jobDescTextarea.value.trim();

  // If user pasted something, that takes priority
  if (pastedText.length > 50) {
    return {
      description: pastedText,
      title: state.detectedJob?.title || 'Position',
      company: state.detectedJob?.company || 'Company',
      source: 'manual',
      url: '',
    };
  }

  // Otherwise use detected job
  if (state.detectedJob) {
    return state.detectedJob;
  }

  return null;
}

// ─── Tailor click ──────────────────────────────────────────────────────────
async function handleTailorClick() {
  const job = resolveJobDescription();
  if (!job) {
    showError('Please paste a job description to tailor your resume.');
    return;
  }

  state.currentJob = job;
  showLoading();

  try {
    const { data, error } = await msg('TAILOR_RESUME', {
      jobDescription: job.description,
      missingKeywords: flattenKeywordAnalysis(state.keywordAnalysis).missing,
      jdKeywords: state.keywordAnalysis?.jdKeywords || [],
    });

    if (error) throw error;

    state.pendingResume = data.resume;
    showPreview(data.resume, job);
  } catch (err) {
    showError(formatError(err));
  }
}

// ─── Preview 
function showPreview(resume, job) {
  hideAll();

  // Count inauthentic bullets
  let inauthCount = 0;
  for (const exp of resume.experience || []) {
    for (const b of exp.bullets || []) {
      if (!b.authentic) inauthCount++;
    }
  }

  // Authenticity warning
  if (inauthCount > 0) {
    els.authenticityWarn.style.display = 'flex';
    els.authenticityWarnText.textContent =
      `${inauthCount} bullet${inauthCount > 1 ? 's' : ''} flagged — AI may have added content not in your original resume. Verify before sending.`;
  } else {
    els.authenticityWarn.style.display = 'none';
  }

  // Render preview HTML
  els.resumePreview.innerHTML = renderResumePreview(resume);

  // Filename preview
  const name = (resume.name || 'Resume').split(' ')[0];
  const company = (job.company || 'Company').replace(/\s/g, '');
  const role = (job.title || 'Role').replace(/\s/g, '');
  const date = new Date().toISOString().split('T')[0];
  const filename = `${name}_${company}_${role}_${date}.docx`;
  els.filenamePreview.textContent = `↓ ${filename}`;

  els.previewState.classList.remove('hidden');
  els.previewState.classList.add('fade-in');
}

function renderResumePreview(resume) {
  let html = '';

  // Name + contact
  html += `<div class="preview-name">${esc(resume.name)}</div>`;
  const contact = [resume.email, resume.phone, resume.location, resume.linkedin]
    .filter(Boolean).join(' · ');
  if (contact) html += `<div class="preview-contact">${esc(contact)}</div>`;

  // Summary
  if (resume.summary) {
    html += `<div class="preview-section-title">Summary</div>`;
    html += `<div class="preview-summary">${esc(resume.summary)}</div>`;
  }

  // Experience
  if (resume.experience?.length) {
    html += `<div class="preview-section-title">Experience</div>`;
    for (const job of resume.experience) {
      html += `<div class="preview-job-title">${esc(job.title)}</div>`;
      html += `<div class="preview-job-company">${esc(job.company)} · ${esc(job.dates)}</div>`;
      for (const bullet of job.bullets || []) {
        const cls = bullet.authentic === false ? 'preview-bullet flagged' : 'preview-bullet';
        html += `<div class="${cls}">${esc(bullet.text)}</div>`;
      }
    }
  }

  // Skills
  if (resume.skills?.length) {
    html += `<div class="preview-section-title">Skills</div>`;
    html += `<div class="preview-skills">`;
    for (const skill of resume.skills) {
      html += `<span class="preview-skill-tag">${esc(skill)}</span>`;
    }
    html += `</div>`;
  }

  // Education
  if (resume.education?.length) {
    html += `<div class="preview-section-title">Education</div>`;
    for (const ed of resume.education) {
      html += `<div class="preview-job-title">${esc(ed.institution)}</div>`;
      html += `<div class="preview-job-company">${esc(ed.degree)} · ${esc(ed.dates)}</div>`;
    }
  }

  return html;
}

// ─── Download ──────────────────────────────────────────────────────────────
// WHY download is triggered here (not in background):
//   chrome.downloads.download({ saveAs: true }) needs a user gesture.
//   The button click handler IS that gesture. Background receives the
//   base64 docx data → we create an object URL here → trigger download.
async function handleDownloadClick() {
  if (!state.pendingResume || !state.currentJob) return;

  els.downloadBtn.disabled = true;
  els.downloadBtn.querySelector('span:not(.btn-icon)').textContent = 'Generating...';

  try {
    const { data, error } = await msg('GENERATE_DOCX', {
      resume: state.pendingResume,
      jobData: state.currentJob,
    });

    if (error) throw error;

    // Decode base64 → Blob → object URL
    // WHY object URL: chrome.downloads.download needs a URL, not a Blob directly
    const binaryStr = atob(data.base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const url = URL.createObjectURL(blob);

    // Trigger download with Save-As dialog
    // This call MUST happen synchronously within the click handler to preserve gesture
    chrome.downloads.download({
      url,
      filename: data.filename,
      saveAs: true,
    }, (downloadId) => {
      URL.revokeObjectURL(url); // Clean up object URL

      if (chrome.runtime.lastError) {
        console.error('[ResumeOS] Download error:', chrome.runtime.lastError);
      }
    });

    // Record session to career memory (async, non-blocking)
    msg('RECORD_SESSION', {
      jobData: state.currentJob,
      confirmedResume: state.pendingResume,
      keywordsUsed: state.keywordAnalysis?.matched || [],
    }).catch(err => console.warn('[ResumeOS] Session record failed:', err));

    // Show success state
    els.downloadBtn.querySelector('span:not(.btn-icon)').textContent = '✓ Downloading...';
    setTimeout(() => {
      resetTailorTab();
    }, 2000);

  } catch (err) {
    els.downloadBtn.disabled = false;
    els.downloadBtn.querySelector('span:not(.btn-icon)').textContent = 'Looks Good — Download .docx';
    showError(formatError(err));
  }
}

// ─── Regenerate ────────────────────────────────────────────────────────────
async function handleRegenerateClick() {
  if (!state.currentJob) return;

  els.previewState.classList.add('hidden');
  showLoading();

  try {
    const { data, error } = await msg('TAILOR_RESUME', {
      jobDescription: state.currentJob.description,
      missingKeywords: state.keywordAnalysis?.missing || [],
      jdKeywords: state.keywordAnalysis?.jdKeywords || [],
    });

    if (error) throw error;

    state.pendingResume = data.resume;
    showPreview(data.resume, state.currentJob);
  } catch (err) {
    showError(formatError(err));
  }
}

// ─── Settings ──────────────────────────────────────────────────────────────
function setupSettingsListeners() {
  // Toggle API key visibility
  els.toggleApiKeyVisibility.addEventListener('click', () => {
    const isPassword = els.settingsApiKey.type === 'password';
    els.settingsApiKey.type = isPassword ? 'text' : 'password';
    els.keyVisIcon.textContent = isPassword ? '🙈' : '👁';
  });

  // Resume file upload
  els.resumeFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const filename = file.name;
    const ext = filename.split('.').pop().toLowerCase();

    // Reject PDF immediately with clear error
    if (ext === 'pdf') {
      els.resumeError.textContent = '✗ PDF not supported — save your resume as .docx or paste the text directly.';
      els.resumeError.classList.remove('hidden');
      return;
    }

    // Convert file to base64 for message passing
    const base64 = await fileToBase64(file);

    const { data, error } = await msg('PARSE_RESUME_FILE', { fileData: base64, filename });

    if (error || data?.error) {
      els.resumeError.textContent = `✗ ${error?.message || data?.error}`;
      els.resumeError.classList.remove('hidden');
      els.resumeStatus.classList.add('hidden');
      return;
    }

    els.resumeError.classList.add('hidden');
    els.resumePasteArea.value = data.text;
    els.resumeStatus.classList.remove('hidden');
    els.resumeStatus.classList.add('has-resume');
    els.resumeStatusIcon.textContent = '✓';
    els.resumeStatusText.textContent = `${filename} · ready`;
  });

  // Save settings
  els.saveSettingsBtn.addEventListener('click', handleSaveSettings);

  // Clear memory
  els.clearMemoryBtn.addEventListener('click', async () => {
    if (!confirm('Clear all career memory? This removes session history and preferences. Cannot be undone.')) return;
    await msg('CLEAR_MEMORY');
    loadHistory();
  });
}

async function handleSaveSettings() {
  const name = els.settingsName.value.trim();
  const apiKey = els.settingsApiKey.value.trim();
  const resumeText = els.resumePasteArea.value.trim();

  if (!name) {
    els.settingsName.focus();
    return;
  }
  if (!apiKey) {
    els.settingsApiKey.focus();
    return;
  }
  if (!resumeText) {
    els.resumePasteArea.focus();
    return;
  }

  els.saveSettingsBtnText.textContent = 'Saving...';
  els.saveSettingsBtn.disabled = true;

  // ✅ No Gemini validation call anymore
  els.keyValidationResult.textContent =
    '✓ Settings saved (API key will be verified on first use)';
  els.keyValidationResult.className = 'validation-result success';
  els.keyValidationResult.classList.remove('hidden');

  await msg('SAVE_SETTINGS', {
    name,
    apiKey,
    baseResumeText: resumeText,
    onboardingDone: true,
  });

  state.onboardingDone = true;
  els.setupBanner.style.display = 'none';
  els.onboardingBanner.classList.add('hidden');
  setStatus('Gemini connected', 'green');

  els.saveSettingsBtnText.textContent = '✓ Saved';

  setTimeout(() => {
    els.saveSettingsBtnText.textContent = 'Save Settings';
    els.saveSettingsBtn.disabled = false;
    switchTab('tailor');
  }, 1200);
}

// ─── History ───────────────────────────────────────────────────────────────
async function loadHistory() {
  const { data } = await msg('GET_MEMORY');
  if (!data?.memory) return;

  const sessions = [...(data.memory.sessions || [])].reverse(); // newest first

  els.historyCount.textContent = sessions.length > 0
    ? `${sessions.length} Application${sessions.length !== 1 ? 's' : ''}`
    : 'Applications';

  if (sessions.length === 0) {
    els.historyList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-title">No applications yet</div>
        <div class="empty-desc">Tailored resumes will appear here</div>
      </div>`;
    return;
  }

  els.historyList.innerHTML = sessions.map(s => `
    <div class="history-item" data-session-id="${s.id}">
      <div class="hist-dot ${s.status || 'tailored'}"></div>
      <div class="hist-info">
        <div class="hist-title">${esc(s.job.title)} · ${esc(s.job.company)}</div>
        <div class="hist-sub">${s.status || 'tailored'} · ${s.job.source}</div>
      </div>
      <div class="hist-date">${formatDate(s.date)}</div>
    </div>
  `).join('');

  // Click to change status
  els.historyList.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', (e) => {
      showStatusDropdown(e, item.dataset.sessionId);
    });
  });
}

let activeDropdownSessionId = null;

function showStatusDropdown(e, sessionId) {
  activeDropdownSessionId = sessionId;
  const rect = e.currentTarget.getBoundingClientRect();

  els.statusDropdown.style.top = `${rect.bottom + 4}px`;
  els.statusDropdown.style.left = `${rect.left}px`;
  els.statusDropdown.classList.remove('hidden');

  // Remove old listeners
  const newDropdown = els.statusDropdown.cloneNode(true);
  els.statusDropdown.parentNode.replaceChild(newDropdown, els.statusDropdown);
  els.statusDropdown = newDropdown; // Update reference

  newDropdown.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      await msg('UPDATE_STATUS', {
        sessionId: Number(sessionId),
        status: btn.dataset.status,
      });
      newDropdown.classList.add('hidden');
      loadHistory();
    });
  });

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', closeDropdown, { once: true });
  }, 0);
}

function closeDropdown() {
  document.getElementById('statusDropdown')?.classList.add('hidden');
}

// ─── UI state helpers ──────────────────────────────────────────────────────
function hideAll() {
  els.loadingState.classList.add('hidden');
  els.errorState.classList.add('hidden');
  els.previewState.classList.add('hidden');
  els.keywordSection.classList.remove('hidden');
  els.tailorBtnSection.classList.remove('hidden');
}

function showLoading() {
  els.keywordSection.classList.add('hidden');
  els.tailorBtnSection.classList.add('hidden');
  els.previewState.classList.add('hidden');
  els.errorState.classList.add('hidden');
  els.loadingState.classList.remove('hidden');
  els.loadingState.classList.add('fade-in');
}

function showError(message) {
  els.loadingState.classList.add('hidden');
  els.previewState.classList.add('hidden');
  els.keywordSection.classList.remove('hidden');
  els.tailorBtnSection.classList.remove('hidden');
  els.errorMsg.textContent = message;
  els.errorState.classList.remove('hidden');
  els.errorState.classList.add('fade-in');
}

function resetTailorTab() {
  state.pendingResume = null;
  state.pendingDocx = null;
  hideAll();
  els.downloadBtn.disabled = false;
  els.downloadBtn.querySelector('span:not(.btn-icon)').textContent = 'Looks Good — Download .docx';
}

// ─── Utility ──────────────────────────────────────────────────────────────
function msg(action, data) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, data }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: { message: chrome.runtime.lastError.message } });
      } else {
        resolve(response || {});
      }
    });
  });
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatError(err) {
  if (typeof err === 'string') return err;
  if (err?.message) return err.message;
  if (err?.code === 'RATE_LIMIT') return 'Gemini rate limit reached. Wait 60 seconds and try again.';
  if (err?.code === 'INVALID_KEY') return 'Invalid API key. Check Settings.';
  if (err?.code === 'NO_RESUME') return 'No base resume. Upload one in Settings.';
  return 'Something went wrong. Try again.';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'today';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result.split(',')[1]);
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────
init().catch(err => console.error('[ResumeOS] Init error:', err));