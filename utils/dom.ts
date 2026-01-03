export const getElementFingerprint = (el: Element, frameId: string) => {
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

export const getSelector = (element: Element) => {
  const path = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector += `#${current.id}`;
      path.unshift(selector);
      break;
    } else {
      let className = '';
      if (typeof current.className === 'string') className = current.className;
      else if (typeof current.className === 'object' && current.className !== null) className = (current.className as any).baseVal || '';
      
      if (className) {
        selector += `.${className.trim().split(/\s+/)[0]}`;
      }
      let sibling = current;
      let nth = 1;
      while (sibling.previousElementSibling) {
        sibling = sibling.previousElementSibling;
        if (sibling.tagName === current.tagName) nth++;
      }
      if (nth > 1) selector += `:nth-of-type(${nth})`;
    }
    path.unshift(selector);
    current = current.parentElement;
  }
  return path.join(' > ');
};
