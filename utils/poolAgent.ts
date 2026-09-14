// Account the automation falls back to when it can't tell which sales rep a
// conversation belongs to (see functions/index.js: getDefaultAutomationAgent).
// Clients still sitting under it are shown to every sales rep so any of them
// can claim one instead of it being stuck invisible on one shared account.
export const POOL_AGENT_EMAIL = 'sabergroup.eg@gmail.com';
