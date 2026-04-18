
> @byline/bench-storage@0.0.0 bench /Users/tony/Clients/Infonomic/Projects/Byline/Solutions/bylinecms.dev/benchmarks/storage
> tsx --env-file=../../packages/db-postgres/.env harness/run-bench.ts --scale 100000

# Storage benchmark — scale 100,000

- Run at: 2026-04-18T11:38:35.586Z
- Platform: darwin arm64 / Apple M1 Pro / 32 GB RAM
- Node: v24.14.0
- Warmup: 10, measured iterations: 50
- Media pool: 2000 docs

## Query timings

| Query | Median (ms) | p95 (ms) | Min | Max |
|---|---:|---:|---:|---:|
| getDocumentById (full reconstruct) | 3.10 | 5.10 | 2.45 | 5.83 |
| getDocumentById (select=['title']) | 1.63 | 2.33 | 1.27 | 4.46 |
| findDocuments (page 1, size 20) | 128.68 | 132.52 | 125.10 | 136.94 |
| findDocuments (where title $contains 'storage', sort by views desc) | 351.59 | 364.24 | 345.71 | 375.80 |
| getDocumentsByDocumentIds (batch of 50) | 7.09 | 10.43 | 6.33 | 17.13 |
| populateDocuments (depth 2, 20 source docs × 1 relation) | 2.78 | 3.17 | 2.34 | 3.22 |

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
Limit  (cost=13056.58..13056.63 rows=20 width=147) (actual time=104.404..104.408 rows=20.00 loops=1)
  Buffers: shared hit=97602
  ->  Sort  (cost=13056.58..13057.84 rows=502 width=147) (actual time=104.403..104.405 rows=20.00 loops=1)
        Sort Key: sq.created_at DESC, sq.id DESC
        Sort Method: top-N heapsort  Memory: 30kB
        Buffers: shared hit=97602
        ->  Subquery Scan on sq  (cost=0.48..13043.22 rows=502 width=147) (actual time=2.351..85.520 rows=100000.00 loops=1)
              Filter: ((sq.rn = 1) AND (sq.collection_id = '019da061-000e-7029-9bfe-5062db28fe97'::uuid))
              Rows Removed by Filter: 3010
              Buffers: shared hit=97596
              ->  WindowAgg  (cost=0.48..11488.40 rows=103655 width=155) (actual time=0.046..75.308 rows=103010.00 loops=1)
                    Window: w1 AS (PARTITION BY document_versions.document_id ORDER BY document_versions.id ROWS UNBOUNDED PRECEDING)
                    Run Condition: (row_number() OVER w1 <= 1)
                    Storage: Memory  Maximum Storage: 17kB
                    Buffers: shared hit=97596
                    ->  Incremental Sort  (cost=0.48..9674.43 rows=103655 width=147) (actual time=0.041..48.378 rows=103034.00 loops=1)
                          Sort Key: document_versions.document_id, document_versions.id DESC
                          Presorted Key: document_versions.document_id
                          Full-sort Groups: 3220  Sort Method: quicksort  Average Memory: 29kB  Peak Memory: 29kB
                          Buffers: shared hit=97596
                          ->  Index Scan using idx_documents_document_id on document_versions  (cost=0.42..5014.37 rows=103655 width=147) (actual time=0.024..28.135 rows=103034.00 loops=1)
                                Filter: (NOT is_deleted)
                                Rows Removed by Filter: 16
                                Index Searches: 1
                                Buffers: shared hit=97596
Planning:
  Buffers: shared hit=247 read=21
Planning Time: 4.804 ms
Execution Time: 104.461 ms
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
Limit  (cost=36066.44..36066.49 rows=20 width=151) (actual time=237.638..237.687 rows=20.00 loops=1)
  Buffers: shared hit=133186, temp read=824 written=824
  ->  Sort  (cost=36066.44..36066.77 rows=134 width=151) (actual time=237.637..237.684 rows=20.00 loops=1)
        Sort Key: store_numeric.value_integer DESC NULLS LAST
        Sort Method: top-N heapsort  Memory: 33kB
        Buffers: shared hit=133186, temp read=824 written=824
        ->  Nested Loop Left Join  (cost=14049.92..36062.87 rows=134 width=151) (actual time=156.319..236.475 rows=6666.00 loops=1)
              Buffers: shared hit=133183, temp read=824 written=824
              ->  Hash Right Semi Join  (cost=14049.50..29261.64 rows=134 width=147) (actual time=156.249..214.926 rows=6666.00 loops=1)
                    Hash Cond: (store_text.document_version_id = sq.id)
                    Buffers: shared hit=106502, temp read=824 written=824
                    ->  Gather  (cost=1000.00..16107.99 rows=27416 width=16) (actual time=4.998..49.703 rows=6666.00 loops=1)
                          Workers Planned: 2
                          Workers Launched: 2
                          Buffers: shared hit=8906
                          ->  Parallel Seq Scan on store_text  (cost=0.00..12366.39 rows=11423 width=16) (actual time=2.269..104.651 rows=2222.00 loops=3)
                                Filter: ((value ~~* '%storage%'::text) AND ((field_name)::text = 'title'::text) AND (((locale)::text = 'en'::text) OR ((locale)::text = 'all'::text)))
                                Rows Removed by Filter: 136194
                                Buffers: shared hit=8906
                    ->  Hash  (cost=13043.22..13043.22 rows=502 width=147) (actual time=150.940..150.942 rows=100000.00 loops=1)
                          Buckets: 65536 (originally 1024)  Batches: 2 (originally 1)  Memory Usage: 7681kB
                          Buffers: shared hit=97596, temp written=808
                          ->  Subquery Scan on sq  (cost=0.48..13043.22 rows=502 width=147) (actual time=2.315..87.126 rows=100000.00 loops=1)
                                Filter: ((sq.rn = 1) AND (sq.collection_id = '019da061-000e-7029-9bfe-5062db28fe97'::uuid))
                                Rows Removed by Filter: 3010
                                Buffers: shared hit=97596
                                ->  WindowAgg  (cost=0.48..11488.40 rows=103655 width=155) (actual time=0.037..76.709 rows=103010.00 loops=1)
                                      Window: w1 AS (PARTITION BY document_versions.document_id ORDER BY document_versions.id ROWS UNBOUNDED PRECEDING)
                                      Run Condition: (row_number() OVER w1 <= 1)
                                      Storage: Memory  Maximum Storage: 17kB
                                      Buffers: shared hit=97596
                                      ->  Incremental Sort  (cost=0.48..9674.43 rows=103655 width=147) (actual time=0.032..48.674 rows=103034.00 loops=1)
                                            Sort Key: document_versions.document_id, document_versions.id DESC
                                            Presorted Key: document_versions.document_id
                                            Full-sort Groups: 3220  Sort Method: quicksort  Average Memory: 29kB  Peak Memory: 29kB
                                            Buffers: shared hit=97596
                                            ->  Index Scan using idx_documents_document_id on document_versions  (cost=0.42..5014.37 rows=103655 width=147) (actual time=0.011..27.757 rows=103034.00 loops=1)
                                                  Filter: (NOT is_deleted)
                                                  Rows Removed by Filter: 16
                                                  Index Searches: 1
                                                  Buffers: shared hit=97596
              ->  Limit  (cost=0.42..50.75 rows=1 width=4) (actual time=0.003..0.003 rows=1.00 loops=6666)
                    Buffers: shared hit=26681
                    ->  Index Scan using unique_numeric_field on store_numeric  (cost=0.42..50.75 rows=1 width=4) (actual time=0.003..0.003 rows=1.00 loops=6666)
                          Index Cond: ((document_version_id = sq.id) AND ((locale)::text = ANY ('{en,all}'::text[])))
                          Filter: ((field_name)::text = 'views'::text)
                          Rows Removed by Filter: 1
                          Index Searches: 6666
                          Buffers: shared hit=26681
Planning:
  Buffers: shared hit=307 read=15
Planning Time: 4.247 ms
Execution Time: 237.917 ms
```

### getDocumentsByDocumentIds (batch of 50)

```sql
SELECT *
    FROM current_documents
    WHERE collection_id = $1
      AND document_id = ANY($2)
```

```
Subquery Scan on sq  (cost=4.78..221.72 rows=1 width=147) (actual time=0.050..0.079 rows=50.00 loops=1)
  Filter: ((sq.rn = 1) AND (sq.collection_id = '019da061-000e-7029-9bfe-5062db28fe97'::uuid))
  Buffers: shared hit=53
  ->  WindowAgg  (cost=4.78..220.97 rows=50 width=155) (actual time=0.049..0.073 rows=50.00 loops=1)
        Window: w1 AS (PARTITION BY document_versions.document_id ORDER BY document_versions.id ROWS UNBOUNDED PRECEDING)
        Run Condition: (row_number() OVER w1 <= 1)
        Storage: Memory  Maximum Storage: 17kB
        Buffers: shared hit=53
        ->  Incremental Sort  (cost=4.78..220.10 rows=50 width=147) (actual time=0.046..0.056 rows=50.00 loops=1)
              Sort Key: document_versions.document_id, document_versions.id DESC
              Presorted Key: document_versions.document_id
              Full-sort Groups: 2  Sort Method: quicksort  Average Memory: 29kB  Peak Memory: 29kB
              Buffers: shared hit=53
              ->  Index Scan using idx_documents_document_id on document_versions  (cost=0.42..217.85 rows=50 width=147) (actual time=0.014..0.039 rows=50.00 loops=1)
                    Index Cond: (document_id = ANY ('{019da062-0acd-77d9-919b-535e928896fb,019da062-0aca-7025-9450-b45559620ee9,019da062-0aca-7025-9450-ad6ee72ba960,019da062-0aca-7025-9450-b31ce7f1c7a0,019da062-0ac9-75df-8ff0-dd5ee6c7411f,019da062-0ac9-75df-8ff0-da9967fbb5a1,019da062-0ac9-75df-8ff0-d0e5c46589b9,019da062-0ac9-75df-8ff0-d6e373b0463c,019da062-0ac9-75df-8ff0-cfeb1409728d,019da062-0ac8-704d-a77d-fa834ba3bfdd,019da062-0ac8-704d-a77d-f6059f772767,019da062-0ac8-704d-a77d-f1456d4b2c02,019da062-0ac8-704d-a77d-edc7b14ff90c,019da062-0ac8-704d-a77d-ea58341dffd1,019da062-0ac8-704d-a77d-e7dbbd61c16c,019da062-0ac8-704d-a77d-e3b15ede040e,019da062-0ac8-704d-a77d-dfde1444f305,019da062-0ac7-70ca-8434-ed138964d672,019da062-0ac7-70ca-8434-e88bf33cf952,019da062-0ac7-70ca-8434-e21b250392a2,019da062-0abd-7434-9e24-9dbb0162a90d,019da062-0abc-735d-bede-18e5d09e4b93,019da062-0abd-7434-9e24-98c978052d46,019da062-0abc-735d-bede-17fba87894db,019da062-0abd-7434-9e24-8af63fa8e489,019da062-0abd-7434-9e24-94bd1cab016e,019da062-0abc-735d-bede-12ff7bcabe51,019da062-0abc-735d-bede-047033e50145,019da062-0abc-735d-bede-091ea73c1425,019da062-0abc-735d-bede-0ffa70a786b2,019da062-0abc-735d-bede-02a0073249df,019da062-0abc-735d-bedd-f4c2da5c2d71,019da062-0abc-735d-bedd-fea0036f20d9,019da062-0abc-735d-bedd-f829e5fdef5a,019da062-0abc-735d-bedd-eb447a95924c,019da062-0abc-735d-bedd-efab4a610a66,019da062-0abc-735d-bedd-e6ee0efb3a6e,019da062-0abc-735d-bedd-f30c09647ce2,019da062-0abc-735d-bedd-e0eff027fc6b,019da062-0abc-735d-bedd-dfafae41f10f,019da062-0ab2-76e9-9307-56f7981ccc0e,019da062-0ab2-76e9-9307-58a1a0dcea63,019da062-0ab1-70d0-9115-22e2626659cb,019da062-0ab1-70d0-9115-2895ea236685,019da062-0ab1-70d0-9115-2ed02d574351,019da062-0ab1-70d0-9115-2583df0af1af,019da062-0ab0-7259-b1ba-880e81e330b9,019da062-0ab1-70d0-9115-1c5c30a2994d,019da062-0ab0-7259-b1ba-831b0fe3aa22,019da062-0aaf-7108-9ac1-364087dab410}'::uuid[]))
                    Filter: (NOT is_deleted)
                    Index Searches: 1
                    Buffers: shared hit=53
Planning:
  Buffers: shared hit=6
Planning Time: 0.162 ms
Execution Time: 0.099 ms
```

