import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", ".work/**", "eslint.config.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "no-console": ["error", { allow: ["error"] }]
    }
  },
  {
    files: ["apps/cli/**/*.ts", "spikes/**/*.ts", "**/*.test.ts"],
    rules: { "no-console": "off" }
  }
);
