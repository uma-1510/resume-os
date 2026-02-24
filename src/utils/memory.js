// memory.js — Career memory: read, write, aggregate, summarize
//
// WHY career memory exists:
//   Without memory, every rewrite starts cold. With memory, the AI knows
//   the user's confirmed bullet verb style, preferred length, target roles,
//   and recurring keywords. This makes each rewrite more personalised.
//
// WHY we build from CONFIRMED rewrites only:
//   We don't have per-bullet accept/reject signals (no diff UI).
//   So we infer preferences from the full confirmed resume.
//   A resume the user downloaded represents their approval of the whole output.
//
// STORAGE SCHEMA: see §3 in architecture doc

const STORAGE_KEY = 'resumeos_memory';
const SUMMARY_REBUILD_EVERY = 5; // sessions

// ─── readMemory ───────────────────────────────────────────────────────────
export function readMemory() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      resolve(result[STORAGE_KEY] || defaultMemory());
    });
  });
}

// ─── writeMemory ──────────────────────────────────────────────────────────
function writeMemory(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: data }, resolve);
  });
}

// ─── defaultMemory ────────────────────────────────────────────────────────
function defaultMemory() {
  return {
    sessions: [],
    aggregate: {
      totalSessions: 0,
      targetRoles: {},
      topKeywords: [],
      topBulletVerbs: [],
      avgBulletLen: 0,
      preferenceSummary: null,
      summaryBuiltAt: 0,
    },
  };
}

// ─── recordSession ────────────────────────────────────────────────────────
// Called after user confirms and downloads a resume.
// Extracts learning signals from the confirmed resume JSON.
export async function recordSession({ jobData, confirmedResume, keywordsUsed }) {
  const memory = await readMemory();

  // Extract bullet verbs (first word of each bullet)
  const bulletVerbs = extractBulletVerbs(confirmedResume);

  // Calculate average bullet length
  const avgBulletLen = calcAvgBulletLen(confirmedResume);

  // Build session record
  const session = {
    id: Date.now(),
    date: new Date().toISOString().split('T')[0],
    job: {
      title: jobData.title || '',
      company: jobData.company || '',
      source: jobData.source || 'manual',
      url: jobData.url || '',
    },
    targetRole: jobData.title || '',
    keywordsUsed: keywordsUsed || [],
    bulletVerbs,
    avgBulletLen,
    status: 'tailored', // user updates to: applied · interview · offer · rejected
  };

  memory.sessions.push(session);

  // Update aggregates
  memory.aggregate = rebuildAggregate(memory.sessions, memory.aggregate);

  await writeMemory(memory);
  return session.id;
}

// ─── updateSessionStatus ──────────────────────────────────────────────────
// Called from History tab when user marks status (applied, interview, etc.)
export async function updateSessionStatus(sessionId, status) {
  const memory = await readMemory();
  const session = memory.sessions.find(s => s.id === sessionId);
  if (session) {
    session.status = status;
    await writeMemory(memory);
  }
}

// ─── updatePreferenceSummary ──────────────────────────────────────────────
// Called from background after AI rebuilds the summary text
export async function updatePreferenceSummary(summary) {
  const memory = await readMemory();
  memory.aggregate.preferenceSummary = summary;
  memory.aggregate.summaryBuiltAt = memory.aggregate.totalSessions;
  await writeMemory(memory);
}

// ─── shouldRebuildSummary ─────────────────────────────────────────────────
// Returns true if we've had enough new sessions since last rebuild
export function shouldRebuildSummary(aggregate) {
  const sessionsSinceLastBuild = aggregate.totalSessions - (aggregate.summaryBuiltAt || 0);
  return sessionsSinceLastBuild >= SUMMARY_REBUILD_EVERY && aggregate.totalSessions >= 2;
}

// ─── clearMemory ──────────────────────────────────────────────────────────
export function clearMemory() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(STORAGE_KEY, resolve);
  });
}

// ─── Internal: rebuildAggregate ───────────────────────────────────────────
function rebuildAggregate(sessions, prevAggregate) {
  const totalSessions = sessions.length;

  // Count target roles
  const targetRoles = {};
  for (const s of sessions) {
    if (s.targetRole) {
      targetRoles[s.targetRole] = (targetRoles[s.targetRole] || 0) + 1;
    }
  }

  // Aggregate keywords (frequency across all sessions)
  const keywordFreq = {};
  for (const s of sessions) {
    for (const kw of s.keywordsUsed || []) {
      keywordFreq[kw] = (keywordFreq[kw] || 0) + 1;
    }
  }
  const topKeywords = Object.entries(keywordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([kw]) => kw);

  // Aggregate bullet verbs
  const verbFreq = {};
  for (const s of sessions) {
    for (const verb of s.bulletVerbs || []) {
      verbFreq[verb] = (verbFreq[verb] || 0) + 1;
    }
  }
  const topBulletVerbs = Object.entries(verbFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([v]) => v);

  // Average bullet length across all sessions
  const avgBulletLen = sessions.length > 0
    ? Math.round(sessions.reduce((sum, s) => sum + (s.avgBulletLen || 18), 0) / sessions.length)
    : 18;

  return {
    totalSessions,
    targetRoles,
    topKeywords,
    topBulletVerbs,
    avgBulletLen,
    preferenceSummary: prevAggregate.preferenceSummary, // preserved until rebuilt
    summaryBuiltAt: prevAggregate.summaryBuiltAt,
  };
}

// ─── Internal: extractBulletVerbs ─────────────────────────────────────────
function extractBulletVerbs(resume) {
  const verbs = [];
  for (const job of resume.experience || []) {
    for (const bullet of job.bullets || []) {
      const text = bullet.text || '';
      const firstWord = text.trim().split(/\s+/)[0];
      if (firstWord && firstWord.length > 1 && /^[A-Z]/.test(firstWord)) {
        verbs.push(firstWord);
      }
    }
  }
  // Deduplicate
  return [...new Set(verbs)];
}

// ─── Internal: calcAvgBulletLen ───────────────────────────────────────────
function calcAvgBulletLen(resume) {
  const lengths = [];
  for (const job of resume.experience || []) {
    for (const bullet of job.bullets || []) {
      const wordCount = (bullet.text || '').trim().split(/\s+/).length;
      lengths.push(wordCount);
    }
  }
  if (lengths.length === 0) return 18;
  return Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
}
