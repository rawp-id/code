/**
 * Converts declarative VS Code extensions (themes and icon themes) into
 * native Acode plugins. Code extensions cannot be converted 1:1 because the
 * two editors expose different extension APIs, so we report them as
 * unsupported instead of shipping something broken.
 */

const FALLBACK_ICON_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABAUlEQVR42u3bQQ4CIQyFYS7hEb2XR/FmupjEzWQUQ1v62v8lLCXpFwUkdIzJ3O7Pl9IYVlEr3AxCvfAliGrF/4VQtfgphOrFf0XoUvwlQmuAbsWfEFoDdC3+gwAAAAAAAEDgmEk5gJXIA1hEFsAycgAekQHwTHsAa4Sxs3iLz0kCZDorhANEz5MKYAdkKEBk0gFEJxXArgAAAAAAyAB4gMkCWEHIA2S4LgtdA6zXEclFMHKu1LuA9zdKYhv8OedjHKP6OaAtQIZbIdaATLtAy4OQ10+Ik2B2AP4OAwBAHYD21+LRCLwS470wr8XpGaBjhL4hOsfoHaR7lB5iusiXC38DHFopT10jwxgAAAAASUVORK5CYII=";

/** Tokens that make Acode treat a plugin as an on-demand "theme plugin". */
const THEME_IDENTIFIERS = [
  "theme",
  "catppuccin",
  "pine",
  "githubdark",
  "radiant",
  "rdtheme",
  "ayumirage",
  "dust",
  "synthwave",
  "dragon",
  "mint",
  "monokai",
  "lumina_code",
  "sweet",
  "moonlight",
  "bluloco",
  "documentsviewer",
  "extra_syntax_highlights",
];

const SCOPE_RULES = [
  [/invalid/, "invalid"],
  [/\bcomment\b/, "comment"],
  [/string\.regexp|regexp/, "regexp"],
  [/\bstring\b/, "string"],
  [/constant\.(numeric|integer|float|hex)|\bnumber\b|\bnumeric\b/, "number"],
  [/constant\.language\.(boolean|true|false)|\bboolean\b|\bbool\b/, "bool"],
  [/keyword\.other\.unit|\bunit\b/, "unit"],
  [/keyword\.operator|\boperator\b/, "operator"],
  [/storage\.type/, "typeName"],
  [/^\s*(storage|keyword)\b/, "keyword"],
  [/entity\.name\.tag|support\.class\.component/, "tagName"],
  [/entity\.other\.attribute-name|attribute\.name/, "attributeName"],
  [/entity\.name\.function|support\.function|meta\.function-call|meta\.function/, "function(variableName)"],
  [
    /entity\.name\.(type|class|struct|enum|interface|namespace|module)|support\.(class|type)|entity\.name\.scope/,
    "typeName",
  ],
  [
    /variable\.other\.property|support\.type\.property-name|meta\.object-literal\.key|meta\.property-name|entity\.name\.property/,
    "propertyName",
  ],
  [/variable\.parameter|variable\.language/, "variableName"],
  [/\bvariable\b/, "variableName"],
  [/\bconstant\b/, "constant"],
  [/\bpunctuation\b/, "punctuation"],
  [/entity\.name\.label/, "labelName"],
  [/markup\.heading|punctuation\.definition\.heading/, "heading"],
  [/markup\.bold/, "strong"],
  [/markup\.italic/, "emphasis"],
  [/markup\.underline\.link|string\.other\.link/, "link"],
  [/markup\.inserted/, "inserted"],
  [/markup\.deleted/, "deleted"],
  [/markup\.changed/, "changed"],
  [/entity\.name/, "definition(variableName)"],
];

// --- Public API ------------------------------------------------------------

export function analyze(manifest) {
  const contributes = manifest.contributes || {};
  const count = (value) => (Array.isArray(value) ? value.length : value ? 1 : 0);

  const capabilities = {
    themes: count(contributes.themes),
    iconThemes: count(contributes.iconThemes),
    productIconThemes: count(contributes.productIconThemes),
    snippets: count(contributes.snippets),
    grammars: count(contributes.grammars),
    languages: count(contributes.languages),
    commands: count(contributes.commands),
    keybindings: count(contributes.keybindings),
    configuration: count(contributes.configuration),
    views: contributes.views ? Object.keys(contributes.views).length : 0,
    debuggers: count(contributes.debuggers),
    taskDefinitions: count(contributes.taskDefinitions),
    problemMatchers: count(contributes.problemMatchers),
    notebooks: count(contributes.notebooks),
  };

  const hasCode = Boolean(manifest.main || manifest.browser);
  const declarative = capabilities.themes > 0 || capabilities.iconThemes > 0 || capabilities.languages > 0;
  const convertible = declarative;

  let kind = "unsupported";
  if (capabilities.themes && capabilities.iconThemes) kind = "theme+icons";
  else if (capabilities.themes) kind = "theme";
  else if (capabilities.iconThemes) kind = "icon-theme";
  else if (capabilities.languages) kind = "language";
  else if (capabilities.grammars || capabilities.snippets) kind = "language";
  else if (hasCode) kind = "code";

  const skipped = [];
  if (hasCode) skipped.push("runtime code (extension.js)");
  if (capabilities.commands) skipped.push(`${capabilities.commands} command(s)`);
  if (capabilities.views) skipped.push("custom views");
  if (capabilities.debuggers) skipped.push("debuggers");
  if (capabilities.taskDefinitions) skipped.push("task definitions");
  if (capabilities.grammars) skipped.push(`${capabilities.grammars} grammar(s) / syntax`);
  if (capabilities.snippets) skipped.push(`${capabilities.snippets} snippet file(s)`);
  if (capabilities.productIconThemes) skipped.push("product icon theme(s)");
  if (capabilities.keybindings) skipped.push("keybindings");
  if (capabilities.configuration) skipped.push("settings/configuration");

  return {
    id: `${manifest.publisher || "unknown"}.${manifest.name || "extension"}`,
    displayName: manifest.displayName || manifest.name || "Extension",
    version: manifest.version || "0.0.0",
    publisher: manifest.publisher || "unknown",
    hasCode,
    convertible,
    partial: convertible && skipped.length > 0,
    kind,
    capabilities,
    skipped,
    license: manifest.license || "",
    repository: normalizeRepository(manifest.repository),
    engines: manifest.engines || {},
  };
}

export async function buildPlugin(pkg, options = {}) {
  const source = options.source || "openvsx";
  const analysis = analyze(pkg.manifest);
  if (!analysis.convertible) {
    return { convertible: false, analysis };
  }

  const id = makePluginId(pkg.publisher, pkg.name);

  // Language extensions are supported through Acode's LSP registry instead of a
  // generated plugin bundle, so there are no assets to build.
  if (!analysis.capabilities.themes && !analysis.capabilities.iconThemes) {
    return { convertible: true, languageOnly: true, analysis, id };
  }

  const contributes = pkg.contributes();

  const themeResult = contributes.themes?.length
    ? await convertThemes(pkg)
    : { appThemes: [], editorThemes: [], themeCount: 0 };

  const iconResult = contributes.iconThemes?.length ? await convertIconTheme(pkg, id) : null;

  const mainJs = buildMainJs({
    id,
    appThemes: themeResult.appThemes,
    editorThemes: themeResult.editorThemes,
    iconPack: iconResult?.pack || null,
  });

  const assets = [
    { path: "main.js", data: mainJs },
    { path: "readme.md", data: await buildReadme(pkg, analysis, themeResult, iconResult) },
    { path: "icon.png", data: await readIconBytes(pkg) },
  ];
  if (iconResult) assets.push(...iconResult.files);

  const pluginJson = {
    $schema: "https://acode.app/schema/plugin/v0.1.0.json",
    id,
    name: `${pkg.displayName} (VS Code)`,
    main: "main.js",
    version: sanitizeVersion(pkg.version),
    readme: "readme.md",
    icon: "icon.png",
    minVersionCode: iconResult ? 1012 : 1000,
    license: pkg.manifest.license || "See the original extension license",
    keywords: ["vscode", "marketplace", "converted", analysis.kind],
    author: { name: pkg.publisher },
    ...(analysis.repository ? { repository: analysis.repository } : {}),
  };

  return {
    convertible: true,
    id,
    source,
    analysis,
    pluginJson,
    assets,
    report: {
      kind: analysis.kind,
      editorThemes: themeResult.editorThemes.length,
      appThemes: themeResult.appThemes.length,
      icons: iconResult ? iconResult.count : 0,
      skipped: analysis.skipped,
      partial: analysis.partial,
    },
  };
}

// --- Theme conversion ------------------------------------------------------

async function convertThemes(pkg) {
  const contributions = pkg.contributes().themes || [];
  const appThemes = [];
  const editorThemes = [];
  const usedNames = new Set();

  for (let index = 0; index < contributions.length; index++) {
    const entry = contributions[index];
    if (!entry.path) continue;

    let theme;
    try {
      theme = await loadTheme(pkg, entry.path, new Set());
    } catch {
      continue;
    }

    const dark = resolveDark(theme, entry);
    const label = entry.label || theme.name || `${pkg.displayName} ${index + 1}`;
    const editorId = `${slug(pkg.publisher)}.${slug(pkg.name)}.${slug(label)}`.slice(0, 80);

    const rules = buildHighlightRules(theme.tokenColors);
    const background = pickColor(theme.colors, ["editor.background", "sideBar.background"], dark ? "#1e1e1e" : "#ffffff");
    const foreground = pickColor(theme.colors, ["editor.foreground", "foreground"], dark ? "#d4d4d4" : "#333333");

    editorThemes.push({
      id: editorId,
      caption: label,
      dark,
      rules,
      styles: buildEditorStyles(theme.colors, background, foreground, dark),
      config: {
        name: editorId,
        dark,
        background,
        foreground,
        ...highlightSummary(rules),
      },
    });

    let appName = contributions.length > 1 ? `${pkg.displayName} - ${label}` : pkg.displayName;
    while (usedNames.has(appName.toLowerCase())) appName += " *";
    usedNames.add(appName.toLowerCase());

    appThemes.push({
      name: appName,
      type: dark ? "dark" : "light",
      colors: mapAppColors(theme.colors, dark),
      preferredEditorTheme: editorId,
    });
  }

  return { appThemes, editorThemes, themeCount: editorThemes.length };
}

async function loadTheme(pkg, themePath, seen) {
  if (seen.has(themePath)) throw new Error(`Circular theme include: ${themePath}`);
  seen.add(themePath);

  const raw = await pkg.text(themePath);
  let theme;
  try {
    theme = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid theme JSON: ${themePath}`);
  }

  if (theme.include) {
    const base = await loadTheme(pkg, joinRelative(themePath, theme.include), seen);
    theme = mergeTheme(base, theme);
  }

  if (typeof theme.tokenColors === "string") {
    const tokensPath = joinRelative(themePath, theme.tokenColors);
    const parsed = JSON.parse(await pkg.text(tokensPath));
    theme.tokenColors = Array.isArray(parsed) ? parsed : parsed.tokenColors || [];
  }

  return theme;
}

function mergeTheme(base, override) {
  return {
    ...base,
    ...override,
    colors: { ...(base.colors || {}), ...(override.colors || {}) },
    tokenColors: [...(base.tokenColors || []), ...(override.tokenColors || [])],
  };
}

function resolveDark(theme, entry) {
  if (theme.type) return theme.type !== "light";
  const ui = entry.uiTheme || "";
  if (ui === "vs") return false;
  if (ui === "vs-dark" || ui === "hc-black" || ui === "hc-light") return ui !== "hc-light";
  return true;
}

function buildHighlightRules(tokenColors) {
  const rules = new Map();
  for (const token of tokenColors || []) {
    const settings = token.settings || {};
    const color = firstColor(settings.foreground);
    const fontStyle = settings.fontStyle || "";
    if (!color && !fontStyle) continue;

    const scopes = normalizeScopes(token.scope);
    for (const scope of scopes) {
      const tag = mapScope(scope);
      if (!tag) continue;
      const existing = rules.get(tag) || { tag };
      if (color) existing.color = color;
      if (fontStyle) existing.fontStyle = fontStyle;
      rules.set(tag, existing);
    }
  }
  return [...rules.values()].filter((rule) => rule.color);
}

function normalizeScopes(scope) {
  if (!scope) return [];
  const list = Array.isArray(scope) ? scope : [scope];
  return list
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function mapScope(scope) {
  for (const [pattern, tag] of SCOPE_RULES) {
    if (pattern.test(scope)) return tag;
  }
  return null;
}

function buildEditorStyles(colors, background, foreground, dark) {
  const selection = pickColor(colors, ["editor.selectionBackground", "editor.inactiveSelectionBackground"], "");
  const line = pickColor(colors, ["editor.lineHighlightBackground", "editor.lineHighlightBorder"], "");
  const cursor = pickColor(colors, ["editorCursor.foreground", "editor.foreground"], foreground);
  const gutterBg = pickColor(colors, ["editorGutter.background"], background);
  const gutterFg = pickColor(colors, ["editorLineNumber.foreground", "editorLineNumber.activeForeground"], foreground);

  return pruneEmpty({
    "&": { color: foreground, backgroundColor: background },
    ".cm-content": { caretColor: cursor },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: cursor },
    ".cm-selectionBackground, .cm-content ::selection": { backgroundColor: selection },
    ".cm-gutters": { backgroundColor: gutterBg, color: gutterFg, border: "none" },
    ".cm-activeLine": { backgroundColor: line },
    ".cm-activeLineGutter": { backgroundColor: line },
  });
}

function highlightSummary(rules) {
  const byTag = new Map(rules.map((rule) => [rule.tag, rule.color]));
  const pick = (...tags) => tags.map((tag) => byTag.get(tag)).find(Boolean);
  return pruneEmpty({
    keyword: pick("keyword"),
    string: pick("string"),
    number: pick("number", "bool"),
    comment: pick("comment"),
    function: pick("function(variableName)"),
    variable: pick("variableName"),
    type: pick("typeName"),
    class: pick("typeName"),
    constant: pick("constant", "bool", "number"),
    operator: pick("operator"),
    invalid: pick("invalid"),
  });
}

function mapAppColors(colors = {}, dark) {
  const fallback = dark
    ? {
        primaryColor: "#252526",
        primaryTextColor: "#cccccc",
        secondaryColor: "#1e1e1e",
        secondaryTextColor: "#d4d4d4",
      }
    : {
        primaryColor: "#e7e7e7",
        primaryTextColor: "#333333",
        secondaryColor: "#ffffff",
        secondaryTextColor: "#333333",
      };

  const out = { ...fallback };
  const set = (prop, keys) => {
    const value = pickColor(colors, keys, "");
    if (value) out[prop] = value;
  };

  set("primaryColor", ["titleBar.activeBackground", "activityBar.background", "statusBar.background"]);
  set("primaryTextColor", ["titleBar.activeForeground", "activityBar.foreground", "statusBar.foreground"]);
  set("secondaryColor", ["editor.background", "sideBar.background", "editorGroup.background"]);
  set("secondaryTextColor", ["editor.foreground", "foreground", "sideBar.foreground"]);
  set("linkTextColor", ["textLink.foreground", "textLink.activeForeground"]);
  set("borderColor", ["panel.border", "editorGroup.border", "contrastBorder", "input.border"]);
  set("boxShadowColor", ["widget.shadow", "scrollbar.shadow"]);
  set("scrollbarColor", ["scrollbarSlider.background", "scrollbarSlider.hoverBackground"]);
  set("activeColor", ["focusBorder", "button.background", "activityBarBadge.background", "list.activeSelectionBackground"]);
  set("activeTextColor", ["button.foreground", "activityBarBadge.foreground"]);
  set("activeIconColor", ["icon.foreground", "sideBar.foreground"]);
  set("errorTextColor", ["errorForeground", "editorError.foreground"]);
  set("dangerColor", ["editorError.foreground", "errorForeground", "statusBarItem.remoteBackground"]);
  set("buttonBackgroundColor", ["button.background"]);
  set("buttonTextColor", ["button.foreground"]);
  set("buttonActiveColor", ["button.hoverBackground"]);
  set("popupBackgroundColor", ["editorWidget.background", "dropdown.background", "menu.background", "quickInput.background"]);
  set("popupTextColor", ["editorWidget.foreground", "dropdown.foreground", "menu.foreground", "quickInput.foreground"]);
  set("popupBorderColor", ["editorWidget.border", "dropdown.border", "menu.border"]);
  set("popupIconColor", ["icon.foreground", "activityBar.foreground"]);

  return out;
}

// --- Icon theme conversion -------------------------------------------------

async function convertIconTheme(pkg, pluginId) {
  const contributions = pkg.contributes().iconThemes || [];
  const entry = contributions[0];
  if (!entry?.path) return null;

  let raw;
  try {
    raw = JSON.parse(await pkg.text(entry.path));
  } catch {
    return null;
  }

  const definitions = raw.iconDefinitions || {};
  const referenced = collectIconRefs(raw);

  const safeById = new Map();
  const used = new Set();
  const files = [];
  const exported = new Set();

  for (const iconId of referenced) {
    const def = definitions[iconId];
    const iconPath = def?.iconPath;
    if (!iconPath || !/\.svg$/i.test(iconPath)) continue;

    const source = joinRelative(entry.path, iconPath);
    if (!pkg.has(source)) continue;

    let safe = String(iconId).replace(/[^A-Za-z0-9_-]/g, "_") || "icon";
    let candidate = safe;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${safe}_${suffix++}`;
    used.add(candidate);
    safeById.set(iconId, candidate);
    exported.add(iconId);

    files.push({ path: `icons/${candidate}.svg`, data: await pkg.bytes(source) });
  }

  if (!files.length) return null;

  const mapIds = (source) => {
    const out = {};
    for (const [key, value] of Object.entries(source || {})) {
      const iconId = typeof value === "string" ? value : value?.id;
      if (iconId && exported.has(iconId)) out[key] = safeById.get(iconId);
    }
    return out;
  };

  const one = (value) => (value && exported.has(value) ? safeById.get(value) : undefined);

  const pack = pruneEmpty({
    id: pluginId,
    name: `${pkg.displayName} Icons`,
    fileNames: mapIds(raw.fileNames),
    fileExtensions: mapIds(raw.fileExtensions),
    languageIds: mapIds(raw.languageIds),
    folderNames: mapIds(raw.folderNames),
    folderNamesExpanded: mapIds(raw.folderNamesExpanded),
    file: one(raw.file),
    folder: one(raw.folder),
    folderExpanded: one(raw.folderExpanded),
    rootFolder: one(raw.rootFolder),
    rootFolderExpanded: one(raw.rootFolderExpanded),
  });

  return { pack, files, count: files.length };
}

function collectIconRefs(raw) {
  const refs = new Set();
  const add = (value) => {
    if (typeof value === "string") refs.add(value);
    else if (value && typeof value === "object" && typeof value.id === "string") refs.add(value.id);
  };
  for (const key of ["fileNames", "fileExtensions", "folderNames", "folderNamesExpanded", "languageIds"]) {
    for (const value of Object.values(raw[key] || {})) add(value);
  }
  for (const key of ["file", "folder", "folderExpanded", "rootFolder", "rootFolderExpanded"]) add(raw[key]);
  return refs;
}

// --- Generated plugin main.js ----------------------------------------------

function buildMainJs({ id, appThemes, editorThemes, iconPack }) {
  const data = JSON.stringify({ appThemes, editorThemes, iconPack }).replace(/</g, "\\u003c");
  return `/* Generated by VS Code Marketplace for Acode. Do not edit by hand. */
(function () {
  "use strict";
  var ID = ${JSON.stringify(id)};
  var DATA = ${data};
  var iconRegistration;
  var boundFileIcons = safeRequire("fileIcons");

  function safeRequire(name) {
    try { return acode.require(name); } catch (error) { return null; }
  }

  function tagFromExpression(expression, tags) {
    var match = /^([A-Za-z]+)(?:\\(([A-Za-z]+)\\))?$/.exec(expression);
    if (!match || !tags) return tags ? tags.variableName : null;
    var base = tags[match[1]];
    if (!base) return tags.variableName;
    if (match[2] && typeof base === "function") {
      var inner = tags[match[2]];
      return inner ? base(inner) : base;
    }
    return base;
  }

  function buildEditorTheme(spec, editorThemes) {
    var tags = (editorThemes.cm && editorThemes.cm.tags) || null;
    if (!tags) {
      var codemirror = safeRequire("codemirror");
      tags = codemirror && codemirror.lezer && codemirror.lezer.tags;
    }
    var rules = [];
    for (var i = 0; i < spec.rules.length; i++) {
      var rule = spec.rules[i];
      var tag = tagFromExpression(rule.tag, tags);
      if (!tag) continue;
      var item = { tag: tag, color: rule.color };
      if (rule.fontStyle) {
        if (rule.fontStyle.indexOf("italic") !== -1) item.fontStyle = "italic";
        if (rule.fontStyle.indexOf("bold") !== -1) item.fontWeight = "bold";
        if (rule.fontStyle.indexOf("underline") !== -1) item.textDecoration = "underline";
      }
      rules.push(item);
    }
    var highlightStyle = editorThemes.createHighlightStyle(rules);
    return editorThemes.createTheme({ dark: spec.dark, styles: spec.styles, highlightStyle: highlightStyle });
  }

  function registerEditorThemes(editorThemes) {
    for (var i = 0; i < DATA.editorThemes.length; i++) {
      (function (spec) {
        editorThemes.register({
          id: spec.id,
          caption: spec.caption,
          dark: spec.dark,
          config: spec.config,
          getExtension: function () { return buildEditorTheme(spec, editorThemes); }
        });
      })(DATA.editorThemes[i]);
    }
  }

  function registerAppThemes() {
    var ThemeBuilder = safeRequire("themeBuilder");
    var themes = safeRequire("themes");
    if (!ThemeBuilder || !themes) return;
    for (var i = 0; i < DATA.appThemes.length; i++) {
      var spec = DATA.appThemes[i];
      var theme = new ThemeBuilder(spec.name, spec.type);
      for (var key in spec.colors) {
        if (Object.prototype.hasOwnProperty.call(spec.colors, key)) theme[key] = spec.colors[key];
      }
      if (spec.preferredEditorTheme) theme.preferredEditorTheme = spec.preferredEditorTheme;
      themes.add(theme);
    }
  }

  function registerIconPack(fileIcons, baseUrl) {
    if (!DATA.iconPack || !fileIcons || !fileIcons.register) return;
    var pack = {
      id: DATA.iconPack.id,
      name: DATA.iconPack.name,
      icons: String(baseUrl).replace(/\\/?$/, "/") + "icons/",
      fileNames: DATA.iconPack.fileNames,
      fileExtensions: DATA.iconPack.fileExtensions,
      languageIds: DATA.iconPack.languageIds,
      folderNames: DATA.iconPack.folderNames,
      folderNamesExpanded: DATA.iconPack.folderNamesExpanded,
      file: DATA.iconPack.file,
      folder: DATA.iconPack.folder,
      folderExpanded: DATA.iconPack.folderExpanded,
      rootFolder: DATA.iconPack.rootFolder,
      rootFolderExpanded: DATA.iconPack.rootFolderExpanded
    };
    for (var key in pack) {
      if (pack[key] === undefined || pack[key] === null) delete pack[key];
    }
    iconRegistration = fileIcons.register(pack);
  }

  acode.setPluginInit(ID, function (baseUrl, page, options) {
    var editorThemes = safeRequire("editorThemes");
    if (editorThemes && DATA.editorThemes.length) registerEditorThemes(editorThemes);
    if (DATA.appThemes.length) registerAppThemes();
    var fileIcons = (options && options.fileIcons) || boundFileIcons;
    registerIconPack(fileIcons, baseUrl);
  });

  acode.setPluginUnmount(ID, function () {
    if (iconRegistration && typeof iconRegistration.dispose === "function") iconRegistration.dispose();
    iconRegistration = undefined;
    var editorThemes = safeRequire("editorThemes");
    if (editorThemes) {
      for (var i = 0; i < DATA.editorThemes.length; i++) {
        try { editorThemes.unregister(DATA.editorThemes[i].id); } catch (error) { /* ignore */ }
      }
    }
  });
})();
`;
}

// --- Readme / icon ---------------------------------------------------------

async function buildReadme(pkg, analysis, themeResult, iconResult) {
  const original = await pkg.readme();
  const bullets = [];
  if (themeResult.editorThemes.length) bullets.push(`- ${themeResult.editorThemes.length} editor theme(s)`);
  if (themeResult.appThemes.length) bullets.push(`- ${themeResult.appThemes.length} app theme(s)`);
  if (iconResult) bullets.push(`- 1 file icon pack with ${iconResult.count} icon(s)`);

  const lines = [
    `# ${pkg.displayName}`,
    "",
    `> Converted from the VS Code extension \`${pkg.publisher}.${pkg.name}@${pkg.version}\` by the **VS Code Marketplace** plugin for Acode.`,
    "",
    "**Included in this Acode plugin:**",
    ...bullets,
  ];

  if (analysis.partial && analysis.skipped.length) {
    lines.push("", `> Some parts of the original extension are not supported by Acode and were skipped: ${analysis.skipped.join(", ")}.`);
  }

  lines.push("", "---", "", original || "_The original extension did not ship a README._");
  return lines.join("\n");
}

async function readIconBytes(pkg) {
  const candidates = [pkg.manifest.icon, "icon.png", "logo.png", "images/icon.png", "assets/icon.png"].filter(Boolean);
  for (const candidate of candidates) {
    const bytes = await pkg.bytes(candidate);
    if (bytes && bytes.length) return bytes;
  }
  return base64ToBytes(FALLBACK_ICON_BASE64);
}

// --- Helpers ---------------------------------------------------------------

export function makePluginId(publisher, name) {
  const scrubbed = scrubThemeIdentifiers(`${publisher}.${name}`);
  return `vscmk.${scrubbed}`.slice(0, 60).replace(/[-_.]+$/, "");
}

function scrubThemeIdentifiers(text) {
  let out = String(text || "extension").toLowerCase();
  for (const token of THEME_IDENTIFIERS) out = out.split(token).join("x");
  return (
    out
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-_.]+|[-_.]+$/g, "") || "extension"
  );
}

function slug(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sanitizeVersion(version) {
  const value = String(version || "1.0.0").split("-")[0];
  return /^\d+\.\d+\.\d+/.test(value) ? value : "1.0.0";
}

function pickColor(colors, keys, fallback) {
  for (const key of keys) {
    const value = colors?.[key];
    if (value && typeof value === "string") return value;
  }
  return fallback;
}

function firstColor(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.foreground === "string") return value.foreground;
  return "";
}

function pruneEmpty(object) {
  const out = {};
  for (const [key, value] of Object.entries(object || {})) {
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) continue;
    out[key] = value;
  }
  return out;
}

function joinRelative(base, relative) {
  if (!relative) return base;
  const clean = String(relative).replace(/\\/g, "/");
  if (!clean.startsWith(".")) return clean.replace(/^\//, "");
  const baseParts = String(base).split("/");
  baseParts.pop();
  for (const part of clean.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") baseParts.pop();
    else baseParts.push(part);
  }
  return baseParts.join("/");
}

function normalizeRepository(repository) {
  if (!repository) return "";
  if (typeof repository === "string") return repository;
  return repository.url || "";
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
