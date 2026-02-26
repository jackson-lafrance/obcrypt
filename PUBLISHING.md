# Publishing Obcrypt to the Obsidian Community Plugins

This guide explains how to release new versions and submit the plugin to the official Obsidian community plugins directory.

## Prerequisites

- GitHub repository: [jackson-lafrance/obcrypt](https://github.com/jackson-lafrance/obcrypt)
- A GitHub release must exist with the required assets before submitting to the community plugins list

## Releasing a New Version

### 1. Update the version

Bump the version in **both** files to match (use [Semantic Versioning](https://semver.org/)):

- `manifest.json` → `"version": "X.Y.Z"`
- `package.json` → `"version": "X.Y.Z"`

### 2. Update CHANGELOG.md

Add a new section for the release with the changes made.

### 3. Create a GitHub release

The repo includes a GitHub Actions workflow that automatically builds and creates a release when you push a tag.

```bash
# Commit your version bump and changelog
git add manifest.json package.json CHANGELOG.md
git commit -m "Release v1.0.0"
git push

# Create and push a tag (tag name must match manifest version, e.g. 1.0.0)
git tag 1.0.0
git push origin 1.0.0
```

The workflow will:

1. Build the plugin (`npm run build`)
2. Create a GitHub release with tag `1.0.0`
3. Attach `main.js`, `manifest.json`, and `styles.css` to the release

**Important:** Use the version number as the tag (e.g. `1.0.0`), not `v1.0.0`. Obsidian expects the tag to match the manifest version exactly.

### 4. (Optional) Edit the release notes

After the workflow runs, go to the [Releases](https://github.com/jackson-lafrance/obcrypt/releases) page and edit the release to add a proper description and changelog.

## Submitting to the Obsidian Community Plugins List

**Do this after your first release is live on GitHub.**

1. **Fork** [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases)

2. **Add your plugin** to `community-plugins.json` with an entry like:

   ```json
   {
     "id": "obcrypt",
     "name": "Obcrypt",
     "author": "slaade",
     "description": "Transparently encrypts notes tagged with #private on the filesystem while keeping them readable in the editor.",
     "repo": "jackson-lafrance/obcrypt"
   }
   ```

   - `id`, `name`, `author`, and `description` must match your `manifest.json`
   - `repo` is your GitHub repo path (`username/repo-name`)
   - Add `"branch": "main"` if your default branch is not `master`

3. **Open a pull request** to obsidian-releases with your changes

4. **Wait for review** — Obsidian staff will review and merge. Once merged, your plugin will appear in the in-app plugin browser.

## Manual release (without GitHub Actions)

If you prefer to create releases manually:

```bash
npm run build
```

Then create a new release on GitHub, upload:

- `main.js`
- `manifest.json`
- `styles.css`

Use a tag that matches the version in `manifest.json` (e.g. `1.0.0`).
