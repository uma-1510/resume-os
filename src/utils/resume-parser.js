// resume-parser.js — Parse uploaded resume files
//
// WHY we only accept .docx and .txt (not PDF):
//   PDF text extraction breaks on multi-column resumes, decorative fonts,
//   and image-based PDFs (common for designer resumes). The extracted text
//   is garbled and produces bad AI output. mammoth.js for .docx is clean
//   and reliable. .txt is trivial.
//
//   When a user uploads a PDF we show a helpful inline error rather than
//   attempting extraction and producing garbage.

import mammoth from 'mammoth';

// ─── parseResumeFile ─────────────────────────────────────────────────────────
// Accepts a File object (from file input), returns { text, error }
// Called from background.js message handler so it runs in the service worker
export async function parseResumeFile(fileBuffer, filename) {
  const ext = filename.split('.').pop().toLowerCase();

  if (ext === 'pdf') {
    return {
      text: null,
      error: 'PDF extraction is unreliable. Save your resume as .docx or paste the text directly.',
    };
  }

  if (ext === 'txt' || ext === 'text') {
    try {
      const text = new TextDecoder('utf-8').decode(fileBuffer);
      if (!text.trim()) {
        return { text: null, error: 'The text file appears to be empty.' };
      }
      return { text: text.trim(), error: null };
    } catch (e) {
      return { text: null, error: 'Could not read the text file.' };
    }
  }

  if (ext === 'docx') {
    try {
      // mammoth.js converts .docx → clean plain text
      // WHY extractRawText (not convertToHtml): We want plain text for the AI.
      //     HTML would add noise (tags, attributes) that wastes tokens.
      const result = await mammoth.extractRawText({
        arrayBuffer: fileBuffer,
      });

      if (result.messages.length > 0) {
        // Log warnings but don't fail — mammoth is usually fine even with warnings
        console.warn('[ResumeOS] mammoth warnings:', result.messages);
      }

      const text = result.value.trim();
      if (!text) {
        return {
          text: null,
          error: 'The .docx file appears to be empty or contains only images.',
        };
      }

      return { text, error: null };
    } catch (e) {
      return {
        text: null,
        error: `Could not read the .docx file: ${e.message}`,
      };
    }
  }

  return {
    text: null,
    error: `Unsupported file type: .${ext}. Please upload a .docx or .txt file.`,
  };
}

// ─── parseResumeText ─────────────────────────────────────────────────────────
// Simple text passthrough for when user pastes text directly
export function parseResumeText(text) {
  const cleaned = text.trim();
  if (!cleaned) {
    return { text: null, error: 'Please enter or paste your resume text.' };
  }
  if (cleaned.length < 100) {
    return { text: null, error: 'The pasted text seems too short to be a resume.' };
  }
  return { text: cleaned, error: null };
}
