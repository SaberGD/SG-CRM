# SG-CRM hardening, November 2026

Source: the audit of 2026-11-17 (14 axes). Work branch `hardening/2026-11` (from live `main`),
functions work on `hardening/2026-11-functions` (merged into it), then merged into `dev`.
**Nothing here is deployed.** The rules, indexes, functions and site go live only with the owner's
OK, following the runbook at the end. There is no CRM dev site: pushing `dev` only runs the CI check.

Status: [x] done · [ ] not done · [-] skipped (reason given)

## Checklist

### 0. Base
- [x] Merged `fix/ai-cost-guards`: Claude instead of Gemini for the three AI endpoints, daily caps, `ai_usage` counters, fallbacks marked `fallback:true` and never saved. Main's SHA-256 automation key check kept (`functions/automationKey.js`); no AUTOMATION_SECRET and no Gemini key in Cloud Build.
- [x] `npx tsc --noEmit` green (ErrorBoundary typing; the project has no `@types/react`).

### 1. Rules (`firestore.rules`, `scripts/test-rules.cjs`: 94 cases, 94 pass on the Rules API test endpoint, nothing deployed)
- [x] `allowed_users` and `invitations`: a non-admin leader can grant, change or remove `sales_agent` only (closes leader -> self-made admin).
- [x] Deactivate/delete in AdminPanel sets `allowed_users/{email}.isActive=false`; reactivate sets it back.
- [x] `logs` create requires `userId == auth.uid` (admins and the server excepted).
- [x] Shift owner: only open now (`reviewing`, no breaks), start now, append a break / close the last break now, end now, link the report. Managers edit freely.
- [x] Client create blocks `accounting*`, `accountingBookingIds`, `aiRecommendation` (plus the snapshot fields as before).
- [x] Sales read own + pool clients and follow-ups; leaders (team leader and up, supervisor included) full read. Pool uid comes from `app_settings/pool {uid}`.
- [x] Follow-up create: own agentId, about a client the writer can see. Leaders may change only `clientAgentId` (transfer re-stamp).
- [x] Duplicate-phone check behind `phoneCheck` (bridge action), with the old direct lookup as fallback while the action is not deployed.
- [x] "Assign to me": narrow rule (pool client -> self, owner fields only) + the agent's own `transfers` record; UI shows errors.
- [x] Reports delete manager-only.

### 2. Automation (`upsertClientFromAutomation`, pure rules in `functions/automationUpsert.js`, contract in `docs/automation-contract.md`)
- [x] Dedupe by `phoneKey` (then `phoneKeys`, then legacy phone variations); ambiguous = oldest client, recorded on the claim.
- [x] Suggested or past follow-up dates are stored only in `automationSuggestedFollowUp` (shown on the client page); only an explicit future date sets `nextFollowUpDate`.
- [x] Status never downgrades (interested stays interested; booked / not_interested untouched).
- [x] Key in the header only (body key dropped); type checks and length limits; 400 on absurd payloads.
- [x] `ad_code` + `first_message_at` -> `adCode`, `firstMessageAt` (first touch wins), copied on the follow-up.
- [x] Follow-ups it writes carry `clientAgentId`; users/labels cached per instance.

### 3. Accounting ingest
- [x] Deterministic client id (`acc_<customerId>` or `acc_pk_<phoneKey>`) + `client_locks/pk_<phoneKey>` in one transaction: no duplicate client under concurrent syncs.
- [x] Older payloads ignored (`sourceUpdatedAt` per booking). Needs the accounting sender to send `booking.updatedAt` (it does not yet: until then the guard is a no-op).
- [x] Ingest honours `sync_review.resolvedClientId`.
- [x] Page "حجوزات محتاجة ربط" (`/sync-review`, 10 per page, managers link; `linkSyncReview`).
- [x] Integration health card on that page (`integrationHealth`: open reviews, failed automation 24 h, last ingest / automation).

### 4. Daily flow
- [x] EndShiftModal never blocks: "التالي، هراجعهم بكرة"; past-dated AI proposals don't count as pending.
- [x] Follow-up save in one `writeBatch` with a saving guard (ClientDetails, ManualFollowUpModal); ManualFollowUpModal hides booking/money for accounting-linked clients.
- [x] AcceptFlowModal rebuilds `searchKeys`/`phoneKey`/`phoneKeys`; local datetime prefill; errors shown.
- [x] "Check" on automated follow-ups only for managers.
- [x] Call / WhatsApp buttons on the client page (start the session too); E.164 links everywhere.
- [x] TodayWork always fresh on return (`sessionCache:false`).
- [x] One overdue definition (`utils/overdue.ts`: open leads, time passed) on Dashboard, Notifications, TodayWork, the alarm, EndShift and the report. Notifications with a service filter keeps the old count until the new indexes are live (`INDEXES_LIVE` in `pages/Notifications.tsx`).

### 5. Transfers and import
- [x] `utils/transfers.ts`: single, bulk, undo and admin transfers in batches of <=400 writes, transferHistory + `transfers` record per client, `bulk_transfers` written after the last commit, undo reads in parallel, follow-ups re-stamped (best effort).
- [x] Bulk import: E.164 phone, searchKeys/phoneKey/phoneKeys, countryCode, createdVia `bulk_import`, no male default, accounting-linked clients' money left alone.

### 6. Build, CI, hygiene
- [x] `server.ts`, express, `@google/genai`, recharts, tsx, esbuild removed; `build` = `vite build`; no key `define`; `sourcemap:false`.
- [x] `.github/workflows/deploy.yml`: `check` job (tsc + vite build + functions tests) on push/PR; deploy needs it and runs on main only; refuses .map/.cjs/server files. FTP host/user from secrets.
- [x] Cloud Build runs the functions tests before deploying; `firebase.json` functions predeploy runs them too.
- [x] `maxInstances` on every function; `geminiPredictSales` removed from code and the deploy list (delete the deployed one by hand, runbook).
- [x] One `utils/roles.ts` (supervisor is manager-tier everywhere, as in the rules); one `utils/phone.ts`.
- [x] Cached clients and paged lists cleared on sign-out / account change.
- [x] Chunk-reload guard (one reload, sessionStorage flag).
- [x] `crmExport` no longer exports `searchKeys`; automation Meta Lead has no client name.

### 7. Public tree
- [x] FTP host/user out of DEPLOYMENT_NOTES.md and deploy.yml.
- [x] Staff alias table out of the code -> `app_settings/salesNameAliases` (seeded from a local file by `scripts/seed-sales-aliases.cjs`); names out of `scripts/reassign-owner-clients.cjs` and tests; local path out of the cleanup script.
- [-] Kept on purpose (the code needs them; not secrets): owner and pool account emails (rules + login), the accounting runtime service-account email and project ids (OIDC check), own function URLs, Chatwoot base URL + account id (`utils/chatwoot.ts`, builds conversation links), Meta pixel id. Old values remain in git history. Making the repo private is the owner's call (CLAUDE.md §5.5).

### 8. Reports and ad code
- [x] Daily report label "مدفوع على حجوزات النهارده" (real cash-by-day needs payment dates from accounting: not cheap, not done).
- [x] adCode / firstMessageAt on the upsert contract, client page and a daily "by ad code" card. The n8n side (parsing the code from the first message) is not done here: contract in `docs/automation-contract.md`.

### Not done (later, with reasons)
- [-] Nightly reconciliation accounting -> CRM: needs a scheduled function and an accounting-side read; not in this pass.
- [-] Maro queries per tool instead of loading all clients; DuplicatesManager / BackupManager in a function; entry chunk split: performance items, left for later.
- [-] Email-verified gate: by owner decision not added (could lock staff out). Later step in the runbook.
- [-] Retention rules, PITR, scheduled exports, budget alerts: owner console actions (runbook).

## Decisions taken (owner delegated)
- Sales read scope: own + pool. The pool uid is read by the rules from `app_settings/pool {uid}` (`scripts/set-pool-setting.cjs`), so no uid is hard-coded.
- Follow-ups carry `clientAgentId` (client owner when written, re-stamped on transfer); old ones get it from `scripts/backfill-followup-client-agent.cjs`.
- "Assign to me" is a narrow rule, not a function.
- Supervisor counts as a leader in the UI (it already was manager-tier in the rules).
- Automation "never downgrade" read strictly: only potential/empty statuses change.
- The frontend calls new bridge actions and falls back to the old way when the live function answers "Invalid action", so dev works against the live backend.

## Dry runs done (read-only, 2026-11-18)
- `set-pool-setting.cjs`: pool user found, 542 clients on the pool, setting missing.
- `backfill-followup-client-agent.cjs`: 3,948 clients, 4,684 follow-ups, 4,575 to stamp, 109 whose client is gone.
- `seed-sales-aliases.cjs <local file>`: 14 aliases to add, live doc missing.

## Go-live runbook (owner, in this order)
Who is affected: every CRM user (sales lose global read; leaders unchanged), n8n (header-only key), accounting sync.

1. **Snapshot / backup.** `node scripts/backup-collections.cjs` (clients, followups, users, allowed_users, app_settings, sync_review).
2. **Check prerequisites.**
   - GitHub Secrets `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` exist (deploy.yml now reads host/user from secrets).
   - n8n sends the automation key in the `x-automation-secret` header, not in the body (the body key is rejected after step 5).
3. **Indexes first:** `firebase deploy --only firestore:indexes --project sg-crm-e3a38`; wait until all are built.
4. **Data before rules** (each: dry run, then `--execute` / `--apply`; journals in `~/backups`):
   - `node scripts/set-pool-setting.cjs --execute`
   - `node scripts/backfill-followup-client-agent.cjs --execute`
   - `node scripts/seed-sales-aliases.cjs <local alias file> --apply`
5. **Merge `hardening/2026-11` into `main`** (Cloud Build deploys the functions after the tests; the site deploys after the CI check). Then `firebase functions:delete geminiPredictSales --project sg-crm-e3a38`.
6. **Rules:** `GOOGLE_APPLICATION_CREDENTIALS=<key> node scripts/test-rules.cjs` (must be 94/94), then `firebase deploy --only firestore:rules --project sg-crm-e3a38`.
7. **Flip `INDEXES_LIVE = true`** in `pages/Notifications.tsx` (small follow-up commit).
8. **Verify:** as a sales agent: the clients list shows own + pool clients, "Assign to me" on a pool client works, a client page shows its full history, adding an existing phone shows the owner, closing the shift with pending AI items works; as a manager: `/sync-review` lists open bookings and the health card shows numbers; n8n executions succeed; one accounting booking syncs (integrationEvents).
9. **Later:** accounting sender adds `booking.updatedAt` and `customer.id`; n8n parses the ad code; repo private; PITR + daily export + budget alerts; email-verified gate after listing unverified accounts.

**Rollback:** rules: redeploy the previous `firestore.rules` from the old main (`git show <old-main>:firestore.rules`). Functions/site: `git revert` the merge on main and push. Data scripts: `--restore=<journal>`. Indexes are additive.
