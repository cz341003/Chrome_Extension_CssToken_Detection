export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    console.log('CSS Token Detector Content Script Loaded');

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
                const tagName = el.tagName.toLowerCase();
                if (excludedTags.has(tagName)) continue;

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
                    if (excludedTags.has(el.tagName.toLowerCase())) continue;
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
          const el = doc.querySelector(`[data-css-token-id="${id}"], #${id}`);
          if (el instanceof HTMLElement) {
            const style = win.getComputedStyle(el);
            const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) !== 0;
            
            if (isVisible) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              const oldOutline = el.style.outline;
              const oldBoxShadow = el.style.boxShadow;
              
              const highlightColor = message.isUnused ? '#ff5555' : '#ffff00';
              el.style.outline = `4px solid ${highlightColor}`;
              el.style.outlineOffset = '2px';
              el.style.boxShadow = `0 0 20px ${highlightColor}, 0 0 40px ${highlightColor}`;
              el.style.zIndex = '2147483647';
              
              setTimeout(() => {
                el.style.outline = oldOutline;
                el.style.boxShadow = oldBoxShadow;
              }, 2000);
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
          const el = doc.querySelector(`[data-css-token-id="${id}"], #${id}`);
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
