const path = require("path");
const fs = require("fs");
const JSZip = require("jszip");

const root = __dirname;
const pluginJSON = path.join(root, "plugin.json");
const distFolder = path.join(root, "dist");
const json = JSON.parse(fs.readFileSync(pluginJSON, "utf8"));

const zip = new JSZip();

zip.file("plugin.json", fs.readFileSync(pluginJSON));

const single = ["icon.png", "readme.md", "LICENSE"];
for (const name of single) {
  const file = path.join(root, name);
  if (fs.existsSync(file)) zip.file(name, fs.readFileSync(file));
}

for (const name of ["changelog.md", "changelogs.md", "CHANGELOG.md"]) {
  const file = path.join(root, name);
  if (fs.existsSync(file)) {
    const target = json.changelogs || "changelog.md";
    zip.file(target, fs.readFileSync(file));
    break;
  }
}

loadFile("", distFolder);

zip
  .generateNodeStream({ type: "nodebuffer", streamFiles: true })
  .pipe(fs.createWriteStream(path.join(root, "plugin.zip")))
  .on("finish", () => {
    const size = fs.statSync(path.join(root, "plugin.zip")).size;
    console.log(`Plugin plugin.zip written (${(size / 1024).toFixed(1)} KB).`);
  });

function loadFile(base, folder) {
  for (const file of fs.readdirSync(folder)) {
    const full = path.join(folder, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      zip.folder(path.join(base, file));
      loadFile(path.join(base, file), full);
      continue;
    }
    if (/\.map$/.test(file)) continue;
    zip.file(path.join(base, file), fs.readFileSync(full));
  }
}
