// prompts.js — Token-optimised prompt builder
//
// Token budget breakdown (Gemini 2.0 Flash free tier = 1M input TPM):
//   System prompt:  ~120 tokens  (was ~350 — cut verbose schema + prose)
//   JD (truncated): ~300 tokens  (was 400-800 — cap at 1500 chars)
//   Base resume:    ~400 tokens  (unchanged — we need all of it)
//   Missing skills: ~30 tokens   (was 60 — removed duplicate jdKeywords)
//   Total input:    ~850 tokens  (was ~1500-2000)
//
//   Output resume JSON: ~400 tokens (was 800-1500)
//   Savings come from:
//     - Short field keys: "c"/"t"/"d"/"b" instead of "company"/"title"/"dates"/"bullets"
//     - Omitting authentic:true on every bullet (default = true, only flag false)
//     - Skills as flat array of strings (no wrapping objects)

// ─── System prompt ──────────────────────────────────────────────────────────
// Kept terse. Model doesn't need an essay — it needs clear rules and a schema.
export function buildSystemPrompt(preferenceSummary = null) {
  let system = `Tailor the resume to the job. Rules:
1. Never invent skills/experience not in the base resume. Only reframe existing experience.
2. Bullets: action-verb first, natural keyword weaving, no stuffing.
3. Output ONLY a JSON object. No markdown, no explanation, nothing outside the JSON.
4. Short keys to save tokens: n=name,e=email,ph=phone,lo=location,li=linkedin,su=summary,x=experience,sk=skills,ed=education
5. In experience array: c=company,t=title,d=dates,b=bullets array
6. Each bullet is a string UNLESS it may be inauthentic — then use {tx:"text",f:1}
7. f:1 means "flag for user review" (AI added something not clearly in base resume)
Schema: {"n":"","e":"","ph":"","lo":"","li":"","su":"","x":[{"c":"","t":"","d":"","b":["bullet text or {tx,f:1}"]}],"sk":[],"ed":[{"i":"","dg":"","d":""}]}`;

  if (preferenceSummary) {
    system += `\nStyle: ${preferenceSummary}`;
  }

  return system;
}

export function buildUserPrompt({ baseResume, jobDescription }) {
  const jdTruncated = jobDescription.length > 1500
    ? jobDescription.slice(0, 1500) + '...'
    : jobDescription;

  return `RESUME:
${baseResume}

JOB:
${jdTruncated}

Output JSON only.`;
}

export function buildSummaryPrompt(sessions) {
  // Only send the fields we actually need — not the full session objects
  const compact = sessions.map(s =>
    `${s.targetRole}|${(s.keywordsUsed || []).slice(0, 5).join(',')}|${(s.bulletVerbs || []).slice(0, 3).join(',')}|${s.avgBulletLen}`
  ).join('\n');

  return `Sessions (role|keywords|verbs|avgBulletLen):\n${compact}\n\nWrite 1-2 sentence style summary. Output only the sentence.`;
}