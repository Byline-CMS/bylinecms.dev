# Storage benchmark — scale 1,000

- Run at: 2026-07-21T13:27:48.803Z
- Platform: darwin arm64 / Apple M1 Pro / 32 GB RAM
- Node: v24.15.0
- Warmup: 10, measured iterations: 50
- Media pool: 20 docs

## Query timings

| Query | Median (ms) | p95 (ms) | Min | Max |
|---|---:|---:|---:|---:|
| getDocumentById (full reconstruct) | 3.28 | 3.79 | 2.83 | 4.34 |
| getDocumentById (select=['title']) | 1.57 | 1.76 | 1.42 | 1.84 |
| findDocuments (page 1, size 20) | 8.59 | 11.41 | 8.05 | 13.18 |
| findDocuments (where title $contains 'storage', sort by views desc) | 24.75 | 27.04 | 20.95 | 28.48 |
| getDocumentsByDocumentIds (batch of 50) | 7.44 | 7.82 | 7.11 | 9.83 |
| populateDocuments (depth 2, 20 source docs × 1 relation) | 2.77 | 3.14 | 2.64 | 3.19 |

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
Limit  (cost=283.33..283.33 rows=1 width=131) (actual time=2.498..2.504 rows=20.00 loops=1)
  Buffers: shared hit=3047
  ->  Sort  (cost=283.33..283.33 rows=1 width=131) (actual time=2.494..2.496 rows=20.00 loops=1)
        Sort Key: sq.created_at DESC, sq.id DESC
        Sort Method: top-N heapsort  Memory: 30kB
        Buffers: shared hit=3047
        ->  Nested Loop  (cost=194.64..283.32 rows=1 width=131) (actual time=1.066..2.270 rows=1000.00 loops=1)
              Buffers: shared hit=3041
              ->  Subquery Scan on sq  (cost=194.36..275.02 rows=1 width=125) (actual time=1.056..1.466 rows=1000.00 loops=1)
                    Filter: ((sq.rn = 1) AND (sq.collection_id = '019f84dc-61dd-75c4-8f37-fa143849c66d'::uuid))
                    Rows Removed by Filter: 291
                    Buffers: shared hit=41
                    ->  WindowAgg  (cost=194.36..240.44 rows=2305 width=133) (actual time=0.826..1.368 rows=1291.00 loops=1)
                          Window: w1 AS (PARTITION BY byline_document_versions.document_id ORDER BY byline_document_versions.id ROWS UNBOUNDED PRECEDING)
                          Run Condition: (row_number() OVER w1 <= 1)
                          Storage: Memory  Maximum Storage: 17kB
                          Buffers: shared hit=41
                          ->  Sort  (cost=194.34..200.10 rows=2305 width=125) (actual time=0.819..0.923 rows=2209.00 loops=1)
                                Sort Key: byline_document_versions.document_id, byline_document_versions.id DESC
                                Sort Method: quicksort  Memory: 345kB
                                Buffers: shared hit=41
                                ->  Seq Scan on byline_document_versions  (cost=0.00..65.60 rows=2305 width=125) (actual time=0.005..0.245 rows=2209.00 loops=1)
                                      Filter: (NOT is_deleted)
                                      Rows Removed by Filter: 72
                                      Buffers: shared hit=41
              ->  Index Scan using byline_documents_pkey on byline_documents  (cost=0.28..8.30 rows=1 width=22) (actual time=0.001..0.001 rows=1.00 loops=1000)
                    Index Cond: (id = sq.document_id)
                    Index Searches: 1000
                    Buffers: shared hit=3000
Planning:
  Buffers: shared hit=354
Planning Time: 1.649 ms
Execution Time: 2.556 ms
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
Limit  (cost=424.35..424.36 rows=1 width=135) (actual time=9.103..9.107 rows=20.00 loops=1)
  Buffers: shared hit=9134
  ->  Sort  (cost=424.35..424.36 rows=1 width=135) (actual time=9.103..9.105 rows=20.00 loops=1)
        Sort Key: byline_store_numeric.value_integer DESC NULLS LAST
        Sort Method: top-N heapsort  Memory: 29kB
        Buffers: shared hit=9134
        ->  Nested Loop Semi Join  (cost=195.20..424.34 rows=1 width=135) (actual time=1.307..9.072 rows=66.00 loops=1)
              Buffers: shared hit=9131
              ->  Nested Loop Left Join  (cost=194.91..291.62 rows=1 width=135) (actual time=1.132..4.272 rows=1000.00 loops=1)
                    Buffers: shared hit=6043
                    ->  Nested Loop  (cost=194.64..283.32 rows=1 width=131) (actual time=1.109..2.339 rows=1000.00 loops=1)
                          Buffers: shared hit=3041
                          ->  Subquery Scan on sq  (cost=194.36..275.02 rows=1 width=125) (actual time=1.104..1.519 rows=1000.00 loops=1)
                                Filter: ((sq.rn = 1) AND (sq.collection_id = '019f84dc-61dd-75c4-8f37-fa143849c66d'::uuid))
                                Rows Removed by Filter: 291
                                Buffers: shared hit=41
                                ->  WindowAgg  (cost=194.36..240.44 rows=2305 width=133) (actual time=0.893..1.423 rows=1291.00 loops=1)
                                      Window: w1 AS (PARTITION BY byline_document_versions.document_id ORDER BY byline_document_versions.id ROWS UNBOUNDED PRECEDING)
                                      Run Condition: (row_number() OVER w1 <= 1)
                                      Storage: Memory  Maximum Storage: 17kB
                                      Buffers: shared hit=41
                                      ->  Sort  (cost=194.34..200.10 rows=2305 width=125) (actual time=0.890..0.992 rows=2209.00 loops=1)
                                            Sort Key: byline_document_versions.document_id, byline_document_versions.id DESC
                                            Sort Method: quicksort  Memory: 345kB
                                            Buffers: shared hit=41
                                            ->  Seq Scan on byline_document_versions  (cost=0.00..65.60 rows=2305 width=125) (actual time=0.004..0.283 rows=2209.00 loops=1)
                                                  Filter: (NOT is_deleted)
                                                  Rows Removed by Filter: 72
                                                  Buffers: shared hit=41
                          ->  Index Scan using byline_documents_pkey on byline_documents  (cost=0.28..8.30 rows=1 width=22) (actual time=0.001..0.001 rows=1.00 loops=1000)
                                Index Cond: (id = sq.document_id)
                                Index Searches: 1000
                                Buffers: shared hit=3000
                    ->  Limit  (cost=0.27..8.29 rows=1 width=4) (actual time=0.002..0.002 rows=1.00 loops=1000)
                          Buffers: shared hit=3002
                          ->  Index Scan using unique_numeric_field on byline_store_numeric  (cost=0.27..8.29 rows=1 width=4) (actual time=0.002..0.002 rows=1.00 loops=1000)
                                Index Cond: ((document_version_id = sq.id) AND ((locale)::text = ANY ('{en,all}'::text[])))
                                Filter: ((field_name)::text = 'views'::text)
                                Rows Removed by Filter: 1
                                Index Searches: 1000
                                Buffers: shared hit=3002
              ->  Index Scan using unique_text_field on byline_store_text  (cost=0.29..66.50 rows=1 width=16) (actual time=0.005..0.005 rows=0.07 loops=1000)
                    Index Cond: ((document_version_id = sq.id) AND ((locale)::text = ANY ('{en,all}'::text[])))
                    Filter: ((value ~~* '%storage%'::text) AND ((field_name)::text = 'title'::text))
                    Rows Removed by Filter: 4
                    Index Searches: 1000
                    Buffers: shared hit=3088
Planning:
  Buffers: shared hit=336
Planning Time: 2.318 ms
Execution Time: 9.158 ms
```

### getDocumentsByDocumentIds (batch of 50)

```sql
SELECT *
    FROM byline_current_documents
    WHERE collection_id = $1
      AND document_id = ANY($2)
```

```
Nested Loop  (cost=59.15..68.99 rows=1 width=131) (actual time=0.060..0.118 rows=50.00 loops=1)
  Buffers: shared hit=163
  ->  Subquery Scan on sq  (cost=58.87..60.69 rows=1 width=125) (actual time=0.056..0.078 rows=50.00 loops=1)
        Filter: ((sq.rn = 1) AND (sq.collection_id = '019f84dc-61dd-75c4-8f37-fa143849c66d'::uuid))
        Buffers: shared hit=13
        ->  WindowAgg  (cost=58.87..59.91 rows=52 width=133) (actual time=0.056..0.073 rows=50.00 loops=1)
              Window: w1 AS (PARTITION BY byline_document_versions.document_id ORDER BY byline_document_versions.id ROWS UNBOUNDED PRECEDING)
              Run Condition: (row_number() OVER w1 <= 1)
              Storage: Memory  Maximum Storage: 17kB
              Buffers: shared hit=13
              ->  Sort  (cost=58.87..59.00 rows=52 width=125) (actual time=0.053..0.056 rows=50.00 loops=1)
                    Sort Key: byline_document_versions.document_id, byline_document_versions.id DESC
                    Sort Method: quicksort  Memory: 30kB
                    Buffers: shared hit=13
                    ->  Bitmap Heap Scan on byline_document_versions  (cost=13.38..57.39 rows=52 width=125) (actual time=0.024..0.036 rows=50.00 loops=1)
                          Recheck Cond: (document_id = ANY ('{019f84dc-6614-75d9-a111-1f3130c1bfad,019f84dc-6613-7349-a7f4-387f8cd80706,019f84dc-6613-7349-a7f4-37c97e76d363,019f84dc-6612-747d-b038-be3040c16271,019f84dc-6612-747d-b038-bb195e95b304,019f84dc-6612-747d-b038-c20ece447019,019f84dc-660e-70fc-8d07-1d9ed3042853,019f84dc-660e-70fc-8d07-1b7b836d9192,019f84dc-660d-73cd-bdc2-80530fc3d2dc,019f84dc-660d-73cd-bdc2-7e62f15c4410,019f84dc-660d-73cd-bdc2-8454bc05b707,019f84dc-660c-7513-b8b5-8ac4f0580955,019f84dc-660c-7513-b8b5-866fff500ead,019f84dc-660b-75f3-a766-f8b77905588f,019f84dc-660a-742c-9724-38cf243b2d32,019f84dc-660a-742c-9724-3c4f87810d32,019f84dc-660a-742c-9724-3557ed1bf2ab,019f84dc-660a-742c-9724-2c0ce9bf2415,019f84dc-660a-742c-9724-2b48752cc866,019f84dc-660a-742c-9724-31aad0cdb1fc,019f84dc-65fd-733f-885c-7d54c2a6c315,019f84dc-65fc-722d-a25d-97e2448e6823,019f84dc-65fc-722d-a25d-802a87ca7fa1,019f84dc-65fc-722d-a25d-9b20d35b70b3,019f84dc-65fc-722d-a25d-9cec789ca115,019f84dc-65fc-722d-a25d-7c1b199ae5cd,019f84dc-65fc-722d-a25d-8b115bdf9a67,019f84dc-65fc-722d-a25d-8cc5b5b1d131,019f84dc-65fc-722d-a25d-874df30f267f,019f84dc-65fc-722d-a25d-927c0212e2dd,019f84dc-65fc-722d-a25d-78e96d871a03,019f84dc-65fb-7708-961c-c2c43dbc216f,019f84dc-65fb-7708-961c-bc50618364bb,019f84dc-65fc-722d-a25d-7433aba63e4a,019f84dc-65fb-7708-961c-c4322361145b,019f84dc-65fb-7708-961c-cbc78e76df1a,019f84dc-65fb-7708-961c-b82036d9f911,019f84dc-65fb-7708-961c-b41a2157ffe9,019f84dc-65fb-7708-961c-b08640deaff9,019f84dc-65fb-7708-961c-af1933b7fd12,019f84dc-65f0-772e-b109-76188859f9f4,019f84dc-65ee-7500-81f5-1f181e74004d,019f84dc-65ec-7122-b0f2-1feb0cfd80fd,019f84dc-65ec-7122-b0f2-1ac6bc0916a9,019f84dc-65ed-71a2-9ecb-fe300ac384b1,019f84dc-65ed-71a2-9ecc-00759694148e,019f84dc-65eb-726f-aa60-733835b8ca96,019f84dc-65eb-726f-aa60-6ca07239e92a,019f84dc-65eb-726f-aa60-61ad5e5749cb,019f84dc-65eb-726f-aa60-6669b2071b47}'::uuid[]))
                          Filter: (NOT is_deleted)
                          Heap Blocks: exact=11
                          Buffers: shared hit=13
                          ->  Bitmap Index Scan on idx_documents_document_id  (cost=0.00..13.24 rows=55 width=0) (actual time=0.017..0.017 rows=50.00 loops=1)
                                Index Cond: (document_id = ANY ('{019f84dc-6614-75d9-a111-1f3130c1bfad,019f84dc-6613-7349-a7f4-387f8cd80706,019f84dc-6613-7349-a7f4-37c97e76d363,019f84dc-6612-747d-b038-be3040c16271,019f84dc-6612-747d-b038-bb195e95b304,019f84dc-6612-747d-b038-c20ece447019,019f84dc-660e-70fc-8d07-1d9ed3042853,019f84dc-660e-70fc-8d07-1b7b836d9192,019f84dc-660d-73cd-bdc2-80530fc3d2dc,019f84dc-660d-73cd-bdc2-7e62f15c4410,019f84dc-660d-73cd-bdc2-8454bc05b707,019f84dc-660c-7513-b8b5-8ac4f0580955,019f84dc-660c-7513-b8b5-866fff500ead,019f84dc-660b-75f3-a766-f8b77905588f,019f84dc-660a-742c-9724-38cf243b2d32,019f84dc-660a-742c-9724-3c4f87810d32,019f84dc-660a-742c-9724-3557ed1bf2ab,019f84dc-660a-742c-9724-2c0ce9bf2415,019f84dc-660a-742c-9724-2b48752cc866,019f84dc-660a-742c-9724-31aad0cdb1fc,019f84dc-65fd-733f-885c-7d54c2a6c315,019f84dc-65fc-722d-a25d-97e2448e6823,019f84dc-65fc-722d-a25d-802a87ca7fa1,019f84dc-65fc-722d-a25d-9b20d35b70b3,019f84dc-65fc-722d-a25d-9cec789ca115,019f84dc-65fc-722d-a25d-7c1b199ae5cd,019f84dc-65fc-722d-a25d-8b115bdf9a67,019f84dc-65fc-722d-a25d-8cc5b5b1d131,019f84dc-65fc-722d-a25d-874df30f267f,019f84dc-65fc-722d-a25d-927c0212e2dd,019f84dc-65fc-722d-a25d-78e96d871a03,019f84dc-65fb-7708-961c-c2c43dbc216f,019f84dc-65fb-7708-961c-bc50618364bb,019f84dc-65fc-722d-a25d-7433aba63e4a,019f84dc-65fb-7708-961c-c4322361145b,019f84dc-65fb-7708-961c-cbc78e76df1a,019f84dc-65fb-7708-961c-b82036d9f911,019f84dc-65fb-7708-961c-b41a2157ffe9,019f84dc-65fb-7708-961c-b08640deaff9,019f84dc-65fb-7708-961c-af1933b7fd12,019f84dc-65f0-772e-b109-76188859f9f4,019f84dc-65ee-7500-81f5-1f181e74004d,019f84dc-65ec-7122-b0f2-1feb0cfd80fd,019f84dc-65ec-7122-b0f2-1ac6bc0916a9,019f84dc-65ed-71a2-9ecb-fe300ac384b1,019f84dc-65ed-71a2-9ecc-00759694148e,019f84dc-65eb-726f-aa60-733835b8ca96,019f84dc-65eb-726f-aa60-6ca07239e92a,019f84dc-65eb-726f-aa60-61ad5e5749cb,019f84dc-65eb-726f-aa60-6669b2071b47}'::uuid[]))
                                Index Searches: 1
                                Buffers: shared hit=2
  ->  Index Scan using byline_documents_pkey on byline_documents  (cost=0.28..8.30 rows=1 width=22) (actual time=0.001..0.001 rows=1.00 loops=50)
        Index Cond: (id = sq.document_id)
        Index Searches: 50
        Buffers: shared hit=150
Planning:
  Buffers: shared hit=14
Planning Time: 0.221 ms
Execution Time: 0.149 ms
```

