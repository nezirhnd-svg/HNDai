import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const textExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".mjs", ".txt", ".yaml", ".yml"]);

function parseArguments(values) {
    const output = { base: null, head: null };
    for (let index = 0; index < values.length; index += 1) {
        if (!["--base", "--head"].includes(values[index]) || !values[index + 1]) throw new Error(`INVALID_ARGUMENT:${values[index]}`);
        output[values[index].slice(2)] = values[index + 1];
        index += 1;
    }
    if ((output.base && !output.head) || (!output.base && output.head)) throw new Error("BASE_HEAD_MUST_BE_PAIRED");
    return output;
}

function git(args, allowFailure = false) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (!allowFailure && result.status !== 0) throw new Error(`GIT_FAILED:${args.join(" ")}:${String(result.stderr).trim()}`);
    return result;
}

try {
    const options = parseArguments(process.argv.slice(2));
    const diffArgs = ["diff", "--check"];
    if (options.base) diffArgs.push(options.base, options.head);
    const diff = git(diffArgs, true);
    if (diff.status !== 0) {
        process.stdout.write(diff.stdout || "");
        process.stderr.write(diff.stderr || "");
        throw new Error("GIT_DIFF_CHECK_FAILED");
    }
    const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]).stdout
        .split("\0").filter(Boolean).sort();
    const failures = [];
    for (const path of untracked) {
        if (!textExtensions.has(extname(path).toLowerCase())) continue;
        const fullPath = resolve(root, path);
        if (!existsSync(fullPath)) throw new Error(`UNTRACKED_FILE_DISAPPEARED:${path}`);
        const relativePath = relative(root, fullPath);
        if (relativePath === ".." || relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || resolve(root, relativePath) !== fullPath)
            throw new Error(`PATH_OUTSIDE_ROOT:${path}`);
        const text = readFileSync(fullPath, "utf8");
        text.split(/\r?\n/).forEach((line, index) => {
            if (/[\t ]+$/.test(line)) failures.push(`${path}:${index + 1}:trailing whitespace`);
        });
    }
    failures.forEach(value => console.error(value));
    console.log(`HND_CI_WHITESPACE_SUMMARY:${JSON.stringify({ diffCheck: "PASS", untrackedTextFileCount: untracked.length, failureCount: failures.length })}`);
    if (failures.length) process.exitCode = 1;
} catch (error) {
    console.error(`HND_CI_WHITESPACE_ERROR:${error && error.stack ? error.stack : error}`);
    process.exitCode = 1;
}
