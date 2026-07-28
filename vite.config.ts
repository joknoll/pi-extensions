import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
    tasks: {
      setup: {
        command: ["vp run -r build", "fd -td -d1 --threads=1 . packages -x pi install {}"],
        // This mutates the user's global Pi settings and must always run.
        cache: false,
      },
      dev: {
        command: "vp run -r dev --parallel",
        cache: false,
      },
    },
  },
});
