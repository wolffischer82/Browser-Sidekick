import { resolve } from 'node:path';
import { defineConfig } from 'wxt';

// Placeholder artwork: design/icon.svg, exported by `npm run icons`.
const ICONS = {
  16: 'icon/16.png',
  32: 'icon/32.png',
  48: 'icon/48.png',
  96: 'icon/96.png',
  128: 'icon/128.png',
};
const TOOLBAR_ICONS = { 16: ICONS[16], 32: ICONS[32] };

interface SidebarAction {
  default_title?: string;
  default_icon?: Record<number, string>;
}

// Manifest permissions follow spec section 6 and are added by the task that
// first needs them. WXT adds `sidePanel` itself for Chrome because of the
// `sidepanel` entrypoint.
export default defineConfig({
  srcDir: 'src',
  // Visible, directly loadable builds: dist/chrome-ext and dist/firefox-ext
  // (dev builds get a -dev suffix). Not the repo root: WXT cleans outDir.
  outDir: 'dist',
  outDirTemplate: '{{browser}}-ext{{modeSuffix}}',
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    icons: ICONS,
    // The `action` key creates the toolbar icon: Chrome opens the side panel
    // from it, Firefox toggles the sidebar in `action.onClicked`.
    action: { default_title: '__MSG_extName__', default_icon: TOOLBAR_ICONS },
    // T02: settings live in storage.local (spec section 6). T06: `activeTab`
    // and `scripting` inject the extractor on demand; no `tabs` permission.
    // T07: `contextMenus` for "Pin to Sidekick"; Firefox's `contextMenus`
    // namespace includes the `tab` context, so no `menus` (decisions.md T07).
    // T09: Chrome's `offscreen` document parses PDFs; Firefox parses them in
    // its background page (spec 5.5).
    permissions: [
      'storage',
      'activeTab',
      'scripting',
      'contextMenus',
      ...(browser === 'firefox' ? [] : ['offscreen']),
    ],
    // T04: the three known provider hosts (spec section 6, D6). A custom
    // OpenAI-compatible origin is requested at runtime when saved (T05).
    host_permissions: [
      'https://api.openai.com/*',
      'https://api.anthropic.com/*',
      'https://generativelanguage.googleapis.com/*',
    ],
    optional_host_permissions: ['<all_urls>'],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'browser-sidekick@wolffischer82.github.io',
              // Owner decision 2026-09-30 (spec section 1).
              strict_min_version: '140.0',
              data_collection_permissions: { required: ['websiteContent', 'browsingActivity'] },
            },
          },
        }
      : { minimum_chrome_version: '116' }),
  }),
  hooks: {
    // T09: pdf.js's worker ships as a packaged file (no CDN, no remote code).
    // Legacy build (Chrome 116), minified like the bundled main library. `.js` so both
    // browsers serve it as JavaScript.
    'build:publicAssets': (_wxt, files) => {
      files.push({
        absoluteSrc: resolve(
          import.meta.dirname,
          'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
        ),
        relativeDest: 'pdf.worker.js',
      });
      // Redesign T17: the Geist fonts' licence, next to the woff2 files Vite emits.
      files.push({
        absoluteSrc: resolve(import.meta.dirname, 'src/entrypoints/sidepanel/fonts/OFL.txt'),
        relativeDest: 'assets/OFL.txt',
      });
    },
    // WXT fills `sidebar_action` from the sidepanel HTML; localise its title
    // and give it the toolbar icon.
    'build:manifestGenerated': (_wxt, manifest) => {
      // `sidebar_action` is Firefox-only and untyped (`any`) in WXT's typings.
      const sidebarAction = manifest.sidebar_action as SidebarAction | undefined;
      if (sidebarAction) {
        sidebarAction.default_title = '__MSG_extName__';
        sidebarAction.default_icon = TOOLBAR_ICONS;
      }
    },
  },
  vite: () => ({
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  }),
});
