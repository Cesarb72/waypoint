# Plan Object (Waypoint V2)

This is the canonical data contract for Waypoint V2.  
A Plan is a **shared decision artifact**: an intention expressed as an ordered set of stops, constrained by reality, and framed for coordination.

If something is not defined here, it should not be added to the Plan Engine.

---

## Purpose

### What a Plan Object represents
A portable, serializable structure that can be:
- created and edited in the authoring surface
- rendered read-only in the sharable surface
- shared via link/QR/embed without backend dependencies
- duplicated and adapted for reuse

### What it explicitly does not represent
- a user account or identity system
- a social object (comments, likes, follows)
- a recommendation engine output
- a database record with server-enforced permissions
- a real-time collaborative document

---

## Schema (Conceptual)

### Plan (root)
Required fields:
- `id` (string): unique identifier
- `version` (string): schema version (e.g., "2.0")
- `title` (string): human-readable title
- `intent` (string): one-line purpose of the plan
- `audience` (string | enum): who this plan is for
- `stops` (Stop[]): ordered list of stops

Optional fields:
- `constraints` (Constraints)
- `signals` (Signals)
- `context` (Context)
- `presentation` (Presentation)
- `metadata` (Metadata)

---

### Stop
Required fields:
- `id` (string)
- `name` (string)
- `role` (StopRole): why this stop exists in the sequence
- `optionality` (Optionality): required vs flexible vs fallback

Optional fields:
- `location` (Location)
- `duration` (Duration)
- `notes` (string)

---

### Constraints
All optional; used to make reality explicit.
- `timeWindow` (string) — e.g., "2–4 hours", "6–9pm"
- `budgetRange` (string) — e.g., "Under $40/person"
- `mobility` (string) — e.g., "Walkable", "Transit-friendly"
- `energyLevel` (string) — e.g., "Low", "Medium", "High"
- `accessibility` (string) — e.g., "Stroller-friendly", "Step-free"

---

### Signals
All optional; lightweight indicators for alignment.
- `vibe` (string) — e.g., "Relaxed", "Lively", "Intimate"
- `flexibility` (string) — e.g., "Low", "Medium", "High"
- `commitment` (string) — e.g., "Tentative", "Likely", "Locked"

---

### Context
Optional, especially valuable for venues/community orgs.
- `occasion` (string) — e.g., "Pre-show"
- `season` (string) — e.g., "Winter", "Rainy day"
- `localNote` (string) — e.g., "Popular with locals after 8"

---

### Presentation
Controls how a plan is presented (not what it is).
Optional fields:
- `templateType` (string | enum) — e.g., "date-night", "family", "venue", "event"
- `branding` (Branding)
- `shareModes` (ShareMode[])

#### Branding (light only)
Optional fields:
- `name` (string)
- `logoUrl` (string)
- `accentColor` (string)

#### ShareMode
- "link"
- "qr"
- "embed"

---

### Metadata
Provenance and timestamps (no auth assumptions).
Optional fields:
- `createdBy` (string) — freeform label, not a user account
- `createdFor` (string) — freeform label
- `createdAt` (string, ISO)
- `lastUpdated` (string, ISO)

---

## Enumerations (Conceptual)

### StopRole
- `anchor` — main event / primary reason for the plan
- `support` — enables the anchor (meal, transition, buffer)
- `optional` — nice-to-have

### Optionality
- `required`
- `flexible`
- `fallback`

---

## Non-Goals (Explicitly Out of Scope)

- Authentication / accounts
- Permissions / roles
- Comments / reactions
- Ratings / reviews
- Social graphs / feeds
- Real-time collaboration
- Analytics hooks
- Monetization

---

## Design Principles

- **Portable:** the plan can travel across channels without losing meaning
- **Serializable:** the plan can be encoded into a URL/QR and restored safely
- **Readable:** the plan is understandable when rendered without explanation
- **Extensible by addition:** new fields can be added without breaking old plans
- **No mutation pressure:** templates and presentation never alter the schema
