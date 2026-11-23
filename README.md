# Figma Export

A local backup tool for anyone who needs **editable Figma files that are easy to import back into Figma**. Figma’s [public REST API](https://developers.figma.com/docs/rest-api/file-endpoints/) returns document data and rendered images, not importable native archives. Figma documents [Save local copy](https://help.figma.com/hc/en-us/articles/8403626871063-Save-a-local-copy-of-files) as a per-file editor action; there is no documented public API or official bulk export for these native copies. This tool automates that editor command without converting the files. Downloads are organized by team and folder. Chrome runs in its own profile and does not need to stay in front.

## Quick start

Requirements: **Node.js 22+**, **Python 3.11+** (`python3` on `PATH`), and desktop **Google Chrome**. Use macOS or a compatible Linux desktop; Windows is not supported. Choose a writable local output filesystem with hard links and POSIX file locking, such as APFS or ext4. Do not use exFAT, FAT, or an unverified network share. The Figma interface is expected to be in English.

```sh
npm ci
npm start -- --team 'My team=123456789'
```

Replace `123456789` with the team ID from a Figma file-browser URL (`/files/team/123456789/...`). You can pass that full team URL instead of the ID. You can repeat `--team` and add `--scope` to include specific project folders, Drafts, or Shared files: open the listing in Figma and copy its address.

```sh
npm start -- \
  --team 'My team=123456789' \
  --scope 'My team/Design=https://www.figma.com/files/team/123456789/folder/456789' \
  --out "$HOME/Downloads/Figma backup"
```

Sign in manually in the dedicated Chrome window the first time. When Figma asks for a CAPTCHA, solve it there; the exporter waits and continues without another command. It can open the **Verify → Begin** screens on recognized Figma verification pages, but does not solve or bypass the check. The **Begin** action does not explicitly focus the popup or move the pointer. Chrome may still show or focus the popup when Figma opens it. Use `--manual-start-captcha` to leave both buttons to you if this interrupts your work. Leave the dedicated window open; you may work in other apps while it runs. Do not run two exports into the same output directory or reuse your normal Chrome profile. Use a separate profile and output directory per Figma account. The profile can be selected with `--profile`.

## Resume and refresh

- **Resume after a failure:** repeat the same command. A folder checkpoint is reusable only for the same folder ID and output label and while its saved archives still pass the local existence and size checks. Use one output label per folder; changing it forces another scan. A checkpoint requires a stable listing at the end of scrolling, one recognized card at each row position, and successful processing of all observed items. This is evidence from the browser, not an authoritative server-side count. Empty listings, multi-card rows and listings without usable counts or indexes are not checkpointed. The tool saves recognized files and reports unverified coverage. Checkpointed folders are not queried again on resume; use `--rescan` to look for later additions.
- **Check for new files after a while:** add `--rescan`. It ignores folder checkpoints, drops each old marker before revisiting its folder, and downloads newly discovered files. An interrupted rescan may have to revisit that folder again. It does **not** re-download existing files by ID, even if they were edited in Figma. For a new snapshot of every file, use a **new** `--out` directory.
- `backup-report.json` accumulates per-file records and checksums; its `issues` list describes the most recent run. `browser-status.json` shows the current stage and worker PID. If a previous run still holds the output lock, stop it with Ctrl+C in its terminal or verify the PID before sending it SIGTERM. Never remove `.backup.lock` while a worker is running. If the report is unreadable, preserve the damaged report and restore a valid `backup-report.json.bak` after stopping the exporter. A restored report may miss the newest archive; keep that copy rather than deleting it. On rerun, a byte-identical archive is reused when found under its intended name. Hidden `.playwright-*` files may contain staged downloads to inspect. Keep runtime state outside Git.
- Exit codes: `0` no issues detected in the requested run, `2` completed with skips or unverified inventory, `1` failure or pause, `130` interruption. Sign-in and verification wait up to 30 minutes with reminders. A shared profile cannot be used by two Chrome instances at once, even if the output folders differ.

## What gets saved

Native archives offered by Figma: `.fig`, `.jam`, `.deck`, `.make`, `.buzz`, and `.site`, when the editor and permissions allow it. A file is saved once by ID, under the first scope where it was exported. Validation checks ZIP structure/CRC and the stored title and records SHA-256; it is not a semantic restore test. This validator expects `canvas.fig` and `meta.json`; other layouts are kept under `_unverified` for inspection. Actual re-import of every format is not covered by automated tests. Import a native archive through Figma's file browser, for example by dragging it in, and test restoration of important files before depending on a backup. An import creates a new file; comments, version history, original file IDs, sharing, and project placement are not restored. External library links may need attention. Prototype-only links and files without export permission are reported as skips. The tool only scans the listings you pass and depends on Figma’s UI; it is not an official Figma tool.

```sh
npm start -- --help
npm test
```

Tests require desktop Chrome to be installed (launched headlessly for browser fixtures). The resume fixture uses a temporary local directory; set `FIGMA_TEST_TMP` to choose its base directory.
