# VAULTX — Store. Share. Access. (Built by PythosX)

One Node service serves the API and the built React app.
Free stack: **Render** (host) + **Neon** (Postgres) + **Cloudflare R2** (files, 2 private buckets). Backblaze B2 also works — it is S3-compatible, only the env vars change.

## 1. Services
1. **Postgres:** create a free Neon (or Supabase) project, copy the connection string → `DATABASE_URL`. Tables are created on first boot.
2. **Storage:** in Cloudflare R2 create two buckets (`vaultx-public`, `vaultx-private`), leave BOTH private (no public access, no r2.dev URL), create an API token with Object Read & Write → `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY`; `STORAGE_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, `STORAGE_REGION=auto`.
3. **Admin:** `npm run hash -- "yourPassword"` → `ADMIN_PASSWORD_HASH`; set `ADMIN_EMAIL`.
## 2. Deploy (Render)
Push to GitHub → Render → New → Blueprint (uses `render.yaml`) → fill the secret env vars (see `.env.example`).
Never commit `.env`. Open `/api/health` after deploy.
## 3. Run locally
`cp .env.example server/.env` (set `NODE_ENV=development`), fill values, `npm run install:all`, `npm run dev` → http://localhost:5173
## Security model
- Public and private files are in different buckets; public routes query only `vault_type='PUBLIC'`; all `/api/private/*` need the admin session (401 otherwise).
- Private files have no public URL; they stream through the authenticated API (`no-store`).
- scrypt password hash, signed httpOnly SameSite=Strict cookie, login + upload rate limits, size/quota limits, sanitized names, random storage keys, nosniff + sandbox CSP; SVG/HTML are download-only.
- Anonymous uploaders get an ownership token (stored hashed) to delete only their own uploads; admin can delete any public file.
## Known limits (free-tier reality)
- Uploads are proxied through the server (temp disk → bucket), so keep file limits small (default 100 MB). Larger files need direct-to-bucket presigned uploads (not included).
- Render's free service sleeps when idle (slow first request). Check each provider's current free-tier limits before launch.
- Not included: Tailwind/GSAP, virtualized lists, resumable uploads, mobile bottom nav, thumbnails, automated tests. Not run in the build sandbox (no network) — test locally first.
