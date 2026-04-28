.PHONY: backend-test frontend-build frontend-lint frontend-e2e docker-build desktop-build test

backend-test:
	cd backend && python -m pytest

frontend-build:
	cd frontend && corepack enable && pnpm install --frozen-lockfile && pnpm run build

frontend-lint:
	cd frontend && corepack enable && pnpm install --frozen-lockfile && pnpm run lint

frontend-e2e:
	cd frontend && corepack enable && pnpm install --frozen-lockfile && pnpm exec playwright install chromium && pnpm run test:e2e

docker-build:
	docker compose build

desktop-build:
	cd desktop && ./build.sh

test: backend-test frontend-lint frontend-build
