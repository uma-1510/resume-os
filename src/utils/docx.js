// docx.js — Resume JSON → formatted .docx document
//
// WHY docx.js (not a different library):
//   • Pure browser/Node compatible — no native binaries needed
//   • Produces real .docx (not HTML masquerading as .docx)
//   • ATS systems read native .docx better than HTML exports
//   • Well-maintained, TypeScript types, active community
//
// WHY we generate in background.js (not side panel):
//   The side panel can't use Node-style modules directly.
//   Background generates the ArrayBuffer, base64-encodes it,
//   and sends it back to the side panel. The side panel's click
//   handler (which has the user gesture) triggers the download.
//   This preserves the saveAs: true behavior.

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  UnderlineType,
  convertInchesToTwip,
  PageMargin,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from 'docx';

// ─── generateDocx ─────────────────────────────────────────────────────────
// Takes resume JSON (from AI output) → returns ArrayBuffer
export async function generateDocx(resume) {
  const sections = [];

  // ── Header: Name ──────────────────────────────────────────────────────────
  sections.push(
    new Paragraph({
      children: [
        new TextRun({
          text: resume.name || 'Your Name',
          bold: true,
          size: 32, // 16pt
          font: 'Calibri',
          color: '1a1a2e',
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
    })
  );

  // ── Header: Contact info ──────────────────────────────────────────────────
  const contactParts = [resume.email, resume.phone, resume.location, resume.linkedin]
    .filter(Boolean);

  if (contactParts.length > 0) {
    sections.push(
      new Paragraph({
        children: [
          new TextRun({
            text: contactParts.join(' · '),
            size: 18, // 9pt
            font: 'Calibri',
            color: '444444',
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
      })
    );
  }

  // ── Divider ───────────────────────────────────────────────────────────────
  sections.push(horizontalRule());

  // ── Summary ───────────────────────────────────────────────────────────────
  if (resume.summary) {
    sections.push(sectionHeading('Professional Summary'));
    sections.push(
      new Paragraph({
        children: [
          new TextRun({
            text: resume.summary,
            size: 20, // 10pt
            font: 'Calibri',
            color: '333333',
          }),
        ],
        spacing: { after: 160 },
      })
    );
  }

  // ── Experience ────────────────────────────────────────────────────────────
  if (resume.experience?.length > 0) {
    sections.push(sectionHeading('Experience'));

    for (const job of resume.experience) {
      // Company + Title row
      sections.push(
        new Paragraph({
          children: [
            new TextRun({
              text: job.title || '',
              bold: true,
              size: 22, // 11pt
              font: 'Calibri',
              color: '1a1a2e',
            }),
            new TextRun({
              text: job.company ? `  ·  ${job.company}` : '',
              size: 22,
              font: 'Calibri',
              color: '2563eb', // blue for company
            }),
          ],
          spacing: { before: 80, after: 20 },
        })
      );

      // Dates
      if (job.dates) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({
                text: job.dates,
                size: 18,
                font: 'Calibri',
                color: '888888',
                italics: true,
              }),
            ],
            spacing: { after: 40 },
          })
        );
      }

      // Bullets
      for (const bullet of job.bullets || []) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `• ${bullet.text}`,
                size: 20, // 10pt
                font: 'Calibri',
                color: bullet.authentic === false ? 'b45309' : '333333',
                // WHY amber for inauthentic: Makes it visually easy to find in Word
                // User can review and edit before sending
              }),
              ...(bullet.authentic === false ? [
                new TextRun({
                  text: ' [VERIFY]',
                  size: 16,
                  font: 'Calibri',
                  color: 'b45309',
                  bold: true,
                }),
              ] : []),
            ],
            spacing: { after: 40 },
            indent: { left: convertInchesToTwip(0.2) },
          })
        );
      }
    }
  }

  // ── Skills ─────────────────────────────────────────────────────────────────
  if (resume.skills?.length > 0) {
    sections.push(sectionHeading('Skills'));
    sections.push(
      new Paragraph({
        children: [
          new TextRun({
            text: resume.skills.join(' · '),
            size: 20,
            font: 'Calibri',
            color: '333333',
          }),
        ],
        spacing: { after: 160 },
      })
    );
  }

  // ── Education ──────────────────────────────────────────────────────────────
  if (resume.education?.length > 0) {
    sections.push(sectionHeading('Education'));

    for (const ed of resume.education) {
      sections.push(
        new Paragraph({
          children: [
            new TextRun({
              text: ed.institution || '',
              bold: true,
              size: 22,
              font: 'Calibri',
              color: '1a1a2e',
            }),
          ],
          spacing: { before: 60, after: 20 },
        })
      );
      if (ed.degree || ed.dates) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({
                text: [ed.degree, ed.dates].filter(Boolean).join('  ·  '),
                size: 18,
                font: 'Calibri',
                color: '666666',
                italics: true,
              }),
            ],
            spacing: { after: 60 },
          })
        );
      }
    }
  }

  // ── Assemble document ──────────────────────────────────────────────────────
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.75),
              bottom: convertInchesToTwip(0.75),
              left: convertInchesToTwip(0.9),
              right: convertInchesToTwip(0.9),
            },
          },
        },
        children: sections,
      },
    ],
  });

  // Packer.toBuffer() returns a Buffer in Node, Uint8Array in browser
  const buffer = await Packer.toBuffer(doc);
  return buffer.buffer || buffer; // ensure ArrayBuffer
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sectionHeading(text) {
  return new Paragraph({
    children: [
      new TextRun({
        text: text.toUpperCase(),
        bold: true,
        size: 18, // 9pt
        font: 'Calibri',
        color: '2563eb',
        allCaps: true,
        characterSpacing: 40,
      }),
    ],
    border: {
      bottom: {
        color: 'cbd5e1',
        style: BorderStyle.SINGLE,
        size: 4,
      },
    },
    spacing: { before: 160, after: 80 },
  });
}

function horizontalRule() {
  return new Paragraph({
    border: {
      bottom: {
        color: 'e2e8f0',
        style: BorderStyle.SINGLE,
        size: 6,
      },
    },
    spacing: { after: 120 },
    children: [],
  });
}

// ─── buildFilename ─────────────────────────────────────────────────────────
// Generate a consistent, descriptive filename.
// Format: FirstName_Company_Role_YYYY-MM-DD.docx
export function buildFilename(resume, jobData) {
  const firstName = (resume.name || 'Resume').split(' ')[0];
  const company = (jobData?.company || 'Company').replace(/[^a-zA-Z0-9]/g, '');
  const role = (jobData?.title || 'Role').replace(/[^a-zA-Z0-9]/g, '');
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  return `${firstName}_${company}_${role}_${date}.docx`;
}
