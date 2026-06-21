# Email notifications plan

This document captures the runtime behaviour of the email-notification
pipeline for milestone events (issue #6). The goal is to keep domain code
free of any knowledge about email, while still emitting well-typed events
that the notifications module can subscribe to.

## Architecture

```
AgreementsService.updateMilestone()
        │
        │ emits
        ▼
@nestjs/event-emitter (in-process bus, EventEmitter2)
        │
        │ @OnEvent listeners
        ▼
NotificationsService.notifyMilestoneApproved()
NotificationsService.notifyEvidenceSubmitted()
        │
        ▼
Resend (HTML email) ──► participant inbox
```

*The domain code (AgreementsService) never sends an email and never knows
that emails exist. If you add a new listener tomorrow (e.g. a Discord
notification), it just registers `@OnEvent(AgreementEventName.MilestoneApproved)`
somewhere else; AgrementsService keeps working unchanged.*

## Issue #6 — Emit milestone events

This PR implements **issue #6** from the GrantFox OSS epic:

1. `AgreementsService.updateMilestone()` emits:
   - `AgreementEventName.MilestoneApproved` when `dto.status === "approved"`,
     enriched with `agreementId`, `agreementTitle`, `milestoneIndex`,
     `milestoneDescription`, `milestoneAmount`, `asset`, `approvedByWallet`,
     `approvedByName`.
   - `AgreementEventName.EvidenceSubmitted` whenever the caller attaches
     evidence (`evidence_description` and/or `evidence_url`), regardless of
     status, with `agreementId`, `agreementTitle`, `milestoneIndex`,
     `milestoneDescription`, `submittedByWallet`, `submittedByName`,
     `evidenceDescription`.
2. `UpdateMilestoneDto` is extended with **optional** `evidence_description`,
   `evidence_url`, and `submitter_name` fields (backward compatible).
3. Evidence is also persisted onto the milestone slice itself so consumers
   reading the agreement see the latest evidence without replaying the
   activity log.
4. Both emissions are wrapped in a defensive `try/catch` in
   `AgreementsService.safeEmit()` (sync) and in the `@OnEvent` async
   handlers in `NotificationsService`. A failing email send therefore
   **never** breaks the originating domain action.

## How to reproduce locally

### 1. Bootstrap a Supabase project

Apply the migrations in `scripts/` so the tables `agreements`,
`agreement_participants`, `agreement_activity`, `profiles`, `auth_users`
exist and a wallet-linked record is present (used as the actor).

### 2. Configure the backend

Copy `.env.example` to `.env.local` and fill at least:

```
SUPABASE_URL=https://YOUR.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
JWT_SECRET=...                       # same as the frontend
THALOS_INTERNAL_SECRET=...           # used by Next -> Nest relay
RESEND_API_KEY=re_xxx                # optional; emails are skipped if unset
PORT=3001
```

### 3. Install and start

```bash
pnpm install
pnpm run start:dev
```

The first boot logs:

```
Nest application successfully started
[NotificationsService] Resend email client initialized
[AgreementEventsListener] Emitting test event "agreement.created" to verify the event bus
[AgreementEventsListener] Received "agreement.created": {"agreementId":"test-agreement-id",...}
```

That confirms the in-process bus is wired.

### 4. Trigger a milestone update

See [`samples/milestone-events.http`](./samples/milestone-events.http)
for ready-to-run curl snippets (you can also open the file in VS Code with
the REST Client extension). Two flows are exercised:

- **Approve a milestone** → server emits `milestone.approved` → all
  participants with email in `profiles` receive "Milestone Approved".
- **Submit evidence** → server emits `evidence.submitted` → all
  participants receive "Evidence Submitted".

### 5. Verify in Resend

Open the Resend dashboard (`https://resend.com/emails`) and confirm both
emails were sent, then check the recipient inbox.

### 6. Verify failure isolation

Temporarily set `RESEND_API_KEY` to an invalid value and re-run step 4:

```
RESEND_API_KEY=re_invalid_key
```

The PATCH call *still* returns `{ success: true }` and the milestone is
still updated in Supabase. The server logs a Resend error but does not
return 500 or roll back the change. This is what the DoD refers to as
*"A failing email never breaks the originating domain action"*.

## Event-name constants

All event names are centralised in
[`src/events/agreement-events.ts`](../src/events/agreement-events.ts).
Domain code never types a string literal like `"milestone.approved"` — it
always uses `AgreementEventName.MilestoneApproved`. The DoD requires
this and lint will fail if any stray string literal sneaks in.
