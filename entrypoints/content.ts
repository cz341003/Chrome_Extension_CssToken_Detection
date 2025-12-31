export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    console.log('CSS Token Detector Content Script Loaded');

    // 用于管理高亮状态，防止多次点击导致样式无法恢复
    const highlightState = new WeakMap<HTMLElement, {
      originalOutline: string;
      originalOutlineOffset: string;
      originalBoxShadow: string;
      originalZIndex: string;
      timer: any;
    }>();

    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'SCAN_TOKENS') {
        // 优化：只关注未使用变量的元素，并增加 frameId 标识
        const unusedMap = new Map<Element, { props: { property: string; value: string }[], frameId: string }>();
        const excludedTags = new Set([
          'svg', 'path', 'g', 'rect', 'circle', 'line', 'polyline', 'polygon', 'ellipse', 'use', 'defs', 'symbol',
          'script', 'style', 'link', 'meta', 'head', 'html', 'body',
          'canvas', 'picture', 'em', 'strong', 'br'
        ]);
        
        const TARGET_PROPERTIES = [
          'color', 'background-color', 'border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'text-decoration-color',
          'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
          'border', 'border-width', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-style', 'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style', 'border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
          'box-shadow', 'text-shadow',
          'line-height',
          'font-size', 'font-weight'
        ];
        const TARGET_PROPERTIES_SET = new Set(TARGET_PROPERTIES);

        let lastYieldTime = performance.now();
        const yieldToMain = async (force = false) => {
          const now = performance.now();
          if (force || now - lastYieldTime > 30) {
            await new Promise(resolve => setTimeout(resolve, 0));
            lastYieldTime = performance.now();
          }
        };

        const seenFingerprints = new Set<string>();
        const getElementFingerprint = (el: Element, frameId: string) => {
          const tagName = el.tagName.toLowerCase();
          let className = '';
          if (typeof el.className === 'string') className = el.className;
          else if (typeof el.className === 'object' && el.className !== null) className = (el.className as any).baseVal || '';
          const sortedClass = className.split(/\s+/).sort().join(' ');
          
          const parent = el.parentElement;
          let parentInfo = '';
          if (parent) {
            let pClass = '';
            if (typeof parent.className === 'string') pClass = parent.className;
            else if (typeof parent.className === 'object' && parent.className !== null) pClass = (parent.className as any).baseVal || '';
            parentInfo = `${parent.tagName.toLowerCase()}.${pClass.split(/\s+/).sort().join(' ')}`;
          }
          
          return `${frameId}:${tagName}.${sortedClass}<${parentInfo}`;
        };

        const scanFrame = async (win: Window, frameId: string) => {
          let doc: Document;
          try { doc = win.document; } catch (e) { return; }

          const selectorsWithHardcoded = new Map<string, { property: string; value: string }[]>();

          try {
            const sheets = doc.styleSheets;
            for (let i = 0; i < sheets.length; i++) {
              const sheet = sheets[i];
              try {
                const rules = sheet.cssRules || (sheet as any).rules;
                if (!rules) continue;
                for (let j = 0; j < rules.length; j++) {
                  const rule = rules[j];
                  if (rule.type === 1 || rule instanceof (win as any).CSSStyleRule) {
                    const styleRule = rule as CSSStyleRule;
                    const style = styleRule.style;
                    
                    // 优化：遍历规则已有的属性，而不是遍历所有目标属性
                    for (let k = 0; k < style.length; k++) {
                      const prop = style[k];
                      if (TARGET_PROPERTIES_SET.has(prop)) {
                        const val = style.getPropertyValue(prop);
                        if (val && !val.includes('var(') && !['inherit', 'initial', 'transparent', 'unset', 'none', '0', '0px'].includes(val.trim())) {
                          if (!selectorsWithHardcoded.has(styleRule.selectorText)) {
                            selectorsWithHardcoded.set(styleRule.selectorText, []);
                          }
                          selectorsWithHardcoded.get(styleRule.selectorText)?.push({ property: prop, value: val });
                        }
                      }
                    }
                  }
                  if (j % 100 === 0) await yieldToMain();
                }
              } catch (e) {}
              await yieldToMain();
            }
          } catch (e) {}

          const hardcodedEntries = Array.from(selectorsWithHardcoded.entries());
          // 优化：批量处理选择器，减少 querySelectorAll 的全文档扫描次数
          const BATCH_SIZE = 50;
          for (let i = 0; i < hardcodedEntries.length; i += BATCH_SIZE) {
            if (unusedMap.size > 2000) break;
            
            const batch = hardcodedEntries.slice(i, i + BATCH_SIZE);
            const combinedSelector = batch.map(([s]) => s).join(',');
            
            try {
              const elements = doc.querySelectorAll(combinedSelector);
              for (let j = 0; j < elements.length; j++) {
                if (unusedMap.size > 2000) break;
                const el = elements[j];

                // 优化：指纹去重，跳过循环生成的重复元素
                const fingerprint = getElementFingerprint(el, frameId);
                if (seenFingerprints.has(fingerprint)) continue;

                const tagName = el.tagName.toLowerCase();
                if (excludedTags.has(tagName)) continue;

                // 标记为已处理
                seenFingerprints.add(fingerprint);

                // 找出该元素匹配 batch 中的哪些具体选择器
                for (let k = 0; k < batch.length; k++) {
                  const [selector, props] = batch[k];
                  try {
                    if (el.matches(selector)) {
                      if (!unusedMap.has(el)) unusedMap.set(el, { props: [], frameId });
                      unusedMap.get(el)?.props.push(...props);
                    }
                  } catch (e) {}
                }
                if (j % 100 === 0) await yieldToMain();
              }
            } catch (e) {
              // 如果合并选择器失败（如语法错误），退回到逐个处理
              for (let j = 0; j < batch.length; j++) {
                const [selector, props] = batch[j];
                try {
                  const elements = doc.querySelectorAll(selector);
                  for (let k = 0; k < elements.length; k++) {
                    if (unusedMap.size > 2000) break;
                    const el = elements[k];

                    const fingerprint = getElementFingerprint(el, frameId);
                    if (seenFingerprints.has(fingerprint)) continue;

                    if (excludedTags.has(el.tagName.toLowerCase())) continue;
                    
                    seenFingerprints.add(fingerprint);
                    if (!unusedMap.has(el)) unusedMap.set(el, { props: [], frameId });
                    unusedMap.get(el)?.props.push(...props);
                    if (k % 100 === 0) await yieldToMain();
                  }
                } catch (e) {}
              }
            }
            await yieldToMain();
          }

          const iframes = doc.querySelectorAll('iframe');
          for (const iframe of Array.from(iframes)) {
            try {
              const style = win.getComputedStyle(iframe);
              if (style.display !== 'none' && iframe.contentWindow) {
                const iframeId = iframe.id || iframe.name || `Iframe-${Math.random().toString(36).substr(2, 5)}`;
                await scanFrame(iframe.contentWindow, iframeId);
              }
            } catch (e) {}
          }
        };

        (async () => {
          await scanFrame(window, 'Main Page');

          let elementIndex = 0;
          const formatElement = (el: Element, index: number) => {
            const id = el.getAttribute('data-css-token-id') || el.id || `token-${index}`;
            if (!el.id && !el.hasAttribute('data-css-token-id')) {
              el.setAttribute('data-css-token-id', id);
            }
            let className = '';
            if (typeof el.className === 'string') className = el.className;
            else if (typeof el.className === 'object' && el.className !== null) className = (el.className as any).baseVal || '';
            
            const style = window.getComputedStyle(el);
            const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) !== 0;
            
            return { id, tagName: el.tagName.toLowerCase(), className, isVisible };
          };

          const unusedResults = Array.from(unusedMap.entries())
            .map(([el, data]) => ({
              ...formatElement(el, elementIndex++),
              type: 'unused',
              frameId: data.frameId,
              hardcoded: data.props.filter((v, i, a) => a.findIndex(t => t.property === v.property) === i)
            }));

          sendResponse({ used: [], unused: unusedResults });
        })();

        return true;
      }

      if (message.type === 'HIGHLIGHT_ELEMENT') {
        const findAndHighlight = (win: Window, id: string): { found: boolean; visible: boolean } => {
          let doc: Document;
          try { doc = win.document; } catch (e) { return { found: false, visible: false }; }
          
          // 修复：数字开头的 ID 在 querySelector 中会报错，优先使用 getElementById
          let el = doc.getElementById(id) || doc.querySelector(`[data-css-token-id="${id}"]`);
          
          if (el instanceof HTMLElement) {
            const style = win.getComputedStyle(el);
            const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) !== 0;
            
            if (isVisible) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              
              // 如果已经在高亮中，先清除之前的定时器，并使用最初保存的样式
              const existing = highlightState.get(el);
              if (existing) {
                clearTimeout(existing.timer);
              }

              const state = existing || {
                originalOutline: el.style.outline,
                originalOutlineOffset: el.style.outlineOffset,
                originalBoxShadow: el.style.boxShadow,
                originalZIndex: el.style.zIndex,
                timer: null
              };
              
              const highlightColor = message.isUnused ? '#ff5555' : '#ffff00';
              el.style.outline = `4px solid ${highlightColor}`;
              el.style.outlineOffset = '2px';
              el.style.boxShadow = `0 0 20px ${highlightColor}, 0 0 40px ${highlightColor}`;
              el.style.zIndex = '2147483647';
              
              state.timer = setTimeout(() => {
                const s = highlightState.get(el);
                if (s) {
                  el.style.outline = s.originalOutline;
                  el.style.outlineOffset = s.originalOutlineOffset;
                  el.style.boxShadow = s.originalBoxShadow;
                  el.style.zIndex = s.originalZIndex;
                  highlightState.delete(el);
                }
              }, 2000);

              highlightState.set(el, state);
            }
            return { found: true, visible: isVisible };
          }
          const iframes = doc.querySelectorAll('iframe');
          for (const iframe of Array.from(iframes)) {
            try {
              if (iframe.contentWindow) {
                const res = findAndHighlight(iframe.contentWindow, id);
                if (res.found) return res;
              }
            } catch (e) {}
          }
          return { found: false, visible: false };
        };
        const result = findAndHighlight(window, message.id);
        sendResponse(result);
        return true;
      }

      if (message.type === 'GET_ELEMENT_ANCESTORS') {
        const findAncestors = (win: Window, id: string): any[] | null => {
          let doc: Document;
          try { doc = win.document; } catch (e) { return null; }
          
          let el = doc.getElementById(id) || doc.querySelector(`[data-css-token-id="${id}"]`);
          
          if (el) {
            const ancestors = [];
            let current: Element | null = el;
            while (current) {
              let className = '';
              if (typeof current.className === 'string') className = current.className;
              else if (typeof current.className === 'object' && current.className !== null) className = (current.className as any).baseVal || '';

              ancestors.push({
                tagName: current.tagName.toLowerCase(),
                className: className
              });
              current = current.parentElement;
            }
            return ancestors;
          }
          const iframes = doc.querySelectorAll('iframe');
          for (const iframe of Array.from(iframes)) {
            try {
              if (iframe.contentWindow) {
                const res = findAncestors(iframe.contentWindow, id);
                if (res) return res;
              }
            } catch (e) {}
          }
          return null;
        };
        const ancestors = findAncestors(window, message.id);
        sendResponse({ ancestors });
        return true;
      }

      if (message.type === 'GET_ELEMENT_RECT') {
        const getRect = (win: Window, id: string): any | null => {
          let doc: Document;
          try { doc = win.document; } catch (e) { return null; }
          
          let el = doc.getElementById(id) || doc.querySelector(`[data-css-token-id="${id}"]`);
          
          if (el instanceof HTMLElement) {
            const style = win.getComputedStyle(el);
            const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) !== 0;
            
            if (!isVisible) return null;

            el.scrollIntoView({ behavior: 'instant', block: 'center' });
            const rect = el.getBoundingClientRect();
            
            // 检查滚动后是否在视口内
            if (rect.width === 0 || rect.height === 0 || 
                rect.bottom < 0 || rect.top > win.innerHeight || 
                rect.right < 0 || rect.left > win.innerWidth) {
              return null;
            }

            return {
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
              dpr: win.devicePixelRatio
            };
          }
          const iframes = doc.querySelectorAll('iframe');
          for (const iframe of Array.from(iframes)) {
            try {
              if (iframe.contentWindow) {
                const res = getRect(iframe.contentWindow, id);
                if (res) {
                  // 如果在 iframe 中，需要加上 iframe 自身的偏移
                  const iframeRect = iframe.getBoundingClientRect();
                  return {
                    x: res.x + iframeRect.left,
                    y: res.y + iframeRect.top,
                    width: res.width,
                    height: res.height,
                    dpr: win.devicePixelRatio
                  };
                }
              }
            } catch (e) {}
          }
          return null;
        };
        // 延迟一小会儿确保滚动完成
        setTimeout(() => {
          const rect = getRect(window, message.id);
          sendResponse({ rect });
        }, 100);
        return true;
      }
    });

    // 监听 iframe 状态变化
    let debounceTimer: any = null;
    const observer = new MutationObserver((mutations) => {
      const hasIframeChange = mutations.some(m => 
        (m.target instanceof HTMLElement && m.target.tagName === 'IFRAME') ||
        (m.target instanceof HTMLElement && m.target.querySelector('iframe'))
      );

      if (hasIframeChange) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          browser.runtime.sendMessage({ type: 'IFRAME_CHANGED' }).catch(() => {});
        }, 1000); // 1秒防抖，避免频繁重扫
      }
    });

    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['style', 'class']
    });
  },
});
