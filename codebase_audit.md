# ARCHI Negotiator-Core — Depth-First Audit

**Method:** Automated variable-level scan of all 37 JS/JSX files + manual line-by-line confirmation of every flagged finding.  
**Checks:** undeclared variable usage, unused imports, missing auth headers on internal fetches, unguarded `.single()` calls, env var null guards, OPTIONS preflight handling, requireAuth coverage.

---

## 🔴 CRITICAL — Confirmed Production Crashes

### CRASH-1: `pattern-decay.js` — Undeclared `supabase` Variable (2 Sites)

**File:** [`pattern-decay.js`](file:///c:/Users/jdqui/Desktop/Negotiator-Core/netlify/functions/pattern-decay.js)  
**Lines:** 69 and 105  
**Status:** NOT FIXED — slipped through the previous audit

The file correctly uses `getDB()` for most queries, but two `.catch()` fallback paths forgotten during the BUG-5 refactor still reference `supabase` which is never declared or imported:

```js
// Line 69 — fallback inside the decay batch
return supabase.from('learned_patterns')   // ← TypeError: supabase is not defined
    .update({ confidence_score: ... }).eq('id', p.id)

// Line 105 — boost batch
return supabase.from('learned_patterns')   // ← same crash
    .update({ confidence_score: ..., last_validated_at: ... }).eq('id', p.id)
```

**Impact:** The primary RPC paths (lines 34, 58) work fine. But if either RPC is unavailable and the function falls back to the manual batch, it crashes immediately. Given that `decay_stale_patterns` and `batch_decay_patterns` are custom RPCs that may not be deployed yet, this crash path is likely always taken — meaning pattern decay and pattern boost have never worked.

**Fix:** Replace both `supabase.from(...)` with `getDB().from(...)`.

---

### CRASH-2: `VoiceNegotiator.jsx` — Undeclared `supabase` at Line 671

**File:** [`VoiceNegotiator.jsx`](file:///c:/Users/jdqui/Desktop/Negotiator-Core/src/components/VoiceNegotiator.jsx#L671)  
**Line:** 671  
**Status:** NOT FIXED — introduced during ElevenLabs migration or leftover from Hume refactor

```js
supabase.from('email_threads').select('id, counterparty_email, subject')
    .then(({ data }) => setThreads(data || []))
```

`VoiceNegotiator.jsx` does NOT import or declare `supabase` anywhere. The ElevenLabs migration removed Hume imports but left this orphaned reference.

**Impact:** Crashes on render or on the code path that loads the thread list for voice context. Results in `TypeError: supabase is not defined` visible to the user as a blank voice panel.

**Fix:** Import from `../api/supabaseClient` OR replace with an `apiFetch` call. Since this is a read of thread data, importing supabase is correct here.

---

## 🟠 HIGH — Will Silently Fail or Create Inconsistent State

### HIGH-1: 4 Internal `fetch()` Calls Missing `Authorization` Header

These functions call other Netlify functions via HTTP without passing the auth header. Since `requireAuth()` was added to all functions, these internal calls get 401 rejected silently, and their responses are ignored because they're fire-and-forget or the error isn't propagated correctly.

| File | Line | Calls | Impact |
|------|------|-------|--------|
| [`email-inbound.js`](file:///c:/Users/jdqui/Desktop/Negotiator-Core/netlify/functions/email-inbound.js#L520) | 520 | `research-counterparty` | Counterparty research never runs — ARCHI negotiates blind forever |
| [`email-inbound.js`](file:///c:/Users/jdqui/Desktop/Negotiator-Core/netlify/functions/email-inbound.js#L920) | 920 | `email-send` | Autonomous email sends never fire (now fixed with auth header) |
| [`initiate-negotiation.js`](file:///c:/Users/jdqui/Desktop/Negotiator-Core/netlify/functions/initiate-negotiation.js#L134) | 134 | `research-counterparty` | Same — research silently fails on every outbound negotiation start |
| [`bulk-ingest-books.js`](file:///c:/Users/jdqui/Desktop/Negotiator-Core/netlify/functions/bulk-ingest-books.js#L510) | 510 | `process-knowledge` | Book ingest inserts rows but never triggers pattern extraction |

**Fix for all 4:**
```js
headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.ARCHI_API_KEY}`,
},
```

---

### HIGH-2: 16 Unguarded `.single()` Calls Will Crash on Empty Results

Supabase's `.single()` throws an error and returns `{ error: ... }` if 0 or 2+ rows match. None of these calls handle that case — they silently get `null` data and then subsequently crash trying to access properties on `null`.

**Most critical (no error variable destructured at all):**

| File | Line | Query | What Breaks |
|------|------|-------|-------------|
| [`email-inbound.js`](file:///c:/Users/jdqui/Desktop/Negotiator-Core/netlify/functions/email-inbound.js#L389) | 389 | `sessions.insert().select().single()` | New thread creation — crashes if insert fails |
| [`email-inbound.js`](file:///c:/Users/jdqui/Desktop/Negotiator-Core/netlify/functions/email-inbound.js#L393) | 393 | `email_threads.insert().select().single()` | Same — kills the entire webhook |
| [`negotiate.js`](file:///c:/Users/jdqui/Desktop/Negotiator-Core/netlify/functions/negotiate.js#L188) | 188, 197 | world_model + session | Whole negotiate call crashes if session ID not found |
| [`negotiation-reflect.js`](file:///c:/Users/jdqui/Desktop/Negotiator-Core/netlify/functions/negotiation-reflect.js#L29) | 29, 37, 135 | outcomes + thread | Reflection crashes on any missing record |
| [`voice-session.js`](file:///c:/Users/jdqui/Desktop/Negotiator-Core/netlify/functions/voice-session.js#L151) | 151, 244 | voice session + thread | Voice session fetch crashes |
| [`initiate-negotiation.js`](file:///c:/Users/jdqui/Desktop/Negotiator-Core/netlify/functions/initiate-negotiation.js#L128) | 128, 180 | thread + email insert | Outbound negotiation start crashes |

**Fix pattern** — replace `.single()` with `.maybeSingle()` for queries that may return no data, and handle the null case:
```js
const { data, error } = await getDB().from('table').select().maybeSingle()
if (error) throw new Error(error.message)
if (!data) return { statusCode: 404, ... }
```

---

### HIGH-3: `elevenlabs-token.js` — No `requireAuth()` 

**File:** [`elevenlabs-token.js`](file:///c:/Users/jdqui/Desktop/Negotiator-Core/netlify/functions/elevenlabs-token.js)

This endpoint is completely public. Anyone who knows your Netlify URL can call `/.netlify/functions/elevenlabs-token` repeatedly and generate unlimited signed WebSocket URLs, exhausting your ElevenLabs credits.

**Fix:** Add `const authErr = requireAuth(event); if (authErr) return authErr` at the top of the handler.

---

### HIGH-4: `training-gym.js` → `simulate.js` Missing Auth Header

**File:** [`training-gym.js`](file:///c:/Users/jdqui/Desktop/Negotiator-Core/netlify/functions/training-gym.js#L63)  
**Line:** 63

```js
const simResponse = await fetch(`${process.env.URL}/.netlify/functions/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },  // ← no auth header
```

Every Training Gym simulation call silently returns 401 from `simulate`. The gym appears to run but no simulation actually processes. All `simResponse` checks will be `!simResponse.ok`.

**Fix:** Same as HIGH-1 — add `Authorization: Bearer ${process.env.ARCHI_API_KEY}` to the fetch headers.

---

### HIGH-5: `negotiate_clean.js` Is a Stale Duplicate of `negotiate.js`

**File:** [`negotiate_clean.js`](file:///c:/Users/jdqui/Desktop/Negotiator-Core/netlify/functions/negotiate_clean.js)

This file is an exact copy of `negotiate.js`. It's deployed to Netlify as `/.netlify/functions/negotiate_clean` — a public endpoint exposing your full negotiation engine with the same bugs. It also means any bug fixed in `negotiate.js` must be manually replicated here.

**Fix:** Delete `negotiate_clean.js`. It's dead weight and a security liability.

---

## 🟡 MEDIUM — Design and Security Issues

### MED-1: `ELEVENLABS_API_KEY` — No Null Guard

**File:** [`elevenlabs-token.js`](file:///c:/Users/jdqui/Desktop/Negotiator-Core/netlify/functions/elevenlabs-token.js#L13)

```js
const apiKey = process.env.ELEVENLABS_API_KEY  // no null check
```

If the key isn't set, the API call proceeds with `undefined` as the key, returns a 401 from ElevenLabs, but the function propagates no useful error to the client. Voice fails silently.

**Fix:**
```js
if (!process.env.ELEVENLABS_API_KEY) {
    return errResponse(serviceError('elevenlabs', 'ELEVENLABS_API_KEY not configured'))
}
```

---

### MED-2: `hume-token.js` — No `requireAuth()`

**File:** [`hume-token.js`](file:///c:/Users/jdqui/Desktop/Negotiator-Core/netlify/functions/hume-token.js)

Hume is no longer the primary voice provider but this endpoint is still deployed and public. Anyone can call it to check your Hume API key validity or exhaust Hume API credits.

**Fix:** Add `requireAuth()` or delete the file if Hume is fully deprecated.

---

### MED-3: `VoiceNegotiator.jsx` — Deprecated `createScriptProcessor`

This was flagged in the first audit and is still present. Chrome shows deprecation warnings on every voice session. The Web Audio Worklet migration should be tracked.

---

### MED-4: `voice-session.js` — Unused Import

```js
import { NEGOTIATION_PLAYBOOK } from './negotiationPlaybook.js'  // never used
```

**File:** [`voice-session.js`](file:///c:/Users/jdqui/Desktop/Negotiator-Core/netlify/functions/voice-session.js#L8), line 8.

---

### MED-5: `email-inbound.js` — Unused Import

```js
import { ..., MODEL_SONNET } from './fnUtils.js'  // MODEL_SONNET never used
```

`MODEL_HAIKU` is used throughout. `MODEL_SONNET` is imported but never referenced. Either a prompt upgrade was planned but not implemented, or it's dead code.

---

### MED-6: `research-counterparty.js` — Unused Import

```js
import { ..., errResponse } from './fnUtils.js'  // errResponse never used
```

---

## 🔵 CODE QUALITY — Design Debt

### CQ-1: `worldModel.js` Uses Anon Key Client on DB Operations

**File:** [`src/api/worldModel.js`](file:///c:/Users/jdqui/Desktop/Negotiator-Core/src/api/worldModel.js)

This file imports `supabase` from `supabaseClient.js` (anon key client) and performs direct DB writes to `world_model`. If called from the frontend, it bypasses service role key. If `world_model` has RLS enabled, these writes will silently fail.

**Real risk depends on RLS:** If `world_model` has RLS disabled, this works but is insecure. If RLS is enabled, updates silently fail.

**Fix:** All `world_model` writes should go through the backend API (`/api/negotiate`), not direct frontend Supabase calls.

---

### CQ-2: No OPTIONS Preflight Handling on Any Function

Every Netlify function lacks an OPTIONS handler for CORS preflight. Browser `fetch()` with custom headers (like `x-archi-api-key`) triggers a preflight. Without an OPTIONS handler, all cross-origin API calls from the React app fail in modern browsers.

This works in `netlify dev` because of the dev server proxy, but fails on the deployed domain if the React app is served from a CDN subdomain.

**Fix:** Add to every handler:
```js
if (event.httpMethod === 'OPTIONS') return handleOptions()
```
Or configure Netlify `_headers` file for function-wide CORS.

---

### CQ-3: `EmailNegotiator.jsx` Creates Its Own `supabase` Client

Line 8-11 creates a new `createClient()` directly instead of importing from `src/api/supabaseClient.js`. This creates a second client instance. While not a crash, it bypasses any session sharing or connection pooling the shared client provides.

---

## Summary Table

| # | File | Severity | Line(s) | Issue |
|---|------|----------|---------|-------|
| 1 | `pattern-decay.js` | 🔴 CRASH | 69, 105 | `supabase` undeclared — RPC fallback crashes |
| 2 | `VoiceNegotiator.jsx` | 🔴 CRASH | 671 | `supabase` undeclared — voice thread load crashes |
| 3 | `email-inbound.js` | 🟠 HIGH | 520 | Fire-and-forget to `research-counterparty` missing auth |
| 4 | `initiate-negotiation.js` | 🟠 HIGH | 134 | Fire-and-forget to `research-counterparty` missing auth |
| 5 | `bulk-ingest-books.js` | 🟠 HIGH | 510 | Call to `process-knowledge` missing auth |
| 6 | `training-gym.js` | 🟠 HIGH | 63 | Call to `simulate` missing auth — Training Gym broken |
| 7 | 11 backend files | 🟠 HIGH | various | 16 unguarded `.single()` calls |
| 8 | `elevenlabs-token.js` | 🟠 HIGH | — | No `requireAuth()` — public endpoint |
| 9 | `negotiate_clean.js` | 🟠 HIGH | — | Stale duplicate of negotiate.js — delete it |
| 10 | `elevenlabs-token.js` | 🟡 MED | 13 | No ELEVENLABS_API_KEY null guard |
| 11 | `hume-token.js` | 🟡 MED | — | No `requireAuth()` — stale public endpoint |
| 12 | `voice-session.js` | 🟡 MED | 8 | Unused import `NEGOTIATION_PLAYBOOK` |
| 13 | `email-inbound.js` | 🟡 MED | 12 | Unused import `MODEL_SONNET` |
| 14 | `research-counterparty.js` | 🟡 MED | 9 | Unused import `errResponse` |
| 15 | All functions | 🔵 CQ | — | No OPTIONS preflight handlers |
| 16 | `worldModel.js` | 🔵 CQ | — | Anon key client doing backend DB writes |
| 17 | `EmailNegotiator.jsx` | 🔵 CQ | 8 | Duplicate `supabase` client creation |

---

## Priority Fix Order

1. **CRASH-1** — `pattern-decay.js` lines 69+105 → `getDB().from(...)`
2. **CRASH-2** — `VoiceNegotiator.jsx` line 671 → import supabase
3. **HIGH-1** — Add auth headers to the 4 internal `fetch()` calls
4. **HIGH-4** — `training-gym.js` → `simulate` auth header (Training Gym completely broken)
5. **HIGH-3** — `elevenlabs-token.js` requireAuth
6. **HIGH-5** — Delete `negotiate_clean.js`
7. **HIGH-2** — Convert critical `.single()` calls to `.maybeSingle()` in `negotiate.js`, `email-inbound.js`, `voice-session.js`
