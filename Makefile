.PHONY: backend-test backend-local-models backend-provision-local-models local-run local-run-setup cli-test mcp-test frontend-build frontend-lint frontend-unit frontend-e2e docker-build desktop-build desktop-installer desktop-runtime desktop-smoke desktop-release-check rc1-gate rc1-gate-full lock test

backend-test:
	cd backend && python -m pytest

backend-local-models:
	cd backend && python -m pip install -r requirements-local-models.txt

backend-provision-local-models:
	cd backend && python scripts/provision_local_models.py

local-run:
	./scripts/start-local.sh

local-run-setup:
	./scripts/start-local.sh --setup --provision-models

cli-test:
	cd cli && python -m pip install -e . && python -m pytest

mcp-test:
	cd mcp && python -m pip install -e ".[dev]" && python -m pytest

frontend-build:
	cd frontend && corepack enable && pnpm install --frozen-lockfile && pnpm run build

frontend-lint:
	cd frontend && corepack enable && pnpm install --frozen-lockfile && pnpm run lint

frontend-unit:
	cd frontend && corepack enable && pnpm install --frozen-lockfile && pnpm run test:unit

frontend-e2e:
	cd frontend && corepack enable && pnpm install --frozen-lockfile && pnpm exec playwright install chromium && pnpm run test:e2e

docker-build:
	docker compose build

desktop-build:
	cd desktop && ./build.sh

desktop-installer:
	cd desktop && ./build-installer.sh

desktop-runtime:
	cd desktop && python scripts/provision-backend-runtime.py --target runtime/python --with-clone

desktop-smoke:
	cd desktop && python scripts/smoke-release-artifacts.py

desktop-release-check:
	python -m compileall desktop/scripts
	KURAL_UPDATER_PUBLIC_KEY=$${KURAL_UPDATER_PUBLIC_KEY:-test-public-key} python desktop/scripts/render-release-config.py --output /tmp/kural-release-test.json
	mkdir -p /tmp/kural-artifacts
	printf artifact > /tmp/kural-artifacts/Kural.AppImage
	printf signature > /tmp/kural-artifacts/Kural.AppImage.sig
	printf '{"version":"0.2.0"}' > /tmp/kural-artifacts/latest.json
	python desktop/scripts/smoke-release-artifacts.py --bundle-dir /tmp/kural-artifacts --require-signatures

rc1-gate:
	python scripts/rc1_release_gate.py

rc1-gate-full:
	python scripts/rc1_release_gate.py --include-playwright --include-docker

# Regenerate the hash-pinned base-runtime lock (cross-platform, --require-hashes).
# Needs `uv`. The Dockerfile + desktop provisioner install from requirements.lock.
lock:
	cd backend && uv pip compile --generate-hashes --universal --python-version 3.11 requirements.txt -o requirements.lock

test: backend-test cli-test mcp-test frontend-lint frontend-unit frontend-build
