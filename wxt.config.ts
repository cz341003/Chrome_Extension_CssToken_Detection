import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'CSS Token Detector',
    permissions: ['activeTab', 'scripting', 'sidePanel', 'contextMenus'],
    host_permissions: ['<all_urls>'],
    action: {
      default_popup: 'entrypoints/popup/index.html',
    },
  },
});
