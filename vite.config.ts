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
      "install-pi-extensions": {
        command: [
          "vp run @joknoll/pi-cache#build",
          "vp run @joknoll/pi-footer#build",
          "vp run @joknoll/pi-rtk#build",
          'pi install "$PWD/packages/pi-cache"',
          'pi install "$PWD/packages/pi-footer"',
          'pi install "$PWD/packages/pi-rtk"',
        ],
        // This mutates the user's global Pi settings and must always run.
        cache: false,
      },
      "dev-pi-extensions": {
        command:
          "vp run -r dev --filter @joknoll/pi-cache --filter @joknoll/pi-footer --filter @joknoll/pi-rtk --parallel",
        cache: false,
      },
    },
  },
});
