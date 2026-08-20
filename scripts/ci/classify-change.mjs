import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultPolicy = resolve(root, ".github", "critical-paths.yml");

function parseArguments(values) {
    const output = { base: null, head: null, changesJson: null, changesJsonBase64: null, policy: defaultPolicy };
    for (let index = 0; index < values.length; index += 1) {
        const key = values[index];
        if (!["--base", "--head", "--changes-json", "--changes-json-base64", "--policy"].includes(key) || !values[index + 1])
            throw new Error(`INVALID_ARGUMENT:${key}`);
        output[{ "--base": "base", "--head": "head", "--changes-json": "changesJson", "--changes-json-base64": "changesJsonBase64", "--policy": "policy" }[key]] = values[index + 1];
        index += 1;
    }
    if (output.changesJson && output.changesJsonBase64) throw new Error("MULTIPLE_CHANGE_FIXTURES");
    if ((output.changesJson || output.changesJsonBase64) && (output.base || output.head)) throw new Error("CHANGE_FIXTURE_CONFLICTS_WITH_BASE_HEAD");
    if (!output.changesJson && !output.changesJsonBase64 && (!output.base || !output.head)) throw new Error("BASE_HEAD_REQUIRED");
    return output;
}

function gitDiff(base, head) {
    const result = spawnSync("git", ["diff", "--name-status", "--find-renames", base, head], {
        cwd: root, encoding: "utf8"
    });
    if (result.status !== 0) throw new Error(`GIT_DIFF_FAILED:${String(result.stderr).trim()}`);
    return result.stdout.split(/\r?\n/).filter(Boolean).map(line => {
        const fields = line.split("\t");
        const status = fields[0];
        if (/^[RC]/.test(status)) return { status, oldPath: fields[1], path: fields[2] };
        return { status, path: fields[1] };
    });
}

function normalizedChange(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_CHANGE");
    const status = String(value.status || "").toUpperCase();
    const path = String(value.path || "").replaceAll("\\", "/");
    const oldPath = value.oldPath == null ? null : String(value.oldPath).replaceAll("\\", "/");
    if (!status || !path || path.startsWith("/") || path.includes("../")) throw new Error("INVALID_CHANGE_FIELDS");
    return { status, path, oldPath };
}

function globExpression(pattern) {
    let expression = "^";
    for (let index = 0; index < pattern.length; index += 1) {
        const character = pattern[index];
        if (character === "*") {
            if (pattern[index + 1] === "*") { expression += ".*"; index += 1; }
            else expression += "[^/]*";
        } else if (character === "?") expression += "[^/]";
        else expression += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`${expression}$`);
}

function matches(path, patterns) {
    return patterns.some(pattern => globExpression(pattern).test(path));
}

function validatePolicy(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1 ||
        !Array.isArray(value.critical) || !Array.isArray(value.safeCandidates) || !Array.isArray(value.criticalStatuses) ||
        !value.critical.every(item => typeof item === "string" && item) ||
        !value.safeCandidates.every(item => typeof item === "string" && item) ||
        !value.criticalStatuses.every(item => typeof item === "string" && item)) throw new Error("INVALID_POLICY");
    return value;
}

function writeOutput(name, value) {
    if (!process.env.GITHUB_OUTPUT) return;
    const result = spawnSync(process.execPath, ["-e", "require('fs').appendFileSync(process.argv[1], process.argv[2]+'\\n')", process.env.GITHUB_OUTPUT, `${name}=${value}`]);
    if (result.status !== 0) throw new Error("GITHUB_OUTPUT_WRITE_FAILED");
}

try {
    const options = parseArguments(process.argv.slice(2));
    const policyPath = resolve(options.policy);
    if (!existsSync(policyPath)) throw new Error("POLICY_MISSING");
    const policy = validatePolicy(JSON.parse(readFileSync(policyPath, "utf8")));
    const fixtureJson = options.changesJsonBase64
        ? Buffer.from(options.changesJsonBase64, "base64").toString("utf8") : options.changesJson;
    const rawChanges = fixtureJson ? JSON.parse(fixtureJson) : gitDiff(options.base, options.head);
    if (!Array.isArray(rawChanges) || rawChanges.length === 0) throw new Error("NO_CHANGES_TO_CLASSIFY");
    const changes = rawChanges.map(normalizedChange);
    const reasons = [];
    let hasCritical = false;
    let hasUnknown = false;
    for (const change of changes) {
        const statusCode = change.status[0];
        const paths = [change.path, change.oldPath].filter(Boolean);
        if (policy.criticalStatuses.includes(statusCode)) {
            hasCritical = true;
            reasons.push(`${change.status}:${paths.join("->")}:CRITICAL_STATUS`);
            continue;
        }
        if (paths.some(path => matches(path, policy.critical))) {
            hasCritical = true;
            reasons.push(`${change.status}:${paths.join("->")}:CRITICAL_PATH`);
        } else if (paths.every(path => matches(path, policy.safeCandidates))) {
            reasons.push(`${change.status}:${paths.join("->")}:SAFE_PATH`);
        } else {
            hasUnknown = true;
            reasons.push(`${change.status}:${paths.join("->")}:UNKNOWN_PATH`);
        }
    }
    const classification = hasCritical ? "CRITICAL" : hasUnknown ? "UNKNOWN" : "SAFE_CANDIDATE";
    const result = {
        schemaVersion: 1,
        classification,
        mergeEligible: false,
        reportingOnly: true,
        base: options.base,
        head: options.head,
        changeCount: changes.length,
        changes,
        reasons
    };
    writeOutput("classification", classification);
    writeOutput("merge_eligible", "false");
    console.log(`HND_CHANGE_CLASSIFICATION:${JSON.stringify(result)}`);
} catch (error) {
    console.error(`HND_CHANGE_CLASSIFIER_ERROR:${error && error.stack ? error.stack : error}`);
    process.exitCode = 1;
}
