<script setup lang="ts">
const openSidePanel = async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    // @ts-ignore
    await browser.sidePanel.open({ tabId: tab.id });
    window.close(); // 关闭 popup
  }
};
</script>

<template>
  <div class="popup-container">
    <div class="logo-area">
      <img src="/wxt.svg" class="logo" alt="logo" />
      <h1>CSS Token Detector</h1>
    </div>
    <p class="description">点击下方按钮开启侧边栏分析页面 CSS 变量</p>
    <button @click="openSidePanel" class="open-btn">
      <span class="icon">📊</span>
      打开分析面板
    </button>
  </div>
</template>

<style scoped>
.popup-container {
  width: 240px;
  padding: 20px;
  background-color: #121212;
  color: #e0e0e0;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.logo-area {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.logo {
  width: 24px;
  height: 24px;
}

h1 {
  font-size: 16px;
  margin: 0;
  background: linear-gradient(135deg, #646cff, #9f7aea);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.description {
  font-size: 12px;
  color: #888;
  margin-bottom: 20px;
  line-height: 1.5;
}

.open-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  background-color: #646cff;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  transition: background-color 0.2s;
}

.open-btn:hover {
  background-color: #535bf2;
}

.icon {
  font-size: 16px;
}
</style>
