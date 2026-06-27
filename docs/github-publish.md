# GitHub Publish Workflow

Use the project script instead of manually editing remotes or placing a token in
the repository URL.

## Token

Set a GitHub token in the shell before publishing:

```powershell
$env:GH_TOKEN = "ghp_xxx"
```

`GITHUB_TOKEN` also works. Do not put tokens in `.env`, source files, Git remote
URLs, commits, or docs.

## Dry Run

Check what would be pushed:

```powershell
npm run github:publish -- --owner randerous --repo jianyin-web-clean-public --dry-run --allow-dirty
```

## Publish Code

Commit current changes and push to a public repository:

```powershell
npm run github:publish -- --owner randerous --repo jianyin-web-clean-public --commit "Update Android packaging workflow"
```

The script will:

1. Read `GH_TOKEN` or `GITHUB_TOKEN`.
2. Create the GitHub repository if it does not exist.
3. Refuse to publish tracked private/generated files such as APKs, keystores,
   local state, or `android/local.properties`.
4. Commit changes when `--commit` is provided.
5. Push with a temporary Git askpass helper, without storing the token in the
   remote URL.

## Publish Code And APK

Build the Android APK, push code, and upload `app-debug.apk` to a prerelease:

```powershell
npm run github:publish -- --owner randerous --repo jianyin-web-clean-public --build-apk --upload-apk --commit "Release debug APK"
```

The APK itself is not committed to Git. It is uploaded as a release asset.
