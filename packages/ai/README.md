# @byline/ai

The AI subsystem for [Byline CMS](https://github.com/Byline-CMS/bylinecms.dev)
— provider-agnostic text generation and structured editing for the admin
editor, with built-in editor plugins for the text and Lexical richtext fields.

This package is part of Byline CMS — a developer-friendly, open-source
headless CMS with versioning, editorial workflow, and content translation as
first-class concerns.

## What it provides

- **Provider-agnostic execution** — a single `ExecuteInstruction` contract over
  OpenAI, Google (Gemini), and Anthropic, with non-streaming and streaming
  variants (`executeInstruction` / `executeInstructionStreaming`).
- **Structured generation** — `generateStructured` / `generateStructuredStreaming`
  for schema-constrained output.
- **Patch generation** — `patch` / `patchStreaming`, which edit an ordered array
  of Lexical text nodes in place (used by the richtext field's AI drawer).
- **Editor plugins** — drop-in plugins for the two editor surfaces:
  `@byline/ai/plugins/text` (`AiPluginText`) and `@byline/ai/plugins/lexical`
  (`AiPluginLexical`, `AiLexicalExtension`, `TOGGLE_AI_DRAWER_COMMAND`).
- **Browser-safe config** — a public config provider and provider/model helpers
  that carry no server SDK dependencies.

## Browser / server split

The root entry is browser-safe; the SDK-backed execution code lives behind a
separate server entry. Import from the right one:

| Entry | Use from | Surface |
|---|---|---|
| `@byline/ai` | Browser **and** server | Types, `AiPublicConfigProvider` / `useAiPublicConfig`, provider/model helpers (`PROVIDERS`, `DEFAULT_MODELS`, `getDefaultModel`, …), `INSTRUCTION_MODES` |
| `@byline/ai/server` | Server only | `executeInstruction(Streaming)`, `generateStructured(Streaming)`, `patch(Streaming)`, `getAiServerConfig` |
| `@byline/ai/plugins/text` | Browser | `AiPluginText` |
| `@byline/ai/plugins/lexical` | Browser | `AiPluginLexical`, `AiLexicalExtension`, `TOGGLE_AI_DRAWER_COMMAND` |

Importing `@byline/ai/server` in the browser will crash — it pulls in the
Anthropic/OpenAI/Google SDKs and pino. Host adapters mount the execute endpoint
on the server and the plugins POST `ExecuteInstruction` payloads to it; see the
host integration in `@byline/host-tanstack-start` (`integrations/byline-ai.tsx`,
`server-fns/ai/*`).

## Configuration

Server config is read from the environment by `getAiServerConfig()`:

| Variable | Purpose | Default |
|---|---|---|
| `AI_DEFAULT_PROVIDER` | `openai` \| `google` \| `anthropic` | `openai` |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | OpenAI credentials | — |
| `GOOGLE_API_KEY` / `GOOGLE_BASE_URL` | Google (Gemini) credentials | — |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` | Anthropic credentials | — |
| `BYLINE_AI_ENDPOINT` | Endpoint the editor plugins POST to | `/admin/api/ai/execute` |
| `LOG_LEVEL` / `LOG_PRETTY` | Logging | `info` |

The curated per-provider model lists live in `src/config/ai-config.ts`
(`PROVIDER_MODELS` / `DEFAULT_MODELS`). Run `pnpm list:models` to discover the
models a provider currently exposes.

## Documentation

For the full architecture overview, the richtext/AI integration, and getting
started instructions, see the main repository:
<https://github.com/Byline-CMS/bylinecms.dev>. Relevant docs: `docs/04-collections/06-rich-text.md`,
`docs/04-collections/01-fields.md`, and `docs/05-reading-and-delivery/05-mcp-server.md`.

## License

MPL-2.0
