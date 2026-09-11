---
"@byline/ui": patch
---

**`@byline/ui`** stopped publishing the `development` export condition, which pointed consumers at TypeScript source inside `node_modules`.

`exports["./react"]` carried `"development": "./src/react.ts"` — correct inside the Byline monorepo, where the package resolves through a workspace link and Vite transforms the source for HMR, and wrong once published. `publishConfig` set only `access` and `files`, so the condition shipped as-is.

Vite adds `development` to its default conditions in dev and test, so a downstream consumer running Vitest against anything that reaches `@byline/ui/react` resolved the `.ts` source from `node_modules` and failed with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` — Node refuses to strip types there. No Vite-side setting fixes it from the consumer side, because the import happens through Node's native resolution of an externalised dependency, which bypasses `resolve.conditions`, `resolve.alias` and `server.deps.inline` alike.

`publishConfig.exports` now mirrors the source map with `development` removed, so the published package resolves `./dist/react.js` — the artefact a built site already ships — while workspace development keeps resolving source. Present since at least 5.2.0.
