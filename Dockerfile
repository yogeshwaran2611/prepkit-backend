# Single-stage is enough here: this app has no native modules and no bundler step beyond
# tsc, so a multi-stage build would only add complexity for a marginal image-size saving.
FROM node:22-slim

WORKDIR /app

# Dependencies first, so Docker's layer cache skips the (slow) npm install when only
# application code changed.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "dist/src/server.js"]
