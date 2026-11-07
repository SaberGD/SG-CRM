// Automatic personal follow-up every 2 weeks for booked clients. The logic lives with the
// Cloud Functions (the accounting sync uses it too); the web app uses the very same code.
export * from '../functions/autoFollowUp.mjs';
export type { AutoFollowUpState } from '../functions/autoFollowUp.mjs';
