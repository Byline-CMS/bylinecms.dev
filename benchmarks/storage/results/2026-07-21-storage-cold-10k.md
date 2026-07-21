# Storage benchmark — scale 10,000

- Run at: 2026-07-21T13:28:13.297Z
- Platform: darwin arm64 / Apple M1 Pro / 32 GB RAM
- Node: v24.15.0
- Warmup: 10, measured iterations: 50
- Media pool: 200 docs

## Query timings

| Query | Median (ms) | p95 (ms) | Min | Max |
|---|---:|---:|---:|---:|
| getDocumentById (full reconstruct) | 3.57 | 3.99 | 3.13 | 6.72 |
| getDocumentById (select=['title']) | 1.71 | 2.25 | 1.32 | 2.41 |
| findDocuments (page 1, size 20) | 32.18 | 40.71 | 29.22 | 44.33 |
| findDocuments (where title $contains 'storage', sort by views desc) | 162.99 | 165.95 | 158.37 | 166.31 |
| getDocumentsByDocumentIds (batch of 50) | 7.07 | 7.65 | 6.74 | 8.24 |
| populateDocuments (depth 2, 20 source docs × 1 relation) | 3.17 | 3.85 | 2.85 | 4.16 |

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
Limit  (cost=1516.97..1516.98 rows=1 width=131) (actual time=18.853..18.856 rows=20.00 loops=1)
  Buffers: shared hit=30211
  ->  Sort  (cost=1516.97..1516.98 rows=1 width=131) (actual time=18.852..18.854 rows=20.00 loops=1)
        Sort Key: sq.created_at DESC, sq.id DESC
        Sort Method: top-N heapsort  Memory: 30kB
        Buffers: shared hit=30211
        ->  Nested Loop  (cost=1105.66..1516.96 rows=1 width=131) (actual time=4.547..16.685 rows=10000.00 loops=1)
              Buffers: shared hit=30205
              ->  Subquery Scan on sq  (cost=1105.37..1508.66 rows=1 width=125) (actual time=4.537..8.666 rows=10000.00 loops=1)
                    Filter: ((sq.rn = 1) AND (sq.collection_id = '019f84dc-7c9a-7209-b11c-6ca11968fced'::uuid))
                    Rows Removed by Filter: 471
                    Buffers: shared hit=205
                    ->  WindowAgg  (cost=1105.37..1335.81 rows=11523 width=133) (actual time=4.244..7.794 rows=10471.00 loops=1)
                          Window: w1 AS (PARTITION BY byline_document_versions.document_id ORDER BY byline_document_versions.id ROWS UNBOUNDED PRECEDING)
                          Run Condition: (row_number() OVER w1 <= 1)
                          Storage: Memory  Maximum Storage: 17kB
                          Buffers: shared hit=205
                          ->  Sort  (cost=1105.35..1134.16 rows=11523 width=125) (actual time=4.238..4.789 rows=11389.00 loops=1)
                                Sort Key: byline_document_versions.document_id, byline_document_versions.id DESC
                                Sort Method: quicksort  Memory: 1637kB
                                Buffers: shared hit=205
                                ->  Seq Scan on byline_document_versions  (cost=0.00..328.00 rows=11523 width=125) (actual time=0.006..1.347 rows=11389.00 loops=1)
                                      Filter: (NOT is_deleted)
                                      Rows Removed by Filter: 72
                                      Buffers: shared hit=205
              ->  Index Scan using byline_documents_pkey on byline_documents  (cost=0.29..8.30 rows=1 width=22) (actual time=0.001..0.001 rows=1.00 loops=10000)
                    Index Cond: (id = sq.document_id)
                    Index Searches: 10000
                    Buffers: shared hit=30000
Planning:
  Buffers: shared hit=354
Planning Time: 1.585 ms
Execution Time: 18.952 ms
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
Limit  (cost=1794.01..1794.01 rows=1 width=135) (actual time=85.023..85.027 rows=20.00 loops=1)
  Buffers: shared hit=101619
  ->  Sort  (cost=1794.01..1794.01 rows=1 width=135) (actual time=85.022..85.025 rows=20.00 loops=1)
        Sort Key: byline_store_numeric.value_integer DESC NULLS LAST
        Sort Method: top-N heapsort  Memory: 29kB
        Buffers: shared hit=101619
        ->  Nested Loop Semi Join  (cost=1106.35..1794.00 rows=1 width=135) (actual time=4.377..84.879 rows=666.00 loops=1)
              Buffers: shared hit=101616
              ->  Nested Loop Left Join  (cost=1105.94..1525.34 rows=1 width=135) (actual time=4.231..36.354 rows=10000.00 loops=1)
                    Buffers: shared hit=60257
                    ->  Nested Loop  (cost=1105.66..1516.96 rows=1 width=131) (actual time=4.208..17.068 rows=10000.00 loops=1)
                          Buffers: shared hit=30205
                          ->  Subquery Scan on sq  (cost=1105.37..1508.66 rows=1 width=125) (actual time=4.204..8.395 rows=10000.00 loops=1)
                                Filter: ((sq.rn = 1) AND (sq.collection_id = '019f84dc-7c9a-7209-b11c-6ca11968fced'::uuid))
                                Rows Removed by Filter: 471
                                Buffers: shared hit=205
                                ->  WindowAgg  (cost=1105.37..1335.81 rows=11523 width=133) (actual time=3.940..7.531 rows=10471.00 loops=1)
                                      Window: w1 AS (PARTITION BY byline_document_versions.document_id ORDER BY byline_document_versions.id ROWS UNBOUNDED PRECEDING)
                                      Run Condition: (row_number() OVER w1 <= 1)
                                      Storage: Memory  Maximum Storage: 17kB
                                      Buffers: shared hit=205
                                      ->  Sort  (cost=1105.35..1134.16 rows=11523 width=125) (actual time=3.930..4.460 rows=11389.00 loops=1)
                                            Sort Key: byline_document_versions.document_id, byline_document_versions.id DESC
                                            Sort Method: quicksort  Memory: 1637kB
                                            Buffers: shared hit=205
                                            ->  Seq Scan on byline_document_versions  (cost=0.00..328.00 rows=11523 width=125) (actual time=0.005..1.176 rows=11389.00 loops=1)
                                                  Filter: (NOT is_deleted)
                                                  Rows Removed by Filter: 72
                                                  Buffers: shared hit=205
                          ->  Index Scan using byline_documents_pkey on byline_documents  (cost=0.29..8.30 rows=1 width=22) (actual time=0.001..0.001 rows=1.00 loops=10000)
                                Index Cond: (id = sq.document_id)
                                Index Searches: 10000
                                Buffers: shared hit=30000
                    ->  Limit  (cost=0.28..8.37 rows=1 width=4) (actual time=0.002..0.002 rows=1.00 loops=10000)
                          Buffers: shared hit=30052
                          ->  Index Scan using unique_numeric_field on byline_store_numeric  (cost=0.28..8.37 rows=1 width=4) (actual time=0.002..0.002 rows=1.00 loops=10000)
                                Index Cond: ((document_version_id = sq.id) AND ((locale)::text = ANY ('{en,all}'::text[])))
                                Filter: ((field_name)::text = 'views'::text)
                                Rows Removed by Filter: 1
                                Index Searches: 10000
                                Buffers: shared hit=30052
              ->  Index Scan using unique_text_field on byline_store_text  (cost=0.41..134.53 rows=1 width=16) (actual time=0.005..0.005 rows=0.07 loops=10000)
                    Index Cond: ((document_version_id = sq.id) AND ((locale)::text = ANY ('{en,all}'::text[])))
                    Filter: ((value ~~* '%storage%'::text) AND ((field_name)::text = 'title'::text))
                    Rows Removed by Filter: 4
                    Index Searches: 10000
                    Buffers: shared hit=41359
Planning:
  Buffers: shared hit=337
Planning Time: 2.109 ms
Execution Time: 85.130 ms
```

### getDocumentsByDocumentIds (batch of 50)

```sql
SELECT *
    FROM byline_current_documents
    WHERE collection_id = $1
      AND document_id = ANY($2)
```

```
Nested Loop  (cost=3.83..155.05 rows=1 width=131) (actual time=0.045..0.107 rows=50.00 loops=1)
  Buffers: shared hit=201
  ->  Subquery Scan on sq  (cost=3.55..146.75 rows=1 width=125) (actual time=0.043..0.071 rows=50.00 loops=1)
        Filter: ((sq.rn = 1) AND (sq.collection_id = '019f84dc-7c9a-7209-b11c-6ca11968fced'::uuid))
        Buffers: shared hit=51
        ->  WindowAgg  (cost=3.55..146.09 rows=44 width=133) (actual time=0.042..0.066 rows=50.00 loops=1)
              Window: w1 AS (PARTITION BY byline_document_versions.document_id ORDER BY byline_document_versions.id ROWS UNBOUNDED PRECEDING)
              Run Condition: (row_number() OVER w1 <= 1)
              Storage: Memory  Maximum Storage: 17kB
              Buffers: shared hit=51
              ->  Incremental Sort  (cost=3.55..145.32 rows=44 width=125) (actual time=0.040..0.051 rows=50.00 loops=1)
                    Sort Key: byline_document_versions.document_id, byline_document_versions.id DESC
                    Presorted Key: byline_document_versions.document_id
                    Full-sort Groups: 2  Sort Method: quicksort  Average Memory: 28kB  Peak Memory: 28kB
                    Buffers: shared hit=51
                    ->  Index Scan using idx_documents_document_id on byline_document_versions  (cost=0.29..143.34 rows=44 width=125) (actual time=0.014..0.035 rows=50.00 loops=1)
                          Index Cond: (document_id = ANY ('{019f84dc-9f2d-741c-b1db-452e580f1374,019f84dc-9f28-7509-8e67-587c86a8dfde,019f84dc-9f28-7509-8e67-653b960c1af9,019f84dc-9f28-7509-8e67-5e3ddd7845c7,019f84dc-9f27-7635-907f-db576d69039e,019f84dc-9f27-7635-907f-d6ac6ff4145f,019f84dc-9f26-766c-87ff-fb2c62b0a0b6,019f84dc-9f26-766c-8800-05e1a0cf5c0d,019f84dc-9f26-766c-87ff-ffcf11358a44,019f84dc-9f25-71f6-b372-7e77fe0ebcb7,019f84dc-9f25-71f6-b372-7bec4122c0c4,019f84dc-9f24-744a-8b0a-c9ebdda020a1,019f84dc-9f24-744a-8b0a-cf606744117f,019f84dc-9f24-744a-8b0a-c7c6224f1607,019f84dc-9f24-744a-8b0a-c0a1ec5761bd,019f84dc-9f24-744a-8b0a-bc6f404b0372,019f84dc-9f23-74bc-a1a5-ac957c7d4f11,019f84dc-9f23-74bc-a1a5-a1fd1897aa0e,019f84dc-9f22-733e-b1ca-476560e8ce6b,019f84dc-9f21-7303-ba65-22c706156e3b,019f84dc-9f16-74ab-8b48-0aaf39d32b8d,019f84dc-9f15-7455-8a24-a53e2b80db24,019f84dc-9f15-7455-8a24-980a9ff7ec86,019f84dc-9f16-74ab-8b48-041ac811c420,019f84dc-9f15-7455-8a24-ad746f058856,019f84dc-9f16-74ab-8b47-e1605ecaf610,019f84dc-9f15-7455-8a24-a0fab09b9615,019f84dc-9f16-74ab-8b47-e55bb87c1fe4,019f84dc-9f15-7455-8a24-976335f65641,019f84dc-9f16-74ab-8b48-033ea407a45e,019f84dc-9f15-7455-8a24-8c60e5a69f4f,019f84dc-9f15-7455-8a24-a987fb962243,019f84dc-9f15-7455-8a24-927900c4f77f,019f84dc-9f15-7455-8a24-9f41f5309538,019f84dc-9f15-7455-8a24-8b9f5eb0548b,019f84dc-9f15-7455-8a24-7a19b9624224,019f84dc-9f15-7455-8a24-7f6493128ce7,019f84dc-9f15-7455-8a24-8224eb6359fd,019f84dc-9f15-7455-8a24-86950c370fef,019f84dc-9f14-76aa-bed5-40ee4986a51d,019f84dc-9f0c-7361-8c3e-707b687dff18,019f84dc-9f09-74c6-a001-d2f40aef8666,019f84dc-9f05-76fe-ac0d-ab37026c7641,019f84dc-9f05-76fe-ac0d-a7104fc39006,019f84dc-9f06-77fd-8df3-38b835104ab8,019f84dc-9f06-77fd-8df3-360e2582f7c7,019f84dc-9f04-70b9-8429-f3ab86b52740,019f84dc-9f05-76fe-ac0d-6ce92b12388e,019f84dc-9f04-70b9-8429-ed1dff6faeb1,019f84dc-9f04-70b9-8429-e5d642a28da3}'::uuid[]))
                          Filter: (NOT is_deleted)
                          Index Searches: 1
                          Buffers: shared hit=51
  ->  Index Scan using byline_documents_pkey on byline_documents  (cost=0.29..8.30 rows=1 width=22) (actual time=0.001..0.001 rows=1.00 loops=50)
        Index Cond: (id = sq.document_id)
        Index Searches: 50
        Buffers: shared hit=150
Planning:
  Buffers: shared hit=14
Planning Time: 0.218 ms
Execution Time: 0.126 ms
```

