# Luminance Curve

Luminance Curve 是一个亮度曲线分析工具，同一套 React 代码同时支持 Web 静态页面和 Electron 桌面应用。它读取本地 `.xlsx` 工作簿，叠加显示多条原始亮度曲线，并提供后处理、图表导出、AI 分层 SVG 和干净 Excel 导出。

## 功能

- 导入一个或多个 `.xlsx` 工作簿，支持文件选择和拖拽。
- 每个文件作为独立曲线叠加显示，可单独隐藏、显示、移除。
- 原始模式支持两种视图：
  - 时间曲线：X = B 列总时间秒，Y = E 列亮度 nits。
  - 百分比分布：X = D 列百分比/窗口，Y = E 列亮度 nits。
- 后处理模式会按窗口亮度级别整理稳定采样，裁掉边界残留，同时保留短暂亮度尖峰。
- Hover 曲线点可查看文件名、亮度、总时间、周期时间、百分比和原始行号。
- 导出 PNG、SVG、Illustrator 友好的 AI 分层 SVG。
- 导出干净 Excel，包含 Summary、Cleaned Points、Diagnostics 三个工作表。
- Web 端使用浏览器下载；桌面端使用系统原生打开/保存对话框。

## 数据格式

应用读取第一个工作表，并跳过第一行表头。有效数据来自：

- B 列：总时间秒
- C 列：周期时间秒
- D 列：百分比 / 窗口亮度级别
- E 列：亮度 nits

单个工作簿限制为 25 MB。Excel 文件只在本机解析，不上传到服务器。

## Web 开发与部署

```bash
npm install
npm run dev
```

打开终端显示的本地地址，例如 `http://localhost:5173`。

构建静态 Web 版本：

```bash
npm run build
npm run preview
```

构建后的静态文件在 `dist/`。普通服务器只需要托管 `dist/`，不需要 Node 常驻进程。

Nginx 示例：

```nginx
server {
  listen 80;
  server_name your-domain.com;

  root /var/www/luminance-curve;
  index index.html;

  gzip on;
  gzip_types text/plain text/css application/javascript application/json image/svg+xml;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?)$ {
    expires 30d;
    add_header Cache-Control "public, immutable";
    try_files $uri =404;
  }
}
```

Docker 部署：

```bash
docker build -t luminance-curve-web .
docker run -d --name luminance-curve-web -p 8080:80 luminance-curve-web
```

## Desktop 开发与打包

桌面端使用 Electron Forge，共用同一个 renderer。

```bash
npm run desktop:dev
```

打包当前平台的免安装应用：

```bash
npm run desktop:package
```

生成安装包：

```bash
npm run desktop:make
```

Electron 输出目录在 `out/`。Windows 会使用 Squirrel maker；macOS 和 Linux maker 需要在对应平台或具备对应系统依赖的环境中运行。

## 验证

```bash
npm run typecheck
npm run test
npm run build
npm run desktop:package
```

在 Windows 上如果 `npm run desktop:make` 因平台 maker 或系统依赖失败，先使用 `npm run desktop:package` 产出可运行桌面包，再在目标平台上制作安装包。

## 维护说明

- `src/App.tsx` 是唯一 UI 入口：存在 `window.luminanceAPI` 时走 Electron 原生文件能力，否则走浏览器文件和下载能力。
- Electron 主进程和 preload 只负责本地文件选择、保存和 IPC 校验，不包含业务解析逻辑。
- Excel 解析、图表、后处理、导出生成逻辑都在 renderer 共享代码里维护。
- 依赖 `xlsx` 读取 `.xlsx`。该包目前有上游未修复的 npm audit advisory，不要把不可信来源的大文件作为生产数据入口。
