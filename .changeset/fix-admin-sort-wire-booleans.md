---
'@byline/host-tanstack-start': patch
---

Fix admin sort direction and header indicators in applications whose router preserves URL search values as strings. Explicitly parse `desc=false` as ascending in collection lists, admin-user lists, and collection/singleton history instead of treating the non-empty string as true.
