# Mk.5 V1 QA Checklist

Scope: manual loop validation only. No inference; null stays silent.

## Manual Loop Checklist
- Discover: City -> District -> Plan
- Save plan
- Toggle Chosen and refresh: chosen persists
- Outcome:
  - Yes => completed=true, completedAt set
  - No => completed=false, completedAt cleared
  - Skip => completed=null, completedAt cleared
- Sentiment:
  - Good/Meh/Bad persist on refresh
  - Clear back to null persists as null
- Notes:
  - Add notes (<=280 chars) and refresh: persists
  - Clear notes: stored as null
- Saved Waypoints:
  - State indicators are quiet and correct
  - Provenance remains unchanged
  - Resume/Explore behave as before
- Hard refresh: signals remain correct

## Expected Results
- No new console errors
- No sorting/filtering/recommendations added
- Null values remain silent (no placeholder labels)
