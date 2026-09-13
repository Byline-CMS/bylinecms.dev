---
title: "Path widget lock — specification"
path: "path-widget-lock-spec"
summary: "Give a collection an explicit way to declare that its document paths are managed rather than edited, and render the system path widget read-only when it does. Admin protection only; enforcing how paths are created and changed remains the installation's responsibility."
---

# Path widget lock — specification

Companions:

- [Document paths](../docs/04-collections/05-document-paths.md) is the present-state reference for path derivation, the widget, and the write transports.
- [Configuration](../docs/10-api-reference/01-configuration.md) documents the admin configuration surface.
- [Testing](../docs/13-testing.md) describes the repository's verification workflow.

Date: 2026-09-13. Status: approved for planning following review. Implementation has not started. Target release: 6.x. The configuration surface is additive, storage and transports are untouched, and no collection changes behaviour unless it opts in; the single break is a narrowed `FormRenderer` prop type (see Configuration surface). The downstream footprint is a small set of first-party applications, so that is a release-note line rather than a migration.

## Purpose and scope

Some collections have paths that are not editorial. They are minted by the system and then load-bearing: other things are derived from the same source, external systems link to them, and a hand-edited path silently breaks an invariant the editor cannot see. The case that prompted this is a downstream catalogue collection whose `useAsPath` names an allocator-assigned counter: the minted value becomes `0000448` through the installation slugifier, the stored path becomes `/catalogue/0000448`, and that URL has to match both legacy inbound links and asset filenames derived independently from the same counter (`…-0000448-cover.jpg`).

Byline's system path widget lets an editor type over that path. This specification gives a collection a way to say the path is managed — `lockPath: true` — and renders the widget read-only when it does. It is a UX guard against an accidental keystroke in the sidebar, and it is deliberately nothing more.

The scope is `packages/admin/src/forms/path-widget.tsx`, the props `packages/admin/src/forms/form-renderer.tsx` computes for it, one new optional member on `CollectionAdminConfig`, and the `byline-admin` translation bundle. No host-shell changes: `adminConfig` already reaches the form renderer. Server-side path policy, the create transport, the system-fields transport, and the storage layer are untouched.

## Present behaviour

The widget is already half-locked for a collection whose `useAsPath` source is server-assigned. `form-renderer.tsx:320` computes

```ts
const pathSourceLocked = source != null && (source.type === 'counter' || source.readOnly === true)
```

and passes it as `sourceLocked`, which suppresses the live derived preview (`path-widget.tsx:120`) and the "Regenerate from {source}" action — both meaningless when the source value is not reproducible client-side.

The read-only decision is a separate line and does not consult it (`path-widget.tsx:112`):

```ts
const isReadOnly = activeLocale !== defaultLocale
```

So the editor sees no preview and no regenerate affordance, but a freely editable text input. In create mode a typed value becomes `params.path`, which takes precedence over derivation in `createDocument`. In edit mode a typed value routes through `updateCollectionDocumentSystemFields` and replaces the stored path row with no new version. Both modes need covering; locking only the edit form would leave the create form as an unguarded way to mint a wrong URL on day one.

There is no downstream escape today. `CollectionAdminConfig` exposes `listView` but no edit-view or widget override, `showPath` is an internal `FormContent` prop rather than configuration, and no collection hook observes `params.path` — `beforeUpdate` receives `data` and `originalData` only, and there is no `beforeSystemFieldsChange`. An installation that wants this has only CSS, which is not a lock.

## Scope boundary: widget protection is not URL immutability

Native `readOnly` stops an editor typing in the form. It does not make the path immutable. `params.path` on create, `updateDocumentSystemFields`, `@byline/client`, and migration scripts all remain able to set any path, which is what an installation's import scripts rely on to seed legacy paths.

That boundary is intentional and belongs in the documentation, so no one reads a greyed-out input as a guarantee. Stricter rules about how paths are created and changed are the installation's responsibility, enforced by whatever subsystem already manages those paths; Byline cannot know a given site's URL contract. Should Byline ever offer server-side enforcement, it gets its own explicit setting rather than an expanded reading of this one — attaching enforcement to `lockPath` later would change the flag's contract no matter where the flag lives.

## Decisions

**The lock is declared, never inferred.** A collection opts in with `lockPath: true`; nothing about a field's type or flags turns it on by itself. The alternative considered was auto-locking whenever the `useAsPath` source is a `counter`, and it was rejected on three counts. A counter says how a value is minted, not that the resulting URL is an invariant — that is a statement about the site, not about the field type. Inference gives a site with a counter-sourced path and a legitimate vanity override no way out, forcing a second flag to undo the first. And it would silently remove an editing capability from existing installations on upgrade — the weakest of the three, since every downstream application is first-party and the change could simply be documented, but the first two stand on their own. One explicit rule is easier to document, test, and reason about than an inferred rule plus its escape hatch.

**The flag lives on `CollectionAdminConfig`.** Its entire effect is on an admin widget, and `adminConfig` already reaches `FormRenderer`, so nothing new has to be threaded through the host shell. Placing it on the collection definition was considered to anticipate a future server policy and rejected: that policy would carry its own setting regardless, and the definition is the wrong home for a flag whose only behaviour is a rendering decision.

**`sourceLocked` keeps its present meaning and its present union.** It answers a different question — can the form derive a preview — and is correct as it stands for both counters and read-only sources. The lock is a second, independent prop rather than a redefinition of the first, so the preview and regenerate suppression that ships today is unchanged, whether or not a collection sets `lockPath`.

**`readOnly: true` on the source field continues to mean nothing for the path.** It is documented as a rendering hint that carries no server immutability (`packages/core/src/@types/field-types.ts:278-292`), and sources are marked read-only for many reasons unrelated to path policy.

**`lockPath` is independent of `useAsPath`.** The flag describes who may edit the path, not where it came from, so it is equally meaningful on a collection whose paths are minted by an import or an external system. No validation rule ties the two together.

**Two hint strings, neither naming a source.** The widget must not name serial numbers or any installation's concept, and must not claim the stored path matches the `useAsPath` field: overrides and path stickiness mean a saved path can legitimately diverge from what that field would derive today. Generic wording stays true in every case and keeps one string instead of a derived/managed pair:

- Create, before first save: "Assigned automatically when this document is saved."
- Saved document: "This path is managed and cannot be edited here."

**Hint precedence is locked, then translation, then validation.** A locked collection edited in a translation locale is both locked and translation-read-only; the managed-path explanation is the more fundamental of the two, and stating it avoids implying the path becomes editable in the source locale. The live "Suggested:" validation hint cannot arise while the input is locked, but the ordering makes that explicit rather than incidental.

**A locked widget stays visible.** It shows the stored path read-only rather than disappearing: editors still need to see and copy the document's URL, and a missing sidebar row reads as a bug rather than a policy.

## Behaviour matrix

`lockPath` is the only new input. Every row without it is today's behaviour, unchanged.

| Collection / mode | Input | Regenerate | Hint |
|---|---|---|---|
| `lockPath`, create | read-only, empty | hidden | "Assigned automatically when this document is saved." |
| `lockPath`, edit, source locale | read-only, shows stored path | hidden | "This path is managed and cannot be edited here." |
| `lockPath`, edit, translation locale | read-only, shows stored path | hidden | locked hint (takes precedence over the translation hint) |
| No `lockPath`, counter source, create or edit in the source locale | editable | hidden (`sourceLocked`) | unchanged |
| No `lockPath`, ordinary source, create | editable | shown when preview differs | placeholder preview, unchanged |
| No `lockPath`, ordinary source, edit, source locale | editable | shown when preview differs | validation hint, unchanged |
| No `lockPath`, any source, edit, translation locale | read-only | hidden | translation hint, unchanged |

## Consequences

A locked collection has no admin route to correct a bad path — a legacy row imported with a wrong slug, say. The correction moves to a script or the client SDK, which is where such a collection's paths are seeded in the first place. This is accepted rather than mitigated: an unlock affordance in the form would reintroduce the accidental edit the lock exists to prevent. A site that hits this regularly should reconsider whether its paths are really managed.

Nothing changes for a collection that does not set the flag, so there is no upgrade note beyond the new option itself.

## Configuration surface

`lockPath?: boolean` on `CollectionAdminConfig` (`packages/core/src/@types/admin-types.ts:302`), documented alongside the other form-affecting collection options. `SingletonAdminConfig` declares `lockPath?: never`, matching the existing `columns` / `listView` treatment at lines 509-515: a singleton has no document path and no path widget.

One typing change follows. `FormRenderer`'s prop is `adminConfig?: FormAdminConfig` (`form-renderer.tsx:136`), the shared base that has no collection-only members, so the renderer cannot read `lockPath` off it as declared. Retype it as `adminConfig?: AdminResourceConfig` (`admin-types.ts:520`), the existing alias for the two configurations the form actually receives: `lockPath` is readable because both members declare it — `boolean` on one, `never` on the other — the union remains assignable to the `FormAdminConfig` that `useFormLayout` takes, and the prop stops understating what callers pass. It stays optional. Narrowing an exported prop type is a break, but every call site in the repository already passes a full collection or singleton configuration, so it costs a type error only for an external caller handing `FormRenderer` a bare base object — a release-note line, and the shape the renderer should have had. No new prop is threaded through the host shell.

For the installation that prompted this, adopting it is a one-line change in that collection's admin configuration.

## i18n

Two new keys in the `byline-admin` namespace: `pathWidget.lockedCreateHint` and `pathWidget.lockedHint`. Neither takes parameters. English is authored; the seven other bundles in `packages/i18n/src/admin/` (de, es, fr, it, ko, th, zh-CN) are translated in the same change. `packages/i18n/src/admin/index.test.node.ts` asserts key parity against English, so a missed bundle fails the suite.

## Verification

`packages/admin/src/forms/path-widget.test.tsx` renders against the real English bundle, so the assertions below check the strings an editor sees. Extend the existing `render` helper with the new prop and cover:

- Locked, create: input is `readOnly`, is empty, shows the create hint, renders no regenerate button.
- Locked, edit: input is `readOnly`, shows the stored path, shows the managed hint.
- Locked, translation locale: input is `readOnly` and shows the locked hint rather than the translation hint.
- Locked: a simulated change event leaves `systemPath` untouched — the lock is not merely visual.
- Unlocked with a counter source, source locale: input remains editable, regenerate still suppressed — the explicit guard against reintroducing inference.
- Unlocked with an ordinary source: create placeholder, regenerate, typing, and the suggested hint all behave exactly as they do today.

Forwarding is covered with the existing form-renderer suites (`form-renderer-capabilities.test.tsx` is the closest fit): `adminConfig.lockPath` reaches the widget, and its absence leaves `sourceLocked` behaviour untouched for a counter source.

Documentation updates land with the change: the widget behaviour section of `docs/04-collections/05-document-paths.md`, which currently describes the input as editable in both modes, and a `lockPath` entry in the admin configuration reference. Both state the scope boundary — the lock is an admin guard, and enforcing how paths are created and changed is the installation's responsibility.
