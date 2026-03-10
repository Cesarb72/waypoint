# Waypoint Freeze Note

## Certified State
- Branch: mk5/v1-signals
- Certified portability tag: phase-v-portable

## What is complete
Waypoint core is certified as:
- deterministic
- vertically portable
- host-agnostic
- acceptance-host validated

## Public core entrypoint
lib/core/index.ts

## Integrity checks
Run these to verify certified state:

npx tsx scripts/portability-integrity.ts  
npm run idea-date:integrity

Expected result:
- portability harness: OVERALL PASS
- idea-date integrity: pass

## Frozen / stable
- coordination core behavior
- public core entrypoint
- portability harness
- acceptance host proof
- concierge and local activation vertical proofs

## Intentionally deferred
- Phase VI toolkit definition
- B2B concierge packaging / Butler OS
- civic / ABCD layer
- marketing / business development
- ID.8 external product

## Handoff line to ID.8
ID.8 should consume Waypoint only through:

lib/core/index.ts

ID.8 should NOT import:
- lib/engine/**
- internal toolkit modules directly
- app-layer scaffolds
- test harness internals