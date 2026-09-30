import { defineConfig } from 'wxt';

// Manifest permissions follow spec section 6 and are added by the task that
// first needs them. WXT adds `sidePanel` itself for Chrome because of the
// `sidepanel` entrypoint.
export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    // The `action` key creates the toolbar icon: Chrome opens the side panel
    // from it, Firefox toggles the sidebar in `action.onClicked`.
    action: { default_title: '__MSG_extName__' },
    optional_host_permissions: ['<all_urls>'],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'browser-sidekick@wolffischer82.github.io',
              strict_min_version: '128.0',
            },
          },
        }
      : { minimum_chrome_version: '116' }),
  }),
  vite: () => ({
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  }),
});
