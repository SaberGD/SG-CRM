const CHATWOOT_BASE_URL = 'https://chat.engsaber.space';
const CHATWOOT_ACCOUNT_ID = '2';

// client.chatId only ever stores the raw Chatwoot conversation id (see
// functions/index.js: upsertClientFromAutomation) -- this builds the actual
// dashboard URL to jump straight into that conversation.
export function buildChatwootConversationLink(chatId: string | number): string {
  return `${CHATWOOT_BASE_URL}/app/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${chatId}`;
}
