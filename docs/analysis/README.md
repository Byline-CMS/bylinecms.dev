# Analysis Documents

This directory holds working analysis documents that capture architectural
decisions, open questions, phase boundaries, and design direction for Byline.

These documents are useful for:

- contributors evaluating the current shape of the project
- future implementation phases
- AI-assisted work that benefits from durable architectural context
- keeping exploratory and in-progress design thinking out of scattered issues
  or chat history

Current documents:

- [Storage analysis](./STORAGE-ANALYSIS.md)
- [Relationships analysis](./RELATIONSHIPS-ANALYSIS.md)
- [Routing and API analysis](./ROUTING-API-ANALYSIS.md)
- [Client in-process SDK analysis](./CLIENT-IN-PROCESS-SDK-ANALYSIS.md)
- [Core composition analysis](./CORE-COMPOSITION-ANALYSIS.md)
- [Collection versioning analysis](./COLLECTION-VERSIONING-ANALYSIS.md)
- [Document path analysis](./DOCUMENT-PATH-ANALYSIS.md)
- [AuthN / AuthZ analysis](./AUTHN-AUTHZ-ANALYSIS.md)
- [Access control recipes](./ACCESS-CONTROL-RECIPES.md)
- [Richtext editor adapter analysis](./RICHTEXT-ANALYSIS.md)
- [File / media upload analysis](./FILE-MEDIA-UPLOAD-ANALYSIS.md) — companion plan: [implementation plan](./FILE-MEDIA-UPLOAD-IMPLEMENTATION-PLAN.md)
- [Phases of work](./PHASES-OF-WORK.md)

These are intentionally working documents. Some describe shipped decisions,
some describe active design work, and some document deferred boundaries so the
project does not accidentally drift into them.

## Naming Convention

Use a lightweight naming rule for new analysis files:

- prefer uppercase kebab-case names ending in `-ANALYSIS.md`
- lead with the subject area, not the action or date
- keep names stable even if the document evolves across multiple phases

Examples:

- `AUTH-ANALYSIS.md`
- `MEDIA-PIPELINE-ANALYSIS.md`
- `QUERY-LAYER-ANALYSIS.md`

Avoid creating analysis filenames that are overly temporary, meeting-specific,
or date-specific unless the document is explicitly meant to be a dated record.
