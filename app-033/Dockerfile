# syntax=docker/dockerfile:1

# ---------- 构建阶段 ----------
FROM node:20-alpine AS build
WORKDIR /app

# 先拷依赖清单，利用层缓存
COPY package.json package-lock.json ./
RUN npm ci

# 拷贝源码并构建（.dockerignore 已排除 node_modules/dist 等）
COPY . .
RUN npm run build

# ---------- 运行阶段 ----------
FROM nginx:1.27-alpine

# .dockerignore 按规格书排除了 nginx.conf，这里直接生成同等配置（内容与仓库 nginx.conf 保持一致）
RUN rm -f /etc/nginx/conf.d/default.conf \
    && printf '%s\n' \
'server {' \
'    listen       80;' \
'    listen  [::]:80;' \
'    server_name  _;' \
'    charset utf-8;' \
'' \
'    root   /usr/share/nginx/html;' \
'    index  index.html;' \
'' \
'    gzip              on;' \
'    gzip_vary         on;' \
'    gzip_comp_level   6;' \
'    gzip_min_length   1024;' \
'    gzip_proxied      any;' \
'    gzip_types text/plain text/css text/xml application/json application/javascript application/xml+rss application/atom+xml image/svg+xml application/font-woff2;' \
'' \
'    location = /healthz {' \
'        access_log  off;' \
'        default_type text/plain;' \
'        return 200 "ok\n";' \
'    }' \
'' \
'    location /assets/ {' \
'        access_log off;' \
'        expires 1y;' \
'        add_header Cache-Control "public, immutable";' \
'        try_files $uri =404;' \
'    }' \
'' \
'    location /fonts/ {' \
'        expires 30d;' \
'        add_header Cache-Control "public";' \
'        try_files $uri =404;' \
'    }' \
'' \
'    location /samples/ {' \
'        add_header Cache-Control "no-cache";' \
'        try_files $uri =404;' \
'    }' \
'' \
'    location = /index.html {' \
'        add_header Cache-Control "no-cache, no-store, must-revalidate";' \
'        expires 0;' \
'    }' \
'' \
'    location / {' \
'        try_files $uri $uri/ /index.html;' \
'    }' \
'}' \
    > /etc/nginx/conf.d/default.conf

# 只拷构建产物
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O - http://127.0.0.1/healthz || exit 1
