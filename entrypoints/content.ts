export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    console.log('CSS Token Detector Content Script Loaded');

    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'SCAN_TOKENS') {
        // 修改数据结构：Element -> Property -> { varName, value, inherited }
        const usedMap = new Map<Element, Map<string, { varName: string; value: string; inherited: boolean }>>();
        const unusedMap = new Map<Element, { property: string; value: string }[]>();
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

        const INHERITABLE_PROPS = new Set([
          'color', 'font-size', 'font-weight', 'line-height'
        ]);

        const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));

        const scanFrame = async (win: Window) => {
          let doc: Document;
          try { doc = win.document; } catch (e) { return; }

          const selectorsWithVars = new Map<string, Map<string, Set<string>>>();
          const selectorsWithHardcoded = new Map<string, { property: string; value: string }[]>();

          try {
            const sheets = Array.from(doc.styleSheets);
            for (const sheet of sheets) {
              try {
                const rules = Array.from(sheet.cssRules || (sheet as any).rules || []);
                for (const rule of rules) {
                  if (rule.type === 1 || rule instanceof (win as any).CSSStyleRule) {
                    const styleRule = rule as CSSStyleRule;
                    const cssText = styleRule.cssText;
                    if (cssText.includes('var(--')) {
                      const style = styleRule.style;
                      for (let i = 0; i < style.length; i++) {
                        const prop = style[i];
                        const val = style.getPropertyValue(prop);
                        if (val.includes('var(--')) {
                          const matches = val.match(/var\((--[^)]+)\)/g);
                          if (matches) {
                            if (!selectorsWithVars.has(styleRule.selectorText)) {
                              selectorsWithVars.set(styleRule.selectorText, new Map());
                            }
                            const propMap = selectorsWithVars.get(styleRule.selectorText)!;
                            if (!propMap.has(prop)) propMap.set(prop, new Set());
                            matches.forEach((m: string) => propMap.get(prop)!.add(m.slice(4, -1)));
                          }
                        }
                      }
                    }

                    TARGET_PROPERTIES.forEach(prop => {
                      const val = styleRule.style.getPropertyValue(prop);
                      if (val && !val.includes('var(') && !['inherit', 'initial', 'transparent', 'unset', 'none', '0', '0px'].includes(val.trim())) {
                        if (!selectorsWithHardcoded.has(styleRule.selectorText)) {
                          selectorsWithHardcoded.set(styleRule.selectorText, []);
                        }
                        selectorsWithHardcoded.get(styleRule.selectorText)?.push({ property: prop, value: val });
                      }
                    });
                  }
                }
              } catch (e) {}
              await yieldToMain();
            }
          } catch (e) {}

          const selectorEntries = Array.from(selectorsWithVars.entries());
          for (const [selector, propMap] of selectorEntries) {
            try {
              const elements = doc.querySelectorAll(selector);
              for (const el of Array.from(elements)) {
                if (usedMap.size > 2000) break;
                if (excludedTags.has(el.tagName.toLowerCase())) continue;

                if (!usedMap.has(el)) usedMap.set(el, new Map());
                const elProps = usedMap.get(el)!;
                const style = win.getComputedStyle(el);

                propMap.forEach((varNames, prop) => {
                  varNames.forEach(name => {
                    const val = style.getPropertyValue(name).trim();
                    if (val) elProps.set(prop, { varName: name, value: val, inherited: false });
                  });

                  if (INHERITABLE_PROPS.has(prop)) {
                    const children = el.querySelectorAll('*');
                    children.forEach(child => {
                      if (excludedTags.has(child.tagName.toLowerCase())) return;
                      if (!usedMap.has(child)) usedMap.set(child, new Map());
                      const childProps = usedMap.get(child)!;
                      varNames.forEach(name => {
                        if (!childProps.has(prop)) {
                          const childStyle = win.getComputedStyle(child);
                          const childVal = childStyle.getPropertyValue(name).trim();
                          if (childVal) childProps.set(prop, { varName: name, value: childVal, inherited: true });
                        }
                      });
                    });
                  }
                });
              }
            } catch (e) {}
            await yieldToMain();
          }

          const inlineElements = doc.querySelectorAll('[style*="var(--"]');
          inlineElements.forEach(el => {
            if (excludedTags.has(el.tagName.toLowerCase())) return;
            const styleAttr = el.getAttribute('style') || '';
            // 简单的内联解析
            const parts = styleAttr.split(';');
            parts.forEach(part => {
              const [prop, val] = part.split(':').map(s => s.trim());
              if (prop && val && val.includes('var(--')) {
                const match = val.match(/var\((--[^)]+)\)/);
                if (match) {
                  if (!usedMap.has(el)) usedMap.set(el, new Map());
                  const elProps = usedMap.get(el)!;
                  const name = match[1];
                  const computedStyle = win.getComputedStyle(el);
                  const computedVal = computedStyle.getPropertyValue(name).trim();
                  if (computedVal) elProps.set(prop, { varName: name, value: computedVal, inherited: false });
                }
              }
            });
          });

          const hardcodedEntries = Array.from(selectorsWithHardcoded.entries());
          for (const [selector, props] of hardcodedEntries) {
            try {
              const elements = doc.querySelectorAll(selector);
              elements.forEach(el => {
                if (unusedMap.size > 2000) return;
                if (excludedTags.has(el.tagName.toLowerCase())) return;
                if (!unusedMap.has(el)) unusedMap.set(el, []);
                unusedMap.get(el)?.push(...props);
              });
            } catch (e) {}
            await yieldToMain();
          }

          const iframes = doc.querySelectorAll('iframe');
          for (const iframe of Array.from(iframes)) {
            try {
              const style = win.getComputedStyle(iframe);
              if (style.display !== 'none' && iframe.contentWindow) {
                await scanFrame(iframe.contentWindow);
              }
            } catch (e) {}
          }
        };

        (async () => {
          await scanFrame(window);

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

          const usedResults = Array.from(usedMap.entries()).map(([el, propMap]) => ({
            ...formatElement(el, elementIndex++),
            type: 'used',
            tokens: Array.from(propMap.entries()).map(([prop, info]) => ({ 
              property: prop,
              name: info.varName, 
              value: info.value, 
              inherited: info.inherited 
            }))
          }));

          const unusedResults = Array.from(unusedMap.entries())
            .filter(([el]) => !usedMap.has(el))
            .map(([el, props]) => ({
              ...formatElement(el, elementIndex++),
              type: 'unused',
              hardcoded: props.filter((v, i, a) => a.findIndex(t => t.property === v.property) === i)
            }));

          sendResponse({ used: usedResults, unused: unusedResults });
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
