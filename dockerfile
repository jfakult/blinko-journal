# Build Stage
FROM oven/bun:1.2.8 AS builder

# Add Build Arguments
ARG USE_MIRROR=false

WORKDIR /app

# Set Sharp environment variables to speed up ARM installation
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1
ENV npm_config_sharp_binary_host="https://npmmirror.com/mirrors/sharp"
ENV npm_config_sharp_libvips_binary_host="https://npmmirror.com/mirrors/sharp-libvips"

# Set Prisma environment variables to optimize installation
ENV PRISMA_ENGINES_MIRROR="https://registry.npmmirror.com/-/binary/prisma"
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true

# CUSTOM-JOURNAL: dev-loop speedup. This used to be `COPY . .` right here, before
# `bun install` - meaning ANY source file edit (a single .tsx change, docs, anything)
# busted the Docker layer cache for `bun install` too, forcing a full dependency
# reinstall on every rebuild even though package.json/bun.lock never changed. Splitting
# into "copy just the workspace manifests + prisma schema, install, THEN copy the rest
# of the source" means `bun install`/`prisma generate` stay cached across pure
# source-code-only rebuilds - only the (fast) full copy + build steps re-run. The
# second `COPY . .` below re-copies these same manifest files too, which is harmless
# (identical content, and Docker no-ops an unchanged layer's downstream steps based on
# content hash, not by avoiding the copy itself).
COPY package.json bun.lock turbo.json ./
COPY app/package.json ./app/package.json
COPY app/tauri-plugin-blinko ./app/tauri-plugin-blinko
COPY server/package.json ./server/package.json
COPY shared/package.json ./shared/package.json
COPY blinko-types/package.json ./blinko-types/package.json
COPY prisma ./prisma

# Configure Mirror Based on USE_MIRROR Parameter
RUN if [ "$USE_MIRROR" = "true" ]; then \
        echo "Using Taobao Mirror to Install Dependencies" && \
        echo '{ "install": { "registry": "https://registry.npmmirror.com" } }' > .bunfig.json; \
    else \
        echo "Using Default Mirror to Install Dependencies"; \
    fi

# Pre-install Sharp for ARM architecture
RUN if [ "$(uname -m)" = "aarch64" ] || [ "$(uname -m)" = "arm64" ]; then \
        echo "Detected ARM architecture, installing sharp platform-specific dependencies..." && \
        mkdir -p /tmp/sharp-cache && \
        export SHARP_CACHE_DIRECTORY=/tmp/sharp-cache && \
        bun install --platform=linux --arch=arm64 sharp@0.34.1 --no-save --unsafe-perm || \
        bun install --force @img/sharp-linux-arm64 --no-save; \
    fi

# Install Dependencies (cached unless a package.json/bun.lock actually changed)
RUN bun install --unsafe-perm
RUN bunx prisma generate

# Copy Project Files (everything else - source code, changes on every edit)
COPY . .

RUN bun run build:web
RUN bun run build:seed

RUN printf '#!/bin/sh\necho "Current Environment: $NODE_ENV"\nnpx prisma migrate deploy\nnode server/seed.js\nnode server/index.js\n' > start.sh && \
    chmod +x start.sh


FROM node:20-alpine as init-downloader

WORKDIR /app

RUN wget -qO /app/dumb-init https://github.com/Yelp/dumb-init/releases/download/v1.2.5/dumb-init_1.2.5_$(uname -m) && \
    chmod +x /app/dumb-init && \
    rm -rf /var/cache/apk/*


# Runtime Stage - Using Alpine as required
FROM node:20-alpine AS runner

# Add Build Arguments
ARG USE_MIRROR=false

WORKDIR /app

# Environment Variables
ENV NODE_ENV=production
# If there is a proxy or load balancer behind HTTPS, you may need to disable secure cookies
ENV DISABLE_SECURE_COOKIE=false
# Set Trust Proxy
ENV TRUST_PROXY=1
# Set Sharp environment variables
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1
ENV npm_config_sharp_binary_host="https://npmmirror.com/mirrors/sharp"
ENV npm_config_sharp_libvips_binary_host="https://npmmirror.com/mirrors/sharp-libvips"

RUN apk add --no-cache openssl vips-dev python3 py3-setuptools make g++ gcc libc-dev linux-headers && \
    if [ "$USE_MIRROR" = "true" ]; then \
        echo "Using Taobao Mirror to Install Dependencies" && \
        npm config set registry https://registry.npmmirror.com; \
    else \
        echo "Using Default Mirror to Install Dependencies"; \
    fi

# Copy Build Artifacts and Necessary Files
COPY --from=builder /app/dist ./server
COPY --from=builder /app/server/lute.min.js ./server/lute.min.js
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma/client ./node_modules/.prisma/client
COPY --from=builder /app/start.sh ./
COPY --from=init-downloader /app/dumb-init /usr/local/bin/dumb-init

RUN chmod +x ./start.sh && \
    ls -la start.sh

RUN if [ "$(uname -m)" = "aarch64" ] || [ "$(uname -m)" = "arm64" ]; then \
        echo "Detected ARM architecture, installing sharp platform-specific dependencies..." && \
        mkdir -p /tmp/sharp-cache && \
        export SHARP_CACHE_DIRECTORY=/tmp/sharp-cache && \
        npm install --platform=linux --arch=arm64 sharp@0.34.1 --no-save --unsafe-perm || \
        npm install --force @img/sharp-linux-arm64 --no-save; \
    fi

# Install runtime dependencies; legacy peer deps avoids optional peer conflicts from LangChain.
RUN echo "Installing additional dependencies..." && \
    npm install @node-rs/crc32 lightningcss sharp@0.34.1 prisma@5.21.1 && \
    npm install -g prisma@5.21.1 && \
    npm install sqlite3@5.1.7 && \
    npm install --legacy-peer-deps llamaindex @langchain/community@0.3.40 && \
    npm install @libsql/client @libsql/core && \
    npx prisma generate && \
    # find / -type d -name "onnxruntime-*" -exec rm -rf {} + 2>/dev/null || true && \
    # npm cache clean --force && \
    rm -rf /tmp/* && \
    apk del python3 py3-setuptools make g++ gcc libc-dev linux-headers && \
    rm -rf /var/cache/apk/* /root/.npm /root/.cache

# Expose Port (Adjust According to Actual Application)
EXPOSE 1111

CMD ["/usr/local/bin/dumb-init", "--", "/bin/sh", "-c", "./start.sh"]
