import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // React 19 strictness — flags `setState` calls inside `useEffect` bodies
      // even for legitimate data-fetching patterns where a fetched async result
      // is written to state. Our codebase uses this pattern intentionally for
      // every list page (entries, claims, users, roles, etc.). Disabling so
      // dev console / build output isn't drowned in repeated noise.
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
