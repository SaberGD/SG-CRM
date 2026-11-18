# CRM Deployment Notes

The site is deployed to Hostinger by GitHub Actions (`.github/workflows/deploy.yml`) on every
push to `main`, after the `check` job (type check, `npx vite build`, functions tests) passes.
Pushes to `dev` and pull requests run the check only (there is no CRM dev site).

Deployment process:

1. `npm ci`
2. `npx vite build` (static site only; no server bundle, no source maps)
3. Upload the contents of `dist/` to Hostinger over FTP.

FTP host, user and password are GitHub Actions Secrets only (`FTP_SERVER`, `FTP_USERNAME`,
`FTP_PASSWORD`). The repository is public: never write them, or any other server detail, in the
project files.

Cloud Functions deploy through Cloud Build (`cloudbuild.yaml`) on push to `main`, after the
functions tests pass. Firestore rules and indexes are deployed by hand (see
`docs/hardening-2026-11.md`, go-live runbook).
