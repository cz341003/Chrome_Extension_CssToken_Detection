# CSS Token Detector 开发提示词

## 角色设定
你是一名资深前端开发工程师，擅长 Chrome Extension (Manifest V3) 开发和 DOM 性能优化。

## 任务目标
开发一个名为 "CSS Token Detector" 的浏览器插件。

## 核心功能需求
1. **识别 CSS Tokens**: 扫描当前页面，找出所有使用了 CSS 变量（Custom Properties，如 `var(--primary-color)`）的 DOM 元素。
2. **数据提取**: 提取这些元素使用的具体变量名称及其当前的计算值（Computed Value）。
3. **UI 展示**: 在插件弹窗（Popup）或侧边栏（Side Panel）中罗列这些元素。列表项应包含：标签名、类名、使用的变量名。
4. **交互定位**: 点击列表中的元素项时，页面应自动滚动到该元素位置，并对其进行高亮显示（例如添加一个暂时的红色边框或闪烁效果）。

## 技术要求
- **Manifest Version**: V3。
- **Permissions**: `activeTab`, `scripting`。
- **Performance**: 考虑到页面可能非常庞大，扫描逻辑需要高效，避免阻塞主线程。建议优先扫描 `computedStyle` 中包含 `var(--` 的元素。
- **Tech Stack**: 技术栈要求使用Vue3、typescript、vite来实现，可以使用现有的开发框架如Plasmo、WXT，具体你来决定。

## 实现逻辑建议
- **扫描策略**: 遍历 `document.querySelectorAll('*')`，利用 `window.getComputedStyle(el)` 获取样式。注意：由于 `getComputedStyle` 返回的是解析后的值，你可能需要结合 `el.getAttribute('style')` 或遍历 `document.styleSheets` 来精准匹配 `var()` 的使用。
- **高亮效果**: 使用 `scrollIntoView({ behavior: 'smooth', block: 'center' })`。
- **页面UI**: 能够调用Chrome的能力将UI固定展示在浏览器右侧

## 输出要求
请提供完整的项目文件结构和每个文件的详细代码实现。

## 优化需求1

- 1、用户更加关注未使用css变量的元素，因此已使用css变量的元素不需要再进行展示；
- 2、只针对特定的css属性进行检测，这些css属性存在在cssProperties.txt中，其他的css属性就无需检测

## 优化需求
已完成了上述 优化需求1
- 1、content.js中仍然计算了已使用css变量的元素，这里是否会消耗性能？优化下
- 2、页面中存在多个iframe，扫描结果会显示所有iframe的元素，这会导致用户分不清哪个元素属于哪个iframe，所以sidepanel的元素列表需要按照iframe进行分组，通过iframe上的id属性分组展示


