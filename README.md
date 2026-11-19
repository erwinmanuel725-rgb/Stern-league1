---
title: Stern League
emoji: ⚽
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# Stern League – Classement & Paris

Application Node.js (Express) + PostgreSQL. Les points sont **fictifs**. Compatible avec Hugging Face Spaces (Docker), Railway, Render, etc.

## Structure

```
server.js            démarrage (migration auto du schéma + données initiales)
src/app.js           Express : helmet/CSP, limites de débit, anti-CSRF, routes API
src/domain.js        logique pure : cotes, classement, règlement, calendrier (testée)
src/services.js      lecture d'état, paris, résultats + règlement en transaction, admin
src/auth.js          mot de passe scrypt, sessions admin, réservation des pseudos
src/schema.sql       tables : players, matches, results, bets, wallet_transactions, admin_log…
src/seed-data.js     calendrier J4→J34, arbitres, stats et points de départ (reste côté serveur)
web/                 front : index.html, app.js, style.css, admin.html, admin.js, legal.html, img/
scripts/             build (minification), hash-password, export
tests/               tests unitaires + tests Postgres (TEST_DATABASE_URL)
```

## Déployer sur Railway

1. Mets ce dossier dans un dépôt GitHub, puis **New Project → Deploy from GitHub repo**.
2. Dans le projet : **+ New → Database → PostgreSQL**.
3. Sur le service de l'appli → **Variables** :
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (réseau privé Railway, pas de SSL nécessaire)
   - `ADMIN_PASSWORD_HASH` = résultat de `npm run hash-password` (voir plus bas)
   - `NODE_ENV` = `production`
4. Service → **Settings → Networking → Generate Domain**. Le healthcheck `/healthz` est déjà configuré (`railway.json`).
5. Au premier démarrage, les tables et les données initiales sont créées automatiquement.
6. Va sur `https://ton-domaine/admin`.

### Générer le mot de passe admin
```bash
npm install
npm run hash-password            # saisie masquée, 12 caractères minimum
# copie la ligne « scrypt$… » dans ADMIN_PASSWORD_HASH (colle-la telle quelle dans Railway)
```
Sans `ADMIN_PASSWORD_HASH`, la page admin est désactivée (rien n'est jamais en clair dans le code).

### Variables
| Variable | Défaut | Rôle |
|---|---|---|
| `DATABASE_URL` | – | connexion Postgres (obligatoire) |
| `ADMIN_PASSWORD_HASH` | – | hash scrypt du mot de passe admin |
| `ADMIN_SESSION_HOURS` | 12 | durée de session admin |
| `BET_CLOSE_MINUTES` | 0 | fermer les paris X min avant le coup d'envoi |
| `DATABASE_SSL` | false | `true` seulement avec l'URL **publique** de Railway |
| `SENTRY_DSN` | – | alertes d'erreur (installer aussi `npm i @sentry/node`) |

## Utilisation

- **Joueurs** : choisissent leur pseudo ; le 1er appareil le réserve (cookie HttpOnly émis par le serveur). « Changer de pseudo » le libère.
- **Admin (`/admin`)** : saisir / corriger / annuler un résultat (les paris sont réglés, re-réglés ou remis en jeu automatiquement), forfaits, ajustement de points (motif obligatoire + journal), réinitialiser un pseudo, calendrier complet, journal des connexions, date de départ, export JSON.
- Les paris ferment au **coup d'envoi** (date de départ + 3 jours par journée, 18h/19h/20h GMT).

## ⚠️ Reprise des données existantes
L'ancienne page stockait résultats, ajustements de points et paris dans la base de l'artefact Claude : elle n'est **pas** reprise automatiquement. Le serveur repart des données codées dans le fichier d'origine (points et stats avant la J4). Pour rattraper : saisis les résultats déjà joués depuis `/admin` → Résultats, puis corrige les soldes via Points (avec un motif).

## Sécurité (ce qui est en place)
- Admin : mot de passe scrypt, session en cookie `HttpOnly; Secure; SameSite=Strict` (expiration serveur), 5 essais / 15 min / IP, délai croissant, journal, vérification `Origin` + JSON obligatoire sur toutes les écritures.
- Paris : cote, solde, limite de 1000 pts/match, interdiction de parier sur son match, fermeture au coup d'envoi, tout vérifié et réglé côté serveur, en transaction (verrous de lignes → paris simultanés sûrs). Journal `wallet_transactions` : solde = somme du journal.
- helmet (HSTS, nosniff, frame DENY…), CSP stricte (`script-src 'self'`, aucun script ni `onclick` inline, images locales + Google Fonts), CORS fermé, validation zod, erreurs sans détail technique.
- Le calendrier futur et les arbitres ne sont jamais envoyés avant la publication de la journée.
- Tout texte affiché est échappé côté navigateur.

## Tests
```bash
npm test                                                           # tests unitaires
TEST_DATABASE_URL=postgresql://user:pass@localhost/test npm test   # + tests Postgres
```
CI GitHub (`.github/workflows/ci.yml`) et Dependabot inclus.

## Sauvegardes
- Railway : active les sauvegardes du volume Postgres (onglet **Backups** du service Postgres).
- Avant chaque journée : `/admin` → Outils → Exporter, ou `railway run npm run export > sauvegarde.json`.

## Limites connues
- Une seule instance de l'appli (le temps réel passe par une mémoire locale) ; les clients se resynchronisent de toute façon toutes les 60 s.
- Pense à compléter le contact dans `web/legal.html`.
- Si un jour des enjeux réels (cadeaux, argent) apparaissent : vraie authentification des joueurs + cadre légal.
