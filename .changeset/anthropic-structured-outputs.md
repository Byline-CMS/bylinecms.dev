---
"@byline/ai": patch
---

Fix the Anthropic adapter's document generation and patch paths on Claude
Opus 5.5, Sonnet 5.5 and Fable 5.1 (#104). These models reject a forced
`tool_choice`, so `generateDoc`, `generateDocStreaming`, `patchDoc` and
`patchDocStreaming` now request structured outputs (`output_config.format`)
instead of forcing a tool call. A refusal, a response truncated at
`max_tokens`, or a response with no JSON object is now an explicit error. The
curated Anthropic models are now `claude-opus-5-5`, `claude-sonnet-5-5` and
`claude-haiku-5-5`, and the default is `claude-sonnet-5-5`. A site that names
an older Claude model in its own configuration keeps working. The live
provider tests now run when `AI_RUN_REAL_TESTS=true`.
