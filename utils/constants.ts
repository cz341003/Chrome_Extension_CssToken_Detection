export const PROPERTY_GROUPS: Record<string, string[]> = {
  font: ['font-size', 'font-weight', 'font-family', 'letter-spacing', 'color', 'text-align'],
  spacing: ['margin', 'padding', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'gap'],
  border: ['border', 'border-width', 'border-style', 'border-color', 'border-radius', 'outline'],
  shadow: ['box-shadow', 'text-shadow'],
  layout: ['width', 'height', 'line-height', 'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index'],
  background: ['background', 'background-color', 'background-image']
};

export const TARGET_PROPERTIES = [
  'color', 'background-color', 'border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'text-decoration-color',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border', 'border-width', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-style', 'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style', 'border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
  'box-shadow', 'text-shadow',
  'line-height',
  'font-size', 'font-weight'
];

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
