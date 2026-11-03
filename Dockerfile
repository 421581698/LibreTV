# ---- 构建阶段 ----
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json .npmrc ./
# 仓库暂未提交 package-lock.json，先生成锁文件再执行干净安装。
RUN npm install --package-lock-only --ignore-scripts --no-audit --no-fund && npm ci --no-audit --no-fund

COPY . .
ENV DOCKER_BUILD=1
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- 运行阶段 ----
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# 非 root 用户
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER nextjs

EXPOSE 8080
CMD ["node", "server.js"]
