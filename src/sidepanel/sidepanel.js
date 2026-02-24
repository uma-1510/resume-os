// sidepanel.js — Main side panel controller
import { analyzeKeywords } from '../utils/keywords.js';

// ─── Keyword compatibility adapter (NEW ENGINE → OLD UI) ──────────────────
function flattenKeywordAnalysis(analysis) {
  if (!analysis) return { matched: [], missing: [], jdKeywords: [] };
  return {
    matched: analysis.approvedKeywords || [],
    missing: [
      ...(analysis.hardSkills?.skills  || []).filter(s => s.status === 'missing').map(s => s.name),
      ...(analysis.softSkills?.skills  || []).filter(s => s.status === 'missing').map(s => s.name),
      ...(analysis.otherSkills?.skills || []).filter(s => s.status === 'missing').map(s => s.name),
    ],
    jdKeywords: analysis.jdKeywords || [],
  };
}

// ─── State ────────────────────────────────────────────────────────────────
let state = {
  onboardingDone: false,
  detectedJob: null,
  currentJob: null,
  keywordAnalysis: null,
  pendingResume: null,
  pendingDocx: null,
  pendingSessionData: null,
  isLoading: false,
  activeTab: 'tailor',
};

// ─── DOM refs ─────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  statusBadge: $('statusBadge'),
  statusText: $('statusText'),
  tabTailor: $('tab-tailor'),
  tabHistory: $('tab-history'),
  tabSettings: $('tab-settings'),
  panelTailor: $('panel-tailor'),
  panelHistory: $('panel-history'),
  panelSettings: $('panel-settings'),
  onboardingBanner: $('onboardingBanner'),
  bannerGoToSettings: $('bannerGoToSettings'),
  detectedJobCard: $('detectedJobCard'),
  detectedSource: $('detectedSource'),
  detectedTitle: $('detectedTitle'),
  detectedCompany: $('detectedCompany'),
  noJobCard: $('noJobCard'),
  manualPasteSection: $('manualPasteSection'),
  jobDescTextarea: $('jobDescTextarea'),
  keywordSection: $('keywordSection'),
  scoreRing: $('scoreRing'),
  scoreValue: $('scoreValue'),
  scoreSubtext: $('scoreSubtext'),
  keywordTags: $('keywordTags'),
  tailorBtnSection: $('tailorBtnSection'),
  tailorBtn: $('tailorBtn'),
  tailorBtnText: $('tailorBtnText'),
  loadingState: $('loadingState'),
  errorState: $('errorState'),
  errorMsg: $('errorMsg'),
  errorRetryBtn: $('errorRetryBtn'),
  previewState: $('previewState'),
  resumePreview: $('resumePreview'),
  authenticityWarn: $('authenticityWarn'),
  authenticityWarnText: $('authenticityWarnText'),
  downloadBtn: $('downloadBtn'),
  regenerateBtn: $('regenerateBtn'),
  filenamePreview: $('filenamePreview'),
  historyCount: $('historyCount'),
  historyList: $('historyList'),
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
  statusDropdown: $('statusDropdown'),
};

// ─── Init ─────────────────────────────────────────────────────────────────
async function init() {
  await loadSettings();
  setupTabListeners();
  setupJobListeners();
  setupSettingsListeners();
  setupMessageListener();

  if (!state.onboardingDone) {
    switchTab('settings');
    els.setupBanner.style.display = 'flex';
    els.onboardingBanner.classList.remove('hidden');
  } else {
    switchTab('tailor');
    els.setupBanner.style.display = 'none';
    els.onboardingBanner.classList.add('hidden');
  }

  loadHistory();
}

// ─── Load settings ─────────────────────────────────────────────────────────
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
  const { onboardingDone, apiKey } = settings || {};
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
  [els.tabTailor, els.tabHistory, els.tabSettings].forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });
  els.panelTailor.classList.toggle('hidden', tabName !== 'tailor');
  els.panelHistory.classList.toggle('hidden', tabName !== 'history');
  els.panelSettings.classList.toggle('hidden', tabName !== 'settings');
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
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'JOB_DETECTED_RELAY') {
      handleDetectedJob(message.data);
    }
  });
}

function handleDetectedJob(job) {
  state.detectedJob = job;
  els.detectedJobCard.classList.remove('hidden');
  els.detectedTitle.textContent = job.title || '—';
  els.detectedCompany.textContent = job.company || '';
  els.detectedSource.textContent = job.source === 'linkedin' ? 'LinkedIn' : 'Indeed';
  els.noJobCard.classList.add('hidden');
  els.manualPasteSection.querySelector('.field-label').textContent = 'Or paste a different job description';
  runKeywordAnalysis(job.description);
}

// ─── Job input listeners ───────────────────────────────────────────────────
function setupJobListeners() {
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

  els.tailorBtn.addEventListener('click', handleTailorClick);
  els.downloadBtn.addEventListener('click', handleDownloadClick);
  els.regenerateBtn.addEventListener('click', handleRegenerateClick);
  els.errorRetryBtn.addEventListener('click', handleTailorClick);
}

// ─── Skill Gap Analysis (browser-only, zero API calls) ────────────────────
async function runKeywordAnalysis(jobDescription) {
  const { data } = await msg('GET_SETTINGS');

  if (!data?.baseResumeText) {
    els.tailorBtn.disabled = false;
    return;
  }

  const analysis = analyzeKeywords(jobDescription, data.baseResumeText);
  state.keywordAnalysis = analysis;

  renderSkillGapUI(analysis);

  els.keywordSection.classList.remove('hidden');
  els.tailorBtn.disabled = false;
}

// ─── Skill Gap Renderer ────────────────────────────────────────────────────
function renderSkillGapUI(analysis) {
  els.keywordTags.innerHTML = '';
  renderImpactBlock('High Impact',   'Hard Skills',  analysis.hardSkills);
  renderImpactBlock('Medium Impact', 'Soft Skills',  analysis.softSkills);
  renderImpactBlock('Low Impact',    'Other Skills', analysis.otherSkills);
}

function renderImpactBlock(impactLabel, title, data, level) {
  const skills  = data?.skills || [];
  const missing = skills.filter(s => s.status === 'missing').map(s => s.name);
  const matched = skills.filter(s => s.status === 'matched').map(s => s.name);

  const container = document.createElement('div');
  container.className = `impact-block ${level}`;

  const header = document.createElement('div');
  header.className = 'impact-header';
  header.innerHTML = `
    <div class="impact-skill">${title}</div>
    <div class="impact-level">${impactLabel}</div>`;
  container.appendChild(header);

  if (missing.length > 0) {
    const desc = document.createElement('div');
    desc.className = 'impact-desc';
    desc.textContent = `${missing.length} ${title} Not Found: Adding these will significantly improve alignment.`;
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

// ─── Resolve current job ───────────────────────────────────────────────────
function resolveJobDescription() {
  const pastedText = els.jobDescTextarea.value.trim();
  if (pastedText.length > 50) {
    return {
      description: pastedText,
      title: state.detectedJob?.title || 'Position',
      company: state.detectedJob?.company || 'Company',
      source: 'manual',
      url: '',
    };
  }
  if (state.detectedJob) return state.detectedJob;
  return null;
}

// ─── Tailor click ──────────────────────────────────────────────────────────
// CHANGE 1: keywords no longer sent to AI — model reads JD directly.
// Skill gap UI is browser-only, for the user's information only.
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
    });

    if (error) throw error;

    state.pendingResume = data.resume;
    showPreview(data.resume, job);
  } catch (err) {
    showError(err); // pass object, not string — showError handles both
  }
}

// ─── Preview ──────────────────────────────────────────────────────────────
function showPreview(resume, job) {
  hideAll();

  let inauthCount = 0;
  for (const exp of resume.experience || []) {
    for (const b of exp.bullets || []) {
      if (!b.authentic) inauthCount++;
    }
  }

  if (inauthCount > 0) {
    els.authenticityWarn.style.display = 'flex';
    els.authenticityWarnText.textContent =
      `${inauthCount} bullet${inauthCount > 1 ? 's' : ''} flagged — AI may have added content not in your original resume. Verify before sending.`;
  } else {
    els.authenticityWarn.style.display = 'none';
  }

  els.resumePreview.innerHTML = renderResumePreview(resume);

  const name    = (resume.name   || 'Resume').split(' ')[0];
  const company = (job.company   || 'Company').replace(/\s/g, '');
  const role    = (job.title     || 'Role').replace(/\s/g, '');
  const date    = new Date().toISOString().split('T')[0];
  els.filenamePreview.textContent = `↓ ${name}_${company}_${role}_${date}.docx`;

  els.previewState.classList.remove('hidden');
  els.previewState.classList.add('fade-in');
}

function renderResumePreview(resume) {
  let html = '';
  html += `<div class="preview-name">${esc(resume.name)}</div>`;
  const contact = [resume.email, resume.phone, resume.location, resume.linkedin].filter(Boolean).join(' · ');
  if (contact) html += `<div class="preview-contact">${esc(contact)}</div>`;

  if (resume.summary) {
    html += `<div class="preview-section-title">Summary</div>`;
    html += `<div class="preview-summary">${esc(resume.summary)}</div>`;
  }

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

  if (resume.skills?.length) {
    html += `<div class="preview-section-title">Skills</div><div class="preview-skills">`;
    for (const skill of resume.skills) {
      html += `<span class="preview-skill-tag">${esc(skill)}</span>`;
    }
    html += `</div>`;
  }

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

    const binaryStr = atob(data.base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const url = URL.createObjectURL(blob);

    chrome.downloads.download({ url, filename: data.filename, saveAs: true }, () => {
      URL.revokeObjectURL(url);
      if (chrome.runtime.lastError) console.error('[ResumeOS] Download error:', chrome.runtime.lastError);
    });

    // Use flattenKeywordAnalysis so matched keywords are pulled correctly from the new engine
    msg('RECORD_SESSION', {
      jobData: state.currentJob,
      confirmedResume: state.pendingResume,
      keywordsUsed: flattenKeywordAnalysis(state.keywordAnalysis).matched,
    }).catch(err => console.warn('[ResumeOS] Session record failed:', err));

    els.downloadBtn.querySelector('span:not(.btn-icon)').textContent = '✓ Downloading...';
    setTimeout(() => resetTailorTab(), 2000);

  } catch (err) {
    els.downloadBtn.disabled = false;
    els.downloadBtn.querySelector('span:not(.btn-icon)').textContent = 'Looks Good — Download .docx';
    showError(err);
  }
}

// ─── Regenerate ────────────────────────────────────────────────────────────
// CHANGE 2: keywords removed here too — same reasoning as handleTailorClick.
async function handleRegenerateClick() {
  if (!state.currentJob) return;

  els.previewState.classList.add('hidden');
  showLoading();

  try {
    const { data, error } = await msg('TAILOR_RESUME', {
      jobDescription: state.currentJob.description,
    });

    if (error) throw error;

    state.pendingResume = data.resume;
    showPreview(data.resume, state.currentJob);
  } catch (err) {
    showError(err); // pass object, not string
  }
}

// ─── Settings ──────────────────────────────────────────────────────────────
function setupSettingsListeners() {
  els.toggleApiKeyVisibility.addEventListener('click', () => {
    const isPassword = els.settingsApiKey.type === 'password';
    els.settingsApiKey.type = isPassword ? 'text' : 'password';
    els.keyVisIcon.textContent = isPassword ? '🙈' : '👁';
  });

  els.resumeFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const filename = file.name;
    const ext = filename.split('.').pop().toLowerCase();

    if (ext === 'pdf') {
      els.resumeError.textContent = '✗ PDF not supported — save your resume as .docx or paste the text directly.';
      els.resumeError.classList.remove('hidden');
      return;
    }

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

  els.saveSettingsBtn.addEventListener('click', handleSaveSettings);

  els.clearMemoryBtn.addEventListener('click', async () => {
    if (!confirm('Clear all career memory? This removes session history and preferences. Cannot be undone.')) return;
    await msg('CLEAR_MEMORY');
    loadHistory();
  });
}

async function handleSaveSettings() {
  const name       = els.settingsName.value.trim();
  const apiKey     = els.settingsApiKey.value.trim();
  const resumeText = els.resumePasteArea.value.trim();

  if (!name)       { els.settingsName.focus();    return; }
  if (!apiKey)     { els.settingsApiKey.focus();  return; }
  if (!resumeText) { els.resumePasteArea.focus(); return; }

  els.saveSettingsBtnText.textContent = 'Saving...';
  els.saveSettingsBtn.disabled = true;

  els.keyValidationResult.textContent = '✓ Settings saved (API key will be verified on first use)';
  els.keyValidationResult.className = 'validation-result success';
  els.keyValidationResult.classList.remove('hidden');

  await msg('SAVE_SETTINGS', { name, apiKey, baseResumeText: resumeText, onboardingDone: true });

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

  const sessions = [...(data.memory.sessions || [])].reverse();

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

  els.historyList.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', (e) => showStatusDropdown(e, item.dataset.sessionId));
  });
}

let activeDropdownSessionId = null;

function showStatusDropdown(e, sessionId) {
  activeDropdownSessionId = sessionId;
  const rect = e.currentTarget.getBoundingClientRect();
  els.statusDropdown.style.top  = `${rect.bottom + 4}px`;
  els.statusDropdown.style.left = `${rect.left}px`;
  els.statusDropdown.classList.remove('hidden');

  const newDropdown = els.statusDropdown.cloneNode(true);
  els.statusDropdown.parentNode.replaceChild(newDropdown, els.statusDropdown);
  els.statusDropdown = newDropdown;

  newDropdown.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      await msg('UPDATE_STATUS', { sessionId: Number(sessionId), status: btn.dataset.status });
      newDropdown.classList.add('hidden');
      loadHistory();
    });
  });

  setTimeout(() => document.addEventListener('click', closeDropdown, { once: true }), 0);
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

// ─── showError ─────────────────────────────────────────────────────────────
// CHANGE 3: accepts error objects, not just strings.
// Three behaviours:
//   DAILY_LIMIT → hide retry button (quota gone for today, no point retrying)
//   RATE_LIMIT  → live countdown using actual retryAfter seconds from Gemini
//   everything else → normal "Try Again" button
function showError(messageOrErr) {
  const err     = typeof messageOrErr === 'object' ? messageOrErr : null;
  const message = typeof messageOrErr === 'string' ? messageOrErr : formatError(messageOrErr);

  els.loadingState.classList.add('hidden');
  els.previewState.classList.add('hidden');
  els.keywordSection.classList.remove('hidden');
  els.tailorBtnSection.classList.remove('hidden');
  els.errorMsg.textContent = message;
  els.errorState.classList.remove('hidden');
  els.errorState.classList.add('fade-in');

  // Daily cap — nothing to retry today, hide the button entirely
  if (err?.code === 'DAILY_LIMIT') {
    els.errorRetryBtn.classList.add('hidden');
    return;
  }

  // Per-minute rate limit — countdown using Gemini's actual retryAfter value
  if (err?.code === 'RATE_LIMIT' && err?.retryAfter) {
    els.errorRetryBtn.classList.remove('hidden');
    els.errorRetryBtn.disabled = true;
    let remaining = err.retryAfter;
    els.errorRetryBtn.textContent = `Wait ${remaining}s`;
    const tick = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(tick);
        els.errorRetryBtn.disabled = false;
        els.errorRetryBtn.textContent = 'Try Again';
      } else {
        els.errorRetryBtn.textContent = `Wait ${remaining}s`;
      }
    }, 1000);
    return;
  }

  // Default — generic retryable error
  els.errorRetryBtn.classList.remove('hidden');
  els.errorRetryBtn.disabled = false;
  els.errorRetryBtn.textContent = 'Try Again';
}

function resetTailorTab() {
  state.pendingResume = null;
  state.pendingDocx   = null;
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
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// formatError: check code BEFORE message so structured errors
// from parseGeminiError always hit the right branch.
function formatError(err) {
  if (typeof err === 'string')     return err;
  if (err?.code === 'DAILY_LIMIT') return err.message;
  if (err?.code === 'RATE_LIMIT')  return err.message;
  if (err?.code === 'INVALID_KEY') return 'Invalid API key. Check Settings.';
  if (err?.code === 'NO_RESUME')   return 'No base resume. Upload one in Settings.';
  if (err?.code === 'NO_KEY')      return 'No API key. Add one in Settings.';
  if (err?.message)                return err.message;
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
    reader.onload  = e => resolve(e.target.result.split(',')[1]);
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────
init().catch(err => console.error('[ResumeOS] Init error:', err));