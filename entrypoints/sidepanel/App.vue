<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { 
  PROPERTY_GROUPS, 
  getGroup, 
  getGroupLabel, 
  getTokenType, 
  getTokenIcon,
  getPropertyChineseName
} from '../../utils/constants';
import { Token, Hardcoded, DetectedElement } from '../../utils/types';
import { generateHTMLReport } from '../../utils/report';

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
  if (message.type === 'TAB_UPDATED' || message.type === 'TAB_ACTIVATED' || message.type === 'DOM_CHANGED') {
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
  const capRes = await browser.runtime.sendMessage({ 
    type: 'CAPTURE_TAB',
    windowId: tab.windowId
  });
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

const cancelExport = () => {
  exporting.value = false;
  toastMessage.value = '导出已取消';
  showToast.value = true;
  setTimeout(() => showToast.value = false, 3000);
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
      // 检查是否已被取消
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
      // 增加停顿时间以解决 MAX_CAPTURE_VISIBLE_TAB_CALLS_PRE_SECOND 限制
      // 默认 1秒内限制次数，这里增加到 1000ms 确保安全
      await new Promise(r => setTimeout(r, 1000));
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
                              <span class="prop-name">
                                {{ item.property }} <span class="prop-zh">{{ getPropertyChineseName(item.property) }}</span>
                              </span>
                              <span class="prop-value">{{ item.value }}</span>
                              <div v-if="['font-size', 'font-weight', 'font-family', 'color', 'border', 'border-color'].some(p => item.property.includes(p))" class="prop-suggestion">
                                💡 建议使用变量
                              </div>
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
            <button v-if="exporting" @click="cancelExport" class="cancel-export-btn">取消导出</button>
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
@import "./App.less";
</style>
