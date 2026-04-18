
> @byline/bench-storage@0.0.0 bench /Users/tony/Clients/Infonomic/Projects/Byline/Solutions/bylinecms.dev/benchmarks/storage
> tsx --env-file=../../packages/db-postgres/.env harness/run-bench.ts --scale 10000

# Storage benchmark — scale 10,000

- Run at: 2026-04-18T11:34:41.452Z
- Platform: darwin arm64 / Apple M1 Pro / 32 GB RAM
- Node: v24.14.0
- Warmup: 10, measured iterations: 50
- Media pool: 200 docs

## Query timings

| Query | Median (ms) | p95 (ms) | Min | Max |
|---|---:|---:|---:|---:|
| getDocumentById (full reconstruct) | 2.80 | 3.19 | 2.37 | 3.28 |
| getDocumentById (select=['title']) | 1.67 | 1.98 | 1.35 | 2.28 |
| findDocuments (page 1, size 20) | 16.72 | 21.10 | 15.65 | 21.20 |
| findDocuments (where title $contains 'storage', sort by views desc) | 147.09 | 149.82 | 140.46 | 152.78 |
| getDocumentsByDocumentIds (batch of 50) | 7.10 | 8.93 | 6.44 | 9.50 |
| populateDocuments (depth 2, 20 source docs × 1 relation) | 2.84 | 3.23 | 2.52 | 3.43 |

## EXPLAIN (ANALYZE, BUFFERS)

### findDocuments list (page size 20)

```sql
SELECT d.*
    FROM current_documents d
    WHERE d.collection_id = $1
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 20 OFFSET 0
```

```
Limit  (cost=1227.02..1227.03 rows=1 width=150) (actual time=10.662..10.666 rows=20.00 loops=1)
  Buffers: shared hit=227
  ->  Sort  (cost=1227.02..1227.03 rows=1 width=150) (actual time=10.659..10.661 rows=20.00 loops=1)
        Sort Key: sq.created_at DESC, sq.id DESC
        Sort Method: top-N heapsort  Memory: 30kB
        Buffers: shared hit=227
        ->  Subquery Scan on sq  (cost=909.28..1227.01 rows=1 width=150) (actual time=4.771..8.758 rows=10000.00 loops=1)
              Filter: ((sq.rn = 1) AND (sq.collection_id = '019da05e-8c25-775d-befb-cac57dce87e4'::uuid))
              Rows Removed by Filter: 1210
              Buffers: shared hit=221
              ->  WindowAgg  (cost=909.28..1090.84 rows=9078 width=158) (actual time=4.348..7.714 rows=11210.00 loops=1)
                    Window: w1 AS (PARTITION BY document_versions.document_id ORDER BY document_versions.id ROWS UNBOUNDED PRECEDING)
                    Run Condition: (row_number() OVER w1 <= 1)
                    Storage: Memory  Maximum Storage: 17kB
                    Buffers: shared hit=221
                    ->  Sort  (cost=909.28..931.98 rows=9078 width=150) (actual time=4.341..4.865 rows=11234.00 loops=1)
                          Sort Key: document_versions.document_id, document_versions.id DESC
                          Sort Method: quicksort  Memory: 1797kB
                          Buffers: shared hit=221
                          ->  Seq Scan on document_versions  (cost=0.00..312.49 rows=9078 width=150) (actual time=0.012..1.425 rows=11234.00 loops=1)
                                Filter: (NOT is_deleted)
                                Rows Removed by Filter: 16
                                Buffers: shared hit=221
Planning:
  Buffers: shared hit=268
Planning Time: 1.194 ms
Execution Time: 10.767 ms
```

### findDocuments with $contains + numeric sort

```sql
SELECT d.*
    FROM current_documents d
    LEFT JOIN LATERAL (
      SELECT value_integer AS _sort_value
      FROM store_numeric
      WHERE document_version_id = d.id
        AND field_name = 'views'
        AND (locale = 'en' OR locale = 'all')
      LIMIT 1
    ) _sort ON true
    WHERE d.collection_id = $1
      AND EXISTS (
        SELECT 1 FROM store_text
        WHERE document_version_id = d.id
          AND field_name = 'title'
          AND (locale = 'en' OR locale = 'all')
          AND value ILIKE '%storage%'
      )
    ORDER BY _sort._sort_value DESC NULLS LAST
    LIMIT 20
```

```
Limit  (cost=1555.16..1555.16 rows=1 width=154) (actual time=79.206..79.210 rows=20.00 loops=1)
  Buffers: shared hit=71726
  ->  Sort  (cost=1555.16..1555.16 rows=1 width=154) (actual time=79.205..79.207 rows=20.00 loops=1)
        Sort Key: store_numeric.value_integer DESC NULLS LAST
        Sort Method: top-N heapsort  Memory: 33kB
        Buffers: shared hit=71726
        ->  Nested Loop Semi Join  (cost=909.99..1555.15 rows=1 width=154) (actual time=4.586..79.055 rows=666.00 loops=1)
              Buffers: shared hit=71723
              ->  Nested Loop Left Join  (cost=909.57..1275.88 rows=1 width=154) (actual time=4.449..28.741 rows=10000.00 loops=1)
                    Buffers: shared hit=30259
                    ->  Subquery Scan on sq  (cost=909.28..1227.01 rows=1 width=150) (actual time=4.397..9.078 rows=10000.00 loops=1)
                          Filter: ((sq.rn = 1) AND (sq.collection_id = '019da05e-8c25-775d-befb-cac57dce87e4'::uuid))
                          Rows Removed by Filter: 1210
                          Buffers: shared hit=221
                          ->  WindowAgg  (cost=909.28..1090.84 rows=9078 width=158) (actual time=3.967..7.990 rows=11210.00 loops=1)
                                Window: w1 AS (PARTITION BY document_versions.document_id ORDER BY document_versions.id ROWS UNBOUNDED PRECEDING)
                                Run Condition: (row_number() OVER w1 <= 1)
                                Storage: Memory  Maximum Storage: 17kB
                                Buffers: shared hit=221
                                ->  Sort  (cost=909.28..931.98 rows=9078 width=150) (actual time=3.960..4.503 rows=11234.00 loops=1)
                                      Sort Key: document_versions.document_id, document_versions.id DESC
                                      Sort Method: quicksort  Memory: 1797kB
                                      Buffers: shared hit=221
                                      ->  Seq Scan on document_versions  (cost=0.00..312.49 rows=9078 width=150) (actual time=0.003..1.137 rows=11234.00 loops=1)
                                            Filter: (NOT is_deleted)
                                            Rows Removed by Filter: 16
                                            Buffers: shared hit=221
                    ->  Limit  (cost=0.29..48.86 rows=1 width=4) (actual time=0.002..0.002 rows=1.00 loops=10000)
                          Buffers: shared hit=30038
                          ->  Index Scan using unique_numeric_field on store_numeric  (cost=0.29..48.86 rows=1 width=4) (actual time=0.002..0.002 rows=1.00 loops=10000)
                                Index Cond: ((document_version_id = sq.id) AND ((locale)::text = ANY ('{en,all}'::text[])))
                                Filter: ((field_name)::text = 'views'::text)
                                Rows Removed by Filter: 1
                                Index Searches: 10000
                                Buffers: shared hit=30038
              ->  Index Scan using unique_text_field on store_text  (cost=0.41..139.84 rows=1 width=16) (actual time=0.005..0.005 rows=0.07 loops=10000)
                    Index Cond: ((document_version_id = sq.id) AND ((locale)::text = ANY ('{en,all}'::text[])))
                    Filter: ((value ~~* '%storage%'::text) AND ((field_name)::text = 'title'::text))
                    Rows Removed by Filter: 4
                    Index Searches: 10000
                    Buffers: shared hit=41464
Planning:
  Buffers: shared hit=356
Planning Time: 1.870 ms
Execution Time: 79.368 ms
```

### getDocumentsByDocumentIds (batch of 50)

```sql
SELECT *
    FROM current_documents
    WHERE collection_id = $1
      AND document_id = ANY($2)
```

```
Subquery Scan on sq  (cost=1.98..86.50 rows=1 width=150) (actual time=0.045..0.073 rows=50.00 loops=1)
  Filter: ((sq.rn = 1) AND (sq.collection_id = '019da05e-8c25-775d-befb-cac57dce87e4'::uuid))
  Buffers: shared hit=48
  ->  WindowAgg  (cost=1.98..85.76 rows=49 width=158) (actual time=0.044..0.067 rows=50.00 loops=1)
        Window: w1 AS (PARTITION BY document_versions.document_id ORDER BY document_versions.id ROWS UNBOUNDED PRECEDING)
        Run Condition: (row_number() OVER w1 <= 1)
        Storage: Memory  Maximum Storage: 17kB
        Buffers: shared hit=48
        ->  Incremental Sort  (cost=1.98..84.90 rows=49 width=150) (actual time=0.042..0.052 rows=50.00 loops=1)
              Sort Key: document_versions.document_id, document_versions.id DESC
              Presorted Key: document_versions.document_id
              Full-sort Groups: 2  Sort Method: quicksort  Average Memory: 29kB  Peak Memory: 29kB
              Buffers: shared hit=48
              ->  Index Scan using idx_documents_document_id on document_versions  (cost=0.29..82.70 rows=49 width=150) (actual time=0.015..0.037 rows=50.00 loops=1)
                    Index Cond: (document_id = ANY ('{019da05e-a8ce-704a-b3fd-8d7de4f6b4bb,019da05e-a8cd-75bc-bc96-953f1a1ab85a,019da05e-a8cb-7037-88f5-427dc2b7d121,019da05e-a8ca-77fb-82fe-e903d28ce5ab,019da05e-a8ca-77fb-82fe-e39937421431,019da05e-a8ca-77fb-82fe-d969ee4aeab1,019da05e-a8ca-77fb-82fe-df67735dbcde,019da05e-a8ca-77fb-82fe-ce9098bb0675,019da05e-a8ca-77fb-82fe-d45245dd13de,019da05e-a8ca-77fb-82fe-d397ee7b03dd,019da05e-a8ca-77fb-82fe-c3aab713a78a,019da05e-a8ca-77fb-82fe-ca47c16359bc,019da05e-a8ca-77fb-82fe-c769172bc805,019da05e-a8ca-77fb-82fe-ba6982e0d983,019da05e-a8ca-77fb-82fe-bd7c2cc7d28b,019da05e-a8ca-77fb-82fe-b4080919bb1f,019da05e-a8c9-76e8-a77d-0c4373d8e9da,019da05e-a8c7-74ba-9423-e3453b4fcbe4,019da05e-a8c7-74ba-9423-dfa8be435293,019da05e-a8c7-74ba-9423-d864b47833ed,019da05e-a8bc-756b-ae58-53a5cbc5e977,019da05e-a8bc-756b-ae58-4a30e3fa894d,019da05e-a8bc-756b-ae58-4ce292103100,019da05e-a8bc-756b-ae58-47b6c15e35d7,019da05e-a8bc-756b-ae58-43154a3e3fd8,019da05e-a8bc-756b-ae58-3fd3843d8101,019da05e-a8bc-756b-ae58-38711090f865,019da05e-a8bc-756b-ae58-350fea375fdc,019da05e-a8bc-756b-ae58-30e1ef946622,019da05e-a8bc-756b-ae58-2f305fdddcd4,019da05e-a8bc-756b-ae58-2a5cc701f3e6,019da05e-a8bb-719e-8f6a-7e8b13c9ef98,019da05e-a8bc-756b-ae58-248dc092d0ec,019da05e-a8bb-719e-8f6a-836fa5d2cd8b,019da05e-a8bb-719e-8f6a-779b0ea1278e,019da05e-a8bb-719e-8f6a-71a1e3563442,019da05e-a8bb-719e-8f6a-796742b7215c,019da05e-a8bb-719e-8f6a-6ceb2b39245b,019da05e-a8bb-719e-8f6a-687f95580cd0,019da05e-a8bb-719e-8f6a-6583bf611e88,019da05e-a8b0-7122-a4e1-6c932c8b1099,019da05e-a8ae-726c-8e3c-c963faeb4ac5,019da05e-a8ae-726c-8e3c-ccdc636ddd9c,019da05e-a8ae-726c-8e3c-d00783e695f1,019da05e-a8ae-726c-8e3c-c5495ae74d48,019da05e-a8ad-73a5-a956-12fd72ba2397,019da05e-a8ad-73a5-a955-d33aaea647eb,019da05e-a8ad-73a5-a955-d7fa2690cf9e,019da05e-a8ac-73d4-acdc-c6df1bbbf26a,019da05e-a8ad-73a5-a955-cd43f64c9cfb}'::uuid[]))
                    Filter: (NOT is_deleted)
                    Index Searches: 1
                    Buffers: shared hit=48
Planning:
  Buffers: shared hit=6
Planning Time: 0.162 ms
Execution Time: 0.094 ms
```

