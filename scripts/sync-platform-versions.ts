// Pins optionalDependencies to package.json's own version. `npm version` runs
// this from the "version" script, so a bump keeps the five packages in step.
import { join } from "node:path";
import { platformPackage, TARGETS } from "./platforms.ts";

const path = join(import.meta.dir, "..", "package.json");
const pkg = await Bun.file(path).json();
pkg.optionalDependencies = Object.fromEntries(TARGETS.map((t) => [platformPackage(t), pkg.version]));
await Bun.write(path, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`optionalDependencies pinned to ${pkg.version}`);
