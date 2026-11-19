FROM node:20-slim

USER node
ENV HOME=/home/node \
    PATH=/home/node/.npm-global/bin:$PATH \
    NODE_ENV=production

WORKDIR /home/node/app

# Installation des dépendances
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copie du code source
COPY --chown=node:node . .

# Construction des assets (minification web -> dist)
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
