
> @byline/bench-storage@0.0.0 bench /Users/tony/Clients/Infonomic/Projects/Byline/Solutions/bylinecms.dev/benchmarks/storage
> tsx --env-file=../../packages/db-postgres/.env harness/run-bench.ts --scale 50000

# Storage benchmark — scale 50,000

- Run at: 2026-04-18T11:36:13.704Z
- Platform: darwin arm64 / Apple M1 Pro / 32 GB RAM
- Node: v24.14.0
- Warmup: 10, measured iterations: 50
- Media pool: 1000 docs

## Query timings

| Query | Median (ms) | p95 (ms) | Min | Max |
|---|---:|---:|---:|---:|
| getDocumentById (full reconstruct) | 2.98 | 4.00 | 2.41 | 6.87 |
| getDocumentById (select=['title']) | 1.51 | 1.89 | 1.19 | 2.34 |
| findDocuments (page 1, size 20) | 69.52 | 74.23 | 66.32 | 80.44 |
| findDocuments (where title $contains 'storage', sort by views desc) | 282.17 | 286.48 | 155.65 | 290.89 |
| getDocumentsByDocumentIds (batch of 50) | 6.85 | 7.52 | 6.34 | 7.92 |
| populateDocuments (depth 2, 20 source docs × 1 relation) | 2.64 | 2.94 | 2.44 | 3.33 |

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
Limit  (cost=6885.87..6885.92 rows=20 width=147) (actual time=51.868..51.872 rows=20.00 loops=1)
  Buffers: shared hit=48663
  ->  Sort  (cost=6885.87..6886.49 rows=250 width=147) (actual time=51.867..51.869 rows=20.00 loops=1)
        Sort Key: sq.created_at DESC, sq.id DESC
        Sort Method: top-N heapsort  Memory: 30kB
        Buffers: shared hit=48663
        ->  Subquery Scan on sq  (cost=0.35..6879.22 rows=250 width=147) (actual time=1.540..42.442 rows=50000.00 loops=1)
              Filter: ((sq.rn = 1) AND (sq.collection_id = '019da05f-746e-7796-a78e-d2f957218b3d'::uuid))
              Rows Removed by Filter: 2010
              Buffers: shared hit=48657
              ->  WindowAgg  (cost=0.35..6098.75 rows=52031 width=155) (actual time=0.037..37.412 rows=52010.00 loops=1)
                    Window: w1 AS (PARTITION BY document_versions.document_id ORDER BY document_versions.id ROWS UNBOUNDED PRECEDING)
                    Run Condition: (row_number() OVER w1 <= 1)
                    Storage: Memory  Maximum Storage: 17kB
                    Buffers: shared hit=48657
                    ->  Incremental Sort  (cost=0.35..5188.21 rows=52031 width=147) (actual time=0.031..23.981 rows=52034.00 loops=1)
                          Sort Key: document_versions.document_id, document_versions.id DESC
                          Presorted Key: document_versions.document_id
                          Full-sort Groups: 1627  Sort Method: quicksort  Average Memory: 29kB  Peak Memory: 29kB
                          Buffers: shared hit=48657
                          ->  Index Scan using idx_documents_document_id on document_versions  (cost=0.29..2849.47 rows=52031 width=147) (actual time=0.015..13.855 rows=52034.00 loops=1)
                                Filter: (NOT is_deleted)
                                Rows Removed by Filter: 16
                                Index Searches: 1
                                Buffers: shared hit=48657
Planning:
  Buffers: shared hit=256 read=12
Planning Time: 3.255 ms
Execution Time: 51.929 ms
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
Limit  (cost=19790.52..19790.57 rows=20 width=151) (actual time=219.090..219.095 rows=20.00 loops=1)
  Buffers: shared hit=67419
  ->  Sort  (cost=19790.52..19790.68 rows=64 width=151) (actual time=219.089..219.093 rows=20.00 loops=1)
        Sort Key: store_numeric.value_integer DESC NULLS LAST
        Sort Method: top-N heapsort  Memory: 33kB
        Buffers: shared hit=67419
        ->  Nested Loop Left Join  (cost=6882.76..19788.82 rows=64 width=151) (actual time=58.797..218.484 rows=3333.00 loops=1)
              Buffers: shared hit=67416
              ->  Hash Right Semi Join  (cost=6882.34..16584.96 rows=64 width=147) (actual time=58.686..208.884 rows=3333.00 loops=1)
                    Hash Cond: (store_text.document_version_id = sq.id)
                    Buffers: shared hit=54065
                    ->  Seq Scan on store_text  (cost=0.00..9652.94 rows=13076 width=16) (actual time=6.858..154.546 rows=3333.00 loops=1)
                          Filter: ((value ~~* '%storage%'::text) AND ((field_name)::text = 'title'::text) AND (((locale)::text = 'en'::text) OR ((locale)::text = 'all'::text)))
                          Rows Removed by Filter: 208914
                          Buffers: shared hit=5408
                    ->  Hash  (cost=6879.22..6879.22 rows=250 width=147) (actual time=51.815..51.817 rows=50000.00 loops=1)
                          Buckets: 65536 (originally 1024)  Batches: 1 (originally 1)  Memory Usage: 7544kB
                          Buffers: shared hit=48657
                          ->  Subquery Scan on sq  (cost=0.35..6879.22 rows=250 width=147) (actual time=1.466..42.283 rows=50000.00 loops=1)
                                Filter: ((sq.rn = 1) AND (sq.collection_id = '019da05f-746e-7796-a78e-d2f957218b3d'::uuid))
                                Rows Removed by Filter: 2010
                                Buffers: shared hit=48657
                                ->  WindowAgg  (cost=0.35..6098.75 rows=52031 width=155) (actual time=0.042..37.265 rows=52010.00 loops=1)
                                      Window: w1 AS (PARTITION BY document_versions.document_id ORDER BY document_versions.id ROWS UNBOUNDED PRECEDING)
                                      Run Condition: (row_number() OVER w1 <= 1)
                                      Storage: Memory  Maximum Storage: 17kB
                                      Buffers: shared hit=48657
                                      ->  Incremental Sort  (cost=0.35..5188.21 rows=52031 width=147) (actual time=0.031..23.559 rows=52034.00 loops=1)
                                            Sort Key: document_versions.document_id, document_versions.id DESC
                                            Presorted Key: document_versions.document_id
                                            Full-sort Groups: 1627  Sort Method: quicksort  Average Memory: 29kB  Peak Memory: 29kB
                                            Buffers: shared hit=48657
                                            ->  Index Scan using idx_documents_document_id on document_versions  (cost=0.29..2849.47 rows=52031 width=147) (actual time=0.011..13.409 rows=52034.00 loops=1)
                                                  Filter: (NOT is_deleted)
                                                  Rows Removed by Filter: 16
                                                  Index Searches: 1
                                                  Buffers: shared hit=48657
              ->  Limit  (cost=0.42..50.05 rows=1 width=4) (actual time=0.003..0.003 rows=1.00 loops=3333)
                    Buffers: shared hit=13351
                    ->  Index Scan using unique_numeric_field on store_numeric  (cost=0.42..50.05 rows=1 width=4) (actual time=0.002..0.002 rows=1.00 loops=3333)
                          Index Cond: ((document_version_id = sq.id) AND ((locale)::text = ANY ('{en,all}'::text[])))
                          Filter: ((field_name)::text = 'views'::text)
                          Rows Removed by Filter: 1
                          Index Searches: 3333
                          Buffers: shared hit=13351
Planning:
  Buffers: shared hit=326
Planning Time: 3.189 ms
Execution Time: 219.248 ms
```

### getDocumentsByDocumentIds (batch of 50)

```sql
SELECT *
    FROM current_documents
    WHERE collection_id = $1
      AND document_id = ANY($2)
```

```
Subquery Scan on sq  (cost=4.38..208.39 rows=1 width=147) (actual time=0.046..0.090 rows=50.00 loops=1)
  Filter: ((sq.rn = 1) AND (sq.collection_id = '019da05f-746e-7796-a78e-d2f957218b3d'::uuid))
  Buffers: shared hit=51
  ->  WindowAgg  (cost=4.38..207.64 rows=50 width=155) (actual time=0.046..0.084 rows=50.00 loops=1)
        Window: w1 AS (PARTITION BY document_versions.document_id ORDER BY document_versions.id ROWS UNBOUNDED PRECEDING)
        Run Condition: (row_number() OVER w1 <= 1)
        Storage: Memory  Maximum Storage: 17kB
        Buffers: shared hit=51
        ->  Incremental Sort  (cost=4.38..206.77 rows=50 width=147) (actual time=0.042..0.066 rows=50.00 loops=1)
              Sort Key: document_versions.document_id, document_versions.id DESC
              Presorted Key: document_versions.document_id
              Full-sort Groups: 2  Sort Method: quicksort  Average Memory: 29kB  Peak Memory: 29kB
              Buffers: shared hit=51
              ->  Index Scan using idx_documents_document_id on document_versions  (cost=0.29..204.52 rows=50 width=147) (actual time=0.014..0.051 rows=50.00 loops=1)
                    Index Cond: (document_id = ANY ('{019da05f-fd8c-74b7-beee-b5cb0716375a,019da05f-fd8c-74b7-beee-b087ac34f0a0,019da05f-fd8a-74b2-b50e-7924f557456e,019da05f-fd8a-74b2-b50e-742d14b5c50b,019da05f-fd8a-74b2-b50e-91648dbd6c81,019da05f-fd8a-74b2-b50e-40914d424f48,019da05f-fd89-748a-9606-816739b30803,019da05f-fd89-748a-9606-8e9f8489c142,019da05f-fd89-748a-9606-89552d86b21d,019da05f-fd89-748a-9606-84315006fb7e,019da05f-fd89-748a-9606-36de9f64d8e2,019da05f-fd89-748a-9606-32e37769b214,019da05f-fd88-718b-8d46-426a1293647a,019da05f-fd89-748a-9606-07b8129ccdc7,019da05f-fd89-748a-9606-01e70e27e02a,019da05f-fd88-718b-8d46-0ada727b3f23,019da05f-fd87-728a-b551-8d88ca4493eb,019da05f-fd87-728a-b551-929a16ba39ab,019da05f-fd88-718b-8d46-01f75215dc7c,019da05f-fd87-728a-b551-88131583dcff,019da05f-fd7d-757b-9b33-5dab0e08db91,019da05f-fd7c-709c-b0bf-2811a1f2b0af,019da05f-fd7c-709c-b0bf-3e619b03f5a8,019da05f-fd7c-709c-b0bf-3a46a60d8fac,019da05f-fd7c-709c-b0bf-2c0c5a3b84ad,019da05f-fd7c-709c-b0bf-32bd3a7c04b7,019da05f-fd7c-709c-b0bf-34b631841c34,019da05f-fd7c-709c-b0bf-2518cd332d13,019da05f-fd7c-709c-b0bf-218677c240db,019da05f-fd7c-709c-b0bf-1e74205d51c4,019da05f-fd7c-709c-b0bf-17fba28b9945,019da05f-fd7c-709c-b0bf-1b5b5f15a333,019da05f-fd7c-709c-b0bf-02b13b98725e,019da05f-fd7c-709c-b0bf-13d5b6025bf1,019da05f-fd7c-709c-b0bf-074489a22d21,019da05f-fd7c-709c-b0bf-0ec21d52ad73,019da05f-fd7c-709c-b0bf-0b0a27eba0cd,019da05f-fd7c-709c-b0be-fab3d233b4be,019da05f-fd7c-709c-b0be-fc54646180ac,019da05f-fd7b-774e-a468-b45a057cf89d,019da05f-fd73-71d9-ba29-33ffe3d2fd35,019da05f-fd72-7008-a409-6dfc369e0dce,019da05f-fd72-7008-a409-6a97132b9d6c,019da05f-fd71-700b-aceb-faa1b82b4f2f,019da05f-fd70-74f1-818b-672beb7e1243,019da05f-fd70-74f1-818b-6c0ad5b9b262,019da05f-fd70-74f1-818b-08a195440eac,019da05f-fd70-74f1-818b-0d1dca7cb4d3,019da05f-fd70-74f1-818b-01f277d6ed82,019da05f-fd70-74f1-818a-fce42fc0fe21}'::uuid[]))
                    Filter: (NOT is_deleted)
                    Index Searches: 1
                    Buffers: shared hit=51
Planning:
  Buffers: shared hit=6
Planning Time: 0.152 ms
Execution Time: 0.116 ms
```

