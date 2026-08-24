# @byline/analytics-conformance

Private workspace-only behavioral tests for `AnalyticsStore` implementations.
The suite pins salt convergence, UTC query behavior, daily-unique semantics,
transactional/idempotent rollups, cardinality overflow, raw/rollup stitching,
cursor behavior, and selective retention against each real SQL backend.

This package is test infrastructure. Applications never install or execute it.
