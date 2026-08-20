import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const files = [];

function collect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) collect(path);
        else if (entry.isFile() && entry.name.endsWith(".js")) files.push(path);
    }
}

try {
    const script = join(root, "script.js");
    const js = join(root, "js");
    if (!existsSync(script) || !existsSync(js)) throw new Error("PRODUCTION_JS_ROOT_MISSING");
    files.push(script);
    collect(js);
    files.sort();
    const failures = [];
    for (const file of files) {
        const result = spawnSync(process.execPath, ["--check", file], { cwd: root, encoding: "utf8" });
        if (result.status !== 0 || result.error) failures.push({
            file: relative(root, file).replaceAll("\\", "/"),
            error: result.error ? String(result.error) : String(result.stderr || result.stdout).trim()
        });
    }
    console.log(`HND_CI_SYNTAX_SUMMARY:${JSON.stringify({ fileCount: files.length, failureCount: failures.length, failures })}`);
    if (failures.length) process.exitCode = 1;
} catch (error) {
    console.error(`HND_CI_SYNTAX_ERROR:${error && error.stack ? error.stack : error}`);
    process.exitCode = 1;
}
