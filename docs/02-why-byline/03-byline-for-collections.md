---
title: "Byline for Collections"
path: "byline-for-collections"
summary: "Why Byline's immutable versioning, default-on workflow, and atomic audit trail make it a strong foundation for digital collections management, and how OAI-PMH, fixity checking, and accession controls would build on that foundation for science, research, cultural, and heritage collections."
---

# Byline for Collections

Companions:
- [Mission & Vision](./01-mission.md) — the three pillars and the data-ownership stance this essay applies to a specific domain.
- [Key architectural decisions](../03-architecture/index.md) — the document-level vs version-level split, immutable versioning, and universal storage referenced throughout.
- [Auditability](../07-auth-and-security/02-auditability.md) — the acting-user trail and document-level audit log that carry the custody argument below.
- [Collection Versioning](../04-collections/08-collection-versioning.md) — how documents remember the schema they were written against.
- [File & Media Uploads](../04-collections/06-file-media-uploads.md) — the upload pipeline, storage providers, and hooks that a fixity service would build on.

Content management systems and collections management systems have
historically served different professions: the first, newsrooms and
marketing teams; the second, registrars, curators, librarians, and
archivists. The requirements, however, overlap more than the two software
traditions suggest. A collections platform must maintain an accountable
record of what an institution holds, how each item was acquired, what has
changed and who changed it. It must support description in more than one
language. And it must offer demonstrable, rather than assumed, confidence
that the digital object in storage today is the object that was accessioned.

These requirements are not exotic. They correspond closely to Byline's
[three pillars](./01-mission.md#the-three-pillars) of versioning, workflow,
and translation, together with the audit trail that binds them, applied to
institutional memory rather than editorial copy. General-purpose CMS
platforms tend to struggle here for the same reason they struggle with
large editorial teams: versioning, workflow, and accountability are added
on rather than foundational, and they fail quietly under real stakes. A
collection record may need to outlive the software it was created in, the
staff who created it, and in some cases the institution's present form.
For such a record, quiet failure is a serious risk.

This essay makes the case in two parts: first, what Byline already provides
that collections work requires; second, what a collections-focused layer
(OAI-PMH, fixity checking, accession controls) would look like built on top
of it.

## What Byline already provides

### The catalogue record is immutable

Every save in Byline writes a new immutable version; the current state of a
document is a pointer, not a mutation
([Immutable versioning](../03-architecture/index.md#2-immutable-versioning)).
For editorial content this is good hygiene. For a catalogue record it is
closer to a defining requirement: a description record accumulates decades
of curatorial judgement, and a registrar must be able to establish who
described an object in a particular way, when they did so, and what the
record said before. In Byline that answer is not reconstructed from
backups; it is a property of the storage model.

The [document-level vs version-level split](../03-architecture/index.md#3-document-level-vs-version-level)
matters here as well. A record's identity and placement (its path, its
position in a hierarchy, its advertised locales) can change without
disturbing its version history or resetting its workflow state, and each of
those structural changes lands in the audit log atomically with the change
itself. Re-shelving an item does not rewrite its history; it adds to it.

### Workflow states are yours to define

Byline's workflow is not a fixed draft/published toggle. A collection
declares its own statuses and transition verbs through `defineWorkflow`
([schema and presentation](../03-architecture/index.md#5-schema-and-presentation-are-separate-systems)),
which means an accession lifecycle is a schema declaration rather than a
customisation project:

```ts
workflow: defineWorkflow({
  accessioned: { label: 'Accessioned', verb: 'Accession' },
  catalogued: { label: 'Catalogued', verb: 'Mark Catalogued' },
  review: { label: 'In Review', verb: 'Send to Review' },
  published: { label: 'Published', verb: 'Publish' },
  deaccessioned: { label: 'Deaccessioned', verb: 'Deaccession' },
})
```

Every status transition is recorded (who, when, from → to) in the same
transaction as the transition itself
([Auditability](../07-auth-and-security/02-auditability.md)).
Deaccessioning, the procedure collections professionals treat with the most
caution, thereby acquires exactly the property it needs: it cannot occur
without leaving a record, because the audit row and the change commit
together or not at all.

### Custody is accountable by construction

The [auditability subsystem](../07-auth-and-security/02-auditability.md)
was built to honour a claim that could serve as a working definition of
provenance: "ask 'where did this come from?' and get a real answer."
Content changes are accountable as immutable, diffable versions with an
acting user. Everything outside the version stream (path changes, locale
changes, tree moves, status transitions, deletions) is recorded in a
document-level audit log that is deliberately free of foreign keys, so that
an audit row outlives the document, collection, or user it names. Deletion
itself is soft, and the deletion event is preserved in the system activity
feed. For an institution answerable to donors, funders, or statute, this is
the difference between asserting good custody and demonstrating it.

### Records remember the schema they were written against

Descriptive standards evolve, and local practice evolves faster. A
collections database that lives for twenty years will be described under
several generations of its own schema. With
[collection versioning](../04-collections/08-collection-versioning.md),
every document version records which version of the collection schema it
was authored against, and every collection carries a SHA-256 fingerprint
that detects when the data-affecting shape has changed. Because
[universal storage](../03-architecture/index.md#1-universal-storage-eav-per-type)
requires no per-collection tables, schema changes involve no destructive
migration; existing rows stay in place. The read-by-version and
forward-migration story is still ahead of us (the boundary is documented
candidly in that reference), but the record-keeping that makes it possible
is already written on every save.

### Hierarchy, relationships, and controlled vocabulary

Archival description is hierarchical: fonds, series, file, item.
[Document trees](../04-collections/04-document-trees.md) model exactly that
structure; each document holds one parent edge and an order among siblings,
and every placement, re-parenting, and re-ordering is audited.
[Relationships](../04-collections/03-relationships.md) connect records
across collections, which is also how controlled vocabularies arise
naturally: a `subjects` or `agents` collection becomes an authority file,
and other collections relate to it rather than retyping strings. The shared
[media library pattern](../04-collections/06-file-media-uploads.md) does
the same for digital objects: one canonical object, related from every
record that cites it.

### Description is multilingual at the data model

Byline separates content locales from interface locales at the data-model
level ([Internationalization](../08-internationalization/index.md)). A
heritage collection described in Korean, English, and French is not three
records to keep in sync; it is one record with localized fields, each
translation moving through its own review, all under one version history.
For cultural patrimony in particular, description in the language of a
collection's community of origin is a core obligation rather than a feature
request.

### The data is yours, and machines can read it

Our [data-ownership position](./01-mission.md#data-ownership), that content
should be portable, extractable, and workable in full and at any time,
reads almost like a preservation-policy requirement, because in practice it
is one. The
[markdown export surface](../05-reading-and-delivery/04-markdown-export.md)
(every published document at its URL + `.md`, plus `llms.txt`) extends the
question of who reads the catalogue to agents and tooling. And
[search with attachment extraction](../06-search/07-attachment-extraction.md)
indexes the text inside uploaded PDFs and documents, not only their
metadata, which gives the finding-aid problem a considerably better
starting point than most repository software provides.

## What a collections layer would add

Byline is a content platform, not yet a collections management system. The
features a collections deployment needs next, however, are ones the
architecture was in effect designed to receive.

### OAI-PMH

OAI-PMH remains the lingua franca of metadata harvesting: it is how a
collection becomes visible to union catalogues, discovery services, and
aggregators such as Europeana. The protocol asks surprisingly little of a
repository, and Byline already holds every piece: stable identifiers
(document UUIDs); reliable datestamps (the time-ordered UUIDv7 version
stream gives an honest answer to "modified since"); sets (collections and
tree placements map directly); and deleted-record support, the requirement
many implementations fumble, which Byline's soft deletion and audit log
satisfy because a deletion leaves a tombstone and an event rather than a
void. What remains is a read-only endpoint and a per-collection crosswalk
from schema fields to `oai_dc` (Dublin Core), naturally a pure,
schema-aware mapper in the mould of `documentToMarkdown`, serving another
machine-readable representation beside the `.md` surface.

### Fixity

Fixity, the demonstrable integrity of a digital object over time, is the
bedrock claim of digital stewardship. The
[upload pipeline](../04-collections/06-file-media-uploads.md) already
carries a `fileHash` in the stored-file envelope, and the
`beforeStore` / `afterStore` hook contract is the natural place for
checksum computation at ingest. A fixity service on top of this is
essentially a scheduled job: re-read each stored object from its provider,
re-compute the digest, compare, and record the outcome, pass or fail, as an
audit event, in the spirit of a PREMIS fixity check. Byline's retention
posture helps as well: soft deletion deliberately retains immutable sources
and variants rather than treating object cleanup as a side effect of
deletion. The result an auditor wants (every object checked on a given
date, mismatches flagged, a log to point to) lands in the same activity
feed as everything else.

### Accession and collections controls

Accessioning is, at heart, disciplined record-keeping about acquisition,
which makes it a schema-design exercise on Byline rather than a new
subsystem. An accession register is a collection; accession numbers are a
`beforeStore`-style concern or a `useAsPath` derivation; object entry,
loans, condition reports, and locations are related collections pointing at
the object record; donor and source agents live in an authority collection.
The controls that make these procedures trustworthy (who may transition a
record, which transitions exist, what every change leaves behind) are the
workflow and audit machinery described above, on by default. Persistent
identifiers (ARK, DOI, Handle) fit the same pattern: minted via a hook at
accession or publication, stored as ordinary fields, served at stable
paths.

## Where the boundary is

We want to be candid about what Byline is not. It is not a digital
preservation system: it does not perform format migration, normalisation,
or OAIS-style archival packaging, and an institution with those obligations
should pair Byline with tooling built for them. Nor does Byline ship
Spectrum, ISAD(G), Dublin Core, or Darwin Core as built-in checkboxes.
Standards compliance is a property of the collection schemas you define,
which Byline makes explicit, typed, and versioned rather than implicit in a
tangle of custom fields. And of the collections layer sketched above, only
the foundations ship today; OAI-PMH, scheduled fixity, and accession
tooling are directions we believe the architecture has earned, not features
you can install this afternoon.

The claim we are making is narrower and, we think, more defensible: the
hard properties (immutability, accountable workflow, atomic audit, schema
memory, multilingual description, data ownership) cannot be retrofitted
onto a platform that lacks them, and they are the properties collections
work cannot do without. Byline has them by default.

## Who this is for

Science and research collections, where specimen and dataset records need
disciplined, versioned metadata and machine-readable surfaces as much as
any publication does. Cultural and heritage collections, where multilingual
description, provenance, and custody are the daily work, and where the
communities a collection describes deserve records kept in their own
languages. And, close to our own history of
[working with non-profits and NGOs](./01-mission.md#building-in-the-open),
the small institutions: the two-person archive, the community museum, the
research group with a collection and no systems staff. Default-on rigour
matters most precisely where no one's job is to enforce it.
