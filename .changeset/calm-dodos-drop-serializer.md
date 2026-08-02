---
"@byline/core": minor
---

Removed the unsafe, unused collection serialization types and `toSerializableCollection()` helper. Runtime collection definitions are not wire contracts; future HTTP and MCP descriptors will use explicit allowlisted projections.
