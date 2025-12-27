# CSS Token Detector 开发提示词

## 角色设定
你是一名资深前端开发工程师，擅长 Chrome Extension (Manifest V3) 开发和 DOM 性能优化。

## 任务目标
对已有的项目进行优化，包括解决项目问题、实现新需求、优化性能。

## 优化需求
已实现的项目需求文档在当前项目根目录下CSS_Token_Detector_Prompt.md文件中；该项目开发了一个开发一个名为 "CSS Token Detector" 的浏览器插件，能够扫描当前页面，找出所有使用了 CSS 变量的DOM元素；现在有针对此项目有以下优化需求：
1. **CSS属性分组**: 对项目中扫描出的DOM元素列表的CSS属性进行分组，如字体相关的font-size、font-weight、color等为一组；间距相关的margin、padding等为一组；边框相关的如border、border-radius等为一组；阴影相关的如box-shadow等为一组；
2、**子iframe扫描逻辑优化**：存在如下场景：主框架页面存在多个iframe，只有部分iframe是显示的，其他的iframe都设置了display属性为none，此时不需要遍历所有的iframe下的DOM节点，只扫描显示状态下的iframe，保证性能；
3、**子iframe扫描问题修复**：在scanFrame方法中，遍历子iframe的样式表时，这个判断rule instanceof CSSStyleRule值为false，而实际上子iframe的rule确实在CSSStyleRule的原型链上，导致列表中无iframe中的DOM元素；
4、**样式优化**：初次加载时的loading状态，优化下使得更有科技感；

## 输出要求
请基于当前项目对代码进行优化，不能影响原有功能。


