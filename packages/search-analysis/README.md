# @byline/search-analysis

Portable multilingual term analysis and backend-neutral query planning for
Byline CMS search providers.

The package owns logical search behavior:

- search-only NFKC normalization with original-text offsets;
- declared-locale validation and script-based fallback;
- identifier extraction before word segmentation;
- ICU-backed `Intl.Segmenter` word boundaries;
- exact-preserving language expansion hooks;
- overlapping Han bigrams;
- grouped query concepts and phrase intent; and
- a parser-safe SQL token codec.

It does not own a search index or query a database. PostgreSQL, MySQL, Solr,
and future providers translate the logical analysis into their own physical
representations.

```ts
import { createPortableSearchAnalyzer, encodeSqlToken } from '@byline/search-analysis'

const analyzer = createPortableSearchAnalyzer({
  defaultLocale: 'en',
  hanLocale: 'zh',
})

const text = analyzer.analyzeText({
  text: 'ฐานข้อมูล Node.js 数据库',
  locale: 'th',
})

const query = analyzer.analyzeQuery({
  query: '"forest restoration" database',
  locale: 'en',
  matching: { operator: 'all', phrase: 'auto' },
})

const physical = text.tokens.map((token) => encodeSqlToken(token))
```

Original content remains authoritative. Analyzer output is a disposable,
versioned projection; `analyzer.fingerprint` changes when behavior that can
affect indexed terms changes.
