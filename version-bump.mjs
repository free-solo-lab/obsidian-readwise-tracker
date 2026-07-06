import { readFile, writeFile } from "node:fs/promises";

const version = process.env.npm_package_version;
if (!version) {
  throw new Error("npm_package_version is not set. Run this script through npm version.");
}

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const versions = JSON.parse(await readFile("versions.json", "utf8"));

manifest.version = version;
versions[version] = manifest.minAppVersion;

await writeFile("manifest.json", `${JSON.stringify(manifest, null, "\t")}\n`);
await writeFile("versions.json", `${JSON.stringify(versions, null, "\t")}\n`);
