<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';

interface Token {
  property: string;
  name: string;
  value: string;
  inherited?: boolean;
}

interface Hardcoded {
  property: string;
  value: string;
}

interface DetectedElement {
  id: string;
  tagName: string;
  className: string;
  type: 'used' | 'unused';
  tokens?: Token[];
  hardcoded?: Hardcoded[];
  isVisible?: boolean;
  frameId?: string;
}

const usedElements = ref<DetectedElement[]>([]);
const unusedElements = ref<DetectedElement[]>([]);

// 按 Frame 分组
const groupedUnusedElements = computed(() => {
  const groups: Record<string, DetectedElement[]> = {};
  unusedElements.value.forEach(el => {
    const frameId = el.frameId || 'Main Page';
    if (!groups[frameId]) groups[frameId] = [];
    groups[frameId].push(el);
  });
  return groups;
});
const scanning = ref(false);
const error = ref<string | null>(null);
const activeTab = ref<'unused'>('unused');
const mainScrollContainer = ref<HTMLElement | null>(null);
const showToast = ref(false);
const toastMessage = ref('');
const selectedElementAncestors = ref<any[] | null>(null);
const viewingAncestorsId = ref<string | null>(null);

const switchTab = (tab: 'unused') => {
  activeTab.value = tab;
  if (mainScrollContainer.value) {
    mainScrollContainer.value.scrollTop = 0;
  }
};

const scanTokens = async () => {
  if (scanning.value) return;
  
  scanning.value = true;
  error.value = null;
  selectedElementAncestors.value = null;
  viewingAncestorsId.value = null;
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    
    if (!tab?.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) {
      usedElements.value = [];
      unusedElements.value = [];
      if (tab?.url?.startsWith('chrome://')) {
        error.value = '无法在浏览器管理页面进行扫描。';
      }
      return;
    }

    const response = await Promise.race([
      browser.tabs.sendMessage(tab.id, { type: 'SCAN_TOKENS' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
    ]) as { used: DetectedElement[], unused: DetectedElement[] };
    
    usedElements.value = response.used || [];
    unusedElements.value = response.unused || [];
  } catch (e: any) {
    console.error('Scan failed:', e);
    usedElements.value = [];
    unusedElements.value = [];
    error.value = e.message === 'Timeout' ? '扫描超时，页面可能过于复杂。' : '无法连接到页面。请刷新页面后再试。';
  } finally {
    scanning.value = false;
  }
};

const highlightElement = async (id: string, isUnused: boolean) => {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const result = await browser.tabs.sendMessage(tab.id, { type: 'HIGHLIGHT_ELEMENT', id, isUnused }) as { found: boolean; visible: boolean };
    
    if (result && result.found && !result.visible) {
      toastMessage.value = '该元素当前处于隐藏状态 (display: none)，无法在页面上高亮。';
      showToast.value = true;
      setTimeout(() => showToast.value = false, 3000);
    }
  } catch (e) {
    console.error('Highlight failed:', e);
  }
};

const viewAncestors = async (id: string, event: Event) => {
  event.stopPropagation();
  if (viewingAncestorsId.value === id) {
    selectedElementAncestors.value = null;
    viewingAncestorsId.value = null;
    return;
  }

  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const response = await browser.tabs.sendMessage(tab.id, { type: 'GET_ELEMENT_ANCESTORS', id });
    if (response && response.ancestors) {
      selectedElementAncestors.value = response.ancestors;
      viewingAncestorsId.value = id;
    }
  } catch (e) {
    console.error('Fetch ancestors failed:', e);
  }
};

const messageListener = (message: any) => {
  if (message.type === 'TAB_UPDATED' || message.type === 'TAB_ACTIVATED' || message.type === 'IFRAME_CHANGED') {
    scanTokens();
  }
};

onMounted(() => {
  scanTokens();
  browser.runtime.onMessage.addListener(messageListener);
});

onUnmounted(() => {
  browser.runtime.onMessage.removeListener(messageListener);
});

// 属性分组逻辑
const PROPERTY_GROUPS = {
  font: ['font-size', 'font-weight', 'font-family', 'line-height', 'letter-spacing', 'color', 'text-align'],
  spacing: ['margin', 'padding', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'gap'],
  border: ['border', 'border-width', 'border-style', 'border-color', 'border-radius', 'outline'],
  shadow: ['box-shadow', 'text-shadow'],
  layout: ['width', 'height', 'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index'],
  background: ['background', 'background-color', 'background-image']
};

const getGroup = (prop: string) => {
  for (const [group, props] of Object.entries(PROPERTY_GROUPS)) {
    if (props.includes(prop)) return group;
  }
  return 'other';
};

const getGroupLabel = (group: string) => {
  switch (group) {
    case 'font': return '字体与文本';
    case 'spacing': return '间距与布局';
    case 'border': return '边框与圆角';
    case 'shadow': return '阴影特效';
    case 'background': return '背景样式';
    default: return '其他属性';
  }
};

const getTokenType = (value: string) => {
  const val = value.trim().toLowerCase();
  if (val.startsWith('#') || val.startsWith('rgb') || val.startsWith('hsl') || ['transparent', 'currentcolor'].includes(val) || /^(red|green|blue|yellow|orange|purple|pink|brown|gray|black|white)$/.test(val)) return 'color';
  if (/^-?\d+(\.\d+)?(px|rem|em|vh|vw|%|pt|pc|in|cm|mm|ex|ch|vmin|vmax)$/.test(val)) return 'size';
  if (val.includes('font') || val.includes('serif') || val.includes('sans-serif') || val.includes('mono')) return 'font';
  return 'other';
};

const getTokenIcon = (type: string) => {
  switch (type) {
    case 'size': return '📏';
    case 'font': return '🔤';
    default: return '🔧';
  }
};

// 对 Used Tokens 进行分组
const groupTokens = (tokens: Token[]) => {
  const groups: Record<string, Token[]> = {};
  tokens.forEach(token => {
    const group = getGroup(token.property);
    if (!groups[group]) groups[group] = [];
    groups[group].push(token);
  });
  return groups;
};

// 对 Unused Hardcoded 进行分组
const groupHardcoded = (items: Hardcoded[]) => {
  const groups: Record<string, Hardcoded[]> = {};
  items.forEach(item => {
    const group = getGroup(item.property);
    if (!groups[group]) groups[group] = [];
    groups[group].push(item);
  });
  return groups;
};
</script>

<template>
  <div class="container">
    <header>
      <div class="logo-area">
        <div class="tech-logo">
          <div class="logo-inner"></div>
        </div>
        <h1>CSS TOKEN DETECTOR</h1>
      </div>
      <div class="header-actions">
        <button @click="scanTokens" :disabled="scanning" class="scan-btn" :class="{ 'is-scanning': scanning }">
          <span class="scan-icon"></span>
          {{ scanning ? '正在扫描...' : '重新扫描' }}
        </button>
      </div>
    </header>

    <div class="tabs">
      <div 
        class="tab-item warning active"
      >
        <span class="tab-label">未使用变量检测</span>
        <span class="tab-count">{{ unusedElements.length }}+</span>
      </div>
    </div>

    <main ref="mainScrollContainer">
      <div v-if="error" class="status-card error">
        <div class="tech-error-icon">!</div>
        <p>{{ error }}</p>
        <button @click="scanTokens" class="retry-btn">RETRY_SYSTEM</button>
      </div>
      
      <div v-else-if="!scanning">
        <!-- 未使用变量 Tab -->
        <div v-if="activeTab === 'unused'">
          <div v-if="unusedElements.length === 0" class="status-card" :class="usedElements.length === 0 ? 'empty' : 'success'">
            <template v-if="usedElements.length === 0">
              <div class="tech-empty-icon">∅</div>
              <h3>未发现变量</h3>
              <p>当前页面未检测到 <code>var(--*)</code> 变量的使用。</p>
            </template>
            <template v-else>
              <div class="tech-success-icon">✓</div>
              <h3>系统已优化</h3>
              <p>所有检测到的属性均已成功映射到 CSS 变量。保持高标准。</p>
            </template>
          </div>
          <div v-else class="results">
            <div v-for="(elements, frameId) in groupedUnusedElements" :key="frameId" class="frame-group">
              <div class="frame-header">
                <span class="frame-icon">▤</span>
                <span class="frame-title">{{ frameId }}</span>
                <span class="frame-count">{{ elements.length }}</span>
              </div>
              <ul class="element-list">
                <li 
                  v-for="el in elements" 
                  :key="el.id" 
                  class="element-item is-unused" 
                  @click="highlightElement(el.id, true)"
                >
                  <div class="element-header">
                    <div class="tag-badge">{{ el.tagName }}</div>
                    <span v-if="el.className" class="class-name" :title="el.className">
                      .{{ el.className.split(' ').filter(c => c).join('.') }}
                    </span>
                    <div class="tech-line"></div>
                    <button class="view-btn" @click="viewAncestors(el.id, $event)" :class="{ active: viewingAncestorsId === el.id }">
                      {{ viewingAncestorsId === el.id ? '收起' : '查看' }}
                    </button>
                  </div>

                  <!-- 祖先拓扑展示 -->
                  <div v-if="viewingAncestorsId === el.id && selectedElementAncestors" class="ancestor-topology">
                    <div class="topology-title">结构拓扑 (从当前到祖先)</div>
                    <div class="topology-list">
                      <div v-for="(ancestor, index) in selectedElementAncestors" :key="index" class="topology-item">
                        <div class="topology-node">
                          <span class="node-tag">{{ ancestor.tagName }}</span>
                          <span v-if="ancestor.className" class="node-class" :title="ancestor.className">
                            .{{ ancestor.className.split(' ').filter((c: any) => c).join('.') }}
                          </span>
                        </div>
                        <div v-if="index < selectedElementAncestors.length - 1" class="topology-connector">
                          <div class="connector-line"></div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="group-container">
                    <div v-for="(items, group) in groupHardcoded(el.hardcoded || [])" :key="group" class="prop-group">
                      <div class="group-header warning">{{ getGroupLabel(group) }}</div>
                      <div class="hardcoded-grid">
                        <div v-for="item in items" :key="item.property" class="hardcoded-badge">
                          <div v-if="getTokenType(item.value) === 'color'" class="color-preview" :style="{ backgroundColor: item.value }"></div>
                          <div v-else class="type-icon">{{ getTokenIcon(getTokenType(item.value)) }}</div>
                          <div class="hardcoded-details">
                            <span class="prop-name">{{ item.property }}</span>
                            <span class="prop-value">{{ item.value }}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>

      </div>
    </main>
    
    <Transition name="fade">
      <div v-if="showToast" class="toast-overlay">
        <div class="toast-content">
          <span class="toast-icon">⚠️</span>
          {{ toastMessage }}
        </div>
      </div>
    </Transition>

    <Transition name="fade">
      <div v-if="scanning" class="scanning-overlay">
        <div class="hud-loader">
          <div class="hud-circle"></div>
          <div class="hud-scanner"></div>
          <div class="hud-text">
            <span class="glitch" data-text="正在扫描 DOM">正在扫描 DOM</span>
            <div class="hud-progress">
              <div class="hud-bar"></div>
            </div>
            <span class="hud-sub">正在分析 CSS 架构...</span>
          </div>
          <div class="hud-corners">
            <span></span><span></span><span></span><span></span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: #0a0a0a;
  color: #00f2ff;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  overflow: hidden;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: linear-gradient(180deg, #1a1a1a 0%, #0a0a0a 100%);
  border-bottom: 1px solid #00f2ff33;
  box-shadow: 0 0 20px #00f2ff11;
}

.logo-area {
  display: flex;
  align-items: center;
  gap: 12px;
}

.tech-logo {
  width: 24px;
  height: 24px;
  border: 2px solid #00f2ff;
  position: relative;
  animation: rotate 4s linear infinite;
}

.logo-inner {
  position: absolute;
  top: 4px;
  left: 4px;
  right: 4px;
  bottom: 4px;
  background: #00f2ff;
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
}

h1 {
  font-size: 14px;
  margin: 0;
  font-weight: 800;
  letter-spacing: 2px;
  text-shadow: 0 0 10px #00f2ff66;
}

.scan-btn {
  background: transparent;
  border: 1px solid #00f2ff;
  color: #00f2ff;
  padding: 6px 16px;
  font-size: 11px;
  font-weight: bold;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.3s;
  position: relative;
  overflow: hidden;
}

.scan-btn:hover:not(:disabled) {
  background: #00f2ff22;
  box-shadow: 0 0 15px #00f2ff44;
}

.scan-icon {
  width: 10px;
  height: 10px;
  border: 2px solid #00f2ff;
  border-radius: 50%;
  border-top-color: transparent;
}

.is-scanning .scan-icon {
  animation: rotate 0.8s linear infinite;
}

.tabs {
  display: flex;
  padding: 8px;
  gap: 8px;
  background: #111;
}

.tab-item {
  flex: 1;
  background: #1a1a1a;
  border: 1px solid #333;
  padding: 8px;
  color: #666;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  transition: all 0.3s;
}

.tab-item.active {
  border-color: #00f2ff;
  color: #00f2ff;
  background: #00f2ff11;
  box-shadow: inset 0 0 10px #00f2ff22;
}

.tab-item.warning.active {
  border-color: #ff0055;
  color: #ff0055;
  background: #ff005511;
}

.tab-count {
  background: #000;
  padding: 2px 6px;
  border-radius: 2px;
  font-size: 9px;
}

main {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  scrollbar-width: thin;
  scrollbar-color: #00f2ff33 transparent;
}

.element-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.element-item {
  background: #111;
  border: 1px solid #222;
  padding: 12px;
  position: relative;
  transition: all 0.3s;
  cursor: pointer;
}

.element-item:hover {
  border-color: #00f2ff66;
  background: #161616;
}

.element-item.is-unused {
  border-left: 2px solid #ff0055;
}

.element-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.tag-badge {
  background: #00f2ff22;
  color: #00f2ff;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: bold;
  border: 1px solid #00f2ff44;
}

.class-name {
  color: #888;
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100px;
}

.view-btn {
  background: #ff005522;
  border: 1px solid #ff0055;
  color: #ff0055;
  font-size: 9px;
  padding: 2px 8px;
  cursor: pointer;
  transition: all 0.3s;
}

.view-btn:hover {
  background: #ff005544;
}

.view-btn.active {
  background: #ff0055;
  color: #fff;
}

.tech-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, #00f2ff33 0%, transparent 100%);
}

.prop-group {
  margin-bottom: 12px;
}

.group-header {
  font-size: 9px;
  color: #00f2ff88;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 1px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.group-header::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #00f2ff11;
}

.group-header.warning {
  color: #ff005588;
}

.token-grid, .hardcoded-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 4px;
}

.token-badge, .hardcoded-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #000;
  padding: 6px;
  border: 1px solid #222;
}

.color-preview {
  width: 12px;
  height: 12px;
  border: 1px solid #333;
}

.type-icon {
  font-size: 10px;
  opacity: 0.6;
}

.token-details, .hardcoded-details {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.token-name, .prop-name {
  font-size: 10px;
  color: #00f2ff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.prop-name {
  color: #ff0055;
}

.token-value, .prop-value {
  font-size: 9px;
  color: #666;
}

.inherited-tag {
  font-size: 8px;
  background: #00f2ff22;
  padding: 0 3px;
  margin-left: 4px;
}

/* Ancestor Topology */
.ancestor-topology {
  background: #000;
  border: 1px dashed #ff005544;
  padding: 10px;
  margin-bottom: 12px;
  font-size: 10px;
}

.topology-title {
  color: #ff0055;
  font-size: 9px;
  margin-bottom: 8px;
  text-transform: uppercase;
  opacity: 0.8;
}

.topology-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.topology-item {
  display: flex;
  flex-direction: column;
}

.topology-node {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: #1a1a1a;
  border-left: 2px solid #ff0055;
}

.node-tag {
  color: #ff0055;
  font-weight: bold;
}

.node-class {
  color: #888;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.topology-connector {
  padding-left: 12px;
  height: 10px;
  display: flex;
  align-items: center;
}

.connector-line {
  width: 1px;
  height: 100%;
  background: #ff005544;
}

/* HUD Loader */
.scanning-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.hud-loader {
  position: relative;
  width: 200px;
  height: 200px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.hud-circle {
  position: absolute;
  width: 120px;
  height: 120px;
  border: 2px solid #00f2ff22;
  border-top-color: #00f2ff;
  border-radius: 50%;
  animation: rotate 2s linear infinite;
}

.hud-scanner {
  position: absolute;
  width: 140px;
  height: 2px;
  background: linear-gradient(90deg, transparent, #00f2ff, transparent);
  animation: scan 2s ease-in-out infinite;
}

.hud-text {
  margin-top: 160px;
  text-align: center;
}

.glitch {
  font-size: 12px;
  font-weight: bold;
  position: relative;
  display: inline-block;
}

.hud-progress {
  width: 120px;
  height: 2px;
  background: #111;
  margin: 8px auto;
  overflow: hidden;
}

.hud-bar {
  width: 40%;
  height: 100%;
  background: #00f2ff;
  animation: progress 1.5s ease-in-out infinite;
}

.hud-sub {
  font-size: 8px;
  opacity: 0.5;
}

.hud-corners span {
  position: absolute;
  width: 15px;
  height: 15px;
  border: 1px solid #00f2ff;
}

.hud-corners span:nth-child(1) { top: 0; left: 0; border-right: 0; border-bottom: 0; }
.hud-corners span:nth-child(2) { top: 0; right: 0; border-left: 0; border-bottom: 0; }
.hud-corners span:nth-child(3) { bottom: 0; left: 0; border-right: 0; border-top: 0; }
.hud-corners span:nth-child(4) { bottom: 0; right: 0; border-left: 0; border-top: 0; }

@keyframes rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes scan {
  0%, 100% { transform: translateY(-60px); opacity: 0; }
  50% { transform: translateY(60px); opacity: 1; }
}

@keyframes progress {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(250%); }
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.5s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.status-card {
  padding: 40px 20px;
  text-align: center;
  border: 1px solid #222;
  background: #111;
}

.tech-error-icon, .tech-empty-icon, .tech-success-icon {
  font-size: 32px;
  margin-bottom: 16px;
}

.tech-error-icon { color: #ff0055; }
.tech-success-icon { color: #00f2ff; }

.retry-btn {
  background: #ff0055;
  color: #fff;
  border: none;
  padding: 8px 20px;
  font-size: 10px;
  font-weight: bold;
  margin-top: 16px;
  cursor: pointer;
}

.toast-overlay {
  position: absolute;
  bottom: 20px;
  left: 20px;
  right: 20px;
  z-index: 2000;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.toast-content {
  background: rgba(255, 0, 85, 0.9);
  color: white;
  padding: 10px 16px;
  border-radius: 4px;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(4px);
  pointer-events: auto;
}

.toast-icon {
  font-size: 14px;
}

.frame-group {
  margin-bottom: 24px;
}

.frame-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-left: 3px solid #00f2ff;
  margin-bottom: 12px;
  position: sticky;
  top: 0;
  z-index: 10;
}

.frame-icon {
  color: #00f2ff;
  font-size: 14px;
}

.frame-title {
  color: #fff;
  font-weight: bold;
  font-size: 11px;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.frame-count {
  background: #00f2ff22;
  color: #00f2ff;
  padding: 2px 6px;
  border-radius: 2px;
  font-size: 9px;
  font-weight: bold;
}
</style>
