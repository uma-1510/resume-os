// prompts.js — Gemini prompt builder
//
// WHY this file exists:
//   Prompt quality is the single most important factor in output quality.
//   Keeping prompts in one place makes them easy to iterate without touching
//   business logic. Every constraint (authenticity, JSON format, bullet length)
//   lives here and is explained inline.

// ─── System prompt ──────────────────────────────────────────────────────────
// The system prompt sets the AI's role and permanent rules.
// It's injected once per call, not per message.
export function buildSystemPrompt(preferenceSummary = null) {
  let system = `You are ResumeOS, an expert resume tailoring assistant. Your job is to rewrite the user's base resume to better match a specific job description.

CORE RULES — follow these exactly:
1. NEVER invent experience, skills, or achievements not grounded in the base resume.
   If the JD asks for a skill the candidate doesn't have, do NOT add it.
   Per bullet, set authentic: false if you stretched or added something not clearly in the base resume.
2. Keep bullets action-verb first (Built, Led, Reduced, Designed, Shipped, etc.)
3. Match the JD's keywords naturally — don't keyword-stuff awkwardly.
4. Keep bullet length consistent with the base resume's style.
5. Output ONLY valid JSON. No markdown fences. No explanation. No preamble.
   The parser will crash if you add anything outside the JSON object.
6. The output format is EXACTLY this schema — no extra fields, no missing fields:

{
  "name": "string",
  "email": "string",
  "phone": "string",
  "location": "string",
  "linkedin": "string",
  "summary": "string (2-3 sentences, keyword-optimised)",
  "experience": [
    {
      "company": "string",
      "title": "string",
      "dates": "string",
      "bullets": [
        {
          "text": "string (the bullet text)",
          "authentic": true
        }
      ]
    }
  ],
  "skills": ["string"],
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "dates": "string"
    }
  ]
}

Set authentic: false on any bullet where you:
- Added a keyword, technology, or achievement not mentioned in the base resume
- Made a quantitative claim stronger than what the base resume states
- Invented context the base resume doesn't support

The user will review authentic: false bullets before sending. This is a trust feature — be honest.`;

  // Inject career memory if available
  // WHY: Memory personalises the AI output to the user's confirmed writing style.
  //      Without memory, every rewrite starts cold. With memory, it knows
  //      their preferred bullet length, verb style, and target roles.
  if (preferenceSummary) {
    system += `\n\nCAREER MEMORY — use this to match the user's confirmed style:\n${preferenceSummary}`;
  }

  return system;
}

// ─── User prompt ────────────────────────────────────────────────────────────
// The user prompt contains the actual data for this specific tailoring session.
export function buildUserPrompt({ baseResume, jobDescription, missingKeywords, jdKeywords }) {
  // Multi-word phrases are listed first in jdKeywords — they're the actual skills.
  // Single tokens follow. We split them here to give the AI clearer instructions.
  const phrases = jdKeywords.filter(k => k.includes(' '));
  const tokens = jdKeywords.filter(k => !k.includes(' '));

  const topKeywordsSection = jdKeywords.length > 0
    ? `\nKEY SKILLS AND CONCEPTS FROM THIS JOB (weave into bullets and summary naturally — only where the candidate's experience supports it):
${phrases.length > 0 ? `  Skill phrases: ${phrases.join(', ')}` : ''}
${tokens.length > 0 ? `  Technologies/tools: ${tokens.join(', ')}` : ''}`
    : '';

  const missingSection = missingKeywords.length > 0
    ? `\nSKILLS IN THE JD NOT DETECTED IN THE BASE RESUME:
${missingKeywords.join(', ')}
IMPORTANT: Do NOT add these unless the base resume contains clear evidence the candidate has this skill. If there is adjacent experience (e.g. resume has "PyTorch" and JD asks for "distributed training"), you may reframe an existing bullet to highlight that connection — but set authentic: false so the user can verify.`
    : '';

  return `BASE RESUME (source of truth — only work from what's here):
${baseResume}

JOB DESCRIPTION (tailor the resume toward this):
${jobDescription}
${topKeywordsSection}
${missingSection}

Now output the tailored resume as a single JSON object. Remember: authentic: false on any bullet you stretched or added. No markdown. No explanation. JSON only.`;
}

// ─── Summary rebuild prompt ─────────────────────────────────────────────────
// Used to regenerate the preference summary every 5 sessions
export function buildSummaryPrompt(sessions) {
  const sessionData = sessions.map(s => ({
    role: s.targetRole,
    keywords: s.keywordsUsed,
    verbs: s.bulletVerbs,
    avgLen: s.avgBulletLen,
  }));

  return `Based on these resume tailoring sessions, write a 2-3 sentence preference summary (under 150 tokens) in the exact format shown. Focus on: target roles, bullet verb style, keyword patterns, bullet length preference.

Sessions: ${JSON.stringify(sessionData)}

Output format: "User targets [roles]. Prefers [bullet style] bullets averaging [N] words. Recurring keywords: [top keywords]."

Output ONLY the summary sentence. No JSON. No explanation.`;
}