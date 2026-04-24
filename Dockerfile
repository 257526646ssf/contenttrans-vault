FROM node:24-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY public ./public

RUN mkdir -p data storage/files storage/tmp

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

CMD ["node", "server.js"]
