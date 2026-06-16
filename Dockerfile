FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Data directory (mount a volume here for persistence)
ENV ROUNDTABLE_STATE_DIR=/data
ENV ROUNDTABLE_HOST=0.0.0.0
ENV ROUNDTABLE_PORT=8787

EXPOSE 8787

VOLUME ["/data"]

CMD ["node", "./src/app/roundtable-server.js"]
