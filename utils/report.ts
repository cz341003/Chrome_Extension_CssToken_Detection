import { DetectedElement } from './types';

export const generateHTMLReport = (data: any[]) => {
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
