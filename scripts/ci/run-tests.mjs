import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "../..");
const testsDirectory = join(root, "tests", "hndai-v1");
const browserTest = "structureHistoricalOutcomeBrowserIntegration.test.js";

function fail(message) {
    console.error(`HND_CI_TEST_RUNNER_ERROR:${message}`);
    process.exitCode = 1;
}

function argumentsMap(values) {
    const output = { mode: null, base: null, head: null, files: [] };
    for (let index = 0; index < values.length; index += 1) {
        const key = values[index];
        if (["--mode", "--base", "--head"].includes(key)) {
            if (!values[index + 1]) throw new Error(`MISSING_VALUE:${key}`);
            output[key.slice(2)] = values[index + 1];
            index += 1;
        } else if (key === "--files") {
            index += 1;
            while (index < values.length && !values[index].startsWith("--")) {
                output.files.push(values[index]);
                index += 1;
            }
            index -= 1;
        } else throw new Error(`UNKNOWN_ARGUMENT:${key}`);
    }
    if (!["targeted", "full", "browser"].includes(output.mode)) throw new Error("INVALID_MODE");
    if ((output.base && !output.head) || (!output.base && output.head)) throw new Error("BASE_HEAD_MUST_BE_PAIRED");
    return output;
}

function git(args) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`GIT_FAILED:${args.join(" ")}:${String(result.stderr).trim()}`);
    return result.stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
}

function changedFiles(options) {
    if (options.files.length) return [...new Set(options.files.map(value => value.replaceAll("\\", "/")))].sort();
    if (options.base && options.head) return git(["diff", "--name-only", options.base, options.head]);
    return git(["status", "--short"]).map(line => line.slice(3).replaceAll("\\", "/"));
}

function allTests() {
    if (!existsSync(testsDirectory)) throw new Error("TEST_DIRECTORY_MISSING");
    const files = readdirSync(testsDirectory).filter(name => name.endsWith(".test.js")).sort();
    if (!files.length) throw new Error("NO_TEST_PACKAGES_FOUND");
    return files;
}

function targetedTests(files, available) {
    const selected = new Set();
    let unmapped = files.length === 0;
    const selectIfPresent = name => { if (available.includes(name)) selected.add(name); };
    for (const raw of files) {
        const path = raw.replaceAll("\\", "/");
        const name = basename(path);
        if (/^tests\/hndai-v1\/.*\.test\.js$/.test(path)) {
            if (!available.includes(name)) unmapped = true;
            else selected.add(name);
            continue;
        }
        if (path.startsWith("js/hndai-v1/") && name.endsWith(".js")) {
            const direct = `${name.slice(0, -3)}.test.js`;
            if (available.includes(direct)) selected.add(direct);
            else unmapped = true;
            continue;
        }
        if (["index.html", "style.css", "js/ui.js"].includes(path)) {
            selectIfPresent("structureShadowRuntimeUI.test.js");
            selectIfPresent(browserTest);
            continue;
        }
        unmapped = true;
    }
    return unmapped || selected.size === 0 ? { tests: available, fallbackToFull: true }
        : { tests: [...selected].sort(), fallbackToFull: false };
}

function assertionCount(output) {
    const explicit = [...output.matchAll(/passed:\s*(\d+) scenarios,\s*(\d+) assertions/gi)];
    if (explicit.length) return Number(explicit.at(-1)[2]);
    const marker = [...output.matchAll(/HND_[A-Z0-9_]+_TESTS_PASS:(\d+)/g)];
    if (marker.length) return Number(marker.at(-1)[1]);
    const passLines = output.split(/\r?\n/).filter(line => line.startsWith("PASS:")).length;
    if (passLines) return passLines;
    throw new Error("ASSERTION_TOTAL_UNAVAILABLE");
}

function runPackage(name) {
    const fullPath = join(testsDirectory, name);
    if (!existsSync(fullPath)) throw new Error(`TEST_FILE_MISSING:${name}`);
    const result = spawnSync(process.execPath, [fullPath], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, NODE_PATH: process.env.NODE_PATH || join(root, "node_modules") },
        maxBuffer: 32 * 1024 * 1024
    });
    const output = `${result.stdout || ""}${result.stderr || ""}`;
    process.stdout.write(output);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`TEST_FAILED:${name}:EXIT_${result.status}`);
    return assertionCount(output);
}

try {
    const options = argumentsMap(process.argv.slice(2));
    const available = allTests();
    let selection;
    if (options.mode === "full") selection = { tests: available, fallbackToFull: false, files: [] };
    else if (options.mode === "browser") {
        if (!available.includes(browserTest)) throw new Error("BROWSER_TEST_MISSING");
        selection = { tests: [browserTest], fallbackToFull: false, files: [] };
    } else {
        const files = changedFiles(options);
        selection = { ...targetedTests(files, available), files };
    }
    let assertions = 0;
    for (const name of selection.tests) {
        console.log(`HND_CI_PACKAGE_BEGIN:${name}`);
        assertions += runPackage(name);
        console.log(`HND_CI_PACKAGE_PASS:${name}`);
    }
    const summary = {
        mode: options.mode,
        packageCount: selection.tests.length,
        assertionCount: assertions,
        failureCount: 0,
        fallbackToFull: selection.fallbackToFull,
        changedFiles: selection.files || [],
        packages: selection.tests
    };
    console.log(`HND_CI_TEST_SUMMARY:${JSON.stringify(summary)}`);
} catch (error) {
    fail(error && error.stack ? error.stack : String(error));
}
