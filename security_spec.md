# Security Specification for SABER GROUP CRM

## Data Invariants
1. **Users**: A user document must exist for every authenticated user. Role must be one of: `admin`, `manager`, `team_leader`, `sales_agent`. Admins can manage all users.
2. **Clients**: Every client must have a `salesAgentId`. Access is restricted based on role:
   - Admins/Managers/Team Leaders: Global read access.
   - Sales Agents: Access only to clients where `salesAgentId == request.auth.uid`.
3. **Follow-ups**: Belongs to a client and an agent. Same visibility as the client.
4. **Reports**: Daily reports for agents.
   - Agents: Read/Write only their own reports.
   - Managers/Admins: Read all reports.
5. **Logs**: Audit trail.
   - High roles: Read all logs.
   - Agents: Restricted access.
6. **Invitations**: Used for onboarding.
7. **Services & Labels**: Global read for all authenticated users.

## The "Dirty Dozen" Payloads (Red Team Test Cases)
1. **Identity Spoofing**: Attempt to create a client with a `salesAgentId` of another user.
2. **Privilege Escalation**: A Sales Agent attempting to update their own `role` to `admin`.
3. **Information Disclosure**: A Sales Agent attempting to `list` all clients without a `where` filter.
4. **Data Tampering**: Updating a client's `createdAt` field.
5. **Orphaned Writes**: Creating a `followup` for a non-existent `clientId`.
6. **Shadow Update**: Adding a `secretField: true` to a user profile update.
7. **Bypassing State Lock**: Changing a report's `submittedAt` after it's been sent.
8. **PII Leak**: A non-admin attempting to `get` another agent's private profile data (if any).
9. **Query Scraping**: Attempting to list all `transfers` without the required role.
10. **Resource Exhaustion**: Sending a 1MB string as a client `name`.
11. **Timestamp Spoofing**: Sending a client-side timestamp for `updatedAt` instead of `request.time`.
12. **Relationship Breach**: Deleting a client that still has associated `followups` (if rules enforce consistency).

## Test Runner (Planned)
The `firestore.rules.test.ts` will verify that these payloads result in `PERMISSION_DENIED`.

## Critical Path Fixes
- Ensure `allow list` explicitly checks `resource.data`.
- Add `isValidId` and size checks to all strings.
- Implement action-based updates for `clients` and `reports`.
- Block unauthorized reads on `users` collection.
