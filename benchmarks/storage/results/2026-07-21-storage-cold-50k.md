# Storage benchmark — scale 50,000

- Run at: 2026-07-21T13:29:37.700Z
- Platform: darwin arm64 / Apple M1 Pro / 32 GB RAM
- Node: v24.15.0
- Warmup: 10, measured iterations: 50
- Media pool: 1000 docs

## Query timings

| Query | Median (ms) | p95 (ms) | Min | Max |
|---|---:|---:|---:|---:|
| getDocumentById (full reconstruct) | 3.71 | 4.95 | 2.96 | 8.84 |
| getDocumentById (select=['title']) | 1.62 | 2.36 | 1.38 | 2.80 |
| findDocuments (page 1, size 20) | 134.91 | 138.77 | 130.06 | 142.96 |
| findDocuments (where title $contains 'storage', sort by views desc) | 455.08 | 462.25 | 449.82 | 465.12 |
| getDocumentsByDocumentIds (batch of 50) | 7.10 | 8.72 | 6.58 | 9.47 |
| populateDocuments (depth 2, 20 source docs × 1 relation) | 2.91 | 3.49 | 2.65 | 3.87 |

## EXPLAIN (ANALYZE, BUFFERS)

### findDocuments list (page size 20)

```sql
SELECT d.*
    FROM byline_current_documents d
    WHERE d.collection_id = $1
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 20 OFFSET 0
```

```
Limit  (cost=6536.52..6536.57 rows=20 width=130) (actual time=96.552..96.556 rows=20.00 loops=1)
  Buffers: shared hit=199630
  ->  Sort  (cost=6536.52..6536.96 rows=178 width=130) (actual time=96.551..96.553 rows=20.00 loops=1)
        Sort Key: sq.created_at DESC, sq.id DESC
        Sort Method: top-N heapsort  Memory: 30kB
        Buffers: shared hit=199630
        ->  Nested Loop  (cost=0.65..6531.78 rows=178 width=130) (actual time=1.562..86.070 rows=50000.00 loops=1)
              Buffers: shared hit=199624
              ->  Subquery Scan on sq  (cost=0.36..5345.05 rows=178 width=124) (actual time=1.550..44.780 rows=50000.00 loops=1)
                    Filter: ((sq.rn = 1) AND (sq.collection_id = '019f84dc-df49-71ac-88c6-bd87605e63ab'::uuid))
                    Rows Removed by Filter: 1271
                    Buffers: shared hit=49624
                    ->  WindowAgg  (cost=0.36..4769.08 rows=38398 width=132) (actual time=0.041..40.540 rows=51271.00 loops=1)
                          Window: w1 AS (PARTITION BY byline_document_versions.document_id ORDER BY byline_document_versions.id ROWS UNBOUNDED PRECEDING)
                          Run Condition: (row_number() OVER w1 <= 1)
                          Storage: Memory  Maximum Storage: 17kB
                          Buffers: shared hit=49624
                          ->  Incremental Sort  (cost=0.36..4097.11 rows=38398 width=124) (actual time=0.037..25.969 rows=52189.00 loops=1)
                                Sort Key: byline_document_versions.document_id, byline_document_versions.id DESC
                                Presorted Key: byline_document_versions.document_id
                                Full-sort Groups: 1626  Sort Method: quicksort  Average Memory: 28kB  Peak Memory: 28kB
                                Buffers: shared hit=49624
                                ->  Index Scan using idx_documents_document_id on byline_document_versions  (cost=0.29..2411.13 rows=38398 width=124) (actual time=0.011..14.772 rows=52189.00 loops=1)
                                      Filter: (NOT is_deleted)
                                      Rows Removed by Filter: 72
                                      Index Searches: 1
                                      Buffers: shared hit=49624
              ->  Index Scan using byline_documents_pkey on byline_documents  (cost=0.29..6.67 rows=1 width=22) (actual time=0.001..0.001 rows=1.00 loops=50000)
                    Index Cond: (id = sq.document_id)
                    Index Searches: 50000
                    Buffers: shared hit=150000
Planning:
  Buffers: shared hit=349
Planning Time: 2.416 ms
Execution Time: 96.620 ms
```

### findDocuments with $contains + numeric sort

```sql
SELECT d.*
    FROM byline_current_documents d
    LEFT JOIN LATERAL (
      SELECT value_integer AS _sort_value
      FROM byline_store_numeric
      WHERE document_version_id = d.id
        AND field_name = 'views'
        AND (locale = 'en' OR locale = 'all')
      LIMIT 1
    ) _sort ON true
    WHERE d.collection_id = $1
      AND EXISTS (
        SELECT 1 FROM byline_store_text
        WHERE document_version_id = d.id
          AND field_name = 'title'
          AND (locale = 'en' OR locale = 'all')
          AND value ILIKE '%storage%'
      )
    ORDER BY _sort._sort_value DESC NULLS LAST
    LIMIT 20
```

```
Limit  (cost=16566.30..16566.35 rows=20 width=134) (actual time=258.430..258.436 rows=20.00 loops=1)
  Buffers: shared hit=217571
  ->  Sort  (cost=16566.30..16566.42 rows=48 width=134) (actual time=258.429..258.434 rows=20.00 loops=1)
        Sort Key: byline_store_numeric.value_integer DESC NULLS LAST
        Sort Method: top-N heapsort  Memory: 29kB
        Buffers: shared hit=217571
        ->  Nested Loop Left Join  (cost=6534.42..16565.02 rows=48 width=134) (actual time=99.429..257.785 rows=3333.00 loops=1)
              Buffers: shared hit=217568
              ->  Hash Right Semi Join  (cost=6534.01..14583.39 rows=48 width=130) (actual time=99.388..248.977 rows=3333.00 loops=1)
                    Hash Cond: (byline_store_text.document_version_id = sq.id)
                    Buffers: shared hit=204230
                    ->  Seq Scan on byline_store_text  (cost=0.00..8005.98 rows=11445 width=16) (actual time=0.254..150.592 rows=3354.00 loops=1)
                          Filter: ((value ~~* '%storage%'::text) AND ((field_name)::text = 'title'::text) AND (((locale)::text = 'en'::text) OR ((locale)::text = 'all'::text)))
                          Rows Removed by Filter: 203045
                          Buffers: shared hit=4606
                    ->  Hash  (cost=6531.78..6531.78 rows=178 width=130) (actual time=96.210..96.212 rows=50000.00 loops=1)
                          Buckets: 65536 (originally 1024)  Batches: 1 (originally 1)  Memory Usage: 6909kB
                          Buffers: shared hit=199624
                          ->  Nested Loop  (cost=0.65..6531.78 rows=178 width=130) (actual time=1.511..85.861 rows=50000.00 loops=1)
                                Buffers: shared hit=199624
                                ->  Subquery Scan on sq  (cost=0.36..5345.05 rows=178 width=124) (actual time=1.504..44.036 rows=50000.00 loops=1)
                                      Filter: ((sq.rn = 1) AND (sq.collection_id = '019f84dc-df49-71ac-88c6-bd87605e63ab'::uuid))
                                      Rows Removed by Filter: 1271
                                      Buffers: shared hit=49624
                                      ->  WindowAgg  (cost=0.36..4769.08 rows=38398 width=132) (actual time=0.039..39.719 rows=51271.00 loops=1)
                                            Window: w1 AS (PARTITION BY byline_document_versions.document_id ORDER BY byline_document_versions.id ROWS UNBOUNDED PRECEDING)
                                            Run Condition: (row_number() OVER w1 <= 1)
                                            Storage: Memory  Maximum Storage: 17kB
                                            Buffers: shared hit=49624
                                            ->  Incremental Sort  (cost=0.36..4097.11 rows=38398 width=124) (actual time=0.035..25.181 rows=52189.00 loops=1)
                                                  Sort Key: byline_document_versions.document_id, byline_document_versions.id DESC
                                                  Presorted Key: byline_document_versions.document_id
                                                  Full-sort Groups: 1626  Sort Method: quicksort  Average Memory: 28kB  Peak Memory: 28kB
                                                  Buffers: shared hit=49624
                                                  ->  Index Scan using idx_documents_document_id on byline_document_versions  (cost=0.29..2411.13 rows=38398 width=124) (actual time=0.008..14.110 rows=52189.00 loops=1)
                                                        Filter: (NOT is_deleted)
                                                        Rows Removed by Filter: 72
                                                        Index Searches: 1
                                                        Buffers: shared hit=49624
                                ->  Index Scan using byline_documents_pkey on byline_documents  (cost=0.29..6.67 rows=1 width=22) (actual time=0.001..0.001 rows=1.00 loops=50000)
                                      Index Cond: (id = sq.document_id)
                                      Index Searches: 50000
                                      Buffers: shared hit=150000
              ->  Limit  (cost=0.42..41.27 rows=1 width=4) (actual time=0.002..0.002 rows=1.00 loops=3333)
                    Buffers: shared hit=13338
                    ->  Index Scan using unique_numeric_field on byline_store_numeric  (cost=0.42..41.27 rows=1 width=4) (actual time=0.002..0.002 rows=1.00 loops=3333)
                          Index Cond: ((document_version_id = sq.id) AND ((locale)::text = ANY ('{en,all}'::text[])))
                          Filter: ((field_name)::text = 'views'::text)
                          Rows Removed by Filter: 1
                          Index Searches: 3333
                          Buffers: shared hit=13338
Planning:
  Buffers: shared hit=312 read=5
Planning Time: 5.732 ms
Execution Time: 258.585 ms
```

### getDocumentsByDocumentIds (batch of 50)

```sql
SELECT *
    FROM byline_current_documents
    WHERE collection_id = $1
      AND document_id = ANY($2)
```

```
Nested Loop  (cost=4.74..219.80 rows=1 width=130) (actual time=0.056..0.134 rows=50.00 loops=1)
  Buffers: shared hit=200
  ->  Subquery Scan on sq  (cost=4.45..211.50 rows=1 width=124) (actual time=0.052..0.082 rows=50.00 loops=1)
        Filter: ((sq.rn = 1) AND (sq.collection_id = '019f84dc-df49-71ac-88c6-bd87605e63ab'::uuid))
        Buffers: shared hit=50
        ->  WindowAgg  (cost=4.45..210.75 rows=50 width=132) (actual time=0.052..0.077 rows=50.00 loops=1)
              Window: w1 AS (PARTITION BY byline_document_versions.document_id ORDER BY byline_document_versions.id ROWS UNBOUNDED PRECEDING)
              Run Condition: (row_number() OVER w1 <= 1)
              Storage: Memory  Maximum Storage: 17kB
              Buffers: shared hit=50
              ->  Incremental Sort  (cost=4.45..209.87 rows=50 width=124) (actual time=0.049..0.060 rows=50.00 loops=1)
                    Sort Key: byline_document_versions.document_id, byline_document_versions.id DESC
                    Presorted Key: byline_document_versions.document_id
                    Full-sort Groups: 2  Sort Method: quicksort  Average Memory: 28kB  Peak Memory: 28kB
                    Buffers: shared hit=50
                    ->  Index Scan using idx_documents_document_id on byline_document_versions  (cost=0.29..207.62 rows=50 width=124) (actual time=0.013..0.040 rows=50.00 loops=1)
                          Index Cond: (document_id = ANY ('{019f84dd-89b2-71ed-9cd7-b0f64451fc2f,019f84dd-89af-74a9-8327-72eecaa29ce0,019f84dd-89af-74a9-8327-6f1db71487a3,019f84dd-89af-74a9-8327-6758d1ad6037,019f84dd-89af-74a9-8327-6ab64755d792,019f84dd-89af-74a9-8327-60892da68a23,019f84dd-89ae-7193-9de8-4e0d7b421407,019f84dd-89ae-7193-9de8-4bc8c9e07043,019f84dd-89ae-7193-9de8-4741080ab2d6,019f84dd-89ae-7193-9de8-40e31a736ec1,019f84dd-89ae-7193-9de8-3d4ece1bf4d0,019f84dd-89ae-7193-9de8-50be28ee5d60,019f84dd-89ad-71eb-a681-30b1eb0a9652,019f84dd-89ab-72eb-b830-b838ea9cd3c0,019f84dd-89ab-72eb-b830-aef5f873a991,019f84dd-89ab-72eb-b830-b12f97cb5b27,019f84dd-89aa-71dc-8110-81fb14bb176c,019f84dd-89ab-72eb-b830-b7097bfa71e9,019f84dd-89aa-71dc-8110-7c9c9b835dd7,019f84dd-89aa-71dc-8110-7b4f42f798a8,019f84dd-899e-71bc-a3b2-8b396c2e0f10,019f84dd-899e-71bc-a3b2-82bebbe2c5cd,019f84dd-899d-779c-bca1-b6e261422e88,019f84dd-899d-779c-bca1-a70c73b32d39,019f84dd-899d-779c-bca1-a1cf2c02a104,019f84dd-899d-779c-bca1-9e5ee29a34b4,019f84dd-899e-71bc-a3b2-84e7a6d83631,019f84dd-899d-779c-bca1-99fcdd3880b6,019f84dd-899d-779c-bca1-92a61df66123,019f84dd-899d-779c-bca1-954afcb602f8,019f84dd-899d-779c-bca1-8c80121042e4,019f84dd-899d-779c-bca1-b8940b405393,019f84dd-899d-779c-bca1-888c9dc8cf58,019f84dd-899d-779c-bca1-ada3cb8a7ece,019f84dd-899c-701f-8d91-b9ee6459b664,019f84dd-899d-779c-bca1-aaa4368e2a30,019f84dd-899d-779c-bca1-b2c109c69d5e,019f84dd-899c-701f-8d91-b5f64c73884d,019f84dd-899c-701f-8d91-b0c06dfc625e,019f84dd-899c-701f-8d91-ac19b3b6df6e,019f84dd-8993-7285-851d-96b4f522186f,019f84dd-8991-70f9-ab63-5127229a810c,019f84dd-898f-71de-ba6e-7c2f97a4d618,019f84dd-898f-71de-ba6e-68c2742204e7,019f84dd-898f-71de-ba6e-65cbad348606,019f84dd-898f-71de-ba6e-6351b1a18c70,019f84dd-898e-735c-93c9-e8376abfb60e,019f84dd-898e-735c-93c9-e6960fcede05,019f84dd-898e-735c-93c9-e0c400383d4f,019f84dd-898d-7190-a005-6e85a10e4bed}'::uuid[]))
                          Filter: (NOT is_deleted)
                          Index Searches: 1
                          Buffers: shared hit=50
  ->  Index Scan using byline_documents_pkey on byline_documents  (cost=0.29..8.31 rows=1 width=22) (actual time=0.001..0.001 rows=1.00 loops=50)
        Index Cond: (id = sq.document_id)
        Index Searches: 50
        Buffers: shared hit=150
Planning:
  Buffers: shared hit=9
Planning Time: 0.233 ms
Execution Time: 0.154 ms
```

