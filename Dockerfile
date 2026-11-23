# One image for Railway, DigitalOcean App Platform, or any container host.
# The base image is pinned by digest, so a changed or tampered "22-slim" tag cannot slip into a build. Dependabot
# (.github/dependabot.yml) proposes new digests as pull requests. To update by hand, look up the digest of node:22-slim.
FROM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# --ignore-scripts: no dependency may run code at install time (none of ours needs to; the lockfile has no install scripts).
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY . .
# Ads and their pictures are saved under /app/data. To keep them across deploys, mount a volume there (Railway: see README).
# The process runs as root on purpose: Railway mounts volumes owned by root, and a non-root user could not write to it.
EXPOSE 3000
CMD ["node", "src/server.mjs"]
