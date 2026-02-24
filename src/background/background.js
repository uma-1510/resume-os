// background.js — Chrome MV3 Service Worker
//
// WHY everything funnels through background.js:
//   • Content scripts cannot call external APIs (CORS) or use chrome.downloads
//   • Side panel can't directly use npm packages bundled via esbuild
//   • Service workers CAN do all of these, and CAN message both sides
//   • This is the single orchestration hub — all AI calls, storage writes,
//     and file generation happen here
//
// MESSAGE PROTOCOL:
//   All messages follow { action: string, data: any }
//   All responses follow { success: boolean, data?: any, error?: any }

import { tailorResume, rebuildPreferenceSummary, parseGeminiError } from '../utils/ai.js';
import { generateDocx, buildFilename } from '../utils/docx.js';
import { parseResumeFile } from '../utils/resume-parser.js';
import {
  readMemory,
  recordSession,
  updateSessionStatus,
  updatePreferenceSummary,
  shouldRebuildSummary,
  clearMemory,
} from '../utils/memory.js';

// Extension install handler
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: 'chrome://newtab' }, (tab) => {
      setTimeout(() => {
        chrome.sidePanel.open({ tabId: tab.id }).catch(() => {
        });
      }, 500);
    });
  }
});

// Action button click → open side panel 
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Main message router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, data } = message;

  // We must return true to indicate async response
  handleMessage(action, data, sender)
    .then(result => sendResponse({ success: true, data: result }))
    .catch(err => {
      console.error(`[ResumeOS background] Error in ${action}:`, err);
      sendResponse({
        success: false,
        error: typeof err === 'object' && err.code
          ? err
          : { code: 'UNKNOWN', message: err?.message || String(err) },
      });
    });

  return true;
});

// Message handlers

async function handleMessage(action, data, sender) {
  switch (action) {

    // Save settings
    case 'SAVE_SETTINGS': {
      const { name, apiKey, baseResumeText, onboardingDone } = data;
      await chromeStorageSet({
        'ros_name': name,
        'ros_apiKey': apiKey,
        'ros_baseResume': baseResumeText,
        'ros_onboardingDone': onboardingDone || false,
      });
      return { saved: true };
    }

    // Get settings
    case 'GET_SETTINGS': {
      const settings = await chromeStorageGet([
        'ros_name', 'ros_apiKey', 'ros_baseResume', 'ros_onboardingDone',
      ]);
      return {
        name: settings.ros_name || '',
        apiKey: settings.ros_apiKey || '',
        baseResumeText: settings.ros_baseResume || '',
        onboardingDone: settings.ros_onboardingDone || false,
      };
    }

    // Parse uploaded resume file - WHY in background: mammoth.js is bundled here. Content/panel can't use it.
    case 'PARSE_RESUME_FILE': {
      const { fileData, filename } = data;
      // fileData is a base64 string (files can't be sent directly via messages)
      const binaryStr = atob(fileData);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      return await parseResumeFile(bytes.buffer, filename);
    }

    // Tailor resume via Gemini
    case 'TAILOR_RESUME': {
      const settings = await chromeStorageGet(['ros_apiKey', 'ros_baseResume']);
      const apiKey = settings.ros_apiKey;
      const baseResume = settings.ros_baseResume;

      if (!apiKey) throw { code: 'NO_KEY', message: 'No API key found. Complete setup in Settings.' };
      if (!baseResume) throw { code: 'NO_RESUME', message: 'No base resume found. Upload your resume in Settings.' };

      // Get preference summary from career memory
      const memory = await readMemory();
      const preferenceSummary = memory.aggregate.preferenceSummary;

      const result = await tailorResume({
        apiKey,
        baseResume,
        jobDescription: data.jobDescription,
        preferenceSummary,
      });

      return { resume: result };
    }

    // ── Generate .docx and return base64 ──────────────────────────────────
    // WHY we return base64 instead of triggering download here:
    //   chrome.downloads.download({ saveAs: true }) requires a user gesture.
    //   The gesture context is lost after the async AI chain.
    //   We send base64 back to the side panel, where the button click handler
    //   (which HAS the gesture) triggers the actual download.
    case 'GENERATE_DOCX': {
      const { resume, jobData } = data;
      const arrayBuffer = await generateDocx(resume);
      const filename = buildFilename(resume, jobData);

      // Convert ArrayBuffer - base64 string for message passing
      // WHY base64: chrome.runtime.sendMessage can't send ArrayBuffer directly
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < uint8.length; i++) {
        binary += String.fromCharCode(uint8[i]);
      }
      const base64 = btoa(binary);

      return { base64, filename };
    }

    // Record confirmed session to career memory
    case 'RECORD_SESSION': {
      const { jobData, confirmedResume, keywordsUsed } = data;
      const sessionId = await recordSession({ jobData, confirmedResume, keywordsUsed });

      // Check if we should rebuild the preference summary
      const memory = await readMemory();
      if (shouldRebuildSummary(memory.aggregate)) {
        // Rebuild in background — don't block the response
        const settings = await chromeStorageGet(['ros_apiKey']);
        if (settings.ros_apiKey) {
          rebuildPreferenceSummary({
            apiKey: settings.ros_apiKey,
            sessions: memory.sessions.slice(-10), // last 10 sessions
          }).then(summary => updatePreferenceSummary(summary))
            .catch(err => console.warn('[ResumeOS] Summary rebuild failed:', err));
        }
      }

      return { sessionId };
    }

    // Update session status (applied, interview, etc.)
    case 'UPDATE_STATUS': {
      await updateSessionStatus(data.sessionId, data.status);
      return { updated: true };
    }

    // Get all sessions for History tab
    case 'GET_MEMORY': {
      const memory = await readMemory();
      return { memory };
    }

    // Job detected by content script — relay to side panel
    case 'JOB_DETECTED': {
      // Broadcast to side panel
      chrome.runtime.sendMessage({ action: 'JOB_DETECTED_RELAY', data });
      return { relayed: true };
    }

    // Clear all memory
    case 'CLEAR_MEMORY': {
      await clearMemory();
      return { cleared: true };
    }

    default:
      throw { code: 'UNKNOWN_ACTION', message: `Unknown action: ${action}` };
  }
}

// Storage helpers

function chromeStorageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

function chromeStorageSet(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  });
}