export const PROPERTY_GROUPS: Record<string, string[]> = {
  font: ['font-size', 'font-weight', 'font-family', 'letter-spacing', 'color', 'text-align'],
  spacing: ['margin', 'padding', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'gap'],
  border: ['border', 'border-width', 'border-style', 'border-color', 'border-radius', 'outline'],
  shadow: ['box-shadow', 'text-shadow'],
  layout: ['width', 'height', 'line-height', 'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index'],
  background: ['background', 'background-color', 'background-image']
};

export const TARGET_PROPERTIES = [
  'color', 'background-color', 'background-image', 'border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'text-decoration-color',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'gap',
  'border', 'border-width', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-style', 'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style', 'border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
  'box-shadow', 'text-shadow',
  'line-height', 'width', 'height', 'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
  'font-size', 'font-weight', 'font-family', 'letter-spacing', 'text-align'
];

export const PROPERTY_CHINESE_NAMES: Record<string, string> = {
  'color': '文字颜色',
  'background': '背景',
  'background-color': '背景颜色',
  'background-image': '背景图片',
  'border': '边框',
  'border-color': '边框颜色',
  'border-width': '边框宽度',
  'border-style': '边框样式',
  'border-radius': '边框圆角',
  'border-top-color': '上边框颜色',
  'border-right-color': '右边框颜色',
  'border-bottom-color': '下边框颜色',
  'border-left-color': '左边框颜色',
  'border-top-width': '上边框宽度',
  'border-right-width': '右边框宽度',
  'border-bottom-width': '下边框宽度',
  'border-left-width': '左边框宽度',
  'border-top-style': '上边框样式',
  'border-right-style': '右边框样式',
  'border-bottom-style': '下边框样式',
  'border-left-style': '左边框样式',
  'border-top-left-radius': '左上圆角',
  'border-top-right-radius': '右上圆角',
  'border-bottom-left-radius': '左下圆角',
  'border-bottom-right-radius': '右下圆角',
  'outline': '轮廓',
  'outline-color': '轮廓颜色',
  'text-decoration-color': '文本装饰颜色',
  'margin': '外边距',
  'margin-top': '上外边距',
  'margin-right': '右外边距',
  'margin-bottom': '下外边距',
  'margin-left': '左外边距',
  'padding': '内边距',
  'padding-top': '上内边距',
  'padding-right': '右内边距',
  'padding-bottom': '下内边距',
  'padding-left': '左内边距',
  'gap': '间距',
  'box-shadow': '盒子阴影',
  'text-shadow': '文本阴影',
  'line-height': '行高',
  'width': '宽度',
  'height': '高度',
  'display': '显示模式',
  'position': '定位',
  'top': '顶部距离',
  'right': '右侧距离',
  'bottom': '底部距离',
  'left': '左侧距离',
  'z-index': '层级',
  'font-size': '字体大小',
  'font-weight': '字体粗细',
  'font-family': '字体族',
  'letter-spacing': '字间距',
  'text-align': '文本对齐'
};

export const EXCLUDED_TAGS = new Set([
  'svg', 'path', 'g', 'rect', 'circle', 'line', 'polyline', 'polygon', 'ellipse', 'use', 'defs', 'symbol',
  'script', 'style', 'link', 'meta', 'head', 'html', 'body',
  'canvas', 'picture', 'em', 'strong', 'br'
]);

export const getGroup = (prop: string) => {
  for (const [group, props] of Object.entries(PROPERTY_GROUPS)) {
    if (props.includes(prop)) return group;
  }
  return 'other';
};

export const getGroupLabel = (group: string) => {
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

export const getPropertyChineseName = (prop: string) => {
  return PROPERTY_CHINESE_NAMES[prop] || prop;
};

export const getTokenType = (value: string) => {
  const val = value.trim().toLowerCase();
  if (val.startsWith('#') || val.startsWith('rgb') || val.startsWith('hsl') || ['transparent', 'currentcolor'].includes(val) || /^(red|green|blue|yellow|orange|purple|pink|brown|gray|black|white)$/.test(val)) return 'color';
  if (/^-?\d+(\.\d+)?(px|rem|em|vh|vw|%|pt|pc|in|cm|mm|ex|ch|vmin|vmax)$/.test(val)) return 'size';
  if (val.includes('font') || val.includes('serif') || val.includes('sans-serif') || val.includes('mono')) return 'font';
  return 'other';
};

export const getTokenIcon = (type: string) => {
  switch (type) {
    case 'size': return '📏';
    case 'font': return '🔤';
    default: return '🔧';
  }
};
