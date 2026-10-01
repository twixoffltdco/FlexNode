FROM node:22-bookworm-slim
WORKDIR /worker
RUN apt-get update && apt-get install -y docker.io && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
CMD ["node","dist/worker.js"]
