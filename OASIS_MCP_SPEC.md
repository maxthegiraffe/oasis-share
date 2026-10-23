# Oasis MCP Server Specification

## Overview

This document specifies the infrastructure needed in the `maxthegiraffe/oasis` repo to enable the `/host` feature on grateful.gg. The goal is to let hosts connect their own Claude subscription to Oasis and build unlimited custom event pages.

**Key Constraint**: Hosts use THEIR OWN Claude tokens/subscription, not ours. We provide CRUD API access to their event data, nothing more.

---

## 1. MCP Server Endpoint

### Deployment

- **URL**: `https://mcp.grateful.gg/v1` (or similar stable endpoint)
- **Protocol**: Model Context Protocol (MCP)
- **Transport**: Server-Sent Events (SSE) or stdio based on MCP spec
- **Hosting**: Deploy on same infrastructure as app.grateful.gg (likely Vercel/Base44)

### Architecture

```
Claude Desktop (host's machine)
    ↓ MCP protocol
https://mcp.grateful.gg/v1
    ↓ validates API key
Oasis database (host-scoped queries only)
```

### Existing Code to Leverage

The user mentioned these files exist in the oasis repo:
- `base44/shared/hostConnectorTools.ts` – Host connector tools
- `pageGigi.ts` – Tools like `get_page`, `update_event`

**Action**: Wrap these existing tools in an MCP server. Use a Node.js MCP SDK (e.g., `@modelcontextprotocol/sdk`) to expose them.

---

## 2. Authentication & Authorization

### Per-Host API Keys

**Goal**: Each host gets a personal API key scoped only to their events.

#### UI Flow (in app.grateful.gg)

1. Host signs in to app.grateful.gg
2. Goes to **Settings → API & Integrations** (new section)
3. Clicks **"Generate Host Key"**
4. System generates a secure key (e.g., `oasis_host_abc123xyz...`)
5. Key is shown once with a copy button
6. Key is stored hashed in the database, associated with the host's user ID

#### Key Properties

- **Format**: `oasis_host_{random_32_chars}` (e.g., `oasis_host_7k3m9p2w5x8q1n4j6h8v9z2r4t7y`)
- **Scope**: Only events owned by that host (no cross-host access)
- **Permissions**: Read and write to their own events, RSVPs, announcements, etc.
- **Revocation**: Host can revoke keys in the UI at any time
- **Rotation**: Host can generate new keys (old ones expire after 30 days notice)

### MCP Authentication Flow

1. Claude Desktop prompts user for API key
2. User pastes their `oasis_host_*` key
3. Claude includes key in MCP requests (e.g., as Bearer token or MCP auth header)
4. Oasis MCP server validates key:
   - Is it valid and not revoked?
   - Which host does it belong to?
   - Scope all queries to that host's events

### Error Handling

- **401 Unauthorized**: Invalid or missing key
- **403 Forbidden**: Valid key, but trying to access another host's event
- **429 Too Many Requests**: Rate limit exceeded

---

## 3. MCP Tools to Expose

Based on the user's description and existing code, expose these tools:

### Event Management

#### `list_events`
- **Description**: Get all events for this host
- **Parameters**: `status` (optional: "upcoming", "past", "draft")
- **Returns**: Array of event objects with id, title, date, URL

#### `get_event`
- **Description**: Get detailed info for one event
- **Parameters**: `event_id` (string)
- **Returns**: Full event object (title, description, cover image, date, location, etc.)

#### `create_event`
- **Description**: Create a new event
- **Parameters**: `title`, `description`, `date`, `location`, `cover_image_url`, etc.
- **Returns**: New event object with generated ID and URL

#### `update_event`
- **Description**: Modify event details
- **Parameters**: `event_id`, fields to update
- **Returns**: Updated event object

### Ticket Management

#### `list_ticket_types`
- **Description**: Get all ticket types for an event
- **Parameters**: `event_id`
- **Returns**: Array of ticket objects (name, price, capacity, sales count)

#### `add_ticket_type`
- **Description**: Add a new ticket tier
- **Parameters**: `event_id`, `name`, `price` (or "free" or "sliding_scale"), `capacity`, `description`, `early_bird_until` (optional)
- **Returns**: New ticket type object

#### `update_ticket_type`
- **Description**: Modify ticket details (price, capacity, etc.)
- **Parameters**: `ticket_type_id`, fields to update
- **Returns**: Updated ticket object

### RSVP Management

#### `list_rsvps`
- **Description**: Get attendee list for an event
- **Parameters**: `event_id`, `ticket_type_id` (optional filter)
- **Returns**: Array of RSVP objects (name, email, ticket type, timestamp)

#### `get_rsvp_stats`
- **Description**: Summary stats (total RSVPs, revenue, breakdown by ticket type)
- **Parameters**: `event_id`
- **Returns**: Stats object

### Check-In

#### `generate_checkin_qr`
- **Description**: Create a QR code for door check-in
- **Parameters**: `event_id`
- **Returns**: QR code image URL and check-in portal URL

#### `list_checkins`
- **Description**: See who's checked in
- **Parameters**: `event_id`
- **Returns**: Array of checked-in attendees with timestamp

### Announcements

#### `send_announcement`
- **Description**: Email/SMS all attendees
- **Parameters**: `event_id`, `subject`, `message`, `send_via` ("email", "sms", "both")
- **Returns**: Confirmation (sent count)

#### `list_announcements`
- **Description**: See past announcements
- **Parameters**: `event_id`
- **Returns**: Array of announcement objects with timestamp

### Analytics

#### `get_analytics`
- **Description**: Event performance data
- **Parameters**: `event_id`
- **Returns**: Registration trends, revenue, ticket sales over time, etc.

---

## 4. Rate Limiting

### Per-Key Limits

- **100 requests/minute** per API key
- **10,000 requests/day** per API key

### Implementation

- Use middleware to track request counts per key
- Return `429 Too Many Requests` when limit exceeded
- Include `Retry-After` header with seconds until reset

### Monitoring

- Alert if any key hits rate limits repeatedly (possible abuse)
- Dashboard for admins to see API usage per host

---

## 5. Cost Controls

### Critical: No Server-Side LLM Costs

- **The MCP server ONLY provides CRUD data access**
- **It must NOT call OpenAI, Anthropic, or any LLM APIs on our dime**
- **Hosts bring their own Claude subscription – they pay for all AI inference**

Our costs are just:
- Hosting the MCP server (minimal – it's just API routing)
- Database queries (normal operational costs)

### What NOT to Build

- Don't add AI-powered event recommendations
- Don't auto-generate event descriptions with our LLM
- Don't train models on event data
- Don't provide "AI assistant" features that run on our infrastructure

**The intelligence comes from the host's Claude, not from us.**

---

## 6. Security Considerations

### Host Data Isolation

- All queries MUST be scoped to the host's user ID
- Use parameterized queries: `WHERE host_user_id = ?`
- Never trust `event_id` alone – always verify ownership first

Example:
```typescript
async function getEvent(eventId: string, hostUserId: string) {
  const event = await db.query(
    'SELECT * FROM events WHERE id = ? AND host_user_id = ?',
    [eventId, hostUserId]
  );
  if (!event) throw new Error('Event not found or unauthorized');
  return event;
}
```

### Input Validation

- Sanitize all user inputs (event titles, descriptions, etc.)
- Validate email addresses before sending announcements
- Rate limit announcement sends (e.g., max 1 per event per hour)

### API Key Storage

- Store keys hashed (bcrypt or similar)
- Never log full keys (only last 4 chars: `...xyz`)
- Require HTTPS for all MCP communication

---

## 7. Testing Plan

### Manual Testing with Juliet

Juliet runs the "Illuminate" event (Ecstatic Qigong + Tea at app.grateful.gg/illuminate). She's the perfect beta tester because she's already hit limitations with the current editor.

**Test Cases**:

1. **Generate API key** in app.grateful.gg
2. **Connect Claude Desktop** to MCP server with her key
3. **Ask Claude to create a new event** with:
   - Custom event page
   - 3 ticket types: Early Bird ($40), Regular ($55), Member Free
   - Sliding scale option for community members
4. **Ask Claude to send an announcement** to all attendees
5. **Ask Claude to generate a check-in QR code**
6. **Try to access another host's event** (should fail with 403)

### Automated Tests

- Unit tests for each MCP tool
- Integration tests for auth flow
- Load tests for rate limiting
- Security tests (injection, unauthorized access)

---

## 8. Deployment Checklist

- [ ] Create API key generation UI in app.grateful.gg
- [ ] Implement key storage (hashed) and revocation
- [ ] Build MCP server wrapping hostConnectorTools.ts
- [ ] Deploy MCP server at mcp.grateful.gg/v1
- [ ] Add rate limiting middleware
- [ ] Set up monitoring and alerts
- [ ] Test with Juliet (beta user)
- [ ] Update /host page to remove "Coming Soon" badges
- [ ] Document API for future hosts
- [ ] Announce feature to existing hosts

---

## 9. Future Enhancements (Post-Launch)

- **OAuth flow** instead of API keys (more secure, better UX)
- **Webhook subscriptions** (notify hosts when new RSVP comes in)
- **Bulk operations** (e.g., import attendees from CSV)
- **Analytics export** (download data as JSON/CSV)
- **Multi-host events** (co-hosted events shared between hosts)

---

## Questions for Oasis Team

1. **Does hostConnectorTools.ts already have these tools?** If so, we just need to wrap them in MCP.
2. **What's the current auth mechanism?** Is there already per-host access control?
3. **Where should we deploy the MCP server?** Same infra as app.grateful.gg?
4. **Any existing rate limiting?** Or do we need to build from scratch?
5. **Who owns the "illuminate" event?** Want to make sure Juliet is the right test user.

---

## Summary

The `/host` page is **ready to ship** once the oasis-side infrastructure is built. The spec above covers:

- MCP server deployment
- Per-host API key auth
- Tools to expose
- Rate limiting and cost controls
- Security requirements
- Testing plan

**Estimated effort**: 2-3 weeks for a senior full-stack engineer familiar with the Oasis codebase. The MCP protocol itself is straightforward – most of the work is in the auth/scoping logic and testing.

**Risk**: Low. We're just exposing existing tools via a new interface. No AI costs for us, since hosts bring their own Claude.

**Value**: Huge. Hosts like Juliet get unlimited power, and we offload support burden (they can solve their own problems by talking to Claude instead of filing tickets).
