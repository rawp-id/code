/**
 * Language-server catalog (pure data).
 *
 * Each entry maps a VS Code extension id and/or language id to a language
 * server Acode can run. Keeping this separate from the LSP logic in `lsp.js`
 * means new servers can be added without touching any code.
 *
 * Server shape (consumed by `acode.require("lsp").defineServer`):
 *   id, label, languages[], runtimes[], command, args, checkCommand, installer
 *
 * `installer` is a plain `LauncherInstallConfig`:
 *   { kind: "npm"|"pip"|"apk"|"cargo"|"github-release"|"shell"|"manual",
 *     source, executable, packages, global, ... }
 */

export const LSP_SERVER_CATALOG = [
  {
    match: { extensions: ["vue.volar", "vue.vetur", "octref.vetur"], languages: ["vue"] },
    server: {
      id: "vscmk-vue",
      label: "Vue (Volar)",
      languages: ["vue"],
      runtimes: ["builtin-alpine"],
      command: "vue-language-server",
      args: ["--stdio"],
      checkCommand: "which vue-language-server",
      installer: {
        kind: "npm",
        source: "npm",
        executable: "vue-language-server",
        packages: ["@vue/language-server"],
        global: true,
      },
      useWorkspaceFolders: true,
      enabled: false,
    },
  },
  {
    match: { extensions: ["svelte.svelte-vscode"], languages: ["svelte"] },
    server: {
      id: "vscmk-svelte",
      label: "Svelte",
      languages: ["svelte"],
      runtimes: ["builtin-alpine"],
      command: "svelteserver",
      args: ["--stdio"],
      checkCommand: "which svelteserver",
      installer: {
        kind: "npm",
        source: "npm",
        executable: "svelteserver",
        packages: ["svelte-language-server"],
        global: true,
      },
      useWorkspaceFolders: true,
      enabled: false,
    },
  },
  {
    match: { extensions: ["astro-build.astro-vscode"], languages: ["astro"] },
    server: {
      id: "vscmk-astro",
      label: "Astro",
      languages: ["astro"],
      runtimes: ["builtin-alpine"],
      command: "astro-ls",
      args: ["--stdio"],
      checkCommand: "which astro-ls",
      installer: {
        kind: "npm",
        source: "npm",
        executable: "astro-ls",
        packages: ["@astrojs/language-server"],
        global: true,
      },
      useWorkspaceFolders: true,
      enabled: false,
    },
  },
  {
    match: { extensions: ["redhat.vscode-yaml"], languages: ["yaml"] },
    server: {
      id: "vscmk-yaml",
      label: "YAML",
      languages: ["yaml"],
      runtimes: ["builtin-alpine"],
      command: "yaml-language-server",
      args: ["--stdio"],
      checkCommand: "which yaml-language-server",
      installer: {
        kind: "npm",
        source: "npm",
        executable: "yaml-language-server",
        packages: ["yaml-language-server"],
        global: true,
      },
      useWorkspaceFolders: true,
      enabled: false,
    },
  },
  {
    match: { extensions: ["bmewburn.vscode-intelephense-client", "bmewburn.vscode-intelephense-client-pro"], languages: ["php"] },
    server: {
      id: "vscmk-intelephense",
      label: "PHP (Intelephense)",
      languages: ["php"],
      runtimes: ["builtin-alpine"],
      command: "intelephense",
      args: ["--stdio"],
      checkCommand: "which intelephense",
      installer: {
        kind: "npm",
        source: "npm",
        executable: "intelephense",
        packages: ["intelephense"],
        global: true,
      },
      useWorkspaceFolders: true,
      enabled: false,
    },
  },
  {
    match: { extensions: ["tamasfe.even-better-toml"], languages: ["toml"] },
    server: {
      id: "vscmk-taplo",
      label: "TOML (Taplo)",
      languages: ["toml"],
      runtimes: ["builtin-alpine"],
      command: "taplo",
      args: ["lsp", "stdio"],
      checkCommand: "which taplo",
      installer: {
        kind: "npm",
        source: "npm",
        executable: "taplo",
        packages: ["@taplo/cli", "@taplo/lib"],
        global: true,
      },
      useWorkspaceFolders: true,
      enabled: false,
    },
  },
  {
    match: { extensions: ["mads-hartmann.bash-ide-vscode", "timonwong.shellcheck"], languages: [] },
    server: {
      id: "vscmk-bash",
      label: "Bash",
      languages: ["shellscript", "bash", "sh"],
      runtimes: ["builtin-alpine"],
      command: "bash-language-server",
      args: ["start"],
      checkCommand: "which bash-language-server",
      installer: {
        kind: "npm",
        source: "npm",
        executable: "bash-language-server",
        packages: ["bash-language-server"],
        global: true,
      },
      useWorkspaceFolders: true,
      enabled: false,
    },
  },
  {
    match: { extensions: ["ms-azuretools.vscode-docker"], languages: ["dockerfile"] },
    server: {
      id: "vscmk-docker",
      label: "Dockerfile",
      languages: ["dockerfile"],
      runtimes: ["builtin-alpine"],
      command: "docker-langserver",
      args: ["--stdio"],
      checkCommand: "which docker-langserver",
      installer: {
        kind: "npm",
        source: "npm",
        executable: "docker-langserver",
        packages: ["dockerfile-language-server-nodejs"],
        global: true,
      },
      useWorkspaceFolders: true,
      enabled: false,
    },
  },
];
