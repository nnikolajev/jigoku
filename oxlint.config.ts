import { defineConfig } from "oxlint";

// anti-slop (https://github.com/dmmulroy/anti-slop) vendored at tools/oxlint/anti-slop.
// Only the anti-slop rules run here: oxlint's own categories are off so this check does
// not duplicate or contradict the ESLint config in eslint.config.js.
// Enforcement is ratcheted by tools/oxlint/anti-slop-check.mjs against
// tools/oxlint/anti-slop-baseline.json, so new violations fail while legacy debt is tolerated.
export default defineConfig({
    categories: {
        correctness: 'off',
        perf: 'off',
        pedantic: 'off',
        restriction: 'off',
        style: 'off',
        suspicious: 'off',
        nursery: 'off'
    },
    ignorePatterns: [
        '.agent/**',
        '.agents/**',
        '.claude/**',
        '.codex/**',
        '.cursor/**',
        '.gemini/**',
        'build/**',
        'node_modules/**',
        'tools/oxlint/anti-slop/**'
    ],
    jsPlugins: [{ name: 'anti-slop', specifier: './tools/oxlint/anti-slop/index.ts' }],
    rules: {
        'anti-slop/no-chained-type-assertions': 'error',
        'anti-slop/no-conditional-empty-object-spread': 'error',
        'anti-slop/no-known-value-widening': 'error',
        'anti-slop/no-module-mocking': 'error',
        'anti-slop/no-object-parameters': 'error',
        'anti-slop/no-reflect-apply': 'error',
        'anti-slop/no-reflect-get': 'error',
        // A `x is T` predicate is the boundary parser this rule asks for, so `typeof` inside one is signal, not slop.
        'anti-slop/no-runtime-typeof': ['error', { allowInTypeGuards: true }],
        'anti-slop/no-shape-in-symbol-names': 'error',
        'anti-slop/no-unknown-parameters': 'error',
        'anti-slop/no-unknown-returns': 'error',
        'anti-slop/no-unknown-type-aliases': 'error',
        'anti-slop/no-unsafe-dictionary-type': 'error',
        'anti-slop/no-widen-then-assert': 'error',
        'anti-slop/require-safety-comment-for-type-assertion': 'error'
    }
});
