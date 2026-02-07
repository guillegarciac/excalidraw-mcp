# Deployment (Vercel / serverless)

For the **standalone Excalidraw app** and **check_drawing** to work when deployed (e.g. Vercel), the drawing store must be **persistent** across requests. Locally we use in-memory storage; in production you use Redis.

**Free tier:** Vercel Hobby (hosting) and Upstash Redis free tier are enough to run this app at no cost.

---

## Deploy to Vercel (step-by-step)

### 1. Push the project to GitHub

```bash
cd /path/to/excalidraw-mcp
git init
git add .
git commit -m "Add Vercel deployment"
git remote add origin https://github.com/YOUR_USERNAME/excalidraw-mcp.git
git push -u origin main
```

### 2. Create a free Redis database (Upstash)

1. Go to [upstash.com](https://upstash.com) and sign up (free).
2. Create a new Redis database (e.g. region closest to you).
3. Open the database and copy **REST URL** and **REST Token** (under "REST API").

### 3. Import the project in Vercel

1. Go to [vercel.com](https://vercel.com) and sign in (free Hobby plan).
2. **Add New** → **Project** → **Import** your GitHub repo (`excalidraw-mcp`).
3. Leave **Build Command** as `npm run build` (or set it in `vercel.json`).
4. Before deploying, add environment variables (next step).

### 4. Add environment variables in Vercel

In the project → **Settings** → **Environment Variables**, add:

| Name | Value |
|------|--------|
| `UPSTASH_REDIS_REST_URL` | (paste from Upstash) |
| `UPSTASH_REDIS_REST_TOKEN` | (paste from Upstash) |

Apply to **Production** (and Preview if you want).

### 5. Deploy

Click **Deploy**. After the build, your app will be at:

- **Standalone Excalidraw:** `https://YOUR_PROJECT.vercel.app/excalidraw`
- **MCP endpoint (HTTP):** `https://YOUR_PROJECT.vercel.app/mcp`
- **Drawing API:** `https://YOUR_PROJECT.vercel.app/api/drawing` (POST)

Users can open the first URL to draw and send to Claude; in Claude (or any MCP client that supports HTTP), point the MCP server to the second URL so `check_drawing` works.

---

## How it works

- **Local (default):** No extra env vars. The app uses an in-memory store. Standalone and MCP run in the same process, so “Send to Claude” and `check_drawing` share state.
- **Deployed (serverless):** Set Redis env vars. The app uses **Upstash Redis** (or Vercel KV, which is backed by Upstash). Every request can hit a different instance; the store is shared via Redis.

## Environment variables (production)

Set **one** of these pairs:

| Env var | Description |
|--------|-------------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token |

**Or** (Vercel KV / legacy):

| Env var | Description |
|--------|-------------|
| `KV_REST_API_URL` | Redis REST URL (e.g. from Vercel KV) |
| `KV_REST_API_TOKEN` | Redis REST token |

If **any** of these are set, the drawing store uses Redis. Otherwise it uses in-memory (local only).

## Setup (Vercel + Upstash)

1. **Create a Redis database**
   - [Upstash](https://upstash.com): create a Redis database, copy REST URL and token.
   - Or in Vercel: Storage → create Redis (Vercel uses Upstash); env vars are often set automatically.

2. **Add env vars to your project**
   - In Vercel: Project → Settings → Environment Variables.
   - Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or the `KV_*` pair if your integration uses that).

3. **Deploy**
   - Ensure `npm run build` runs (so `dist/` has the server, store, and standalone HTML).
   - Expose your MCP over HTTP (e.g. `/api/mcp`) and serve the standalone app (e.g. `/excalidraw`) and `POST /api/drawing` from the same app so they share the same Redis-backed store.

## Dependency

The Redis store uses **@upstash/redis**:

```bash
npm install @upstash/redis
```

It’s already in `package.json`. Local runs don’t need Redis; the store falls back to memory when the env vars above are unset.

## Stored data

- **Key:** `excalidraw:latest`
- **TTL:** 1 hour (drawings expire if not consumed)
- **Value:** JSON `{ screenshot, elements, prompt, timestamp }`

Each `check_drawing` call **consumes** the latest drawing (get + delete). The next “Send to Claude” from the standalone app overwrites the key.
