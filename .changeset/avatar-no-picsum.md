---
"@byline/ui": patch
---

**`Avatar`** no longer loads a hardcoded placeholder photo from `picsum.photos`. New optional `src` and `alt` props (`alt` defaults to `initials`) render an image only when `src` is given; without one, no request is made and the initials show immediately.
