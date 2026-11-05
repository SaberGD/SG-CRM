// The search-key logic lives with the Cloud Functions (which keep every client's keys up
// to date); the web app uses the very same code.
export * from '../functions/searchKeys.mjs';
