.PHONY: dev seed lint relay terminal db-push
dev:
	bun run dev
seed:
	bun scripts/seed.ts
lint:
	bun run lint
db-push:
	bun run db:push
relay:
	cd mini-services/relay && bun install && bun run dev
terminal:
	cd mini-services/terminal-service && bun install && bun run dev
