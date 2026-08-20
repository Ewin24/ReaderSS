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
      // The single enforced DOMPurify choke point (design.md §5, layer 1 of
      // 3). The sink list also covers document.write/parseFromString/
      // createContextualFragment/setHTMLUnsafe/srcdoc, and the computed
      // bracket-access form of every property-name sink below, e.g.
      // `el["innerHTML"]`. A computed key built from string concatenation,
      // e.g. `el["inner" + "HTML"]`, is a KNOWN, DELIBERATE, UNCOVERED gap: its
      // AST property node is a BinaryExpression, not a Literal, so no
      // selector matching a literal `property.value` can express it. See
      // src/adapters/security/rawHtmlSinkGuard.test.ts's module doc comment
      // for the same limitation stated against layer 3.
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
        {
          selector: 'MemberExpression[property.name="parseFromString"]',
          message: SAFE_HTML_MESSAGE,
        },
        {
          selector: 'MemberExpression[property.name="createContextualFragment"]',
          message: SAFE_HTML_MESSAGE,
        },
        {
          selector: 'MemberExpression[property.name="setHTMLUnsafe"]',
          message: SAFE_HTML_MESSAGE,
        },
        {
          selector: 'MemberExpression[property.name="srcdoc"]',
          message: SAFE_HTML_MESSAGE,
        },
        {
          selector: 'CallExpression[callee.object.name="document"][callee.property.name="write"]',
          message: SAFE_HTML_MESSAGE,
        },
        {
          // Computed bracket access with a literal string key, e.g.
          // `el["innerHTML"]` (the covered half of the blind spot).
          selector:
            'MemberExpression[computed=true][property.type="Literal"][property.value=/^(innerHTML|outerHTML|insertAdjacentHTML|srcdoc)$/]',
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
  {
    // The single file-level override for the choke point itself
    // (design.md §5, enforcement layer 1 of 3). Scoped to the exact file,
    // not a broader glob, and not a per-line eslint-disable comment (which
    // the guard test explicitly rejects if it names this rule).
    files: ["src/ui/components/SafeHtml/SafeHtml.tsx"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    // This override was previously repo-wide (`**/*.test.ts(x)`), silently
    // exempting every current and future test file from the layer-zone rule
    // for one test's need. Scoped down to the exact two files that were
    // empirically confirmed (by temporarily removing the override and
    // running `npm run lint`) to need it, mirroring the narrower
    // file-scoped override already used a few lines above for
    // SafeHtml.tsx itself:
    //   - SafeHtml.test.tsx (ui/components/** importing adapters/security/**
    //     directly) renders through the REAL DomPurifySanitizer instead of a
    //     mock, per design.md §7's "assert the resulting DOM, not the
    //     string" testing philosophy.
    //   - subscribeToFeed.test.ts (services/** importing adapters/feed/**
    //     directly) exercises the real feedParser instead of a mock, for
    //     the same reason.
    // Test files are not shipped production code and never enter the
    // runtime import graph the layer-zone rule protects, so this relaxation
    // is legitimate -- but it must be named per-file, not granted to every
    // test in the repo, so a future test cannot silently inherit an
    // exemption it never needed and never asked for. The raw-HTML-sink and
    // dompurify-import bans still apply to these two files unchanged --
    // only the layer-zone import-path rule is relaxed here.
    files: [
      "src/ui/components/SafeHtml/SafeHtml.test.tsx",
      "src/services/subscribeToFeed.test.ts",
    ],
    rules: {
      "import-x/no-restricted-paths": "off",
    },
  },
);
