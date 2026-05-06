# API Sniffer — 浏览器接口监听工具

拦截浏览器所有 Fetch / XHR 请求，实时记录接口 URL、参数、请求头、响应体，支持过滤、导出和重放分析。

---

## 目录

- [方式一：Chrome 扩展](#方式一chrome-扩展推荐)
- [方式二：控制台脚本](#方式二控制台脚本免安装)
- [功能列表](#功能列表)
- [导出格式](#导出格式)
- [文件说明](#文件说明)
- [架构](#架构)

---

## 方式一：Chrome 扩展（推荐）

### 安装

1. 打开 Chrome，地址栏输入 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `api-sniffer` 文件夹
5. 工具栏出现扩展图标即安装完成

> 需要准备一张 `icon.png`（128×128）放在目录下，否则 Chrome 会报图标缺失警告。

### 使用

| 操作 | 说明 |
|------|------|
| 打开弹窗 | 点击工具栏扩展图标 |
| 查看请求 | 列表实时显示所有捕获的请求 |
| 展开详情 | 点击某条记录，展示 URL / 请求头 / 请求体 / 响应头 / 响应体 |
| 复制数据 | 每个字段旁有「复制」按钮，一键写入剪贴板 |
| 删除记录 | 记录右侧 × 按钮删除单条；「清空」按钮删除全部 |
| 暂停采集 | 点击「暂停」停止记录新请求，再点恢复 |
| 域名过滤 | 「仅监控当前域名」开关，默认开启，关闭后捕获全部域名请求 |
| 方法过滤 | 点击 GET / POST / PUT / DELETE / PATCH 芯片筛选 |
| 状态过滤 | 点击 2xx / 3xx / 4xx / 5xx / 错误 芯片筛选 |
| URL 搜索 | 输入框输入关键字过滤 URL |
| 刷新列表 | 点击「刷新」按钮（列表会自动推送，一般不需手动刷新） |
| 导出数据 | 点击导出按钮，支持 4 种格式 |

### 导出

| 按钮 | 格式 | 内容 |
|------|------|------|
| 导出 JSON | `.json` | 完整请求/响应数据，适合二次分析 |
| 导出摘要 | `.json` | 按 URL + Method 去重统计，不含响应体，可读性最高 |
| 导出 HAR | `.har` | 标准 HTTP Archive，可导入 Charles / Fiddler / Chrome DevTools |
| 导出 CSV | `.csv` | 表格格式，Excel 直接打开，含响应大小和类型 |

> 导出的数据范围受当前筛选条件影响——筛选后导出即只导出筛选结果。

---

## 方式二：控制台脚本（免安装）

适合临时监听、不想装扩展的场景。

### 使用

1. 打开目标网页，按 `F12` → **Console**
2. 复制 `api-sniffer-console.js` 全部代码，粘贴到控制台，回车
3. 正常操作页面，所有请求自动打印在控制台并暂存
4. 执行以下命令操作数据：

```js
apiSniffer.help()          // 显示所有命令
apiSniffer.getRecords()    // 查看捕获记录数组
apiSniffer.exportJSON()    // 下载完整 JSON
apiSniffer.exportSummary() // 下载去重摘要
apiSniffer.exportCSV()     // 下载 CSV
apiSniffer.exportHAR()     // 下载 HAR
apiSniffer.domainOnly(false) // 关闭域名过滤
apiSniffer.clear()         // 清空记录
```

> 刷新页面数据即丢失，仅适用于临时分析。

---

## 功能列表

### 请求拦截
- 同时劫持 `fetch` 和 `XMLHttpRequest`
- 记录请求方法、URL、请求头、请求体、响应头、响应体、状态码、耗时
- 支持 FormData / URLSearchParams / JSON / 文本等多种 body 类型
- 自动解析 JSON 响应为对象
- 网络错误同样记录

### 域名过滤
- 默认仅捕获当前页面域名的请求（含子域名和父域名）
- 第三方 CDN、统计、广告等请求自动排除
- 弹窗开关可随时关闭，恢复全量捕获

### 筛选与搜索
- HTTP 方法过滤：全部 / GET / POST / PUT / DELETE / PATCH
- 状态码过滤：全部 / 2xx / 3xx / 4xx / 5xx / 错误
- URL 关键字搜索
- 多个筛选条件可组合使用

### 数据导出
- **JSON**：完整数据，适合程序分析
- **摘要**：按 URL+Method 去重，显示调用次数、状态码分布、平均耗时、最大/最小耗时，一眼看清接口全景
- **HAR**：标准格式，可导入 Charles / Fiddler
- **CSV**：可直接用 Excel 打开，包含响应大小和类型（不含原始 body）

### 交互
- 列表实时自动刷新，无需手动操作
- 每个字段旁有复制按钮，一键复制到剪贴板
- 单条记录可删除（× 按钮）
- 暂停/恢复采集，不丢失已缓存数据

### 安全
- postMessage 通信限定 `location.origin`，防止数据泄漏到第三方脚本
- 收发双向 origin 校验

### 性能
- 响应体超过 10KB 自动截断，防止 storage 溢出和导出文件过大
- 本地最多保留 5000 条记录，超出自动淘汰最早记录

---

## 导出格式

| 格式 | 后缀 | 内容 | 适用场景 |
|------|------|------|----------|
| JSON | `.json` | 完整请求/响应数据 | 二次开发、数据分析 |
| 摘要 | `.json` | 按 URL 去重的统计信息 | 快速了解接口全景 |
| HAR | `.har` | HTTP Archive 标准格式 | 导入 Charles / Fiddler |
| CSV | `.csv` | 表格（含响应大小/类型） | Excel 查看、报表 |

---

## 文件说明

| 文件 | 作用 |
|------|------|
| `manifest.json` | Chrome 扩展配置（Manifest V3） |
| `injected.js` | 注入页面上下文，劫持 fetch / XHR |
| `content.js` | 内容脚本，桥接 injected 与扩展通信，同步设置 |
| `background.js` | Service Worker，存储记录、处理导出、广播设置 |
| `popup.html` | 弹窗 UI |
| `popup.js` | 弹窗逻辑：渲染列表、筛选、导出、复制、暂停、删除 |
| `api-sniffer-console.js` | 独立控制台脚本，免安装即贴即用 |
| `icon.png` | 扩展图标（128×128，需自备） |

---

## 架构

```
页面上下文 (injected.js)
    │ 劫持 fetch / XHR，过滤域名
    │ postMessage (origin 限定)
    ▼
内容脚本 (content.js)
    │ chrome.runtime.sendMessage
    ▼
Service Worker (background.js)
    │ chrome.storage.local 存储
    │ chrome.downloads 导出
    │ 广播设置到所有 tab
    ▼
弹窗 (popup.js)
    │ 展示列表、筛选、导出、暂停/恢复
    │ 实时接收 background 推送自动刷新
    ▼
用户
```
