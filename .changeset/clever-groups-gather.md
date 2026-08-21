---
'@byline/core': minor
'@byline/host-tanstack-start': minor
'@byline/i18n': minor
---

added admin dashboard collection groups: declare an ordered `AdminConfig.collectionGroups` registry of `{ name, label }` and join collections to it with `CollectionAdminConfig.group`, and the dashboard renders each group under its label with ungrouped collections in a leading heading-less band. Group names are boot-validated — duplicate names, blank names or labels, and references to an undeclared group all throw at startup. The registry is optional and omitting it keeps the existing flat dashboard, so the configuration surface is additive and non-breaking.

Dashboard cards are now filtered to the collections the signed-in administrator can read. **This changes behaviour for existing installations:** an administrator without `collections.<path>.read` previously saw that collection's card with every status tile showing `0` — indistinguishable from a genuinely empty collection — and following it failed at the list view. That card is now hidden, a group left with no readable collections disappears with it, and an administrator who can read nothing sees an explanatory message. The filtering is a cosmetic affordance only; `assertActorCanPerform` remains the enforcement boundary and is unchanged.
