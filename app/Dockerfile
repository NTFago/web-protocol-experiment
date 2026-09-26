FROM node:24.15.0-alpine

WORKDIR /app
COPY --chown=node:node server.mjs /app/server.mjs

USER node
EXPOSE 3000

CMD ["node", "server.mjs"]

