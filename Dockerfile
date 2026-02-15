FROM node:20-bookworm-slim

ARG PUID=1000
ARG PGID=1000

ENV DEBIAN_FRONTEND=noninteractive
ENV BUN_INSTALL=/home/tinyclaw/.bun
ENV PATH=/home/tinyclaw/.bun/bin:${PATH}
ENV NODE_LLAMA_CPP_SKIP_DOWNLOAD=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        git \
        jq \
        procps \
        tmux \
    && rm -rf /var/lib/apt/lists/*

# Create fixed runtime user/group (mapped from host if needed), but gracefully
# reuse an existing UID/GID if the image already has one.
RUN set -eux; \
    EXISTING_GROUP="$(getent group "${PGID}" | cut -d: -f1 || true)"; \
    if [ -n "${EXISTING_GROUP}" ]; then \
        GROUP_NAME="${EXISTING_GROUP}"; \
    else \
        groupadd -g "${PGID}" tinyclaw; \
        GROUP_NAME="tinyclaw"; \
    fi; \
    EXISTING_USER="$(getent passwd "${PUID}" | cut -d: -f1 || true)"; \
    if [ -n "${EXISTING_USER}" ]; then \
        usermod -g "${GROUP_NAME}" "${EXISTING_USER}"; \
        usermod -d /home/tinyclaw -m "${EXISTING_USER}" || true; \
        usermod -l tinyclaw "${EXISTING_USER}" || true; \
    else \
        useradd -m -u "${PUID}" -g "${GROUP_NAME}" -s /bin/bash tinyclaw; \
    fi

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Install required model CLIs in image so redeploys don't lose binaries.
RUN npm install -g @anthropic-ai/claude-code bun \
    && BUN_INSTALL=/home/tinyclaw/.bun bun install -g github:tobi/qmd \
    && /home/tinyclaw/.bun/bin/qmd --help >/dev/null \
    && ln -sf /home/tinyclaw/.bun/bin/qmd /usr/local/bin/qmd

# Runtime state and auth persistence locations
RUN mkdir -p /app/.tinyclaw /home/tinyclaw/.claude /home/tinyclaw/.codex /home/tinyclaw/.config /home/tinyclaw/.bun \
    && chown -R tinyclaw:tinyclaw /app /home/tinyclaw

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER tinyclaw
ENV HOME=/home/tinyclaw

ENTRYPOINT ["/entrypoint.sh"]
CMD ["start"]
