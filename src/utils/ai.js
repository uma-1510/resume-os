import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildSystemPrompt, buildUserPrompt, buildSummaryPrompt } from './prompts.js';

const MODEL_ID = 'gemini-2.5-flash';

// ─── tailorResume ────────────────────────────────────────────────────────────
// Main AI call: takes base resume + JD → returns structured JSON resume
export async function tailorResume({ apiKey, baseResume, jobDescription, preferenceSummary }) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL_ID,
    systemInstruction: buildSystemPrompt(preferenceSummary),
    generationConfig: {
      maxOutputTokens: 1500,
      temperature: 0.3,
    },
  });

  const userPrompt = buildUserPrompt({ baseResume, jobDescription });

  // Catch Gemini SDK errors here and convert to structured error objects
  // before they propagate. Without this, the raw SDK message reaches
  // sidepanel as { code: 'UNKNOWN', message: <giant string> }.
  let result;
  try {
    result = await model.generateContent(userPrompt);
  } catch (err) {
    throw parseGeminiError(err);
  }
  
  return parseResumeJSON(rawText);
}

// ─── rebuildPreferenceSummary ────────────────────────────────────────────────
// Regenerates the career memory summary every 5 confirmed sessions.
// WHY every 5: Rebuilding every session is expensive. Every 10 is too stale.
//              5 strikes the balance — new patterns emerge after a few sessions.
export async function rebuildPreferenceSummary({ apiKey, sessions }) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL_ID,
    generationConfig: {
      maxOutputTokens: 200,
      temperature: 0.1, // Very low temp — we want consistent, factual summary
    },
  });

  const prompt = buildSummaryPrompt(sessions);
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

// ─── parseResumeJSON ─────────────────────────────────────────────────────────
// Gemini sometimes wraps JSON in markdown fences. Strip them before parsing.
// Also handles trailing commas (common model output bug).
function parseResumeJSON(rawText) {
  let text = rawText.trim();

  // Strip markdown code fences if present
  // WHY: Despite instructions, Gemini 2.0 Flash occasionally wraps output in
  //      ```json ... ``` blocks. We strip them defensively.
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  // Find JSON object boundaries (in case there's any preamble)
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('No JSON object found in AI response');
  }
  text = text.slice(start, end + 1);

  try {
    const parsed = JSON.parse(text);
    return validateResumeSchema(parsed);
  } catch (e) {
    // Last resort: try to fix common JSON issues
    // Remove trailing commas before ] or }
    const fixed = text.replace(/,(\s*[}\]])/g, '$1');
    const parsed = JSON.parse(fixed); // Will throw if still broken → caught upstream
    return validateResumeSchema(parsed);
  }
}

// ─── validateResumeSchema ───────────────────────────────────────────────────
// Expands the compact short-key JSON the AI returns into the full schema
// the rest of the app uses. Short keys save ~40% output tokens.
//
// Short → Full mapping:
//   n→name, e→email, ph→phone, lo→location, li→linkedin, su→summary
//   x→experience: c→company, t→title, d→dates, b→bullets
//   sk→skills, ed→education: i→institution, dg→degree, d→dates
//   Bullet: plain string = authentic, {tx, f:1} = flagged
function validateResumeSchema(data) {
  // Support both short keys (new) and long keys (fallback for safety)
  return {
    name:     data.n  || data.name     || '',
    email:    data.e  || data.email    || '',
    phone:    data.ph || data.phone    || '',
    location: data.lo || data.location || '',
    linkedin: data.li || data.linkedin || '',
    summary:  data.su || data.summary  || '',
    experience: (data.x || data.experience || []).map(exp => ({
      company: exp.c || exp.company || '',
      title:   exp.t || exp.title   || '',
      dates:   exp.d || exp.dates   || '',
      bullets: (exp.b || exp.bullets || []).map(b => {
        // Plain string = authentic bullet
        if (typeof b === 'string') return { text: b, authentic: true };
        // {tx, f:1} = flagged bullet
        if (b.tx !== undefined) return { text: b.tx, authentic: !b.f };
        // Legacy long-key format fallback
        return { text: b.text || '', authentic: b.authentic !== false };
      }),
    })),
    skills: Array.isArray(data.sk || data.skills)
      ? (data.sk || data.skills)
      : [],
    education: (data.ed || data.education || []).map(ed => ({
      institution: ed.i  || ed.institution || '',
      degree:      ed.dg || ed.degree      || '',
      dates:       ed.d  || ed.dates       || '',
    })),
  };
}

// ─── parseGeminiError ────────────────────────────────────────────────────────
// Extract a user-friendly error message from Gemini SDK errors
export function parseGeminiError(err) {
  const msg = err?.message || String(err);

  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {

    // Try to extract the retry delay Gemini gives us (e.g. "53.809189902s")
    const retryMatch = msg.match(/retry[^0-9]*(\d+(?:\.\d+)?)s/i)
      || msg.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i);
    const retrySeconds = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60;

    // Distinguish daily cap (RPD) from per-minute (RPM)
    const isDailyLimit = msg.includes('PerDay') || msg.includes('per_day') || msg.includes('RPD');

    if (isDailyLimit) {
      return {
        code: 'DAILY_LIMIT',
        message: "You've used all your free Gemini requests for today. Your quota resets at midnight Pacific Time. You can also enable billing on your Google AI project for higher limits.",
        retryAfter: null,
      };
    }

    return {
      code: 'RATE_LIMIT',
      message: `Gemini rate limit hit. Wait ${retrySeconds} seconds and try again.`,
      retryAfter: retrySeconds,
    };
  }

  if (msg.includes('401') || msg.includes('API_KEY_INVALID') || msg.includes('invalid api key')) {
    return {
      code: 'INVALID_KEY',
      message: 'Invalid API key. Check your key in Settings.',
    };
  }
  if (msg.includes('403') || msg.includes('PERMISSION_DENIED')) {
    return {
      code: 'PERMISSION',
      message: "API key doesn't have Gemini access. Make sure you've enabled the Generative Language API in your Google Cloud project.",
    };
  }
  if (msg.includes('500') || msg.includes('INTERNAL')) {
    return {
      code: 'SERVER_ERROR',
      message: 'Gemini server error. Try again in a moment.',
    };
  }
  return {
    code: 'UNKNOWN',
    message: `AI error: ${msg.slice(0, 100)}`,
  };
}