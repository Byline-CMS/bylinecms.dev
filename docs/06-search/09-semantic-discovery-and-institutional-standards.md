---
title: "Semantic discovery and institutional standards"
path: "semantic-discovery-institutional-standards"
summary: "How Byline's multilingual search foundation, together with capabilities now under development and active research, supports structured, hybrid, relationship-aware, and standards-based discovery for research, library, archive, biodiversity, and cultural-heritage collections."
---

# Semantic discovery and institutional standards

Companions:
- [Search](./index.md) — the shipped search architecture, provider boundary, multilingual guarantees, and current limits.
- [Byline for Collections](../02-why-byline/03-byline-for-collections.md) — why Byline's versioning, workflow, audit trail, and multilingual content model are relevant to institutional collections.
- [Search provider contract](./04-provider-contract.md) — the capability declarations and conformance boundary through which new retrieval providers integrate.
- [Portable multilingual search analysis](./05-portable-analysis.md) — the Unicode, locale, identifier, and query-planning foundation that both built-in SQL providers use.
- [Attachment extraction for search](./07-attachment-extraction.md) — the derived-artifact boundary, under development, for PDF, office-document, OCR, and vision extraction.

Institutional discovery is broader than matching words in a web page. A researcher may know an
alternate transliteration but not the catalogue's preferred name. An archivist may need to
combine an agent, place, date range, and record hierarchy. A biodiversity collection may need
to connect a local species record to a recognised taxon. A museum may need to retrieve objects
through the people, places, events, and concepts associated with them.

Byline does not yet claim to solve all of these problems. It does provide a practical search
and content foundation on which they can be developed: typed collection schemas,
relationships, multilingual content, immutable versions, an auditable lifecycle, and one
provider-neutral search projection. Our direction is to add institutional discovery in
explicit, testable layers rather than label ordinary full-text search as “semantic.”

## What Byline provides today

The built-in PostgreSQL and MySQL providers ship:

- ranked collection and cross-collection zone search;
- published-only, locale-scoped search projections;
- Unicode normalisation and ICU word segmentation;
- identifier preservation, Han bigrams, and optional language expansion;
- all-term, any-term, minimum-term, and phrase matching;
- field weighting and highlighted snippets;
- rebuildable indexes with analyzer fingerprints; and
- authorization and optional hydration through Byline's normal read pipeline.

This is multilingual lexical search. It is not cross-lingual semantic retrieval: an interface
translation, a multilingual index, and a query that finds equivalent meaning in another
language are separate capabilities.

The built-in providers do **not** yet implement facet aggregation, structured search
filtering, typo tolerance, semantic or vector retrieval, a portable BM25 guarantee, attachment
extraction, or graph traversal. The public contract reserves several of these shapes so a
provider can add them without bypassing Byline's authorization and hydration boundaries.

Two of those capabilities are already under development beyond the built-in providers: a Solr
provider with BM25 ranking and facet aggregation, and the attachment-extraction boundary. Both
run against a production institutional deployment and are expected to meet the conformance bar
described in [Native search engines and backend portability](./08-native-engine-providers.md).
Semantic, vector, and cross-lingual retrieval are under active research and development. A
capability described on this page is part of the public Byline packages only when the
registered provider declares it.

## The discovery layers we are working toward

### Structured discovery

The next practical layer is not an AI model. It is the ability to combine text with reliable
metadata:

- facet aggregation over authority and relationship fields;
- typed filters for dates, identifiers, status, places, and other declared values;
- stable concept identifiers instead of display labels as facet identity;
- alternate labels and transliterations attached to one confirmed concept; and
- bounded relationship queries over paths an institution has deliberately modelled.

The production Solr deployment noted above already demonstrates this layer. Byline's
provider-neutral projection retains configured facet and filter values today, and bringing
their query behaviour to the built-in providers is the near-term step: existing metadata
becomes an institutional discovery surface without a graph database or a general ontology
reasoner.

### Extracted and hybrid retrieval

Institutional knowledge often lives inside PDFs, office documents, scans, and images.
Byline's extraction boundary, under development, treats extracted text as persisted, versioned
derived data rather than work performed during every index rebuild. Embeddings should follow the same
pattern: associate them with the source content hash, locale, model, and model version, then
let a capable search provider consume them.

A hybrid provider is under active research and development. It would combine:

- lexical ranking for names, identifiers, quotations, and rare terminology;
- multilingual vector retrieval for broader conceptual recall;
- confirmed authority labels and aliases for precise identity;
- structured filters and facets; and
- an explicit fusion policy with relevance tests.

Embeddings do not make authority work obsolete. Low-resource languages, specialist
terminology, and culturally sensitive names require representative evaluation and, where
identity matters, curator-confirmed records. Byline should advertise cross-lingual retrieval
only for languages and domains it has tested with human relevance judgments.

### Relationship-aware and AI-facing access

Some questions require traversal rather than similarity: publications connected to one field
site and taxon, objects associated with one person through several events, or records beneath
one archival series. Known query shapes can often be implemented with ordinary relational
tables and joins. A dedicated graph or RDF store becomes relevant only if open-ended traversal,
reasoning, scale, or external query requirements justify its additional operational cost.

Natural-language answers and agent access come after reliable retrieval. A future RAG or MCP
surface should preserve permissions and return citations to canonical Byline records. GraphRAG
is useful only where graph traversal measurably improves representative questions; MCP is an
access interface, not a substitute for search quality.

## Institutional standards are profiles, not badges

Different institutions describe different things for different purposes. Byline should not
force all collections into one universal ontology. Its contribution can instead be a profile
pattern: typed collection schemas and authority records for editorial work, accompanied by
validated mappings to the standards an institution needs for exchange, aggregation, or
preservation workflows.

The following table is a signpost, not a list of built-in compliance claims:

| Domain | Likely standards and authorities | Where they fit |
| --- | --- | --- |
| General research outputs | [DataCite Metadata Schema](https://schema.datacite.org/), [DCMI Metadata Terms](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/), [schema.org](https://schema.org/docs/documents.html), and [PROV-O](https://www.w3.org/TR/prov-o/) | Citation, contributor identity, related outputs, funding, discovery, and provenance. |
| Research packages and reproducibility | [RO-Crate](https://www.researchobject.org/ro-crate/specification.html) and domain-specific RO-Crate profiles | Files and datasets packaged with people, organisations, software, instruments, workflow context, licences, and identifiers. |
| Data catalogues and open-data portals | [DCAT 3](https://www.w3.org/TR/vocab-dcat-3/) and schema.org | Datasets, distributions, data services, publishers, access conditions, and catalogue exchange. |
| Biodiversity and ecological collections | [Darwin Core](https://dwc.tdwg.org/), [GBIF data standards and vocabularies](https://www.gbif.org/standards), and recognised taxonomic authorities | Taxa, specimens, observations, sampling events, ecological datasets, and aggregation through biodiversity networks. |
| Libraries and bibliographic collections | DCMI Terms, [MODS](https://www.loc.gov/standards/mods/), [BIBFRAME](https://www.loc.gov/bibframe/docs/index.html), ORCID, VIAF, and Library of Congress authorities | Bibliographic description, works/instances/items, agents, subjects, holdings, and linked identifiers. |
| Archives and finding aids | [Encoded Archival Description](https://www.loc.gov/ead/) and the institution's archival description practice | Hierarchical finding aids, agents, dates, places, rights, and exchange with archival systems. |
| Cultural heritage and museum collections | [Linked Art](https://linked.art/model/), [CIDOC-CRM](https://www.cidoc-crm.org/), [Europeana Data Model](https://pro.europeana.eu/index.php/page/edm-documentation), Getty vocabularies, and IIIF where digital images require interoperable presentation | Event-centred provenance, objects, people, places, concepts, digital representations, and aggregation. |
| Controlled terminology across domains | [SKOS](https://www.w3.org/TR/skos-reference/) plus relevant local and external authorities | Stable concepts, multilingual preferred and alternate labels, hierarchy, related terms, and mappings between schemes. |

One standard can influence several parts of an implementation. CIDOC-CRM or Linked Art, for
example, may shape event and provenance fields in a heritage collection as well as its outward
JSON-LD. Darwin Core may shape a biodiversity schema and its GBIF export. “Standards-out” does
not mean that standards are considered only after editorial data has been designed; it means
Byline keeps a usable operational model while making each mapping explicit and testable.

Institutional interoperability also includes harvesting protocols. Byline does not yet ship
OAI-PMH; [Byline for Collections](../02-why-byline/03-byline-for-collections.md#oai-pmh)
describes how a read-only endpoint and per-collection metadata crosswalk could build on the
existing identity, versioning and soft-deletion foundations.

## What Byline can contribute

Large semantic-web and repository platforms already serve institutions with deep modelling
requirements. Byline's opportunity is different: provide an affordable editorial and
publishing foundation, then add the standards and discovery layers each institution can
justify without making every installation operate the same specialist infrastructure.

That contribution rests on several existing boundaries:

- collection schemas make institutional metadata explicit and typed;
- relationships support authority records and domain entities;
- versions and audit events preserve accountable change;
- content locales separate one record's translations from duplicated records;
- search providers declare capabilities rather than silently changing behaviour;
- search projections are disposable and rebuildable; and
- authorization and hydration remain in the ordinary Byline read path.

These properties do not themselves constitute linked-data, ontology, or semantic-search
support. They make those features more credible to add because the institutional record
remains authoritative, reviewable, and portable.

## A capability-led roadmap

| Status | Direction | Evidence required before Byline claims it |
| --- | --- | --- |
| Implemented (core) | Multilingual lexical search through PostgreSQL and MySQL | Provider conformance, lifecycle tests, authorization tests, and documented language limits. |
| Under development | A Solr provider (BM25 ranking, facet aggregation) and the attachment-extraction boundary, proven against a production institutional deployment | Conformance and extraction lifecycle tests before the public packages claim them; structured `where` filtering remains open. |
| Next | Portable `where` filtering and facet aggregation in the provider contract; stable concept identifiers, aliases, and authority links | Consistent provider behaviour, non-leaking authorized counts, and real institutional query sets. |
| Actively researched | Embedding artifacts, hybrid lexical/vector retrieval, cross-lingual evaluation, and selected standards profiles | Rebuild and deletion tests, model/version tracking, profile validation, and human relevance judgments for each claimed language and domain. |
| Future, where justified | Relationship traversal, richer linked-data projections, cited natural-language answers, and MCP tools | A real partner use case, permission-safe retrieval, measurable improvement over simpler approaches, and an operational maintenance plan. |

The sequence is intentional. Structured metadata and confirmed identities improve both lexical
and semantic retrieval. Extraction makes the collection searchable before it makes it
answerable. Hybrid search should earn its place against a measured baseline. Agent interfaces
should expose proven retrieval rather than conceal weak retrieval behind fluent text.

## Working with institutions

The most useful next step is not to promise every standard in the table. It is to choose one
collection and one exchange or discovery problem with an institutional partner:

1. identify the questions users actually ask;
2. select the smallest relevant metadata and authority profile;
3. map the editorial schema and search projection;
4. establish relevance and validation tests;
5. publish a transparent account of what ships and what remains local; and
6. reuse the profile only after a second implementation shows which parts are genuinely
   portable.

A production research-collection deployment is the active proving ground for multilingual
lexical search, BM25 ranking, faceted discovery, and attachment extraction, and a natural
environment for taxonomic reconciliation and biodiversity queries. One deployment cannot, by
itself, validate museum-event modelling, archival standards, or CIDOC-CRM claims. Those
directions need partners from the relevant communities.

Byline's intended signal is therefore measured but serious: we understand the standards and
retrieval problems institutional collections face; the architecture already reserves useful
boundaries for them; and we want to develop affordable, verifiable support with institutions
rather than announce an ontology platform before one exists.
