# Contributing

## Layout

Agent Plus (`xnervwang.agent-plus`) provides the work plan view, the Conversations tab with its Answer view, and
the status bar entry. This extension lists Agent Plus in `extensionDependencies` and registers Claude Code with it as a
conversation source. Agent Plus's `docs/protocol.md` describes the interface.

- `extension.js` handles activation, settings, commands, and the status bar toggle.
- `src/adapters.js` lists patch targets for both the entry point and the uninstall hook.
- `src/webview.js` holds the panel edits, live stylesheet, and in-page script assembly.
- `src/host.js` holds the extension-host edit.
- `src/page/*.js` holds the in-page script, one subject per file. The files are concatenated in file-name order.
- `src/claude-files.js` locates Claude Code's directory, its transcripts and the plan directory, and reads a transcript as it grows. Code that reads Claude Code's files goes through it.
- `src/workplan.js` reads plan files. Its header defines the contract between the two halves.
- `src/plugin-install.js` registers the companion Claude Code plugin and unregisters it on uninstall.
- `src/carryover.js` copies what the earlier id, `xnervwang.claude-code-extras`, kept and this extension still uses: the session pins and colors, two saved values, and the work plans an uninstall moved aside. It also tells whether an earlier version of that id is installed.
- `src/removal.js` notices an uninstall when VS Code restarts its extensions, and restores Claude Code then rather than when VS Code deletes the folder.
- `src/openlatency.js` pairs panel-opening times from the official extension's log.
- `src/background.js` finds the `claude --bg` sessions and `claude -p` workers a conversation started, in its transcript, and reads their state for the agent map and the green dot; it also lists the running workers with the conversation each was tied to, from their session records.
- `src/detached.js` reads /proc for the work a conversation left running after its turn: shells it detached, the `claude -p` worker a detached shell holds, and the conversation each worker was started from.
- `src/detachedends.js` tells a conversation when a command it detached stops, and sends the other notices that wait for a conversation the same way: `src/bgends.js` for its `claude --bg` sessions that ended or wait for an answer, and `src/stoppedwork.js` for the background work that stopped with its other process.
- `src/stewards.js` keeps which conversations each supervisor manages, works out what to tell a supervisor, and posts it to the supervisor's inbox socket. `src/steward-view.js` draws the Supervisor panel, and `src/steward-marks.js` the supervisor titles in tabs and the session list. The plugin's `hooks/steward.py` tells a supervisor at each turn how its conversations stand, `hooks/steward-peek.py` reads one of them for it, and `skills/steward/SKILL.md` says what a supervisor does.
- `src/efforts.js` reads, from a conversation's transcripts, where the effort its replies were sent with changed, for the reply figures.
- `src/sessionpins.js` keeps the conversations pinned in the session list from Claude Code's transcript cleanup, by giving their files a later modification time before they reach its age, and records when each was really last active.
- `src/sessioncolors.js` stores the text color picked for each conversation in the session list.
- `src/bgsessions.js` tells which sessions in the session list are background sessions, so they can be left out.
- `src/claude-source.js` is Claude Code's conversation source for Agent Plus, and `src/core-link.js` registers it.
- `src/waiting.js` lists the running conversations with `claude agents --json`, merged by session.
- `src/conversations.js` adds the stopped conversations whose plans have open rows, and gives each its title and state.
- `src/page/91-answer.js` types an answer from Agent Plus into the conversation's message input.
- `src/bounded.js` reads a plan file only if it is a regular file under a size limit.
- `build/plan-health.js` counts how current the plans on this machine are: stale `doing` rows, `waiting` rows that name nobody.
- `src/python-runtime.js` looks for a Python 3 to run the hooks and, on a Windows machine without one, downloads one from python.org; `src/python-offer.js` asks about that download once per Python version on each machine.
- `claude-plugin/` holds the companion plugin: the skill that maintains a plan and the hooks that keep it honest.
- `test/check.js` is the whole suite. It parses everything and checks every edit against an unpatched bundle. How
  many checks it runs depends on how many Claude Code builds are installed, so the count is not quoted here.
- `test/against-latest.js` checks the same edits against the current marketplace build.
- `test/page-harness.js` runs the injected script in a headless browser against a stand-in panel, for the checks on what the page costs.
- `test/reply-shape.js` reads what a reply element holds out of a real bundle, which the stand-in panel cannot contradict.
- `test/with-core.js` runs this extension with Agent Plus from its checkout beside this one, in Agent Plus's
  fake VS Code (`test/fake-vscode.js`). Without that checkout its checks are skipped.
- `test/vscode/` holds the checks that run in a real VS Code window, started by `.github/workflows/vscode.yml`. `run.js` is the entry point and `ui.js` drives the window through Playwright; `lib/` has the fake model, the fake `~/.claude` and the crop comparison, and `baseline/<platform>/` the approved crops.
- `build/pack.sh` produces the `.vsix` without npm.
- `shared.json` lists the files copied from Agent Plus and where each one comes from: the packing scripts, two checks, shared host and page code in `src/`, and the hooks the two plugins share. Claude Code's part of those hooks is `claude-plugin/agent-work-plan/hooks/plan_agent.py`, and `skills/maintain/SKILL.md` is generated from Agent Plus's template with this extension's text filled in. `guard-work-plan.py` and `refresh-work-plan.py` are not copied. To change a copied file, change it in Agent Plus and run `node build/sync-shared.js`; `test/shared-copies.js` fails when a copy is edited here.
- `shim/` is the last version of the earlier id. It depends on Claude Code Plus, so updating the old extension installs Claude Code Plus. It writes `export.json`, which Claude Code Plus imports, and does nothing else. `bash build/pack-shim.sh` builds its `.vsix`.
- `build/supported.js`, `build/update-versions.js`, and `supported-versions.json` maintain the record of verified Claude Code builds.

## Working on it

Run `node test/check.js` for the full suite. No npm install or dependencies are needed. The checks on what the page costs also need Chrome or Chromium; without one they report themselves as skipped, except in CI, which requires one. Run `bash build/pack.sh` to produce a `.vsix` for installing locally; the package the marketplaces get is described under Publishing.

The in-page script stays in ordinary `.js` files rather than one large template literal. In a literal, every backslash needed doubling. A missed backslash failed only at runtime: `/\s+/` became `/s+/` and replaced the letter *s* in every label it passed through.

Reload the window twice to see a code change: once for the extension to rewrite the file, then once for the panel to load it.

Neither patch needs a manual version bump. Each marker includes a digest of the scripts and edits that patch writes, so a patched file that differs from this tree is recognised as outdated.

Two rules the in-page script keeps, each adopted after the failure it prevents. Never put a node of your own inside one the panel owns - read positions, add siblings, set attributes and inline styles, but nothing goes inside. When the panel's own rendering collided with such a node it threw, and from then on the page stopped handling clicks and keys at all: a dead stop button and a dead Escape, with nothing visible to say why. And never do anything before the panel has painted - the script is appended to the panel's own bundle, so whatever it does there is work the panel must finish before it can show anything. Everything that reads or watches the page waits for the browser to report itself idle.

Keep the early exit in the injected script's React fiber tree loop. It runs for every visible row on every refresh. Searching for more than one thing at a time measured 8–10× slower. `test/check.js` checks that the early exit remains.

## Publishing

- Set `version` in `package.json`, commit the change, and push it to `main`. Tag that commit and push the tag to start `.github/workflows/release.yml`, replacing `<version>` with the value from `package.json`:

  ```sh
  git tag v<version> && git push origin v<version>
  ```

- The workflow runs `node test/check.js`, then checks that the tagged commit is on `main` and that the tag matches `v` followed by the `package.json` version. For a new release, the version must be higher than the highest version listed by either the Visual Studio Marketplace or Open VSX. After these checks, it packages the extension with `@vscode/vsce` 4.1.1 and keeps the `.vsix` as a run artifact. The `--baseImagesUrl` and `--baseContentUrl` settings point the README images and links on both store pages to the tagged commit on GitHub. It then publishes the same `.vsix` to the Visual Studio Marketplace with `vsce publish --oidc` and to Open VSX with `ovsx publish --trusted-publishing`.
- Each registry exchanges the job's GitHub OIDC token for a short-lived credential. No publishing token is stored.
- Each registry has a trusted publisher entry for `xnervwang/vscode-claude-code-plus` and `release.yml`. If you rename the workflow file, update both entries: the `xnervwang` publisher's Trusted Publishing page on the Marketplace and Settings > Trusted Publishers on `open-vsx.org`.
- If the run publishes to one registry but fails on the other, re-run it in GitHub Actions. A rerun accepts a version already listed by one registry and skips the upload there.
- Neither registry accepts a version that was already published, even after it was removed.
- Use `build/pack.sh` for a local trial install, not for a marketplace package. It copies all of `images/`, including about 1.2 MB of README screenshots, and leaves relative README links as they are.
- To build the workflow's `.vsix` locally, run this from a clean checkout of the tagged commit. On Node 22.11, set `NODE_OPTIONS=--experimental-require-module` in the environment first.

  ```sh
  SHA=$(git rev-parse HEAD)
  npx --yes @vscode/vsce@4.1.1 package --out xnervwang.claude-code-plus-<version>.vsix \
    --baseImagesUrl "https://github.com/xnervwang/vscode-claude-code-plus/raw/$SHA/" \
    --baseContentUrl "https://github.com/xnervwang/vscode-claude-code-plus/blob/$SHA/"
  ```

## Watching for upstream changes

Claude Code ships roughly once per working weekday. If a release reshapes patched code, the panel can lose every addition at once. On a user's machine, that may become apparent only after the update is installed.

Run `node test/against-latest.js` to fetch the current marketplace build and check every edit against it. `.github/workflows/upstream-check.yml` runs that check four times a day. It files one issue per build when an edit stops matching or a reply holds a child not seen before, and puts the report in the run summary either way.

These checks cannot catch changes to class names or test ids used by the in-page script. Every edit can still match exactly once while those lookups break. That failure appears at runtime through a marker the script raises in the panel.

## In a real VS Code window

`.github/workflows/vscode.yml` runs `test/vscode/run.js` on Linux, macOS, and Windows. It runs on pushes to `main` or a `ci/` branch, on pull requests, daily at 09:43 UTC, and by hand.

Except for the daily run and manual runs with the `upstream` input set to `newest`, the workflow installs the newest Claude Code build recorded in `supported-versions.json`. `node build/update-versions.js -w` writes that file; see its section below. On the runs that install that build, the workflow builds the Agent Plus `.vsix` from the commit in `test/vscode/agent-plus-commit`. The file contains only the full commit hash. To update Agent Plus, change that file in a commit of its own.

The daily run installs the newest Claude Code from the marketplace and builds the Agent Plus `.vsix` from the head of its default branch. Its job names end in ", newest upstream". A daily run that fails while runs on `main` pass means a newer Claude Code or Agent Plus needs a change here. If the scheduled run fails, GitHub sends a notification, but pushes can still proceed.

In each job, the runner:

- downloads the newest stable VS Code;
- installs the selected Claude Code build, Agent Plus from a supplied `.vsix` or the marketplace, and this extension's `.vsix` into a separate profile;
- runs the tests assigned to that job (described below) against the installed copies.

Any failed stage makes the runner exit non-zero.

On each platform, five jobs run at the same time. The runner divides the `ui.js` window steps among four jobs, keeping each job's steps consecutive and the estimated times about equal. The fifth job runs `suite/` inside VS Code and `test/check.js`. Every job also writes the patched files, reloads, opens the first of the test's fake conversations (described below) in a tab, and checks at the end that no page showed the extension's self-check warning.

The runner splits the steps using `test/vscode/step-seconds.json`, which records the longest time each step took on any of the three platforms. Each step logs `took <N> s` when it ends. A missing step counts as 20 seconds. `test/check.js` fails if the file omits a step or names one that no longer exists.

Manual runs take three inputs:

- `os` lists the runners separated by commas and defaults to `ubuntu-latest,macos-latest,windows-latest`.
- `steps` is a regular expression matched against the window step names, as listed in `test/vscode/step-seconds.json`. When it is set, each listed platform runs a single job: the matching window steps plus the four steps every job runs. It skips `suite/` and `test/check.js`.
- `upstream` defaults to `pinned`. Set it to `newest` to use the same versions as the daily run.

To run one step on macOS from a branch:

```sh
gh workflow run vscode.yml --ref <branch> -f os=macos-latest -f steps='^the steward panel$'
```

The window checks these steps in order:

- Both patched files are written on the first start, and VS Code asks for a reload. The tab bar then has exactly one Claude button: Claude Code's own.
- The session list has New in tab and New in sidebar, a pin and dates on each row, Resume in tab, Resume in sidebar and Text color in the right-click menu, and hover text for a row.
- A conversation resumed in a tab has times on every message and reply, a bar on your own messages, the rail and its list, footer buttons and their hover text, and the information box. At the top of the session list, OPEN SESSIONS lists the conversation while its tab is open, and RECENTLY CLOSED lists it once the tab is closed. The times disappear and return when this extension is turned off and on.
- The tab's logo has a green dot while a turn runs; when the reply lands with the tab in the background, the dot disappears, the tab title ends in an envelope, and its row in Open sessions shows the envelope and no dot. The dot is red while Claude Code waits for permission to run a command, and an idle conversation's tab has no dot and no envelope.
- Delete session… asks for confirmation on an archived conversation. The window also checks Show Status, Settings, and the confirmation for Stop Loading the Work Plan Plugin.
- Not covered by the window stage: the footer's filter for the main thread or one sub-agent, which only appears in a conversation that ran sub-agents; the sound of the chimes.

Claude Code is not signed in during the run. `claudeCode.disableLoginPrompt` turns off its login prompt. `claudeCode.environmentVariables` gives its CLI a fake API key and sends every turn to the model on `127.0.0.1` in `test/vscode/lib/fake-model.js`. The temporary `~/.claude.json` marks that key as accepted. The CLI started from the panel uses an API key only after it has been accepted once; otherwise every turn answers "Not logged in". `test/vscode/lib/fake-home.js` writes the fake transcripts under the temporary `~/.claude/projects/`.

Every home folder (`HOME`; `USERPROFILE` and the AppData folders on Windows; the XDG folders on Linux), along with VS Code's user data and extensions folders, sits under a new folder in `RUNNER_TEMP` or the system's temporary folder. The window's environment leaves out `VSCODE_*`, `ELECTRON_*`, `LD_LIBRARY_PATH`, `CLAUDE*`, `ANTHROPIC_*`, `AWS_*`, and `OTEL_*`. When the runner starts inside a Claude Code session or VS Code terminal, those variables could otherwise send installs to another VS Code or turns to that session's provider.

On Linux, the test stage runs in a network namespace with loopback only. It uses `unshare -rn`, then `test/vscode/as-user.py` to run as the caller rather than root. The workflow sets `CLAUDE_CODE_PLUS_UI_OFFLINE=require`, so it fails if it cannot make the namespace. On macOS and Windows, `HTTP_PROXY`, `HTTPS_PROXY`, and VS Code's `http.proxy` point at `127.0.0.1:9`, where no proxy is running.

### Results and approved crops

The `--out` folder holds a screenshot of every step in `shots/`, crops in `actual/<platform>/`, a diff image for each failed crop in `diff/<platform>/`, and VS Code logs in `logs/`. When a step fails, `pages/<step>/` holds two files for each page of the window: a `.txt` file with its address and text, and an `.html` file with its markup. Only elements this extension draws are cropped, never Claude Code's or VS Code's own. If one of ours sits between two Claude Code elements, it gets its own crop.

Each job uploads its `--out` folder as `vscode-<OS>-<part>` whether it passes or fails. `<part>` is `1-of-4` to `4-of-4` for the four window-step jobs, `suite` for the fifth, or `steps` for a manual run with `steps` set. Each job's artifact has crops only for the steps that job ran. `test/vscode/update-baseline.js`, below, takes one artifact at a time.

Each crop is compared pixel by pixel with the approved copy for its platform. A pixel differs when any channel differs by more than 32 of 255. A crop fails when more than 0.2% of its pixels differ, or its width or height differs by more than one pixel. Times in crops are masked.

Only Linux has approved crops so far. They were made on a development machine under Xvfb with a 1600x1000 screen at 24 bits. macOS and Windows save their crops without comparing them until someone approves a set from a CI run. The first Linux CI run may fail because the runner's fonts differ. If `diff/linux/` shows only glyph differences, approve the runner's crops from the artifact.

The person merging into `main` approves new copies. Before copying them, inspect every crop to be copied and `diff/<platform>/` from the same run. Then run:

```sh
node test/vscode/update-baseline.js <results folder or unpacked artifact> [<platform>] [--only <name>[,<name>]]
```

The command copies `actual/<platform>/*.png` over `test/vscode/baseline/<platform>/`. Commit the updated baselines on their own, saying what changed on screen and why.

### Running it locally

For a local run, install the test dependencies outside the repository and point `NODE_PATH` at that folder's `node_modules`:

```sh
npm install --no-save --no-package-lock --prefix <folder of your own> @vscode/test-electron@3 playwright-core@1
```

On Linux, start a display and run:

```sh
Xvfb :94 -screen 0 1600x1000x24 -nolisten tcp &
DISPLAY=:94 NODE_PATH=<folder>/node_modules node test/vscode/run.js <the .vsix> [<Agent Plus .vsix>] [--out <dir>] [--vscode <executable>] --local
```

The runner refuses to start outside CI unless given `--local`. `--vscode` uses an executable already on disk instead of downloading VS Code. `CLAUDE_CODE_PLUS_UI_KEEP=1` keeps the temporary root so you can open the same profile by hand. On a development machine, a run takes about 2.5 minutes, including the marketplace install of Claude Code.

To run only part of the tests, set one of these:

- `CLAUDE_CODE_PLUS_UI_STEPS` to step names separated by commas;
- `CLAUDE_CODE_PLUS_UI_STEPS_RE` to a regular expression;
- `CLAUDE_CODE_PLUS_UI_SHARD` to `i/n` for the i-th of n parts, or to `suite` for the part the fifth CI job runs.

With any of these set, `run.js` skips `suite/` and `test/check.js` unless `CLAUDE_CODE_PLUS_UI_SHARD=suite`.

On a screen with two pixels per point, such as a Mac's own display, set `CLAUDE_CODE_PLUS_UI_SCALE=1` so that the crops are drawn at one pixel per point, as the approved copies were. A window larger than a CI runner's still lays out some parts wider, so a few crops can differ in width.

### README screenshots

To retake the screenshots in `images/shots/`, run `test/vscode/readme-shots.js` with the same dependencies. `--pack` is a folder holding a demo project and demo conversations.

```sh
NODE_PATH=<folder>/node_modules xvfb-run -a -s '-screen 0 3200x2000x24' node test/vscode/readme-shots.js --pack <demo pack> --vsix <the .vsix> [<shot> ...]
```

### Pictures for an agent to review

`test/vscode/ui-look.js` opens the same demo window as `readme-shots.js`, with the same dependencies and demo pack. Run it on your own machine. It never runs in CI and does not call a model.

```sh
NODE_PATH=<folder>/node_modules xvfb-run -a -s '-screen 0 3200x2000x24' node test/vscode/ui-look.js --pack <demo pack> --vsix <the .vsix> --out <dir> [<step> ...]
```

A full run takes the window through 84 steps, at least one for each feature in `test/vscode/ui-look-features.json` that can be shown in a window. The file lists 51 features and gives the reason for each of the ten that cannot be shown. To list the steps for each feature without opening a window, run `node test/vscode/ui-look.js --features`. It takes about nine minutes once VS Code and Claude Code are in the cache.

To run it at the same time as `readme-shots.js`, give each script its own `--cache` folder.

For each step, the script saves a close-up of the part of the window under review and a picture of the whole window in the `--out` folder. `look.json` says what each close-up should show and lists the log lines and notifications since the previous step. Notifications stay on screen because an unexpected notification is a finding. The script copies `test/vscode/LOOK.md` beside `look.json`.

Give the folder to a coding agent that can read images and ask it to follow `LOOK.md`. At each step, the agent checks the expected result and looks for anything unexpected, such as overlap, cut-off text or an error notification.

That comes to about 250 pictures, more than one agent session can read. `LOOK.md` has a fresh session review each range of at most 12 steps and merges the parts into `REVIEW.md` in the output folder.

`test/check.js` checks that each step has a unique name and the text its pictures need, and that each feature has a step or a reason it cannot be shown. Every setting, command and view in `package.json` must belong to exactly one feature. When you add a setting or command, include a step or a reason in the same change.

## The record of verified builds

`supported-versions.json` records the Claude Code builds **this commit** was verified to patch. Someone using an older build can use the record to find a commit that works with it.

Record only builds verified against the current code. Leave out a build that is not installed on the machine writing the commit, even if an earlier commit verified it. To find that earlier commit, ask git:

```sh
git log -S2.1.283 -- supported-versions.json
```

Nothing is written unless the full suite passes. `node build/update-versions.js` shows what would change. `node build/update-versions.js -w` runs the suite and then writes the record.

The suite fails if the record differs in either direction from the builds the machine just verified. Listing more makes a false claim. Listing fewer can leave an upgrade unrecorded forever, because a conservative record would not otherwise fail a check.

This check needs the installed bundles, so it cannot run in CI. A runner has no Claude Code installed, and the section reports itself as skipped. Enforcement is local. To enable the pre-commit hook, run:

```sh
git config core.hooksPath build/git-hooks
```

Git does not install repository hooks automatically. The hook runs the same suite; it reports a mismatch and stops rather than writing the record for you.
