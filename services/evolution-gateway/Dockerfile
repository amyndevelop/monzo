FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530
WORKDIR /app
COPY --chown=node:node package.json protocol.mjs core.mjs server.mjs main.mjs ./
USER node
EXPOSE 9080
HEALTHCHECK --interval=15s --timeout=4s --retries=3 CMD node -e "fetch('http://127.0.0.1:9080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "main.mjs"]
