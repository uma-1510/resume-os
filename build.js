// build.js — esbuild bundler for ResumeOS Chrome Extension
// Bundles background.js and content.js separately (MV3 requires separate bundles)
// All heavy deps (Gemini SDK, docx, mammoth) go into background bundle only

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const isWatch = process.argv.includes('--watch');

// Ensure dist/ exists
if (!fs.existsSync('dist')) fs.mkdirSync('dist');

const sharedConfig = {
  bundle: true,
  minify: !isWatch,
  sourcemap: isWatch ? 'inline' : false,
  target: ['chrome120'],
  logLevel: 'info',
};

async function build() {
  // ─── Background service worker ───────────────────────────────────────────
  // Contains: Gemini SDK, docx.js, mammoth, all utils
  // WHY: Service workers can import ESM. All AI + file logic lives here.
  //      Content scripts cannot call AI. Side panel cannot use Node modules.
  await esbuild.build({
    ...sharedConfig,
    entryPoints: ['src/background/background.js'],
    outfile: 'dist/background.js',
    format: 'esm',
    // WHY platform: browser — we need browser globals (fetch, etc.)
    // but we're NOT in a DOM context (no window), so we can't use platform: 'browser'
    // for everything. Service workers have self, not window.
    platform: 'browser',
    define: {
      // Suppress Node.js-specific checks in mammoth
      'process.env.NODE_ENV': '"production"',
    },
  });

  // ─── Content script ───────────────────────────────────────────────────────
  // Contains: URL detection, MutationObserver, DOM extraction, badge injection
  // WHY separate: Content scripts run in page context. They cannot use
  //               chrome.downloads, cannot call Gemini directly (CORS), and
  //               must be small. They only extract + relay data to background.
  await esbuild.build({
    ...sharedConfig,
    entryPoints: ['src/content/content.js'],
    outfile: 'dist/content.js',
    format: 'iife', // WHY iife: Content scripts don't support ESM modules
    platform: 'browser',
  });

  console.log('✓ Build complete');
}

if (isWatch) {
  // Watch mode: rebuild on file changes
  Promise.all([
    esbuild.context({
      ...sharedConfig,
      entryPoints: ['src/background/background.js'],
      outfile: 'dist/background.js',
      format: 'esm',
      platform: 'browser',
    }).then(ctx => ctx.watch()),
    esbuild.context({
      ...sharedConfig,
      entryPoints: ['src/content/content.js'],
      outfile: 'dist/content.js',
      format: 'iife',
      platform: 'browser',
    }).then(ctx => ctx.watch()),
  ]).then(() => console.log('👀 Watching for changes...'));
} else {
  build().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
