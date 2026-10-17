FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY admin/package.json ./admin/package.json
RUN npm ci
COPY server ./server
COPY admin ./admin
RUN npm run build && mkdir -p /app/data /app/uploads && chown -R node:node /app/data /app/uploads
USER node
EXPOSE 3000
CMD ["npm", "start"]
