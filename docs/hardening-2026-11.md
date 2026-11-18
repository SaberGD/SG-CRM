# SG-CRM hardening, November 2026

Source: the audit of 2026-11-17 (14 axes). Work branch `hardening/2026-11` (from live `main`),
functions work on `hardening/2026-11-functions` (merged into it), then merged into `dev`.
Nothing here is deployed: the rules, indexes, functions and the site go live only with the owner's OK
(see the runbook at the end).

Status: [x] done · [ ] not done yet · [-] skipped (reason given)

## Checklist

### 0. Base
- [x] Merge `fix/ai-cost-guards` (Claude instead of Gemini, daily caps, usage counters, fallbacks marked and never saved). Main's SHA-256 automation key check kept; no AUTOMATION_SECRET or Gemini key in Cloud Build.
- [x] `npx tsc --noEmit` green (ErrorBoundary typing).

### 1. Rules (firestore.rules + scripts/test-rules.cjs)
- [x] allowed_users / invitations: non-admin leaders grant, change or remove `sales_agent` only.
- [ ] Deactivate / delete user also deactivates `allowed_users/{email}` (AdminPanel).
- [x] logs create requires `userId == auth.uid` (admins and the server excepted).
- [x] Shift owner limited to: open now, start now, break on/off (append only), end now, link report.
- [x] Client create blocks accounting*/aiRecommendation fields.
- [x] Sales read own + pool clients/follow-ups; leaders full read.
- [ ] Duplicate-phone check behind a function (`phoneCheck` bridge action) with fallback.
- [x] "Assign to me" from the pool: narrow rule + own claim transfer record.
- [x] Rules tests extended (92 cases, all pass against the Rules API test endpoint, nothing deployed).

### 2. Automation (upsertClientFromAutomation)
- [ ] Dedupe by phoneKey.
- [ ] Suggested / past follow-up dates stored only as a suggestion.
- [ ] Never downgrade interested -> potential.
- [ ] Key only in the header; length limits.

### 3. Accounting ingest
- [ ] Deterministic client creation + phoneKey lock.
- [ ] Older payloads ignored.
- [ ] sync_review page "حجوزات محتاجة ربط" (10 per page) + `linkSyncReview`; ingest honours `resolvedClientId`.
- [ ] Integration health card.

### 4. Daily flow
- [ ] EndShiftModal never blocks closing.
- [ ] Follow-up save in one batch with a saving guard (ClientDetails, ManualFollowUpModal; no money on accounting-linked clients).
- [ ] AcceptFlowModal rebuilds searchKeys/phoneKey; local datetime prefill.
- [ ] "Check" button only for managers.
- [ ] tel: / wa.me buttons on the client page.
- [ ] TodayWork cache invalidated on return.
- [ ] One overdue definition.

### 5. Transfers and import
- [ ] Bulk transfer chunked (<=400 per batch), record after commit.
- [ ] AdminPanel transfers through the same helper, with history.
- [ ] Bulk import builds searchKeys/phoneKey.

### 6. Build, CI, hygiene
- [ ] Remove server.ts / express / Gemini deps and the vite GEMINI define; CI builds with `npx vite build`.
- [ ] CI job: tsc + vite build + functions tests, deploy needs it.
- [ ] maxInstances; geminiPredictSales removed if dead.
- [ ] One utils/roles.ts; one phone helper.
- [ ] allClientsStore cleared on sign-out / account change.
- [ ] Chunk-reload guard.

### 7. Public tree
- [ ] FTP host/user lines out of DEPLOYMENT_NOTES.md.
- [ ] Staff alias table out of the code.
- [ ] Other server details.

### 8. Reports and ad code
- [ ] Income label "مدفوع على حجوزات النهارده".
- [ ] adCode / firstMessageAt on the upsert contract, client page and report.

## Decisions taken (owner delegated)
- Sales read scope: own + pool. The pool account's uid is read by the rules from
  `app_settings/pool { uid }` (script `scripts/set-pool-setting.cjs`), so no uid is hard-coded.
- Follow-ups carry `clientAgentId` (the client's owner when written, re-stamped on transfer); sales
  read follow-ups they wrote or whose `clientAgentId` is theirs / the pool. Old follow-ups get it from
  a backfill script (dry-run first).
- "Assign to me" is a narrow rule, not a function (no extra deploy unit).
