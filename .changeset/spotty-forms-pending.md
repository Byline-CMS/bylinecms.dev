---
"@byline/admin": patch
"@byline/i18n": patch
---

Showed a pending state while a document form saves, and kept the editor's keyboard position

The form marks itself busy for the whole in-flight save, with the Save button holding its width so the actions row no longer shifts. The busy announcement moved to a live region outside the inert subtree, where assistive technology can actually reach it, and focus is captured before the form goes inert and restored afterwards instead of being dropped onto the document body.
