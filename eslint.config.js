import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import-x";

const SAFE_HTML_MESSAGE =
  "Raw HTML insertion is banned repo-wide. Feed-supplied HTML must go through the single sanitization choke point (src/ui/components/SafeHtml).";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", ".wrangler/**", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "import-x": importPlugin,
    },
    settings: {
      "import-x/resolver": {
        typescript: true,
      },
    },
    rules: {
      // The single enforced DOMPurify choke point (design.md §5, layer 1 of 3).
      "no-restricted-syntax": [
        "error",
        {
          selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
          message: SAFE_HTML_MESSAGE,
        },
        {
          selector: 'MemberExpression[property.name="innerHTML"]',
          message: SAFE_HTML_MESSAGE,
        },
        {
          selector: 'MemberExpression[property.name="outerHTML"]',
          message: SAFE_HTML_MESSAGE,
        },
        {
          selector: 'MemberExpression[property.name="insertAdjacentHTML"]',
          message: SAFE_HTML_MESSAGE,
        },
      ],
      // Layer 2 of 3: dompurify may only be imported by its own adapter.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "dompurify",
              message:
                "dompurify may only be imported inside src/adapters/security/**.",
            },
          ],
        },
      ],
      // One-way dependency rule (design.md §1): domain <- ports <- services <- ui/containers,
      // adapters <- domain/ports only, ui/components presentational-only, worker isolated.
      "import-x/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./src/domain",
              from: [
                "./src/ports",
                "./src/services",
                "./src/adapters",
                "./src/ui",
                "./src/app",
                "./worker",
              ],
              message: "domain/** must not import from any other layer.",
            },
            {
              target: "./src/ports",
              from: [
                "./src/adapters",
                "./src/services",
                "./src/ui",
                "./src/app",
                "./worker",
              ],
              message: "ports/** may only import domain/**.",
            },
            {
              target: "./src/services",
              from: ["./src/adapters", "./src/ui", "./src/app", "./worker"],
              message: "services/** may only import domain/** and ports/**.",
            },
            {
              target: "./src/adapters",
              from: ["./src/services", "./src/ui", "./src/app", "./worker"],
              message:
                "adapters/** may only import domain/**, ports/**, and npm libs.",
            },
            {
              target: "./src/ui/components",
              from: [
                "./src/ports",
                "./src/services",
                "./src/adapters",
                "./worker",
              ],
              message:
                "ui/components/** is presentational-only: props in, callbacks out.",
            },
            {
              target: "./src/ui/containers",
              from: ["./src/adapters", "./worker"],
              message:
                "ui/containers/** may bind domain/** and services/** (via context) plus ui/components/**, never adapters/** directly.",
            },
            {
              target: "./worker",
              from: ["./src"],
              message: "worker/** must never import from src/**.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/adapters/security/**"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
);
