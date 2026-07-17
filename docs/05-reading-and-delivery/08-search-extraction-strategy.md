---
title: "Search and document extraction strategy"
path: "search-extraction-strategy"
summary: "Forward-looking research for attachment extraction and retrieval: provider boundaries, persistence, indexing, chunking, and phased delivery."
---

# Search and document extraction strategy

:::note[Status]
This is **forward-looking landscape research**, not a description of shipped
code. Since it was written, the **search** subsystem's first slice has shipped —
the `SearchProvider` seam, the built-in Postgres full-text driver
(`@byline/search-postgres`), the type-enriched `SearchDocument` + assembler,
lifecycle indexing, `reindex`, and `client.collection(x).search()`. The
present-state reference for that is [Search & Retrieval](./07-search.md). This
brief remains the strategy source for the **still-unbuilt phases** it
cross-links to: §1 informs the external-driver tiers (Solr / Meilisearch /
Typesense / OpenSearch / vector — search Phase 4), and §2–§5 inform the
**`@byline/extract`** attachment-extraction pipeline (search Phase 3). When
those phases begin, the relevant section here should graduate into its own
design doc alongside `07-search.md` (as the search design did).
:::

:::note[Provenance]
This document is a compiled, lightly edited reference of a working conversation
exploring (a) the search landscape for Byline CMS and a tiered search-adapter
strategy, and (b) the document-extraction landscape and a tiered
`@byline/extract` adapter strategy. It is intended as a handoff brief for
implementation work. Factual claims about third-party tools, licenses, pricing,
and benchmarks reflect research as of **June 2026** and should be re-verified
against current vendor/model documentation before committing to any one of
them—licensing and managed-service pricing in this space move quickly.
:::

**Context assumed throughout:**

- Byline CMS is PostgreSQL-first, with a package/adapter-based architecture. Search is intended to
  ship as `@byline/search` (the contract) plus implementations (`@byline/search-postgres`,
  `@byline/search-solr`, `@byline/search-elastic`, etc.).
- Core collection lifecycle hooks make index storage (write) and invalidation (delete) straightforward.
- Hosting: most own/client sites on **Fly.io**, databases on **Neon**. A dedicated **Solr** server
  (with **Tika** integrated) currently provides full-text + faceted search to one client install on
  Payload CMS, to be migrated to Byline.
- Historically an **AWS** customer; some clients specifically request AWS.
- Interests: faceted results (facets/aggregations), semantic search (similars, typo-tolerance), and
  soon RAG (semantic + chat). RAG is expected to want a different adapter shape than CRUD search.
- Reference medium-tier corpus: the **FORRU library** (research PDFs with attachments).
- Thai-language content is in scope (relevant to extraction/OCR choices).
- Algolia deliberately set aside for the initial strategy; Typesense and Meilisearch in scope.

---

## 1. Search landscape & tiered strategy

### 1.1 Strategic flag: the Postgres-native floor moved

Because Byline is Postgres-first on Neon, the most consequential recent change is at the
Postgres-native end:

- As of **19 March 2026, ParadeDB's `pg_search` is no longer available for new Neon projects**
  (existing projects keep it). Neon — now Databricks' **"Lakebase"** — steers new projects toward
  built-in `tsvector`/`tsquery` full-text, `pg_trgm` fuzzy matching, `pgvector` semantic search, and
  a new **`lakebase_text`** BM25 index.
- The Lakebase Search extensions — **`lakebase_text`** (BM25, compatible with standard `tsvector`)
  and **`lakebase_vector`** (an ANN index, drop-in for `pgvector`, scales past a billion vectors) —
  are real but currently in **private preview**.
- `pgvector` is available on every Neon plan with no add-on. Neon also ships an experimental in-DB
  RAG helper extension (`pgrag`).

**Adapter implication:** do **not** make BM25-in-Postgres a hard dependency on any one extension.
Build `@byline/search-postgres` on the universally-available primitives (`tsvector` + GIN,
`pg_trgm`, `pgvector`) and treat BM25 ranking as an **optional capability behind a flag**, satisfiable
three ways depending on where a client is hosted: `lakebase_text` on Neon, self-hosted ParadeDB
(Docker/CloudNativePG), or Tiger Data's `pg_textsearch` (from-scratch OSS BM25; 1.0 lacks phrase
queries). The capability flag keeps the adapter honest about what a given deployment can actually do.

### 1.2 The four families of search solution

**1. Postgres-native (in-database).** Zero new infrastructure; runs in the client's existing Neon DB;
lifecycle hooks just write rows.

- `tsvector`/`tsquery` + GIN: free, everywhere, fine relevance at small scale. Weakness: `ts_rank`
  lacks IDF (no corpus-wide term-rarity weighting), so ranking degrades as the corpus grows, and
  faceting is hand-rolled via `GROUP BY`.
- `pg_trgm`: trigram similarity for typo-tolerance and "did you mean."
- `pgvector`: embeddings for semantic / "similars" (HNSW or IVFFlat). Also the simplest RAG store.
- BM25 path (optional): ParadeDB `pg_search` brings BM25 + faceting + columnar aggregates inside
  Postgres via Tantivy, with hybrid (BM25 + `pgvector`) on the roadmap — but note the Neon
  availability change, and AGPLv3-or-commercial licensing. `lakebase_text` or `pg_textsearch` are
  the alternatives.

**2. Self-hostable dedicated engines.**

- **Apache Solr** (already operated here): gold standard for faceting/filtering; integrates Tika for
  PDF text; dense-vector kNN since 9.0; the **9.8 LLM module** adds end-to-end semantic search via
  LangChain4j (OpenAI/Cohere/HuggingFace/Mistral); hybrid (kNN + BM25) works today with Reciprocal
  Rank Fusion landing via a combined-query component. Apache-2.0. JVM-heavy but already running, so
  marginal cost ≈ 0.
- **Elasticsearch / OpenSearch**: richest aggregations + mature vector/neural; ingest pipelines
  (Tika attachment processor) for PDFs. OpenSearch is the Apache-2.0 fork and the natural AWS choice;
  Elasticsearch is dual AGPL/Elastic-licensed. Heaviest ops.
- **Typesense**: C++, in-RAM, sub-50 ms; excellent typo-tolerance and faceting; ships vector search
  plus built-in conversational (RAG) search; resource-based cloud pricing. GPLv3. Constraint: all
  data must fit in RAM, which gets expensive at large scale.
- **Meilisearch**: Rust, MIT-licensed, disk-backed (LMDB) so it indexes larger sets on smaller
  machines; zero-config DX; AI-powered hybrid keyword+vector search; **supports Thai out of the box**.
  Historically weaker on multi-node HA. The MIT license is the cleanest of any dedicated engine for a
  commercial product.

**3. Managed SaaS search.** Typesense Cloud, Meilisearch Cloud (~$30/mo entry tiers), Elastic Cloud,
AWS OpenSearch (managed cluster or Serverless). See the OpenSearch Serverless cost trap in §1.6.

**4. RAG / vector-specific.** `pgvector`/`lakebase_vector` (simplest, same DB); dedicated vector DBs
(Qdrant — Apache-2.0, Weaviate, Pinecone, Milvus) when you outgrow `pgvector`; **AWS Bedrock
Knowledge Bases** as a fully managed RAG pipeline (see §1.6).

### 1.3 Capability snapshot

| Solution | Facets | Typo/fuzzy | Semantic/hybrid | PDF text | New infra? | License |
|---|---|---|---|---|---|---|
| Postgres `tsvector`+`pg_trgm`+`pgvector` | hand-rolled (GROUP BY) | `pg_trgm` | `pgvector` | extract in pipeline | none | permissive |
| ParadeDB / `pg_textsearch` / `lakebase_text` | yes / via SQL / via SQL | partial | hybrid (ParadeDB) | extract in pipeline | extension/preview | AGPL / OSS / Neon |
| Solr (existing) | best-in-class | yes | 9.0+ kNN, 9.8 LLM module | Tika (out-of-process) | already running | Apache-2.0 |
| Elasticsearch / OpenSearch | aggregations | yes | mature vector/neural | ingest pipeline (Tika) | heavy | AGPL / Apache-2.0 |
| Typesense | yes | excellent | vector + built-in RAG | extract in pipeline | one node (RAM-bound) | GPLv3 |
| Meilisearch | yes | excellent | AI hybrid; Thai support | extract in pipeline | one node (disk-backed) | MIT |
| Bedrock KB | hybrid | — | managed RAG + rerank | multimodal parsing built-in | managed (AWS) | service |

**Cross-cutting:** PDF text extraction should live **once** in Byline's ingestion path, not in each
search adapter. Put a shared `@byline/extract` step in the collection hook that emits normalized text
+ metadata; every search/RAG adapter consumes the same output. That keeps the adapter contract clean
and the facet model consistent. (Extraction is developed fully in §2 and §4.)

### 1.4 Tiered search strategy

- **Tier 0 — Small (~100 docs), batteries-included.** `@byline/search-postgres` over `tsvector` +
  GIN, `pg_trgm` for typo-tolerance, optional `pgvector` for similars. No new infrastructure; runs on
  the client's existing Neon DB. At 100 docs the weak ranking and GROUP-BY faceting are invisible.
  This is the default and should require zero decisions from the user.
- **Tier 1 — Small-to-medium wanting "Algolia-quality" feel, cheaply.** Either enable a BM25
  capability in Postgres (`lakebase_text` on Neon, self-hosted ParadeDB, or `pg_textsearch`) to keep
  a single store, or stand up one small Meilisearch/Typesense node (self-hosted or cloud ~$30/mo) for
  excellent typo-tolerance, facets, and light semantic. For Thai-content clients, Meilisearch's
  out-of-the-box Thai handling is a real differentiator.
- **Tier 2 — Medium (100–500 docs incl. PDFs), the FORRU shape.** Strongest, lowest-marginal-cost
  play is `@byline/search-solr` against the existing Solr server: best-in-class facets/filtering,
  Tika for the attached PDFs, dense-vector + LLM-module semantic when wanted. Natural migration target
  for the existing Payload→Byline Solr client. Lighter alternative: Meilisearch/Typesense with
  extraction handled in Byline's pipeline.
- **Tier 3 — Large (>500 docs incl. PDFs) and/or RAG.** Split search from RAG. Search at scale: Solr
  or OpenSearch/Elasticsearch for serious aggregations, hybrid retrieval, sharding — OpenSearch when
  AWS-aligned. RAG: a separate `@byline/rag` (or `@byline/ai`) package — `pgvector`/`lakebase_vector`
  + own chunk/embed/retrieve for self-hosted, Solr's LLM module to keep it in Solr, or Bedrock
  Knowledge Bases for AWS clients (backed by Aurora `pgvector` or S3 Vectors, **not** the
  OpenSearch-Serverless default).

### 1.5 Recommended adapter sequencing (roadmap)

1. **`@byline/search`** — the interface: `index / delete / query / facet / suggest / vectorQuery`; a
   normalized facet-and-aggregate model so results look identical across backends; per-adapter
   capability flags so the UI lights up facets/typo/semantic only where supported.
2. **`@byline/search-postgres`** (`tsvector` + `pg_trgm` + `pgvector`; BM25 optional behind a flag).
   Covers Tier 0 and much of Tier 1–2 with no new infra. The MVP.
3. **`@byline/search-solr`** — serves the existing client and the faceted-PDF medium/large tier on
   infrastructure already operated.
4. **One lightweight dedicated engine** — start with **Meilisearch** for Byline specifically: MIT
   license (cleanest to distribute), disk-backed (cheaper at the medium tier than RAM-bound
   Typesense), native Thai support. Typesense's edge is built-in conversational/RAG and resource-based
   pricing; reasonable second.
5. **`@byline/search-elastic`/`-opensearch`** when a client demands it (especially AWS).
6. **`@byline/rag`** as a distinct concern, `pgvector`-first, with a Bedrock KB adapter for AWS clients.

### 1.6 Two cost/availability traps to avoid

- Don't couple the Postgres BM25 story to `pg_search` given the Neon change.
- Don't let Bedrock-based RAG silently sit on **OpenSearch Serverless**: it carries a **~$350/month
  minimum** (2 OCUs at ~$0.24/OCU-hour) regardless of query volume, and deleting the Knowledge Base
  does not delete the collection — it keeps billing. Bedrock supports Aurora PostgreSQL,
  OpenSearch (Serverless + managed), Neptune Analytics, **S3 Vectors**, Pinecone, MongoDB, and Redis
  as vector stores. Prefer **Aurora Serverless v2 + `pgvector`** (scales to zero, floor under
  ~$50/month, ~90% cheaper for small-to-mid RAG) or **S3 Vectors** (GA 2 Dec 2025; serverless object-
  storage vector search, no provisioned floor, up to ~90% cheaper, scales to billions, sub-second
  to ~100 ms) as an archival-RAG tier.

---

## 2. Document extraction landscape

> **Correction to a common assumption:** In Solr 9, Tika is **not** built in — Solr deprecated the
> in-process Solr Cell / `ExtractingRequestHandler`, and Tika now runs **out-of-process** (largely a
> security/stability response to Tika's CVE history). It "integrates easily" rather than being
> "built in."

The output target across the field has standardized on **structured markdown** (or markdown + JSON
with bounding boxes), which is what makes an adapter abstraction clean. Four families:

**1. Classic / heuristic parsers — fast, cheap, born-digital only.** PyMuPDF (and its `pymupdf4llm`
markdown wrapper), pdfplumber, Camelot/Tabula for tables, GROBID for academic XML, MarkItDown. They
read the PDF's own text layer: near-instant and free, but no OCR and weak layout understanding; they
collapse on scans, multi-column, and complex tables. On READoc, `PyMuPDF4LLM` averages around 40
versus ~73 for MinerU. A newer entrant: **Firecrawl's `/parse`** (Rust-based Fire-PDF engine averages
under 400 ms/page, classifies each page, routes only scanned pages to GPU OCR; Markdown or JSON).

**2. ML pipeline tools — layout → table/formula models → assembled markdown, runs locally.** The
sweet spot for self-hosted Tier 2/3. Three to know:

- **Docling** (IBM Research, under LF AI & Data): DocLayNet layout + TableFormer table structure;
  OCR via Tesseract/EasyOCR/RapidOCR; built for air-gapped enterprise RAG with layout-aware chunking.
- **Marker** (Datalab): Surya OCR for multilingual extraction; optimized for speed across
  GPU/CPU/Apple MPS; the flexible "Swiss-Army-knife" default.
- **MinerU** (OpenDataLab): strongest on complex/CJK layouts and scientific docs, runs on the
  broadest hardware, outputs Markdown + JSON.

Practitioner notes: MinerU converts quickly and handles HTML-rendered complex tables well; Marker is
strong on structure fidelity and image/table handling; outline/heading recognition remains the common
weak point across all of them.

**3. End-to-end VLM / "OCR-free" models — the big 2025–26 shift.** A single vision-language model
reads the page image and emits structured markdown (often with coordinates/doc-tags). Open-weight
leaders: **olmOCR-2** (8B, English-only, batch-optimized) and **Chandra** (9B) lead olmOCR-Bench
(>83 avg); **PaddleOCR-VL** (109 languages) and **DeepSeek-OCR** (~100) are strong on multilingual /
handwritten / scanned content; small models like **Granite-Docling-258M** emit DocTags.
**dots.ocr** is a single-model multilingual layout parser benchmarking near Mistral OCR/Marker.
**Honest caveat:** the top OmniDocBench/v1.6 entries are largely vendor self-reported and not
independently reproduced, and the leaders are close enough that production fit matters more than
headline score gaps. Treat any leaderboard as a prior and run a private eval on your own corpus.

**4. Hosted AI-native parsers & cloud document-AI.** AI-native: **LlamaParse** (agentic, 90+ formats,
100+ languages, self-correction loop, cost-optimizer; free to 10k credits/mo), **Mistral OCR**
(Pixtral-based; markdown with equations/tables; lower cost), **Reducto** (multi-pass; SOC2/HIPAA/ZDR),
**LandingAI ADE** (coordinate-level citations), **Unstructured** (broadest OSS-plus-API, built-in
chunking). Hyperscalers: **AWS Textract** (~$0.0015/page text detection; tables/forms/queries;
S3/Lambda; HIPAA-eligible), **Google Document AI** (Gemini-powered, 50+ languages), **Azure Document
Intelligence** (only hyperscaler with an on-prem container). Hyperscalers suit standardized
transactional docs; they're less ideal for knowledge-rich RAG where structural fidelity matters.

### 2.1 Cost and where it lands

`PyMuPDF4LLM`/Docling are free for local use; at the high end LandingAI ADE is ~$0.03/page and
LlamaParse Agentic Plus ~$0.09/page — so 1M pages/month spans roughly **$1,000 to $90,000** depending
on tool/mode. That spread is the whole reason page-level routing matters.

### 2.2 Cross-cutting concerns that shape the contract

- **Charts:** the frontier weak spot. Classic and most pipeline tools treat charts as opaque images;
  agentic/VLM parsers (LlamaParse, LandingAI, Mistral/Pixtral, larger VLMs, PaddleOCR-VL) attempt
  figure/chart understanding. Validate when chart semantics matter.
- **Thai / multilingual:** PaddleOCR-VL (109), DeepSeek-OCR (~100), dots.ocr, LlamaParse (100+),
  Google Document AI (50+) are realistic candidates. Don't trust the language *count* — Thai's absent
  word boundaries and stacked tone marks trip many models; test on real Thai documents.
- **Output shape:** markdown for prose + JSON for tables/blocks with bounding boxes and reading order
  (Docling DocTags, LandingAI coordinates, LlamaParse layout JSON). Normalize to that; downstream
  search-indexing and RAG-chunking both consume the same artifact.
- **Licensing (watch for a distributed product):** Docling is permissive (cleanest local default);
  Marker/Surya carry usage restrictions (revenue-gated weights); MinerU pulls in copyleft deps; hosted
  APIs sidestep model licensing but add per-page cost and data-residency questions. (Detailed in §4.)

### 2.3 Mapping to a Byline extraction adapter

A `@byline/extract` contract mirrors `@byline/search`: input bytes/file → normalized
`{ markdown, blocks[]: {type, bbox, page}, tables, figures, readingOrder, language, confidence }`,
plus capability flags (`ocr`, `tables`, `formulas`, `charts`, `languages`, `coordinates`). Then:

- `@byline/extract-fast` — PyMuPDF4LLM / Fire-PDF class; born-digital; zero-cost default.
- `@byline/extract-docling` (and/or `-marker`, `-mineru`) — local ML pipeline; table/formula-aware;
  no per-page cost; runs on Fly/Ubuntu infra.
- `@byline/extract-vlm` — pluggable to a self-hosted VLM (dots.ocr / DeepSeek-OCR / PaddleOCR-VL) for
  the hardest scans, charts, and Thai, where a GPU is available.
- `@byline/extract-hosted` variants — LlamaParse / Mistral OCR / Reducto / LandingAI for
  quality-without-ops; Textract / Document AI / Azure DI for cloud-aligned clients.
- `@byline/extract-firecrawl` — one API surface for both web content and uploaded files.

**Key architectural point: build page-level routing into the extract layer, not just adapter
selection.** Classify each page (born-digital vs scanned/complex), send the easy ~90% to the cheap
parser and only the hard pages to a VLM or hosted API. Doing this at Byline's layer keeps a
10,000-page FORRU-style library from turning into a large ingestion bill when most of those research
PDFs are born-digital with a clean text layer.

**Tie to lifecycle hooks:** extraction runs once on create/update, emits the normalized
markdown+blocks, and that single artifact feeds both the search index (facets/full-text) and the RAG
chunk/embed step. One extraction, many consumers.

**Tier defaults:** Tier 2 self-hosted → Docling baseline with a fast-path for born-digital; Tier 2
with scans/Thai → add a VLM or Mistral OCR; Tier 3 / AWS clients → Textract or a hosted AI-native
parser in-pipeline, self-hosted VLM at volume if a GPU box is available.

---

## 3. PixelRAG assessment (visual retrieval — set aside for now)

> Decision: **visual/pixel-native retrieval is set aside for the initial strategy.** Captured here
> for completeness because it was evaluated.

**What it is:** PixelRAG (StarTrail-org/PixelRAG, Apache-2.0) is a *visual document retrieval*
framework — it renders documents (web pages, PDFs, images) to screenshot tiles, embeds the page
images directly with a vision-language embedding model (Qwen3-VL-Embedding-2B), builds FAISS indexes,
and serves a similarity search API. Five `uv` packages (render / embed / index / serve / train), a
LoRA fine-tune recipe, and a Claude Code plugin. Its thesis ("the end of web parsing") is to skip the
parse step entirely and retrieve on pixels. This sits in the **ColPali / visual document retrieval**
lineage — a credible research direction.

**Genuine appeal:**

- Sidesteps the entire extraction problem for retrieval — the page image *is* the index unit;
  charts/complex tables/weird layouts just get embedded as they look.
- Language-agnostic by construction — no Thai tokenization/segmentation problem at all (structurally
  advantageous for Thai-heavy corpora).
- Works on anything renderable (web + PDF through one path).

**Why it's not a fit for Byline now:**

- **Different problem than the search tier.** It returns page images ranked by visual similarity — no
  full-text, no BM25, no facets, no classification aggregation. The FORRU facet requirement is
  structurally impossible on a pure pixel index. At best it's an alternative *RAG retrieval* strategy
  inside `@byline/rag`, not a replacement for `@byline/search` or extraction.
- **Returns images, so generation is more expensive and less citable.** Answering means feeding page
  images to a multimodal LLM at query time — heavier per query, and you lose clean text snippets and
  span-level citations (which matter for a research library).
- **GPU- and storage-heavy** on both indexing and serving — a poor fit for the small/medium tiers
  mapped onto Neon/`pgvector` with no new infra.
- **Appears to be single-vector embedding + FAISS**, not ColPali-style late interaction (multi-vector
  MaxSim) — more scalable but coarser for fine-grained retrieval, compounding the no-citations issue.
- **Early-research-grade repo** (low stars, no releases, committed `node_modules`/`tmp`, JSON-heavy
  tree, effectively single-author) — not a dependency to ship in a client-facing CMS.

**Verdict:** conceptually on-trend, and the language-agnostic angle is a real hook for Thai work, but
it's a narrow retrieval strategy dressed up as a parsing revolution, and the repo is too green to
depend on. If exploring the paradigm, reach for the more established **ColPali / ColQwen2** and the
**ViDoRe** benchmark, and prototype it only as one experimental option inside `@byline/rag` (visually
dense docs, Thai corpora). Keep the default RAG path on **extracted-text + `pgvector`** for citations,
filtering, and cheap CPU serving. A weekend spike, not a roadmap commitment.

---

## 4. Deep dive: the three extraction adapter tiers

Two facts cut across all three tiers and should shape the build more than any quality benchmark.

**The Python/Node reality.** Every tool in all three tiers is Python (and the VLM tier additionally
needs CUDA + a serving runtime like vLLM or SGLang). Byline is TypeScript/Node. So a
`@byline/extract-*` adapter is never running these in-process — it's a thin TS client over an HTTP
boundary to a Python extraction service (a sidecar Fly machine, or the Ubuntu box), or a subprocess
shelling out to a CLI. That boundary is the real design work; the model behind it is swappable. The
one exception is the fast tier, where you can stay entirely in Node and skip Python.

**Licensing decides what you can ship.** This matters more here than for most, because Byline is
distributed to clients rather than run as a single internal pipeline. The copyleft/commercial terms
are landmines; each is flagged below.

### 4.1 `@byline/extract-fast` — born-digital, zero-cost

Reads the PDF's existing text layer. No OCR, no models, ~0.01 s/page, CPU-only. For the large share
of FORRU-style research PDFs that are born-digital with a clean text layer, this is all you need, and
it's 10–50× faster than the other tiers.

**Licensing catch:** PyMuPDF (and therefore PyMuPDF4LLM) is **AGPL-3.0**, and Marker is **GPL-3.0** —
copyleft that needs legal review for a distributed product. PyMuPDF has a commercial license from
Artifex (a cost and a negotiation). For a default tier shipped to clients, avoid AGPL on principle.

**Cleaner routes:**

- **Stay in Node.** Use `unpdf` (a serverless-friendly pdf.js wrapper) or `pdfjs-dist` directly —
  MIT, runs in the existing Node process, no Python boundary. **Recommended default for the fast
  tier:** removes both the AGPL question and the sidecar. Slightly less markdown-structure polish than
  PyMuPDF4LLM, but marginal at the born-digital tier.
- **If Python here anyway:** `pdfplumber` (MIT; cell coordinates for simple tables) and `pypdfium2`
  (permissive PDFium binding). `pdfmux` (MIT) is a newer CPU-only option routing only table-candidate
  pages to an ML model, claiming table accuracy crossing Docling's at zero GPU cost — vendor
  benchmark, so "test it yourself."

**Beyond extraction, this tier's real job is classification:** PyMuPDF/pypdfium2 `get_text()` returns
an empty string for image-only pages — a cheap, deterministic signal that a page is scanned and must
escalate. Put that routing logic in the extract layer so the expensive tiers only see pages that need
them.

### 4.2 `@byline/extract-docling` / `-marker` / `-mineru` — local ML pipeline

Layout detection → table/formula models → assembled markdown, locally, no per-page fee. Not
interchangeable:

**Docling (IBM) — the default.** MIT-licensed (the only clean license of the three; decisive for a
distributed CMS). DocLayNet layout + TableFormer; OCR via Tesseract/EasyOCR/RapidOCR; built for
air-gapped enterprise RAG. Quality leader on tables: RT-DETR layout >85% mAP; TableFormer >91% TEDS
on FinTabNet (accurate mode) vs ~75–80% for Marker's tables. Footprint ~4–6 GB VRAM/worker on GPU;
runs on CPU (slower). Outputs DoclingDocument → markdown/JSON/HTML; chunking-aware — exactly the
artifact to feed both search index and RAG.

**Marker (Datalab) — faster generalist, two license layers.** Code is **GPL-3.0**; Surya model
weights ship under a **modified AI Pubs Open Rail-M** license that requires a **paid commercial
license for organizations above $2M in funding or revenue**. So "free for you" depends on Infonomic's
revenue and clients' — a real gate. Surya supports 90+ languages; runs GPU/CPU/Apple MPS; optional
`--use_llm` flag layers an LLM for accuracy-critical pages; ~3–5 GB VRAM/worker. MPS support helps for
prototyping on Apple Silicon (e.g. the M5 Mac), though production wants CUDA.

**MinerU (OpenDataLab) — the specialist.** Best-in-class formula recognition (UniMERNet) and strongest
multi-column scientific-paper handling; heaviest and slowest; needs Docker + CUDA. **AGPL-3.0** and
currently depends on PyMuPDF (also AGPL); the team has said they plan to swap for something more
permissive. Reach for it only when a corpus is equation-dense enough that Docling's formula handling
isn't sufficient.

**For the FORRU library** (research PDFs, mostly born-digital, tables/figures, occasional scans):
**Docling** is the right Tier 2 default — clean license, best tables, CPU-capable, chunking-aware. Run
it as a Python service on a Fly machine or the Ubuntu box, with the fast tier in front doing the
born-digital majority and the page-router sending only scanned/complex pages through.

### 4.3 `@byline/extract-vlm` — self-hosted VLM for the hard ~5%

Escalation target for scanned, handwritten, stamp-laden, chart-heavy, or Thai pages that defeat the
pipeline OCR fallbacks. (Built-in OCR in Docling/Marker/MinerU handles clean scans but struggles with
low-quality scans, handwriting, stamps, and mixed-script — route those to a VLM first.)

- **PaddleOCR-VL (Baidu) — start here.** A 0.9B VLM (NaViT-style encoder + ERNIE-4.5-0.3B; RT-DETR
  layout + pointer network for reading order) supporting **109 languages** and explicitly recognizing
  text, tables, formulas, **and charts**. ~2–4 GB VRAM at FP16; ~45 pages/min on an L40S with
  vLLM/SGLang; AMD ROCm day-0 support exists. **Apache-2.0** — permissive, fits a commercial product.
- **DeepSeek-OCR — the throughput/cost play.** MoE activating ~570M of ~3B params/step; ~100
  languages; "contexts optical compression" for efficiency; DeepSeek-OCR-2 processes ~200K pages/day
  on one A100; L40S supports batch≈16. **MIT.** Tradeoff: compression focus can cost accuracy on
  complex layouts, unusual fonts, poor scans — the exact edge cases you'd escalate *to* it for, so
  validate first.
- **dots.ocr — evaluate, don't assume.** Competent single-model multilingual layout parser
  (benchmarks near Mistral OCR/Marker); confirm its license on the model card and test Thai
  specifically.

**Serving notes:** use **vLLM** for mixed document types; switch to **SGLang** for large batches of
same-template docs (RadixAttention prefix caching adds 20–40% throughput). Rasterize pages at
150–200 DPI; ~1080p works, but very high-res (1440p/4K) inputs can cause text to be missed.

**Cost:** self-hosting wins at volume — PaddleOCR-VL on an L40S runs roughly **$7 per 10,000 pages**
vs ~**$15 per 10,000** for AWS Textract basic text, and the self-hosted model returns structured
tables Textract bills extra for.

**Thai caveat (honest):** no published Thai-specific benchmarks to point to. PaddleOCR-VL's 109-lang
list and DeepSeek's ~100 strongly imply coverage, but Thai's absent word boundaries and stacked tone
marks are exactly where OCR degrades — a "run a private eval on real FORRU/Thai docs" decision, not a
spec-sheet one. **Avoid GLM-OCR here** despite strong table scores: it officially supports only 8
languages (Chinese, English, French, Spanish, Russian, German, Japanese, Korean) — no Thai. An
Apple-Silicon machine is fine for *developing* against this tier, but CUDA-first serving stacks mean
production VLM inference wants an actual NVIDIA card (rented L40S/A100 or a dedicated GPU box) rather
than MPS.

### 4.4 The shape of it

Read as an escalation ladder driven by the page-router:

1. born-digital → `extract-fast` (Node-native, zero cost)
2. scanned/complex → `extract-docling` (MIT, best tables, CPU-capable)
3. residual hard pages → `extract-vlm` (PaddleOCR-VL on a GPU) only when a page fails the cheaper tiers

This keeps a 10,000-page library's cost dominated by the free path while still handling the nasty Thai
scan in the corner.

**Licensing bottom line:** Docling (MIT) and PaddleOCR-VL (Apache-2.0) give a clean permissive spine
end-to-end. PyMuPDF (AGPL), Marker (GPL + revenue-gated Surya weights), and MinerU (AGPL) each carry
strings to manage. Build the default ladder from the permissive ones; treat the others as opt-in
adapters a client can enable knowingly.

---

## 5. Tika + Solr, and routing

**Is the existing Tika+Solr setup the `extract-fast` scenario?** Functionally it overlaps
`extract-fast` for born-digital PDFs, but it's best treated as its **own adapter**, `@byline/extract-tika`.

- For born-digital PDFs, Tika (via PDFBox) reads the existing text layer → flat text + metadata. Same
  fidelity class as `extract-fast`: searchable text, no real table reconstruction, no structured
  markdown, no reading-order ML.
- **Tika's actual superpower is format breadth** — one API over 1,000+ formats (PDF, all Office types,
  HTML, email, archives) that the Node/Python PDF tools don't match.
- With the **Tesseract** parser enabled it also does OCR, so it straddles up into a basic scanned-page
  capability — but Tesseract is the **weakest OCR rung** (fine on clean scans; poor on low-quality
  scans, complex tables, handwriting, and Thai-script edge cases).
- Tika gives Solr searchable text (great for the full-text/faceted **search** tier) but its tables
  come out as mangled flowed text and there's no structured markdown — a **weak feed for RAG** or for
  anything needing faithful table data.
- The whole **Tika/PDFBox/Tesseract stack is Apache-2.0** — permissive, no copyleft string to manage.
  Permissive, broad, and already running: a strong pragmatic default for the Solr-centric Tier 2.

**Can complex/scanned pages route elsewhere? Yes** — and because Tika already runs out-of-process as a
Tika Server (REST), the router sits in front of it (not inside Solr). Two patterns, likely both:

- **Pre-extraction classification (clean pattern).** Before anything, check each document/page: has a
  text layer? image-only? table-/chart-heavy? Route: born-digital simple → Tika (already feeds Solr
  natively); image-only/scanned → skip Tika's Tesseract, send to the VLM tier (PaddleOCR-VL for
  scans/Thai/charts); table-/formula-heavy → Docling for real table structure. Every path writes text
  back into the **same Solr index**, so downstream search is agnostic to which extractor produced a
  document. Detection is cheap: a scanned page yields empty/near-empty text from PDFBox — the same
  deterministic "escalate" signal as the Node fast tier.
- **Replace Tika's OCR specifically (narrow, lowest-disruption).** Keep Tika for born-digital text and
  format breadth, but intercept image-only pages and route them to PaddleOCR-VL/DeepSeek-OCR instead
  of Tesseract, then hand the VLM's text back to Tika's pipeline or straight to Solr. Keeps everything
  in place and just swaps the weakest component for the residual pages.

**Decision to make explicit: route on *output quality for the downstream consumer*, not just
"scanned vs not."** A born-digital page with a dense financial-style table passes the text-layer test
(Tika won't flag it) but Tika still flattens that table into unusable text. If a collection feeds RAG
or needs faithful table data, send its table-heavy pages to Docling **even when born-digital**. For
plain full-text search, Tika's flat output is good enough and not worth the extra hop.

**In the Byline adapter model:** `@byline/extract-tika` is a first-class adapter at fast-tier fidelity
but with the broadest format reach and an optional (weak) OCR flag; the `@byline/extract` router
escalates the pages it can't serve well — scanned → `extract-vlm`, table/formula-heavy →
`extract-docling` — with all paths normalizing to the same contract and landing in Solr. Given Tika +
Solr are already operated together, keep **Tika as the default extraction path for the Solr tier** and
treat the other two as escalation targets the router reaches for only on the pages that fail Tika's
strengths, rather than ripping anything out.

---

## Appendix — open implementation threads

These were identified as natural next steps and are **not yet specified**:

1. **`@byline/search` interface** — normalized facet/aggregate model reconciling Solr facets, Elastic
   aggregations, and Postgres GROUP-BY into one shape; capability flags.
2. **`@byline/extract` interface** — normalized output contract
   (`markdown`, `blocks[]`, `tables`, `figures`, `readingOrder`, `language`, `confidence`),
   capability flags, and the page-router signature.
3. **Router classification signals** — text-layer presence, image-area ratio, table density — and a
   **per-collection policy** that decides how aggressively to escalate based on whether the target is
   search-only or also RAG.
