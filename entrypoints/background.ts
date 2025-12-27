export default defineBackground(() => {
  console.log('CSS Token Detector Background Loaded');

  // 创建右键菜单
  browser.contextMenus.create({
    id: 'open-sidepanel',
    title: '打开 CSS Token 分析面板',
    contexts: ['all'],
  });

  // 监听右键菜单点击
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'open-sidepanel' && tab?.id) {
      // @ts-ignore
      await browser.sidePanel.open({ tabId: tab.id });
    }
  });

  // 监听标签页更新（如路由变化、刷新）
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active) {
      browser.runtime.sendMessage({ type: 'TAB_UPDATED', tabId }).catch(() => {
        // 忽略侧边栏未打开时的错误
      });
    }
  });

  // 监听标签页切换
  browser.tabs.onActivated.addListener((activeInfo) => {
    browser.runtime.sendMessage({ type: 'TAB_ACTIVATED', tabId: activeInfo.tabId }).catch(() => {
      // 忽略侧边栏未打开时的错误
    });
  });
});
