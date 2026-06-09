FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

EXPOSE 8888
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "8888"]
