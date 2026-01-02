<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';

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
  selector?: string;
}

const usedElements = ref<DetectedElement[]>([]);
const unusedElements = ref<DetectedElement[]>([]);
const hasScanned = ref(false);
const needsRescan = ref(false);
const selectedFilter = ref<string>('all');

// 按 Frame 分组并过滤
const filteredUnusedElements = computed(() => {
  let filtered = unusedElements.value;
  if (selectedFilter.value !== 'all') {
    filtered = unusedElements.value.filter(el => 
      el.hardcoded?.some(h => getGroup(h.property) === selectedFilter.value)
    ).map(el => ({
      ...el,
      hardcoded: el.hardcoded?.filter(h => getGroup(h.property) === selectedFilter.value)
    }));
  }

  const groups: Record<string, DetectedElement[]> = {};
  filtered.forEach(el => {
    const frameId = el.frameId || 'Main Page';
    if (!groups[frameId]) groups[frameId] = [];
    groups[frameId].push(el);
  });
  return groups;
});

const scanning = ref(false);
const error = ref<string | null>(null);
const activeTab = ref<'unused'>('unused');
const activeFrameId = ref<string>('');
const mainScrollContainer = ref<HTMLElement | null>(null);

// 监听过滤后的元素变化，确保选中的 frame 有效
watch(filteredUnusedElements, (newGroups) => {
  const frames = Object.keys(newGroups);
  if (frames.length > 0) {
    if (!activeFrameId.value || !frames.includes(activeFrameId.value)) {
      activeFrameId.value = frames[0];
    }
  } else {
    activeFrameId.value = '';
  }
}, { immediate: true });
const showToast = ref(false);
const toastMessage = ref('');
const selectedElementAncestors = ref<any[] | null>(null);
const viewingAncestorsId = ref<string | null>(null);
const screenshotUrl = ref<string | null>(null);
const showScreenshotModal = ref(false);

const exporting = ref(false);
const exportProgress = ref(0);
const exportTotal = ref(0);

const switchTab = (tab: 'unused') => {
  activeTab.value = tab;
  if (mainScrollContainer.value) {
    mainScrollContainer.value.scrollTop = 0;
  }
};

const switchFrame = (frameId: string) => {
  activeFrameId.value = frameId;
  if (mainScrollContainer.value) {
    mainScrollContainer.value.scrollTop = 0;
  }
};

const scanTokens = async () => {
  if (scanning.value) return;
  
  // 如果正在导出，先停止导出
  exporting.value = false;
  exportProgress.value = 0;
  
  scanning.value = true;
  error.value = null;
  hasScanned.value = true;
  needsRescan.value = false;
  
  // 立即清空旧数据，确保 UI 状态切换
  unusedElements.value = [];
  usedElements.value = [];
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
    if (hasScanned.value) {
      needsRescan.value = true;
    }
  }
};

onMounted(() => {
  browser.runtime.onMessage.addListener(messageListener);
});

onUnmounted(() => {
  browser.runtime.onMessage.removeListener(messageListener);
});

// 属性分组逻辑
const PROPERTY_GROUPS = {
  font: ['font-size', 'font-weight', 'font-family', 'letter-spacing', 'color', 'text-align'],
  spacing: ['margin', 'padding', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'gap'],
  border: ['border', 'border-width', 'border-style', 'border-color', 'border-radius', 'outline'],
  shadow: ['box-shadow', 'text-shadow'],
  layout: ['width', 'height', 'line-height', 'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index'],
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
    case 'layout': return '尺寸与位置';
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

const captureElementScreenshot = async (id: string, crop: boolean = false): Promise<string | null> => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;

  // 1. 获取元素坐标
  const rectRes = await browser.tabs.sendMessage(tab.id, { type: 'GET_ELEMENT_RECT', id });
  if (!rectRes?.rect) return null;

  // 2. 捕获标签页截图
  const capRes = await browser.runtime.sendMessage({ type: 'CAPTURE_TAB' });
  if (capRes.error || !capRes.dataUrl) throw new Error(capRes.error || '截图失败');

  // 3. Canvas 合成
  const { x, y, width, height, dpr } = rectRes.rect;
  
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }

      if (crop) {
        // 裁剪模式：保留元素周围 100px 边距
        const padding = 100 * dpr;
        const sourceX = Math.max(0, x * dpr - padding);
        const sourceY = Math.max(0, y * dpr - padding);
        const sourceW = Math.min(img.width - sourceX, width * dpr + padding * 2);
        const sourceH = Math.min(img.height - sourceY, height * dpr + padding * 2);

        canvas.width = sourceW;
        canvas.height = sourceH;
        ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, sourceW, sourceH);
        
        // 在裁剪后的图中绘制红框
        ctx.strokeStyle = '#dc3545';
        ctx.lineWidth = 3 * dpr;
        ctx.setLineDash([10 * dpr, 5 * dpr]);
        ctx.strokeRect(x * dpr - sourceX, y * dpr - sourceY, width * dpr, height * dpr);
      } else {
        // 全屏模式
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        ctx.strokeStyle = '#dc3545';
        ctx.lineWidth = 3 * dpr;
        ctx.setLineDash([10 * dpr, 5 * dpr]);
        ctx.strokeRect(x * dpr, y * dpr, width * dpr, height * dpr);
      }
      
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = capRes.dataUrl;
  });
};

const handleScreenshotClick = async (id: string) => {
  scanning.value = true;
  try {
    const dataUrl = await captureElementScreenshot(id, false);
    if (!dataUrl) {
      toastMessage.value = '该元素不在可视区域内，无法截图。';
      showToast.value = true;
      setTimeout(() => showToast.value = false, 3000);
    } else {
      screenshotUrl.value = dataUrl;
      showScreenshotModal.value = true;
    }
  } catch (e) {
    console.error('Screenshot failed:', e);
    toastMessage.value = '截图生成失败，请重试。';
    showToast.value = true;
    setTimeout(() => showToast.value = false, 3000);
  } finally {
    scanning.value = false;
  }
};

const exportReport = async () => {
  if (exporting.value || unusedElements.value.length === 0) return;
  
  exporting.value = true;
  exportProgress.value = 0;
  const targets = unusedElements.value.filter(el => el.isVisible !== false);
  exportTotal.value = targets.length;

  const reportData: any[] = [];

  try {
    for (let i = 0; i < targets.length; i++) {
      // 检查是否已被取消（如触发了重新扫描）
      if (!exporting.value) return;

      const el = targets[i];
      exportProgress.value = i + 1;
      
      try {
        const screenshot = await captureElementScreenshot(el.id, true);
        reportData.push({
          ...el,
          screenshot
        });
      } catch (e) {
        console.warn(`Failed to capture screenshot for ${el.id}`, e);
        reportData.push({
          ...el,
          screenshot: null
        });
      }
      // 稍微停顿一下，让页面有时间响应滚动
      await new Promise(r => setTimeout(r, 300));
    }

    if (!exporting.value) return;

    // 生成 HTML 报告
    const htmlContent = generateHTMLReport(reportData);
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `css-token-report-${new Date().toISOString().split('T')[0]}.html`;
    link.click();
    URL.revokeObjectURL(url);

    toastMessage.value = '报告导出成功！';
    showToast.value = true;
    setTimeout(() => showToast.value = false, 3000);
  } catch (e) {
    console.error('Export failed:', e);
    toastMessage.value = '导出失败，请重试。';
    showToast.value = true;
    setTimeout(() => showToast.value = false, 3000);
  } finally {
    exporting.value = false;
  }
};

const generateHTMLReport = (data: any[]) => {
  const itemsHtml = data.map(item => `
    <div class="report-item">
      <div class="item-info">
        <div class="item-header">
          <span class="tag">${item.tagName}</span>
          <span class="class">${item.className ? '.' + item.className.split(' ').join('.') : ''}</span>
          <span class="frame">Frame: ${item.frameId || 'Main Page'}</span>
        </div>
        <div class="item-selector">${item.selector || ''}</div>
        <div class="props-list">
          ${item.hardcoded.map((h: any) => `
            <div class="prop-row">
              <span class="prop-name">${h.property}</span>
              <span class="prop-value">${h.value}</span>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="item-screenshot">
        ${item.screenshot ? `<img src="${item.screenshot}" />` : '<div class="no-img">无法获取截图</div>'}
      </div>
    </div>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>CSS Token 扫描报告</title>
      <style>
        body { font-family: sans-serif; background: #f4f7f9; color: #333; margin: 0; padding: 40px; }
        .container { max-width: 1000px; margin: 0 auto; }
        header { margin-bottom: 40px; border-bottom: 2px solid #4a90e2; padding-bottom: 20px; }
        h1 { color: #4a90e2; margin: 0; }
        .summary { background: #fff; padding: 20px; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
        .report-item { background: #fff; border-radius: 8px; margin-bottom: 20px; display: flex; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
        .item-info { flex: 1; padding: 20px; }
        .item-header { margin-bottom: 10px; display: flex; align-items: center; gap: 10px; }
        .item-selector { font-size: 11px; color: #888; font-family: monospace; margin-bottom: 15px; word-break: break-all; background: #f8f9fa; padding: 4px 8px; border-radius: 4px; }
        .tag { background: #e9ecef; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; }
        .class { color: #666; font-family: monospace; font-size: 13px; }
        .frame { font-size: 11px; color: #999; margin-left: auto; }
        .props-list { display: grid; gap: 8px; }
        .prop-row { display: flex; justify-content: space-between; background: #f8f9fa; padding: 8px 12px; border-radius: 4px; font-size: 13px; }
        .prop-name { color: #555; }
        .prop-value { color: #dc3545; font-weight: bold; }
        .item-screenshot { width: 400px; background: #eee; display: flex; align-items: center; justify-content: center; border-left: 1px solid #eee; }
        .item-screenshot img { max-width: 100%; max-height: 300px; object-fit: contain; }
        .no-img { color: #999; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <header>
          <h1>CSS Token 扫描报告</h1>
          <p>生成时间: ${new Date().toLocaleString()}</p>
        </header>
        <div class="summary">
          <strong>检测概览：</strong> 共发现 ${data.length} 个包含硬编码属性的元素。
        </div>
        <div class="report-list">
          ${itemsHtml}
        </div>
      </div>
    </body>
    </html>
  `;
};

const downloadScreenshot = () => {
  if (!screenshotUrl.value) return;
  const link = document.createElement('a');
  link.href = screenshotUrl.value;
  link.download = `css-token-issue-${Date.now()}.png`;
  link.click();
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
      <div class="header-actions" v-if="hasScanned">
        <button @click="exportReport" :disabled="scanning || exporting || unusedElements.length === 0" class="export-btn">
          导出报告
        </button>
        <button @click="scanTokens" :disabled="scanning || exporting" class="scan-btn" :class="{ 'is-scanning': scanning }">
          <span class="scan-icon"></span>
          {{ scanning ? '正在扫描...' : '重新扫描' }}
        </button>
      </div>
    </header>

    <div class="tabs" v-if="hasScanned">
      <div class="tab-item warning active">
        <span class="tab-label">未使用变量检测</span>
        <span class="tab-count">{{ unusedElements.length }}</span>
      </div>
    </div>

    <div class="filter-bar" v-if="hasScanned && unusedElements.length > 0">
      <div 
        class="filter-item" 
        :class="{ active: selectedFilter === 'all' }"
        @click="selectedFilter = 'all'"
      >全部</div>
      <div 
        v-for="(label, key) in PROPERTY_GROUPS" 
        :key="key"
        class="filter-item"
        :class="{ active: selectedFilter === key }"
        @click="selectedFilter = key"
      >
        {{ getGroupLabel(key) }}
      </div>
    </div>

    <!-- Iframe Tabs (Fixed at top) -->
    <div class="frame-tabs" v-if="hasScanned && !scanning && !error && activeTab === 'unused'">
      <div 
        v-for="(_, frameId) in filteredUnusedElements" 
        :key="frameId"
        class="frame-tab-item"
        :class="{ active: activeFrameId === frameId || (!activeFrameId && frameId === Object.keys(filteredUnusedElements)[0]) }"
        @click="switchFrame(frameId)"
      >
        <span class="frame-tab-title">{{ frameId }}</span>
        <span class="frame-tab-count">{{ filteredUnusedElements[frameId].length }}</span>
      </div>
    </div>

    <main ref="mainScrollContainer">
      <div v-if="!hasScanned" class="welcome-screen">
        <div class="welcome-content">
          <div class="welcome-icon">🔍</div>
          <h2>准备好开始了吗？</h2>
          <p>点击下方按钮扫描当前页面的 CSS 变量使用情况</p>
          <button @click="scanTokens" :disabled="scanning" class="main-scan-btn">
            {{ scanning ? '正在分析中...' : '开始扫描页面' }}
          </button>
        </div>
      </div>

      <div v-else-if="error" class="status-card error">
        <div class="tech-error-icon">!</div>
        <p>{{ error }}</p>
        <button @click="scanTokens" class="retry-btn">重试扫描</button>
      </div>
      
      <div v-else-if="!scanning">
        <!-- 未使用变量 Tab -->
        <div v-if="activeTab === 'unused'">
          <div v-if="unusedElements.length === 0" class="status-card success">
            <div class="tech-success-icon">✓</div>
            <h3>未发现硬编码属性</h3>
            <p>太棒了！当前页面所有检测到的属性均已使用 CSS 变量。</p>
          </div>
          <div v-else-if="Object.keys(filteredUnusedElements).length === 0" class="status-card empty">
            <div class="tech-empty-icon">∅</div>
            <h3>无匹配结果</h3>
            <p>当前分类下未发现硬编码属性。</p>
          </div>
          <div v-else class="results">
            <div v-for="(elements, frameId) in filteredUnusedElements" :key="frameId">
              <div v-if="activeFrameId === frameId" class="frame-group">
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
                      <div class="element-actions">
                        <button class="view-btn" @click="viewAncestors(el.id, $event)" :class="{ active: viewingAncestorsId === el.id }">
                          结构
                        </button>
                        <button class="screenshot-btn" @click.stop="handleScreenshotClick(el.id)">
                          截图
                        </button>
                      </div>
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
      </div>
    </main>
    
    <Transition name="fade">
      <div v-if="needsRescan" class="rescan-overlay">
        <div class="rescan-card">
          <div class="rescan-icon">🔄</div>
          <h3>检测到页面更新</h3>
          <p>页面内容或路由已发生变化，建议重新扫描以获取准确结果。</p>
          <button @click="scanTokens" class="main-scan-btn">立即重新扫描</button>
          <button @click="needsRescan = false" class="secondary-btn">稍后处理</button>
        </div>
      </div>
    </Transition>

    <Transition name="fade">
      <div v-if="showToast" class="toast-overlay">
        <div class="toast-content">
          <span class="toast-icon">⚠️</span>
          {{ toastMessage }}
        </div>
      </div>
    </Transition>

    <Transition name="fade">
      <div v-if="showScreenshotModal" class="screenshot-modal" @click="showScreenshotModal = false">
        <div class="modal-content" @click.stop>
          <div class="modal-header">
            <h3>异常元素截图</h3>
            <button class="close-btn" @click="showScreenshotModal = false">×</button>
          </div>
          <div class="modal-body">
            <img :src="screenshotUrl!" alt="Screenshot" />
          </div>
          <div class="modal-footer">
            <button class="secondary-btn" @click="showScreenshotModal = false">关闭</button>
            <button class="main-scan-btn" @click="downloadScreenshot">下载截图</button>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="fade">
      <div v-if="scanning || exporting" class="scanning-overlay">
        <div class="hud-loader">
          <div class="hud-circle"></div>
          <div class="hud-scanner"></div>
          <div class="hud-text">
            <span class="glitch" :data-text="exporting ? '正在生成报告' : '正在扫描 DOM'">
              {{ exporting ? '正在生成报告' : '正在扫描 DOM' }}
            </span>
            <div class="hud-progress">
              <div class="hud-bar" :style="{ width: exporting ? (exportProgress / exportTotal * 100) + '%' : '30%' }"></div>
            </div>
            <span class="hud-sub">
              {{ exporting ? `正在处理第 ${exportProgress}/${exportTotal} 个元素...` : '正在分析 CSS 架构...' }}
            </span>
          </div>
          <div class="hud-corners">
            <span></span><span></span><span></span><span></span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped lang="less">
@primary-color: #4a90e2;
@primary-hover: #357abd;
@error-color: #dc3545;
@error-bg: #f8d7da;
@success-color: #28a745;
@text-main: #333;
@text-secondary: #666;
@text-muted: #adb5bd;
@bg-light: #f8f9fa;
@border-color: #eee;

.container {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: @bg-light;
  color: @text-main;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  overflow: hidden;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid @border-color;

  .logo-area {
    display: flex;
    align-items: center;
    gap: 10px;

    .tech-logo {
      width: 20px;
      height: 20px;
      border: 2px solid @primary-color;
      position: relative;

      .logo-inner {
        position: absolute;
        top: 3px;
        left: 3px;
        right: 3px;
        bottom: 3px;
        background: @primary-color;
      }
    }

    h1 {
      font-size: 13px;
      margin: 0;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: @primary-color;
    }
  }

  .header-actions {
    display: flex;
    gap: 8px;

    .export-btn {
      background: #fff;
      border: 1px solid @primary-color;
      color: @primary-color;
      padding: 5px 12px;
      font-size: 11px;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;

      &:hover:not(:disabled) {
        background: #f0f7ff;
      }

      &:disabled {
        border-color: #ccc;
        color: #ccc;
        cursor: not-allowed;
      }
    }

    .scan-btn {
      background: @primary-color;
      border: none;
      color: #fff;
      padding: 5px 12px;
      font-size: 11px;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: background 0.2s;

      &:hover:not(:disabled) {
        background: @primary-hover;
      }

      .scan-icon {
        width: 8px;
        height: 8px;
        border: 1.5px solid #fff;
        border-radius: 50%;
        border-top-color: transparent;
      }

      &.is-scanning .scan-icon {
        animation: rotate 0.8s linear infinite;
      }
    }
  }
}

.tabs {
  display: flex;
  padding: 12px 16px 0;
  background: #fff;

  .tab-item {
    flex: 1;
    padding: 8px;
    color: @text-secondary;
    border-bottom: 2px solid transparent;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 500;

    &.active {
      color: @error-color;
      border-bottom-color: @error-color;
    }

    .tab-count {
      background: @error-bg;
      color: @error-color;
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 10px;
    }
  }
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid @border-color;

  .filter-item {
    flex: 1;
    min-width: calc(33.33% - 8px);
    text-align: center;
    white-space: nowrap;
    padding: 6px 8px;
    background: #f1f3f5;
    border-radius: 16px;
    font-size: 11px;
    color: @text-secondary;
    cursor: pointer;
    transition: all 0.2s;

    &.active {
      background: @primary-color;
      color: #fff;
    }
  }
}

main {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  position: relative;
}

.welcome-screen {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;

  .welcome-icon {
    font-size: 48px;
    margin-bottom: 16px;
  }

  .welcome-content {
    h2 {
      font-size: 18px;
      margin-bottom: 8px;
      color: @text-main;
    }

    p {
      font-size: 13px;
      color: @text-secondary;
      margin-bottom: 24px;
    }
  }
}

.main-scan-btn {
  background: @primary-color;
  color: #fff;
  border: none;
  padding: 12px 32px;
  font-size: 14px;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(74, 144, 226, 0.3);
  transition: transform 0.2s, background 0.2s;

  &:hover {
    background: @primary-hover;
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }
}

.secondary-btn {
  background: transparent;
  border: 1px solid #dee2e6;
  color: #6c757d;
  padding: 8px 24px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  margin-top: 12px;
  width: 100%;
  transition: all 0.2s;

  &:hover {
    background: @bg-light;
    border-color: #ced4da;
  }
}

.rescan-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1500;
  padding: 24px;

  .rescan-card {
    background: #fff;
    padding: 32px 24px;
    border-radius: 16px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.1);
    text-align: center;
    border: 1px solid @border-color;
    max-width: 280px;

    .rescan-icon {
      font-size: 40px;
      margin-bottom: 16px;
      animation: rotate 4s linear infinite;
    }

    h3 {
      font-size: 16px;
      margin-bottom: 8px;
      color: @text-main;
    }

    p {
      font-size: 12px;
      color: @text-secondary;
      margin-bottom: 24px;
      line-height: 1.6;
    }

    .main-scan-btn {
      width: 100%;
      padding: 10px;
    }
  }
}

.element-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.element-item {
  background: #fff;
  border: 1px solid @border-color;
  border-radius: 8px;
  padding: 12px;
  transition: box-shadow 0.2s;
  cursor: pointer;

  &:hover {
    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
  }

  &.is-unused {
    border-left: 4px solid @error-color;
  }

  .element-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;

    .tag-badge {
      background: #e9ecef;
      color: #495057;
      padding: 2px 6px;
      font-size: 10px;
      font-weight: 700;
      border-radius: 4px;
      flex-shrink: 0;
    }

    .class-name {
      color: #6c757d;
      font-size: 11px;
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }

    .element-actions {
      display: flex;
      gap: 6px;
      margin-left: auto;
      flex-shrink: 0;

      .view-btn,
      .screenshot-btn {
        background: @error-bg;
        border: none;
        color: @error-color;
        font-size: 10px;
        padding: 3px 8px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;

        &:hover {
          background: #f1b0b7;
        }

        &.active {
          background: @error-color;
          color: #fff;
        }
      }

      .screenshot-btn {
        background: #e2e3e5;
        color: #383d41;

        &:hover {
          background: #d6d8db;
        }
      }
    }
  }

  .ancestor-topology {
    background: @bg-light;
    border-radius: 6px;
    padding: 10px;
    margin-bottom: 12px;

    .topology-title {
      color: #6c757d;
      font-size: 10px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .topology-list {
      display: flex;
      flex-direction: column;
      gap: 2px;

      .topology-item {
        .topology-node {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          background: #fff;
          border: 1px solid @border-color;
          border-radius: 4px;

          .node-tag {
            color: @error-color;
            font-weight: 700;
            font-size: 10px;
          }

          .node-class {
            color: #6c757d;
            font-size: 10px;
          }
        }

        .topology-connector {
          padding-left: 15px;
          height: 8px;
          border-left: 1.5px dashed #dee2e6;
          margin-left: 10px;
        }
      }
    }
  }

  .prop-group {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid @bg-light;

    .group-header {
      font-size: 10px;
      font-weight: 600;
      color: #555;
      margin-bottom: 6px;
      text-transform: uppercase;
    }

    .hardcoded-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 6px;

      .hardcoded-badge {
        display: flex;
        align-items: center;
        gap: 8px;
        background: @bg-light;
        padding: 6px 10px;
        border-radius: 6px;

        .color-preview {
          width: 14px;
          height: 14px;
          border-radius: 3px;
          border: 1px solid rgba(0,0,0,0.1);
        }

        .type-icon {
          font-size: 12px;
        }

        .hardcoded-details {
          display: flex;
          justify-content: space-between;
          flex: 1;

          .prop-name {
            font-size: 11px;
            color: #495057;
          }

          .prop-value {
            font-size: 11px;
            color: @error-color;
            font-weight: 500;
          }
        }
      }
    }
  }
}

/* Scanning Overlay */
.scanning-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;

  .hud-loader {
    text-align: center;

    .hud-circle {
      width: 40px;
      height: 40px;
      border: 3px solid #e9ecef;
      border-top-color: @primary-color;
      border-radius: 50%;
      margin: 0 auto 16px;
      animation: rotate 1s linear infinite;
    }

    .hud-text {
      font-size: 13px;
      color: @primary-color;
      font-weight: 600;
    }
  }
}

@keyframes rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.status-card {
  padding: 48px 24px;
  text-align: center;
  background: #fff;
  border-radius: 12px;
  border: 1px solid @border-color;

  &.success .tech-success-icon { color: @success-color; font-size: 40px; margin-bottom: 16px; }
  &.empty .tech-empty-icon { color: @text-muted; font-size: 40px; margin-bottom: 16px; }
  &.error .tech-error-icon { color: @error-color; font-size: 40px; margin-bottom: 16px; }

  .retry-btn {
    background: @error-color;
    color: #fff;
    border: none;
    padding: 8px 24px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    margin-top: 16px;
    cursor: pointer;
  }
}

.frame-group {
  margin-bottom: 20px;

  .frame-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    margin-bottom: 8px;
    border-bottom: 1px solid @border-color;

    .frame-icon { color: @text-muted; font-size: 12px; }
    .frame-title { color: #495057; font-weight: 600; font-size: 11px; flex: 1; }
    .frame-count { color: @text-muted; font-size: 11px; }
  }
}

/* Frame Tabs Styles */
.frame-tabs {
  z-index: 10;
  background: #fff;
  padding: 8px 16px 12px;
  display: flex;
  overflow-x: auto;
  gap: 8px;
  border-bottom: 1px solid @border-color;
  scrollbar-width: none; /* Firefox */

  &::-webkit-scrollbar {
    display: none; /* Chrome, Safari, Opera */
  }

  .frame-tab-item {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: #f1f3f5;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    border: 1px solid transparent;

    &.active {
      background: #fff;
      border-color: @primary-color;
      color: @primary-color;
      box-shadow: 0 2px 4px rgba(74, 144, 226, 0.1);

      .frame-tab-count {
        background: rgba(74, 144, 226, 0.1);
        color: @primary-color;
      }
    }

    .frame-tab-title {
      font-size: 11px;
      font-weight: 600;
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .frame-tab-count {
      font-size: 10px;
      background: rgba(0, 0, 0, 0.05);
      padding: 1px 5px;
      border-radius: 10px;
      color: @text-secondary;
    }
  }
}

.toast-overlay {
  position: absolute;
  bottom: 24px;
  left: 16px;
  right: 16px;
  z-index: 2000;

  .toast-content {
    background: #343a40;
    color: #fff;
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  }
}

/* Modal Styles */
.screenshot-modal {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 20px;

  .modal-content {
    background: #fff;
    border-radius: 12px;
    width: 100%;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 50px rgba(0,0,0,0.3);

    .modal-header {
      padding: 12px 16px;
      border-bottom: 1px solid @border-color;
      display: flex;
      justify-content: space-between;
      align-items: center;

      h3 {
        margin: 0;
        font-size: 14px;
        color: @text-main;
      }

      .close-btn {
        background: none;
        border: none;
        font-size: 20px;
        color: #999;
        cursor: pointer;
      }
    }

    .modal-body {
      flex: 1;
      overflow: auto;
      padding: 12px;
      background: @bg-light;
      display: flex;
      align-items: flex-start;
      justify-content: center;

      img {
        max-width: 100%;
        border: 1px solid #ddd;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      }
    }

    .modal-footer {
      padding: 12px 16px;
      border-top: 1px solid @border-color;
      display: flex;
      gap: 12px;

      .secondary-btn, .main-scan-btn {
        margin: 0;
        flex: 1;
        padding: 8px;
        font-size: 12px;
      }
    }
  }
}
</style>
