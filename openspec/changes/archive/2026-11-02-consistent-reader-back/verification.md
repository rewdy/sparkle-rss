# Verification — 2026-11-02

Local Vite browser acceptance used dev authentication and intercepted API fixture
responses, not production data. Fifteen articles and a mixed Saved library exercised
real Shell, reader, list, card, Swipe, and image-preview components.

| Surface/action | Result |
| --- | --- |
| List and Cards: open, step twice, refresh, browser Back/Forward, reader Back, Escape | Returned directly to ascending All; Forward reopened final article |
| Swipe: same sequence from `/all/story/12?sort=asc` | Returned to the original story route after refresh and stepping |
| Read later: keyboard open, step, Escape | Returned directly to ascending Read later |
| Mixed Saved article j/k | Skipped image row; Escape returned to ascending Saved |
| Saved preview: refresh, Back/Forward, reader Back, Escape | Returned directly to ascending Saved; j did not navigate |
| Saved image removal | Replaced with Saved and cleared reader metadata |
| Direct article with prior browser history | Reader Back replaced with parent stream preserving sort |
| Missing article (fixture 404) | Replaced with parent stream preserving sort |
| Reader next/previous buttons | Replaced within session; reader Back returned directly |
| Sidebar and Settings followed by new article session | Returned to new origin, not old reader origin |

Automated coverage includes all three return actions with Forward, keyboard opening,
boundary no-ops, mark-on-open on/off, Read later endpoint choice, origin validation,
unrelated state preservation, invalid/legacy metadata, new-surface isolation, Saved
preview policy, and Swipe origin retention through stepping and remount.

Checks passed: 169 web tests across 20 files, workspace typecheck, Biome lint,
and production web build. OpenSpec strict validation and git diff whitespace checks pass.
No deployment or infrastructure changes.
