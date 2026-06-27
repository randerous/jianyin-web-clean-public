import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultRepo = "jianyin-web-clean-public";
const githubApi = "https://api.github.com";

function parseArgs(argv) {
  const args = {
    repo: process.env.GITHUB_REPOSITORY_NAME || defaultRepo,
    owner: process.env.GITHUB_OWNER || "",
    branch: process.env.GITHUB_BRANCH || "main",
    commit: "",
    public: true,
    buildApk: false,
    uploadApk: false,
    dryRun: false,
    allowDirty: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value after ${arg}`);
      return argv[index];
    };
    if (arg === "--repo") args.repo = next();
    else if (arg === "--owner") args.owner = next();
    else if (arg === "--branch") args.branch = next();
    else if (arg === "--commit") args.commit = next();
    else if (arg === "--private") args.public = false;
    else if (arg === "--public") args.public = true;
    else if (arg === "--build-apk") args.buildApk = true;
    else if (arg === "--upload-apk") args.uploadApk = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--allow-dirty") args.allowDirty = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function commandName(name) {
  if (process.platform === "win32" && name === "git") {
    const bundled = "C:\\Program Files\\Git\\cmd\\git.exe";
    if (existsSync(bundled)) return bundled;
  }
  return process.platform === "win32" ? `${name}.exe` : name;
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function run(command, args, options = {}) {
  const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  return execFileSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio ?? "pipe",
    shell: useShell
  });
}

function git(args, options = {}) {
  return run(commandName("git"), args, options);
}

function token() {
  const value = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!value) throw new Error("Set GH_TOKEN or GITHUB_TOKEN before publishing.");
  return value;
}

async function githubFetch(path, options = {}) {
  const response = await fetch(`${githubApi}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message || response.statusText;
    const error = new Error(`GitHub API ${response.status}: ${message}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function currentUser() {
  const user = await githubFetch("/user");
  return user.login;
}

async function ensureRepo(owner, repo, isPublic) {
  try {
    return await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  const body = {
    name: repo,
    private: !isPublic,
    auto_init: false,
    has_issues: true,
    has_projects: false,
    has_wiki: false
  };
  const created = await githubFetch("/user/repos", {
    method: "POST",
    body: JSON.stringify(body)
  });
  console.log(`Created GitHub repo: ${created.html_url}`);
  return created;
}

function trackedChanges() {
  return git(["status", "--short"]).trim();
}

function assertNoSensitiveTrackedFiles() {
  const files = git(["ls-files"]).split(/\r?\n/).filter(Boolean);
  const blocked = files.filter((file) => {
    const lower = file.toLowerCase();
    return lower.endsWith(".apk")
      || lower.endsWith(".aab")
      || lower.endsWith(".keystore")
      || lower.endsWith(".jks")
      || lower === ".jianyin-shared-state.json"
      || lower.includes("local.properties");
  });
  if (blocked.length) {
    throw new Error(`Refusing to publish tracked generated/private files:\n${blocked.join("\n")}`);
  }
}

function commitIfRequested(message) {
  if (!message) return;
  git(["add", "-A"], { stdio: "inherit" });
  const staged = git(["diff", "--cached", "--name-only"]).trim();
  if (!staged) {
    console.log("No staged changes to commit.");
    return;
  }
  git(["commit", "-m", message], { stdio: "inherit" });
}

function pushWithToken(repoUrl, branch) {
  const basicToken = Buffer.from(`x-access-token:${token()}`).toString("base64");
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basicToken}`
  };
  git(["push", repoUrl, `HEAD:${branch}`], { env, stdio: "inherit" });
}

async function ensureRelease(owner, repo, tag) {
  try {
    return await githubFetch(`/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`);
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  return githubFetch(`/repos/${owner}/${repo}/releases`, {
    method: "POST",
    body: JSON.stringify({
      tag_name: tag,
      name: tag,
      prerelease: true,
      make_latest: "false"
    })
  });
}

async function uploadApk(owner, repo) {
  const apkPath = resolve(root, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
  if (!existsSync(apkPath)) throw new Error(`APK not found: ${apkPath}. Run npm run android:apk first or pass --build-apk.`);
  const tag = `debug-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const release = await ensureRelease(owner, repo, tag);
  const uploadUrl = release.upload_url.replace(/\{.*$/, "");
  const bytes = await import("node:fs").then((fs) => fs.readFileSync(apkPath));
  const response = await fetch(`${uploadUrl}?name=app-debug.apk`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": String(statSync(apkPath).size)
    },
    body: bytes
  });
  if (!response.ok) {
    const data = await response.text();
    throw new Error(`Failed to upload APK: ${response.status} ${data}`);
  }
  console.log(`Uploaded APK to release: ${release.html_url}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const owner = args.owner || (args.dryRun ? "OWNER" : await currentUser());
  const repoUrl = `https://github.com/${owner}/${args.repo}.git`;

  if (args.buildApk) {
    run(npmCommand(), ["run", "android:apk"], { stdio: "inherit" });
  }

  assertNoSensitiveTrackedFiles();
  if (args.commit) commitIfRequested(args.commit);

  const changes = trackedChanges();
  if (changes && !args.allowDirty) {
    throw new Error(`Working tree has uncommitted changes. Commit with --commit "message" or pass --allow-dirty.\n${changes}`);
  }

  if (args.dryRun) {
    console.log(`Dry run OK. Would push to ${repoUrl} branch ${args.branch}.`);
    return;
  }

  const repo = await ensureRepo(owner, args.repo, args.public);
  pushWithToken(repoUrl, args.branch);
  console.log(`Pushed to ${repo.html_url}`);

  if (args.uploadApk) {
    await uploadApk(owner, args.repo);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
