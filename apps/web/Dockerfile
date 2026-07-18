# 前端生产镜像。
# 职责：构建 Vue3 + Vite 静态资源，并交给 OpenResty 托管。
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM openresty/openresty:1.25.3.2-0-alpine

COPY openresty.conf /usr/local/openresty/nginx/conf/nginx.conf
COPY --from=build /app/dist /usr/local/openresty/nginx/html

EXPOSE 80
