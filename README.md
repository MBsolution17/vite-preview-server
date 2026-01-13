# Vite Preview Server

Serveur Vite Runtime pour les previews Boundly Studio.

## Features

- ✅ Compilation Vite ultra-rapide (2s)
- ✅ Hot Module Replacement (HMR)
- ✅ Multi-projets simultanés
- ✅ Auto-cleanup des projets inactifs
- ✅ Health check pour Railway wake-up

## Endpoints

### `GET /health`
Health check (pour wake-up Railway)

### `POST /load-project`
Charge un projet dans Vite
```json
{
  "projectId": "my-app-123",
  "files": [
    { "path": "/app/page.tsx", "content": "..." }
  ]
}
```

### `POST /update-file`
Met à jour un fichier (trigger HMR)
```json
{
  "projectId": "my-app-123",
  "path": "/components/Button.tsx",
  "content": "..."
}
```

### `GET /preview/:projectId`
Affiche la preview du projet

## Développement Local

```bash
npm install
npm run dev
```

## Déploiement Railway

1. Push sur GitHub
2. Connecter à Railway
3. Deploy automatique !

## Variables d'Environnement

```env
PORT=5173
ALLOWED_ORIGINS=https://boundly-studio.vercel.app
NODE_ENV=production
```
