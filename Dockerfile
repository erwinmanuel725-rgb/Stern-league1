FROM node:20-slim

# Utilisateur non-root (requis par Hugging Face Spaces et bonnes pratiques Docker)
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.npm-global/bin:$PATH \
    PORT=7860 \
    NODE_ENV=production

WORKDIR /home/user/app

# Installation des dépendances
COPY --chown=user:user package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copie du code source
COPY --chown=user:user . .

# Construction des assets (minification web -> dist)
RUN npm run build

EXPOSE 7860
CMD ["npm", "start"]

