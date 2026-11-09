# Contributing to HipnoType Panel

1. Fork → branch (`feat/…` or `fix/…`) → PR against `main`.
2. `bun install && bun run lint` must pass; every feature needs backend + API + UI + audit + docs.
3. Security rules are non-negotiable: `execFile` arrays only, strict input validation, no secrets
   in logs, honest backend states (never fake success). See docs/DECISIONS.md.
4. Original code only — reference panels are for ideas (licenses in docs/RESEARCH.md).
5. Update docs/PROGRESS.md and docs/API.md with your change.
