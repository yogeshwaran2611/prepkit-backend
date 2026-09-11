# Single-stage is enough here: this app has no native modules and no bundler step beyond
# tsc, so a multi-stage build would only add complexity for a marginal image-size saving.
#
# NOT node:22-slim: its minimal Debian OpenSSL build is documented as incompatible with
# MongoDB Atlas's TLS handshake — Atlas's mongod sends a generic "internal_error" alert
# during the handshake (openssl error 0A000438, alert number 80) that has nothing to do
# with credentials, network access, or the connection string; it is specifically a
# client-side OpenSSL build issue. The full (non-slim) image ships a different OpenSSL
# build that does not hit this. Found via a real Render deploy: correct URI, IP allowlist
# open, and the connection still failed until this line changed.
FROM node:22

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
