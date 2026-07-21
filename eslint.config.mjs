import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // This rule's static analysis can't tell "setState after an await" or
      // "reset form state when a modal's `open` prop flips" apart from a
      // genuinely synchronous render loop — both are standard, correct
      // patterns used throughout this app (fetch-on-mount, reset-on-open).
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // Edge Functions run under Deno, separate from the Next.js app's
    // generated Database type — typing `ctx.supabaseAdmin` against it
    // makes postgrest-js's insert/update/upsert argument types collapse to
    // `never` (no schema to match against). These intentionally stay loose
    // (`any` + a runtime interface cast), matching the existing
    // send-push/send-invite convention.
    files: ["supabase/functions/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
