FROM node:20-bookworm-slim

ARG PUID=1000
ARG PGID=1000

ENV DEBIAN_FRONTEND=noninteractive

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

# Create fixed runtime user/group (mapped from host if needed)
RUN groupadd -g ${PGID} tinyclaw \
    && useradd -m -u ${PUID} -g tinyclaw -s /bin/bash tinyclaw

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Runtime state and auth persistence locations
RUN mkdir -p /app/.tinyclaw /home/tinyclaw/.claude /home/tinyclaw/.codex /home/tinyclaw/.config \
    && chown -R tinyclaw:tinyclaw /app /home/tinyclaw

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER tinyclaw
ENV HOME=/home/tinyclaw

ENTRYPOINT ["/entrypoint.sh"]
CMD ["start"]
