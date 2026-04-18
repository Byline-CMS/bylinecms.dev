
> @byline/bench-storage@0.0.0 bench /Users/tony/Clients/Infonomic/Projects/Byline/Solutions/bylinecms.dev/benchmarks/storage
> tsx --env-file=../../packages/db-postgres/.env harness/run-bench.ts --scale 1000

# Storage benchmark — scale 1,000

- Run at: 2026-04-18T11:33:50.090Z
- Platform: darwin arm64 / Apple M1 Pro / 32 GB RAM
- Node: v24.14.0
- Warmup: 10, measured iterations: 50
- Media pool: 20 docs

## Query timings

| Query | Median (ms) | p95 (ms) | Min | Max |
|---|---:|---:|---:|---:|
| getDocumentById (full reconstruct) | 3.15 | 3.79 | 2.60 | 3.90 |
| getDocumentById (select=['title']) | 1.51 | 1.80 | 1.34 | 1.86 |
| findDocuments (page 1, size 20) | 6.44 | 7.06 | 5.71 | 7.31 |
| findDocuments (where title $contains 'storage', sort by views desc) | 17.79 | 21.46 | 16.00 | 21.81 |
| getDocumentsByDocumentIds (batch of 50) | 7.43 | 9.58 | 6.81 | 10.30 |
| populateDocuments (depth 2, 20 source docs × 1 relation) | 3.09 | 3.58 | 2.75 | 3.87 |

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
Limit  (cost=255.66..255.67 rows=5 width=150) (actual time=1.801..1.804 rows=20.00 loops=1)
  Buffers: shared hit=56
  ->  Sort  (cost=255.66..255.67 rows=5 width=150) (actual time=1.800..1.802 rows=20.00 loops=1)
        Sort Key: sq.created_at DESC, sq.id DESC
        Sort Method: top-N heapsort  Memory: 30kB
        Buffers: shared hit=56
        ->  Subquery Scan on sq  (cost=183.71..255.60 rows=5 width=150) (actual time=1.139..1.589 rows=1000.00 loops=1)
              Filter: ((sq.rn = 1) AND (sq.collection_id = '019da05e-0e26-7257-b00f-ff22486c5909'::uuid))
              Rows Removed by Filter: 1030
              Buffers: shared hit=50
              ->  WindowAgg  (cost=183.71..224.79 rows=2054 width=158) (actual time=0.770..1.446 rows=2030.00 loops=1)
                    Window: w1 AS (PARTITION BY document_versions.document_id ORDER BY document_versions.id ROWS UNBOUNDED PRECEDING)
                    Run Condition: (row_number() OVER w1 <= 1)
                    Storage: Memory  Maximum Storage: 17kB
                    Buffers: shared hit=50
                    ->  Sort  (cost=183.71..188.85 rows=2054 width=150) (actual time=0.764..0.876 rows=2054.00 loops=1)
                          Sort Key: document_versions.document_id, document_versions.id DESC
                          Sort Method: quicksort  Memory: 361kB
                          Buffers: shared hit=50
                          ->  Seq Scan on document_versions  (cost=0.00..70.70 rows=2054 width=150) (actual time=0.007..0.283 rows=2054.00 loops=1)
                                Filter: (NOT is_deleted)
                                Rows Removed by Filter: 16
                                Buffers: shared hit=50
Planning:
  Buffers: shared hit=268
Planning Time: 1.142 ms
Execution Time: 1.882 ms
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
Limit  (cost=832.56..832.56 rows=1 width=154) (actual time=6.851..6.855 rows=20.00 loops=1)
  Buffers: shared hit=3391
  ->  Sort  (cost=832.56..832.56 rows=1 width=154) (actual time=6.851..6.853 rows=20.00 loops=1)
        Sort Key: store_numeric.value_integer DESC NULLS LAST
        Sort Method: top-N heapsort  Memory: 33kB
        Buffers: shared hit=3391
        ->  Nested Loop Left Join  (cost=184.28..832.55 rows=1 width=154) (actual time=1.189..6.821 rows=66.00 loops=1)
              Buffers: shared hit=3388
              ->  Nested Loop Semi Join  (cost=184.00..787.75 rows=1 width=150) (actual time=1.175..6.613 rows=66.00 loops=1)
                    Buffers: shared hit=3190
                    ->  Subquery Scan on sq  (cost=183.71..255.60 rows=5 width=150) (actual time=1.087..1.547 rows=1000.00 loops=1)
                          Filter: ((sq.rn = 1) AND (sq.collection_id = '019da05e-0e26-7257-b00f-ff22486c5909'::uuid))
                          Rows Removed by Filter: 1030
                          Buffers: shared hit=50
                          ->  WindowAgg  (cost=183.71..224.79 rows=2054 width=158) (actual time=0.721..1.403 rows=2030.00 loops=1)
                                Window: w1 AS (PARTITION BY document_versions.document_id ORDER BY document_versions.id ROWS UNBOUNDED PRECEDING)
                                Run Condition: (row_number() OVER w1 <= 1)
                                Storage: Memory  Maximum Storage: 17kB
                                Buffers: shared hit=50
                                ->  Sort  (cost=183.71..188.85 rows=2054 width=150) (actual time=0.718..0.824 rows=2054.00 loops=1)
                                      Sort Key: document_versions.document_id, document_versions.id DESC
                                      Sort Method: quicksort  Memory: 361kB
                                      Buffers: shared hit=50
                                      ->  Seq Scan on document_versions  (cost=0.00..70.70 rows=2054 width=150) (actual time=0.005..0.234 rows=2054.00 loops=1)
                                            Filter: (NOT is_deleted)
                                            Rows Removed by Filter: 16
                                            Buffers: shared hit=50
                    ->  Index Scan using unique_text_field on store_text  (cost=0.29..88.74 rows=1 width=16) (actual time=0.005..0.005 rows=0.07 loops=1000)
                          Index Cond: ((document_version_id = sq.id) AND ((locale)::text = ANY ('{en,all}'::text[])))
                          Filter: ((value ~~* '%storage%'::text) AND ((field_name)::text = 'title'::text))
                          Rows Removed by Filter: 4
                          Index Searches: 1000
                          Buffers: shared hit=3140
              ->  Limit  (cost=0.28..44.78 rows=1 width=4) (actual time=0.003..0.003 rows=1.00 loops=66)
                    Buffers: shared hit=198
                    ->  Index Scan using unique_numeric_field on store_numeric  (cost=0.28..44.78 rows=1 width=4) (actual time=0.003..0.003 rows=1.00 loops=66)
                          Index Cond: ((document_version_id = sq.id) AND ((locale)::text = ANY ('{en,all}'::text[])))
                          Filter: ((field_name)::text = 'views'::text)
                          Rows Removed by Filter: 1
                          Index Searches: 66
                          Buffers: shared hit=198
Planning:
  Buffers: shared hit=353
Planning Time: 2.283 ms
Execution Time: 6.883 ms
```

### getDocumentsByDocumentIds (batch of 50)

```sql
SELECT *
    FROM current_documents
    WHERE collection_id = $1
      AND document_id = ANY($2)
```

```
Subquery Scan on sq  (cost=0.92..35.85 rows=1 width=150) (actual time=0.055..0.087 rows=50.00 loops=1)
  Filter: ((sq.rn = 1) AND (sq.collection_id = '019da05e-0e26-7257-b00f-ff22486c5909'::uuid))
  Buffers: shared hit=48
  ->  WindowAgg  (cost=0.92..35.10 rows=50 width=158) (actual time=0.055..0.082 rows=50.00 loops=1)
        Window: w1 AS (PARTITION BY document_versions.document_id ORDER BY document_versions.id ROWS UNBOUNDED PRECEDING)
        Run Condition: (row_number() OVER w1 <= 1)
        Storage: Memory  Maximum Storage: 17kB
        Buffers: shared hit=48
        ->  Incremental Sort  (cost=0.92..34.22 rows=50 width=150) (actual time=0.052..0.064 rows=50.00 loops=1)
              Sort Key: document_versions.document_id, document_versions.id DESC
              Presorted Key: document_versions.document_id
              Full-sort Groups: 2  Sort Method: quicksort  Average Memory: 29kB  Peak Memory: 29kB
              Buffers: shared hit=48
              ->  Index Scan using idx_documents_document_id on document_versions  (cost=0.28..31.97 rows=50 width=150) (actual time=0.017..0.047 rows=50.00 loops=1)
                    Index Cond: (document_id = ANY ('{019da05e-1179-75f9-a4a3-d967a5b67a6d,019da05e-1174-74a2-bdf1-acdd75ec7df4,019da05e-1174-74a2-bdf1-b0c90a3c604c,019da05e-1172-76df-bd05-2df33516d427,019da05e-1172-76df-bd04-dcd8bc95b8f5,019da05e-1171-71fb-84a6-006cf89dbbf7,019da05e-1172-76df-bd05-34b1705363c3,019da05e-1172-76df-bd05-31870dce8eae,019da05e-1170-77d4-b592-e705b26d9e35,019da05e-1170-77d4-b592-e102136365be,019da05e-1170-77d4-b592-dd22ff2e100e,019da05e-1170-77d4-b592-daa779f0caa6,019da05e-1170-77d4-b592-d60f0f715172,019da05e-116f-70af-a2d1-77fad8c01fa8,019da05e-116f-70af-a2d1-71ab62889019,019da05e-116f-70af-a2d1-7c4b098e2468,019da05e-116f-70af-a2d1-7b5ccba36c84,019da05e-116f-70af-a2d1-6de6dac3ad4b,019da05e-116f-70af-a2d1-6bea5045bb3c,019da05e-116e-705f-a1f0-b0459f819624,019da05e-1164-71bd-bb2b-89ee4c8c5c13,019da05e-1163-72cf-919e-67890d70967a,019da05e-1163-72cf-919e-6b6be5fcbec5,019da05e-1163-72cf-919e-634fa3c15475,019da05e-1163-72cf-919e-5b6b3d77dba6,019da05e-1163-72cf-919e-502055e4bfc2,019da05e-1163-72cf-919e-567a724a00ec,019da05e-1163-72cf-919e-47a9858538de,019da05e-1163-72cf-919e-42a848e29f10,019da05e-1163-72cf-919e-355bce925a18,019da05e-1163-72cf-919e-33c86dab692d,019da05e-1163-72cf-919e-4bccea504f04,019da05e-1163-72cf-919e-3e10ff924e8d,019da05e-1163-72cf-919e-5c311a3ddbf4,019da05e-1163-72cf-919e-2b7abdfa6ed0,019da05e-1163-72cf-919e-381369d251c0,019da05e-1163-72cf-919e-2c8230152935,019da05e-1163-72cf-919e-2582212e9a55,019da05e-1162-775e-ba83-3d414b43f36e,019da05e-1162-775e-ba83-3a5536b8804b,019da05e-1159-7602-b57b-3435d009f15c,019da05e-1156-7385-9be4-638c6ff732ea,019da05e-1155-72dc-9002-fcfa0b2304bb,019da05e-1155-72dc-9002-f5e855e5e37d,019da05e-1155-72dc-9002-f8608b3b92c2,019da05e-1155-72dc-9002-f2e7bf32e3ae,019da05e-1155-72dc-9002-eda84e25060e,019da05e-1155-72dc-9002-eb2b9266feec,019da05e-1155-72dc-9002-e015d204476e,019da05e-1153-703d-b9bd-e4812706d400}'::uuid[]))
                    Filter: (NOT is_deleted)
                    Index Searches: 1
                    Buffers: shared hit=48
Planning:
  Buffers: shared hit=6
Planning Time: 0.187 ms
Execution Time: 0.116 ms
```

