# Storage benchmark — scale 100,000

- Run at: 2026-07-21T13:31:59.156Z
- Platform: darwin arm64 / Apple M1 Pro / 32 GB RAM
- Node: v24.15.0
- Warmup: 10, measured iterations: 50
- Media pool: 2000 docs

## Query timings

| Query | Median (ms) | p95 (ms) | Min | Max |
|---|---:|---:|---:|---:|
| getDocumentById (full reconstruct) | 3.46 | 5.13 | 2.91 | 7.25 |
| getDocumentById (select=['title']) | 1.60 | 2.69 | 1.33 | 3.99 |
| findDocuments (page 1, size 20) | 275.62 | 278.20 | 220.44 | 279.20 |
| findDocuments (where title $contains 'storage', sort by views desc) | 530.34 | 553.00 | 472.19 | 557.09 |
| getDocumentsByDocumentIds (batch of 50) | 6.99 | 7.72 | 6.45 | 8.13 |
| populateDocuments (depth 2, 20 source docs × 1 relation) | 3.24 | 3.66 | 3.07 | 3.87 |

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
Limit  (cost=21851.25..21851.30 rows=20 width=136) (actual time=202.360..202.366 rows=20.00 loops=1)
  Buffers: shared hit=498825 read=12
  ->  Sort  (cost=21851.25..21852.50 rows=499 width=136) (actual time=202.359..202.361 rows=20.00 loops=1)
        Sort Key: sq.created_at DESC, sq.id DESC
        Sort Method: top-N heapsort  Memory: 30kB
        Buffers: shared hit=498825 read=12
        ->  Nested Loop  (cost=0.95..21837.97 rows=499 width=136) (actual time=2.599..181.264 rows=100000.00 loops=1)
              Buffers: shared hit=498819 read=12
              ->  Subquery Scan on sq  (cost=0.54..18720.91 rows=499 width=130) (actual time=2.589..88.826 rows=100000.00 loops=1)
                    Filter: ((sq.rn = 1) AND (sq.collection_id = '019f84de-371c-7674-81e4-737fb9765a69'::uuid))
                    Rows Removed by Filter: 2271
                    Buffers: shared hit=98819 read=12
                    ->  WindowAgg  (cost=0.54..17173.03 rows=103192 width=138) (actual time=0.111..80.267 rows=102271.00 loops=1)
                          Window: w1 AS (PARTITION BY byline_document_versions.document_id ORDER BY byline_document_versions.id ROWS UNBOUNDED PRECEDING)
                          Run Condition: (row_number() OVER w1 <= 1)
                          Storage: Memory  Maximum Storage: 17kB
                          Buffers: shared hit=98819 read=12
                          ->  Incremental Sort  (cost=0.54..15367.17 rows=103192 width=130) (actual time=0.104..50.889 rows=103189.00 loops=1)
                                Sort Key: byline_document_versions.document_id, byline_document_versions.id DESC
                                Presorted Key: byline_document_versions.document_id
                                Full-sort Groups: 3220  Sort Method: quicksort  Average Memory: 28kB  Peak Memory: 28kB
                                Buffers: shared hit=98819 read=12
                                ->  Index Scan using idx_documents_document_id on byline_document_versions  (cost=0.42..10834.16 rows=103192 width=130) (actual time=0.077..28.942 rows=103189.00 loops=1)
                                      Filter: (NOT is_deleted)
                                      Rows Removed by Filter: 72
                                      Index Searches: 1
                                      Buffers: shared hit=98819 read=12
              ->  Index Scan using byline_documents_pkey on byline_documents  (cost=0.42..6.25 rows=1 width=22) (actual time=0.001..0.001 rows=1.00 loops=100000)
                    Index Cond: (id = sq.document_id)
                    Index Searches: 100000
                    Buffers: shared hit=400000
Planning:
  Buffers: shared hit=307 read=47
Planning Time: 5.749 ms
Execution Time: 202.421 ms
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
Limit  (cost=46251.58..46251.63 rows=20 width=140) (actual time=330.686..330.770 rows=20.00 loops=1)
  Buffers: shared hit=533356 read=5030
  ->  Sort  (cost=46251.58..46251.89 rows=123 width=140) (actual time=330.685..330.767 rows=20.00 loops=1)
        Sort Key: byline_store_numeric.value_integer DESC NULLS LAST
        Sort Method: top-N heapsort  Memory: 29kB
        Buffers: shared hit=533356 read=5030
        ->  Nested Loop Left Join  (cost=20203.98..46248.31 rows=123 width=140) (actual time=126.246..329.525 rows=6666.00 loops=1)
              Buffers: shared hit=533353 read=5030
              ->  Hash Semi Join  (cost=20203.56..42043.72 rows=123 width=136) (actual time=126.200..311.573 rows=6666.00 loops=1)
                    Hash Cond: (sq.id = byline_store_text.document_version_id)
                    Buffers: shared hit=506680 read=5030
                    ->  Nested Loop  (cost=0.95..21837.97 rows=499 width=136) (actual time=2.302..179.415 rows=100000.00 loops=1)
                          Buffers: shared hit=498831
                          ->  Subquery Scan on sq  (cost=0.54..18720.91 rows=499 width=130) (actual time=2.296..86.440 rows=100000.00 loops=1)
                                Filter: ((sq.rn = 1) AND (sq.collection_id = '019f84de-371c-7674-81e4-737fb9765a69'::uuid))
                                Rows Removed by Filter: 2271
                                Buffers: shared hit=98831
                                ->  WindowAgg  (cost=0.54..17173.03 rows=103192 width=138) (actual time=0.037..77.920 rows=102271.00 loops=1)
                                      Window: w1 AS (PARTITION BY byline_document_versions.document_id ORDER BY byline_document_versions.id ROWS UNBOUNDED PRECEDING)
                                      Run Condition: (row_number() OVER w1 <= 1)
                                      Storage: Memory  Maximum Storage: 17kB
                                      Buffers: shared hit=98831
                                      ->  Incremental Sort  (cost=0.54..15367.17 rows=103192 width=130) (actual time=0.034..49.125 rows=103189.00 loops=1)
                                            Sort Key: byline_document_versions.document_id, byline_document_versions.id DESC
                                            Presorted Key: byline_document_versions.document_id
                                            Full-sort Groups: 3220  Sort Method: quicksort  Average Memory: 28kB  Peak Memory: 28kB
                                            Buffers: shared hit=98831
                                            ->  Index Scan using idx_documents_document_id on byline_document_versions  (cost=0.42..10834.16 rows=103192 width=130) (actual time=0.011..27.346 rows=103189.00 loops=1)
                                                  Filter: (NOT is_deleted)
                                                  Rows Removed by Filter: 72
                                                  Index Searches: 1
                                                  Buffers: shared hit=98831
                          ->  Index Scan using byline_documents_pkey on byline_documents  (cost=0.42..6.25 rows=1 width=22) (actual time=0.001..0.001 rows=1.00 loops=100000)
                                Index Cond: (id = sq.document_id)
                                Index Searches: 100000
                                Buffers: shared hit=400000
                    ->  Hash  (cost=19879.06..19879.06 rows=25884 width=16) (actual time=123.762..123.841 rows=6687.00 loops=1)
                          Buckets: 32768  Batches: 1  Memory Usage: 570kB
                          Buffers: shared hit=7849 read=5030
                          ->  Gather  (cost=1000.00..19879.06 rows=25884 width=16) (actual time=0.802..122.510 rows=6687.00 loops=1)
                                Workers Planned: 2
                                Workers Launched: 2
                                Buffers: shared hit=7849 read=5030
                                ->  Parallel Seq Scan on byline_store_text  (cost=0.00..16290.66 rows=10785 width=16) (actual time=1.602..120.079 rows=2229.00 loops=3)
                                      Filter: ((value ~~* '%storage%'::text) AND ((field_name)::text = 'title'::text) AND (((locale)::text = 'en'::text) OR ((locale)::text = 'all'::text)))
                                      Rows Removed by Filter: 134237
                                      Buffers: shared hit=7849 read=5030
              ->  Limit  (cost=0.42..34.17 rows=1 width=4) (actual time=0.002..0.002 rows=1.00 loops=6666)
                    Buffers: shared hit=26673
                    ->  Index Scan using unique_numeric_field on byline_store_numeric  (cost=0.42..34.17 rows=1 width=4) (actual time=0.002..0.002 rows=1.00 loops=6666)
                          Index Cond: ((document_version_id = sq.id) AND ((locale)::text = ANY ('{en,all}'::text[])))
                          Filter: ((field_name)::text = 'views'::text)
                          Rows Removed by Filter: 1
                          Index Searches: 6666
                          Buffers: shared hit=26673
Planning:
  Buffers: shared hit=307 read=18
Planning Time: 5.012 ms
Execution Time: 330.842 ms
```

### getDocumentsByDocumentIds (batch of 50)

```sql
SELECT *
    FROM byline_current_documents
    WHERE collection_id = $1
      AND document_id = ANY($2)
```

```
Nested Loop  (cost=395.00..404.80 rows=1 width=136) (actual time=0.047..0.109 rows=50.00 loops=1)
  Buffers: shared hit=229
  ->  Subquery Scan on sq  (cost=394.58..396.36 rows=1 width=130) (actual time=0.045..0.066 rows=50.00 loops=1)
        Filter: ((sq.rn = 1) AND (sq.collection_id = '019f84de-371c-7674-81e4-737fb9765a69'::uuid))
        Buffers: shared hit=29
        ->  WindowAgg  (cost=394.58..395.60 rows=51 width=138) (actual time=0.045..0.061 rows=50.00 loops=1)
              Window: w1 AS (PARTITION BY byline_document_versions.document_id ORDER BY byline_document_versions.id ROWS UNBOUNDED PRECEDING)
              Run Condition: (row_number() OVER w1 <= 1)
              Storage: Memory  Maximum Storage: 17kB
              Buffers: shared hit=29
              ->  Sort  (cost=394.58..394.71 rows=51 width=130) (actual time=0.043..0.045 rows=50.00 loops=1)
                    Sort Key: byline_document_versions.document_id, byline_document_versions.id DESC
                    Sort Method: quicksort  Memory: 30kB
                    Buffers: shared hit=29
                    ->  Bitmap Heap Scan on byline_document_versions  (cost=213.39..393.13 rows=51 width=130) (actual time=0.019..0.030 rows=50.00 loops=1)
                          Recheck Cond: (document_id = ANY ('{019f84df-850a-7098-9e66-59d2f6a9b6d2,019f84df-8508-73aa-bc20-8fb796a5c86c,019f84df-8509-7172-8c34-8acc4381cd48,019f84df-8508-73aa-bc20-8a21e5dd5940,019f84df-8508-73aa-bc20-86274f2c4c8f,019f84df-8507-775e-8d21-3c0295de1215,019f84df-8507-775e-8d21-39bfe92873f0,019f84df-8507-775e-8d21-346130f05bfd,019f84df-8507-775e-8d21-7198c9919dfe,019f84df-8507-775e-8d21-74b4889b1b20,019f84df-8507-775e-8d21-484c6dc0a4aa,019f84df-8507-775e-8d21-4354c4cb05c8,019f84df-8507-775e-8d21-47ebd8f0a2c4,019f84df-8506-7159-92d2-1fceb1b935df,019f84df-8506-7159-92d2-2370e022e8a2,019f84df-8505-70f7-b03d-0357571b49d0,019f84df-8504-73e9-8219-21627abf6e6d,019f84df-8504-73e9-8219-1d7fc10806a0,019f84df-8504-73e9-8219-1837ecddc0bf,019f84df-8504-73e9-8219-15152b9964ce,019f84df-84f7-75b5-bc92-33258914586e,019f84df-84f8-7661-b675-47f2c11ca7ee,019f84df-84f7-75b5-bc92-2f2618231d68,019f84df-84f8-7661-b675-4ac62fa6d988,019f84df-84f8-7661-b675-51f71f70948e,019f84df-84f7-75b5-bc92-258bacfa64e6,019f84df-84f7-75b5-bc92-2bca97b26694,019f84df-84f8-7661-b675-4f3db0bef10a,019f84df-84f7-75b5-bc92-06d14ade6b4d,019f84df-84f7-75b5-bc92-09c5e9250200,019f84df-84f7-75b5-bc91-f94bafa2275c,019f84df-84f7-75b5-bc91-f10dd408711b,019f84df-84f7-75b5-bc92-031888727102,019f84df-84f7-75b5-bc92-0f22165aa23d,019f84df-84f6-740b-abf8-bb068206e172,019f84df-84f7-75b5-bc91-ffa1ce0112a6,019f84df-84f6-740b-abf8-b2759d1d8f4b,019f84df-84f6-740b-abf8-b77376be9e2a,019f84df-84f7-75b5-bc91-f7afb8a00904,019f84df-84f6-740b-abf8-ad92168067d9,019f84df-84ed-7036-902f-cab9f6497bf4,019f84df-84e9-753e-8f93-398f1ba1c366,019f84df-84e9-753e-8f93-341b22393bc2,019f84df-84e9-753e-8f93-6496ff78bbaa,019f84df-84e9-753e-8f93-3183d8a454c1,019f84df-84e8-7748-9e3d-1d50a1fa9912,019f84df-84e8-7748-9e3d-2096ea32c58c,019f84df-84e8-7748-9e3d-18fff43aa36b,019f84df-84e8-7748-9e3d-155c29e029af,019f84df-84e7-7689-898d-c3dcd22d8a66}'::uuid[]))
                          Filter: (NOT is_deleted)
                          Heap Blocks: exact=26
                          Buffers: shared hit=29
                          ->  Bitmap Index Scan on idx_documents_document_id  (cost=0.00..213.25 rows=51 width=0) (actual time=0.012..0.012 rows=50.00 loops=1)
                                Index Cond: (document_id = ANY ('{019f84df-850a-7098-9e66-59d2f6a9b6d2,019f84df-8508-73aa-bc20-8fb796a5c86c,019f84df-8509-7172-8c34-8acc4381cd48,019f84df-8508-73aa-bc20-8a21e5dd5940,019f84df-8508-73aa-bc20-86274f2c4c8f,019f84df-8507-775e-8d21-3c0295de1215,019f84df-8507-775e-8d21-39bfe92873f0,019f84df-8507-775e-8d21-346130f05bfd,019f84df-8507-775e-8d21-7198c9919dfe,019f84df-8507-775e-8d21-74b4889b1b20,019f84df-8507-775e-8d21-484c6dc0a4aa,019f84df-8507-775e-8d21-4354c4cb05c8,019f84df-8507-775e-8d21-47ebd8f0a2c4,019f84df-8506-7159-92d2-1fceb1b935df,019f84df-8506-7159-92d2-2370e022e8a2,019f84df-8505-70f7-b03d-0357571b49d0,019f84df-8504-73e9-8219-21627abf6e6d,019f84df-8504-73e9-8219-1d7fc10806a0,019f84df-8504-73e9-8219-1837ecddc0bf,019f84df-8504-73e9-8219-15152b9964ce,019f84df-84f7-75b5-bc92-33258914586e,019f84df-84f8-7661-b675-47f2c11ca7ee,019f84df-84f7-75b5-bc92-2f2618231d68,019f84df-84f8-7661-b675-4ac62fa6d988,019f84df-84f8-7661-b675-51f71f70948e,019f84df-84f7-75b5-bc92-258bacfa64e6,019f84df-84f7-75b5-bc92-2bca97b26694,019f84df-84f8-7661-b675-4f3db0bef10a,019f84df-84f7-75b5-bc92-06d14ade6b4d,019f84df-84f7-75b5-bc92-09c5e9250200,019f84df-84f7-75b5-bc91-f94bafa2275c,019f84df-84f7-75b5-bc91-f10dd408711b,019f84df-84f7-75b5-bc92-031888727102,019f84df-84f7-75b5-bc92-0f22165aa23d,019f84df-84f6-740b-abf8-bb068206e172,019f84df-84f7-75b5-bc91-ffa1ce0112a6,019f84df-84f6-740b-abf8-b2759d1d8f4b,019f84df-84f6-740b-abf8-b77376be9e2a,019f84df-84f7-75b5-bc91-f7afb8a00904,019f84df-84f6-740b-abf8-ad92168067d9,019f84df-84ed-7036-902f-cab9f6497bf4,019f84df-84e9-753e-8f93-398f1ba1c366,019f84df-84e9-753e-8f93-341b22393bc2,019f84df-84e9-753e-8f93-6496ff78bbaa,019f84df-84e9-753e-8f93-3183d8a454c1,019f84df-84e8-7748-9e3d-1d50a1fa9912,019f84df-84e8-7748-9e3d-2096ea32c58c,019f84df-84e8-7748-9e3d-18fff43aa36b,019f84df-84e8-7748-9e3d-155c29e029af,019f84df-84e7-7689-898d-c3dcd22d8a66}'::uuid[]))
                                Index Searches: 1
                                Buffers: shared hit=3
  ->  Index Scan using byline_documents_pkey on byline_documents  (cost=0.42..8.44 rows=1 width=22) (actual time=0.001..0.001 rows=1.00 loops=50)
        Index Cond: (id = sq.document_id)
        Index Searches: 50
        Buffers: shared hit=200
Planning:
  Buffers: shared hit=14
Planning Time: 0.207 ms
Execution Time: 0.128 ms
```

