/* eslint-env node */
/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  ignorePatterns: ["dist", "node_modules", "coverage"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["@typescript-eslint", "react", "react-hooks", "import"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
  ],
  settings: {
    react: { version: "detect" },
    "import/resolver": {
      typescript: { project: "./tsconfig.app.json", alwaysTryTypes: true },
    },
  },
  rules: {
    "react-hooks/exhaustive-deps": "off",
    "react/no-unescaped-entities": "off",
    "react/react-in-jsx-scope": "off",
    "react/prop-types": "off",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    "@typescript-eslint/no-explicit-any": "off",
    "import/no-unresolved": "error",
    "no-restricted-syntax": [
      "error",
      {
        selector: "Literal[value=/dm-(pill|table-pager__btn)/]",
        message:
          "Do not use dm-pill or dm-table-pager__btn class strings — use AarPill and shared pagination (dm-table-pager + AarButton / aar-btn).",
      },
      {
        selector: "TemplateElement[value.raw=/dm-(pill|table-pager__btn)/]",
        message:
          "Do not embed dm-pill or dm-table-pager__btn in templates — use AarPill and shared pagination (dm-table-pager + AarButton / aar-btn).",
      },
      {
        selector: "Literal[value=/op-table-pager__btn/]",
        message:
          "Do not use op-table-pager__btn — use AarButton with class op-table-pager__action inside PlainOperationalTable (see plainOperationalTable.css).",
      },
      {
        selector: "TemplateElement[value.raw=/op-table-pager__btn/]",
        message:
          "Do not embed op-table-pager__btn — use AarButton + op-table-pager__action for table pager controls.",
      },
    ],
  },
  overrides: [
    {
      files: ["src/pages/scrubber2/**/*.{ts,tsx}"],
      rules: {
        "no-restricted-syntax": "off",
      },
    },
  ],
};
