# Build from the REPO ROOT:
#   docker build -f devops/web/Dockerfile -t pg-rent/web .

# ---- stage 1: build the React app --------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY frontend/ ./
# Same-origin API: the browser calls /api on whatever address served the page.
# (Set explicitly so a stray local frontend/.env can never point the build at localhost.)
ENV VITE_API_URL=/api
RUN npm run build

# ---- stage 2: serve it with nginx (unprivileged image, listens on 8080) -------
FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY devops/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
