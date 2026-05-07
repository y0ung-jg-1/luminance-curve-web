# Luminance Curve Web

一个纯网页版本的亮度曲线工具。用户在浏览器里选择或拖拽本地 `.xlsx` 文件，数据只在浏览器本地解析，不会上传到服务器。

## 功能

- 手动选择或拖拽多个 `.xlsx`
- 每个文件作为一条原始采样曲线叠加显示
- 时间曲线：X = B 列总时间秒，Y = E 列亮度 nits
- 百分比分布：X = D 列百分比/窗口，Y = E 列亮度 nits
- Hover 显示文件名、亮度、总时间、周期时间、百分比、原始行号
- 支持曲线显示/隐藏、移除、清空、浅/深色模式、PNG 下载

## 本地开发

```bash
npm install
npm run dev
```

打开终端显示的本地地址，例如 `http://localhost:5173`。

## 本地验证

```bash
npm run typecheck
npm run test
npm run build
```

构建后的静态文件在 `dist/`。

## 部署到普通 Linux 服务器（Nginx）

服务器只需要托管静态文件，不需要 Node 常驻进程。

1. 在本地构建：

```bash
npm ci
npm run build
```

2. 上传 `dist/` 到服务器：

```bash
scp -r dist/* root@你的服务器IP:/var/www/luminance-curve/
```

3. 在服务器安装 Nginx：

```bash
sudo apt update
sudo apt install -y nginx
sudo mkdir -p /var/www/luminance-curve
```

4. 新建 Nginx 站点 `/etc/nginx/sites-available/luminance-curve`：

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

5. 启用站点并重载：

```bash
sudo ln -s /etc/nginx/sites-available/luminance-curve /etc/nginx/sites-enabled/luminance-curve
sudo nginx -t
sudo systemctl reload nginx
```

6. 配 HTTPS：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## Docker 部署

```bash
docker build -t luminance-curve-web .
docker run -d --name luminance-curve-web -p 8080:80 luminance-curve-web
```

然后访问 `http://服务器IP:8080`。生产环境建议再用 Nginx/Caddy 反代并配置 HTTPS。

## 数据与安全说明

- Excel 数据在浏览器本地解析，不上传服务器。
- 单个工作簿限制为 25 MB，避免超大文件拖慢浏览器。
- 依赖 `xlsx` 读取 `.xlsx`，该包目前有上游未修复 npm audit advisory；不要把不可信来源的大文件作为生产数据入口。
