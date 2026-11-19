FROM node:24-slim
WORKDIR /app

COPY package.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN npm run install:all

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

CMD ["npm", "start"]
