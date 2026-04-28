# Kural Frontend

Next.js web UI for offline speech generation, voice cloning, batch synthesis, pronunciation replacement, and local session audio history.

## Development

```bash
corepack enable
pnpm install
pnpm dev
```

Open http://localhost:3000. Set `NEXT_PUBLIC_API_URL` when the backend is not on `http://localhost:8000`.

## Validation

```bash
pnpm lint
pnpm build
pnpm test:e2e
```

Desktop builds use `NEXT_DESKTOP=1 pnpm build:desktop` to create a static export for Tauri.
