FROM node:24-alpine

WORKDIR /app

COPY package.json ./
COPY package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public ./public

RUN mkdir -p data storage/files storage/tmp

ENV NODE_ENV=production
ENV PORT=7860
ENV HOST=0.0.0.0

EXPOSE 7860

CMD ["node", "server.js"]
