# syntax=docker/dockerfile:1

# ---------- 构建阶段（同时作为 verify 一次性验收服务的镜像） ----------
FROM node:20-alpine AS builder
WORKDIR /app

# 优先拷贝依赖清单，利用层缓存
COPY package.json package-lock.json ./
RUN npm ci

# 拷贝源码与测试
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts

# 镜像构建即执行一次生产构建检查（类型检查 + 打包）
RUN npm run build

# ---------- 运行阶段：纯静态 Web，无后端 ----------
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
