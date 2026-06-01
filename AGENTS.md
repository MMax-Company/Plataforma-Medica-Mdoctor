# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is

Monorepo for **Mdoctor Survive** (async telemedicine / prescription renewal): `mdoctor-backend` (Express API, port **3004**), `mdoctor-panel` (Next.js doctor UI, port **3000**), `mdoctor-automation` (webhook gateway, port **5678**). See `docs/VS-CODE-LOCAL-DEV.md` and per-app READMEs for full detail.

### First-time local config

Copy backend env before first run (not created by `npm install`):

```bash
cp mdoctor-backend/.env.local.example mdoctor-backend/.env.local
```

Default dev credentials: `MEDICO_USER=admin`, `MEDICO_PASS=admin123`. Without Supabase URL/key, the backend uses in-memory seed data (`DISABLE_LOCAL_DB_FALLBACK=false` in the example).

### Running services

From repo root:

```bash
npm run dev
```

Aliases: `dev:backend`, `dev:panel`, `dev:automation`. On Cloud VMs, prefer a **tmux** session (e.g. `mdoctor-dev`) so servers survive disconnects.

Health: `GET http://localhost:3004/health`, panel `http://localhost:3000`, automation `http://localhost:5678/health`.

### Lint and checks

| Package | Command | Notes |
|---------|---------|--------|
| backend | `npm --prefix mdoctor-backend run check` | `node --check` on main modules |
| automation | `npm --prefix mdoctor-automation run check` | Syntax check |
| automation | `npm --prefix mdoctor-automation run smoke` | Webhook smoke (needs backend + automation up) |
| panel | `npm --prefix mdoctor-panel run lint` | **Interactive** on first run if no ESLint config exists in `mdoctor-panel` |
| root | `npm run pre-github-check` | Secret scan + repo identity; may warn on `.env.local` and fail `origin` URL if not the official GitHub remote |

There is no Jest/Vitest suite; `mdoctor-backend` `npm test` exits with an error by design.

### Gotchas

- Do **not** put `NODE_ENV=production` or `*.railway.internal` hosts in local `.env` — `npm run dev` in the backend can block startup (`docs/VS-CODE-LOCAL-DEV.md`).
- `npm run production-check` in the backend expects real Supabase/Memed/delivery credentials; it is not for default local dev.
- Panel API base URL: `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:3004` in dev).

### Minimal hello-world (core flow)

1. Start `npm run dev`.
2. `POST http://localhost:3004/api/auth/login` with `admin` / `admin123`, or open `http://localhost:3000/login` and sign in.
3. Open `/fila` and confirm queue entries (e.g. seed **Paciente Demo**).
