# Automation contract: `upsertClientFromAutomation`

The n8n idle-conversation workflow (Chatwoot conversation -> Claude extraction) sends one
request per conversation. The function creates or updates one CRM client and writes one
follow-up. Code: `functions/index.js` (handler) and `functions/automationUpsert.js` (rules,
unit-tested in `functions/automationUpsert.test.js`).

## Request

- Method: `POST`, body: JSON object.
- Auth: header `x-automation-secret` with the automation key (kept in the n8n credential only;
  the code checks its SHA-256). **The key in the JSON body (`automationSecret`) is no longer
  accepted.**
- Every field is optional unless stated otherwise. Text longer than its limit is cut to the
  limit. Fields not listed here are ignored.
- Rejected with `400 { error }`: body not an object, body over 100,000 characters, a text
  field over 20,000 characters, a list over 100 items, or a field of the wrong type.

| Field | Type | Limit | Meaning |
|---|---|---|---|
| `customer_phone` | string or number | 32 | Phone in any format. Required, except for a non-WhatsApp source that sends `chatwoot_contact_id`. |
| `country_code` | string | 6 | `+20` style (digits with or without `+`). Default `+20`. |
| `customer_name` | string | 120 | Placeholders (`unknown`, `user`, `غير معروف`, ...) are ignored. |
| `position` | string | 120 | Job or study, only stored when the client has none. |
| `governorate`, `city` | string | 60 each | Only stored when the client has none. |
| `sales_brief` | string | 2000 | Short summary for the salesperson. |
| `detailed_result` | string | 2000 | Longer result, used as the follow-up note. |
| `suggested_status` | string | 40 | `interested`, `potential`, `not_interested` or `booked` (booked only flags `bookedMentioned`). |
| `suggested_labels` | string[] | 20 items of 60 | Matched against the CRM labels by text. |
| `suggested_service` | string | 120 | Matched against the active services by name. |
| `next_followup_date` | string or number | 64 | ISO date/time, or unix seconds/milliseconds. |
| `next_followup_channel` | string | 40 | `phone`, `whatsapp`, `meeting` or `other` (default `whatsapp`). |
| `next_followup_reason` | string | 500 | Why the date was set. |
| `missing_or_ambiguous_fields` | string[] | 20 items of 80 | `next_followup_date_suggested_not_explicit` marks the date as the AI's own suggestion. |
| `distinctive_search_phrase` (or `search_phrase`, `meta_search_phrase`) | string | 280 | Phrase to find the chat later. |
| `has_meaningful_content` | boolean | | `false` -> the conversation is skipped. |
| `source` | string | 40 | `whatsapp`, `messenger`, `facebook`, `instagram`, `tiktok`, `google` or `other`. |
| `gender` | string | 20 | `male`, `female` or `unspecified`. |
| `has_laptop` | string | 20 | `with`, `without` or `unspecified`. |
| `attendance_mode` | string | 20 | `online`, `offline` or `unspecified`. |
| `sales_rep_name` | string | 120 | Who handled the chat; mapped to a CRM user (see "Sales names"). |
| `profile_link`, `chatwoot_conversation_link` | string | 500 each | Links. |
| `chatwoot_conversation_id` (or `conversation_id`) | string or number | 64 | Used for the once-per-conversation claim. |
| `chatwoot_contact_id` | string or number | 64 | Chatwoot contact. |
| `last_contact_at` (or `last_followup_date`, `last_followup_at`, `last_contacted_at`, `last_message_at`, `chatwoot_last_activity_at`) | string or number | 64 | Time of the latest message. A conversation is processed again only when this is newer. |
| `automation_mode` (or `run_mode`) | string | 40 | Free label stored on the claim (default `hourly`). |
| `ad_code` | string | 20 | **New.** Ad code from the start of the customer's first message (convention: one letter N/O/F/P + digits, e.g. `N12`). Trimmed and uppercased; anything not matching 1-3 letters + 1-4 digits is ignored. |
| `first_message_at` | string or number | 64 | **New.** Time of the customer's first message (ISO or unix s/ms). Ignored when before 2020 or more than a day in the future. |

## What the function does

- **Never** sets booked, money or payment fields.
- **Status:** a new client gets the suggestion (`booked` -> `potential`). An existing client
  that is `booked`, `isBooked`, `not_interested` or `interested` is never changed (no
  downgrade). Only a `potential` (or empty) client may move to the suggestion.
- **Follow-up date:** `nextFollowUpDate` is written only when `next_followup_date` is explicit
  (not marked suggested) **and in the future**; it is then queued for the agent's Accept
  (`nextFollowUpReviewedBySales: false`, `nextFollowUpSetVia: "ai_automation"`). A suggested
  or past date is stored only as
  `automationSuggestedFollowUp: { at, channel, reason: "suggested" | "past", note, receivedAt }`
  and `nextFollowUpDate` is left as it was (`0` on a new client).
- **Finding the client:** same conversation (`chatId`), then `phoneKey` (last 10 digits),
  then `phoneKeys`, then the old raw-phone variations (legacy clients), then
  `chatwootContactId`. With several matches the oldest client (`createdAt`) is used and the
  claim records `dedupe: { ambiguous, pickedClientId, candidateIds }`; a new client is never
  created next to them. `phoneKey` / `phoneKeys` are written on new clients and filled in on
  legacy ones.
- **Attribution (first touch wins):** `adCode` and `firstMessageAt` are stored on the client
  only when it has none yet. The follow-up carries `adCode` (this conversation's code, else
  the client's).
- **Follow-up doc:** also carries `clientAgentId` (the client's `salesAgentId` when written).
- **Sales names:** `sales_rep_name` is matched to an active CRM user: exact name / e-mail
  first, then whole-word prefix, then shared words. Spelling differences between systems are
  mapped in the Firestore doc `app_settings/salesNameAliases` (seeded with
  `scripts/seed-sales-aliases.cjs` from a local file). When nobody matches, or two users
  match equally, the default automation agent is used.
- **Meta:** a new client with a phone sends a Lead event with the hashed phone and a generic
  `content_name` (never the client's name).

## Response

| Case | Status | Body |
|---|---|---|
| New client | 200 | `{ success: true, action: "created_new", clientId, bookedMentioned }` |
| Existing client | 200 | `{ success: true, action: "updated_existing", clientId, bookedMentioned }` |
| Skipped | 200 | `{ success: true, action: "skipped", reason: "conversation_already_processed" \| "not_meaningful" \| "no_phone", clientId?, note_for_agent? }` |
| Bad payload | 400 | `{ error: "Invalid payload: <reason>" }` |
| Bad or missing key | 401 | `{ error: "Unauthorized" }` |
| Not POST | 405 | `{ error: "Method not allowed" }` |
| Server error | 500 | `{ error }`. The claim is marked `failed`, so a retry processes the conversation again. |
