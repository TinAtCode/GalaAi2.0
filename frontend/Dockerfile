# Frontend: statischer Build, ausgeliefert von nginx. nginx leitet /api an
# das Backend weiter – Frontend und API haben so dieselbe Adresse (kein CORS,
# Sitzungs-Cookie SameSite=Lax genügt).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV VITE_API_BASE_URL=/api
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
