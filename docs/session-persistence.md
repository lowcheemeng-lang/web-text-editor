# Session persistence and preferences — the design

Task 7, 2026-10-11. This is the design note behind `src/storage/`, `src/editor/preferences-dialog.ts`
and the restore path in `src/editor/workspace.ts`. It records what Notepad++ does (with the source
lines), what this port does instead where the material differs, and the two problems a page has that
N++ does not.

The task's own spec is three sentences — "Save open tabs, caret positions, and scroll positions in
IndexedDB. Persist UI preferences: theme, font size, word wrap, toolbar layout. Implement restore on
startup." Everything below is what those sentences turn into once they have to match N++.

---

## 1. What Notepad++ does

### 1.1 `session.xml` — `NppParameters::writeSession` (`Parameters.cpp:4818`), read by `getSessionFromXmlTree` (`Parameters.cpp:3408`)

```xml
<NotepadPlus>
  <Session activeView="0">
    <mainView activeIndex="0">
      <File firstVisibleLine="…" xOffset="…" scrollWidth="…" startPos="…" endPos="…"
            selMode="…" offset="…" wrapCount="…" lang="…" encoding="…" userReadOnly="…"
            filename="…" backupFilePath="…" originalFileLastModifTimestamp="…"
            tabColourId="…" RTL="…" tabPinned="…" mapFirstVisibleDisplayLine="…" …>
        <Mark line="12"/>
        <Fold line="34"/>
      </File>
    </mainView>
    <subView activeIndex="0"/>
  </Session>
</NotepadPlus>
```

Facts that decided the port's shape:

| N++ | Meaning |
|---|---|
| `activeView`, per-view `activeIndex` | which view was in front, and which tab within it |
| `filename` | the file's path — this port's `FileSystemFileHandle` |
| `startPos` / `endPos` / `selMode` | the caret **and the selection**, not just the line |
| `firstVisibleLine` / `xOffset` | the viewport, recorded separately from the caret |
| `lang` | the language, by name; a file that was saved with a language keeps it |
| `encoding` | which encoding to write it back with (§6's round-trip rule) |
| `userReadOnly` | a document that is open read-only |
| `backupFilePath` | the body of an *unsaved* document, if there is one |
| `originalFileLastModifTimestamp` | when the file on disk was last read — used to notice it changed |
| `<Mark line="…"/>` / `<Fold line="…"/>` | **bookmarks and folded lines are part of the session** (Task 5's bookmarks, Task 6's folds) |
| `wrapCount` | wrap state rides along with the file |

On the way in (`NppIO.cpp:2494-2613`) N++ opens each file in order, sets the language *from the
session* (`buf->setLangType(langTypeToSet, pLn)`), restores the fold state, then the position, then
the encoding, then the read-only flag. Only after the files does it deal with which tab was active.

### 1.2 `backup/` — the algorithm, quoted from `Buffer.cpp:1231-1272`

N++ writes the whole specification into a comment above the code that implements it:

```
For existing file (c:\tmp\foo.h)
  - Open
   1. load backup\FILENAME@CREATION_TIMESTAMP (backup\foo.h@198776) if exist, otherwise load FILENAME.
   2. if backup\… is loaded, set it dirty (red).
   3. if backup\… is loaded, last modif timestamp of FILENAME, compare with tracked timestamp (in session.xml).
   4. in the case of unequal result, tell user the FILENAME was modified. ask user if he want to reload FILENAME
  - Editing
   when a file starts being modified, a file will be created with name: FILENAME@CREATION_TIMESTAMP
   1. sync: (every N seconds) the backup file will be saved if the buffer is dirty and modifications are present.
   2. sync: each save file, or close file, the backup file will be deleted (if buffer is not dirty).
   3. before switch off to another tab (or close files on exit), check 1 & 2 (sync with backup).
  - Close
   1. track FILENAME@CREATION_TIMESTAMP if exist (in session.xml).
   2. track last modified timestamp of FILENAME if … was tracked.

For untitled document (new 4)
  - Open: open file UNTITLED_NAME@CREATION_TIMESTAMP (backup\new 4@198776); set label as UNTITLED_NAME and disk icon as red.
  - Editing: same sync rules; the backup is deleted when the document is saved or closed.
```

The name comes from `Buffer.cpp:1312-1324`: the document's own base name, `@`, and
`wcsftime(…, L"%Y-%m-%d_%H%M%S")` in local time. The timestamp is *not* rewritten on every sync — the
buffer caches the name it created (`setBackupFileName`).

### 1.3 `config.xml` / `ScintillaViewParams` — the preferences

| Key | N++ default | Source |
|---|---|---|
| `RememberLastSession` | `yes` | `Parameters.h:755` |
| `KeepSessionAbsentFileEntries` | `no` | `Parameters.h:756` |
| `isSnapshotMode()` | `_isSnapshotMode && _rememberLastSession && …` | `Parameters.h:867` |
| `<GUIConfig name="Backup" … snapshotBackupTiming>` | `7000` ms | `Parameters.h:869`, `Parameters.cpp:6734` |
| `<GUIConfig name="ToolBar" visible="yes" …>standard</GUIConfig>` | visible, standard icons | `Parameters.cpp:6046` |
| `<ScintillaViewParams … zoom="0" zoom2="0" zoomSync="false">` | no zoom | `Parameters.cpp:7288` |
| GlobalStyles `fontName`/`fontSize` | Courier New, 10 | `stylers.model.xml` |
| theme name | `ThemeSwitcher`, `_themeName` | `Parameters.h:852`, `1253` |

`KeepSessionAbsentFileEntries`'s **code** semantics, not its label (`NppIO.cpp:2553`): with it off, a
session entry whose file is gone is dropped without a word; with it on, N++ *offers* read-only
placeholders and remembers the answer for the run (`FileManager::newPlaceholderDocument`,
`Buffer.cpp:1719-1763`).

### 1.4 The two questions N++ asks at startup

* **Inaccessible files.** "Some files from your past session are inaccessible. They can be opened as
  empty and read-only documents as placeholders.\n\nWould you like to create those placeholders?"
  (`Buffer.cpp:1742`) — asked once per run.
* **A file that changed behind N++'s back.** "`"<file>"` — This file has been modified by another
  program. Do you want to reload it and lose the changes made in Notepad++?" (`Notepad_plus.cpp:2593`).

### 1.5 Two rules that are easy to miss

* **A file that is already open is activated, not opened twice**: "If we found the document, then we
  don't open the existing doc. We return the found buffer ID instead" (`NppIO.cpp:306-330`) — skipped
  in snapshot mode (`!isSnapshotMode`).
* **The app never loses unsaved work by surprise**, because it asks on close.

---

## 2. What this port does

### 2.1 Three stores, one database

| N++ | This port | Why |
|---|---|---|
| `session.xml` | IndexedDB store `session`, one record (`src/storage/session-store.ts`) | D8: metadata in IndexedDB; also: a page has no directory to write a file into |
| `backup/` | OPFS directory `backup/` (`src/storage/backup-store.ts`) | D8: document *bodies* in OPFS, and OPFS is the one place a page can write real files |
| `config.xml` | IndexedDB store `preferences`, key `config` (`src/storage/preferences.ts`) | same as above |
| `%APPDATA%` | the origin's storage | — |

`src/storage/idb.ts` owns the database, its version and its upgrade path; `recent-files.ts` (Task 4)
was moved onto it so a profile written by Task 4 upgrades in place rather than needing a second
database. Everything fails soft: if IndexedDB is unavailable the app edits, opens and saves exactly
as before, and says nothing was remembered.

### 2.2 The record: N++'s fields, this port's material

| N++ attribute | Here | Note |
|---|---|---|
| `filename` | `name` + `handle` | the handle *is* the capability (D8/D3) |
| `encoding` | `format.encoding` + `format.bom` + `format.eol` | a WHATWG label, plus the two things the round-trip rule needs |
| `lang` | `language` (registry id) | ids are stable; N++'s names are copy |
| `startPos`/`endPos`/`selMode` | `selection.anchor`/`.head`/`.mode` | `mode` distinguishes a rectangular selection |
| `firstVisibleLine`/`xOffset` | `position.firstVisibleLine`/`.xOffset` | the caret is restored without scrolling, then the viewport is restored |
| `userReadOnly` | `readOnly` | set for a placeholder; CM6 needs **two** facets for this (`EditorCoreOptions.readOnly`) |
| `<Mark line>`/`<Fold line>` | `marks`/`folds`, as line numbers | converted to offsets against the restored text, so a file that changed underneath does not put a bookmark in the wrong place |
| `backupFilePath` | `backupPath` → `backup/NAME@YYYY-MM-DD_HHMMSS` | same naming rule |
| `originalFileLastModifTimestamp` | the same, from `File.lastModified` | drives the "modified by another program" question |
| `wrapCount`-carrying wrap state | `wordWrap` | |
| `Session activeView` / `activeIndex` | `activeView` / `mainView.activeIndex` | |
| sub view | non-empty ⇒ the split was open | S5: the split shows the *active document* in both panes, so the sub view carries that one file |

### 2.3 When it is written

* **The session**, 500 ms after any change (`SESSION_WRITE_DELAY_MS`), and immediately on a tab
  switch, a close, `visibilitychange` → hidden and `pagehide`. N++ writes `session.xml` once on the
  way out; a page cannot rely on being told it is going away, so it writes early and often.
* **The bodies**, on N++'s own interval (`snapshotBackupTiming`, 7000 ms by default): a dirty
  document's text goes to `backup/`; a document that is back at its save point has its backup
  deleted, in the same pass that clears its modified flag.
* **The session is rewritten after a restore**, from what actually opened — a dropped entry, a
  placeholder, a file that turned out to be missing are all the truth by then. N++ does the same on
  its way out ("your session WILL BE MODIFIED ON EXIT!").

### 2.4 The restore, in order

1. Preferences (`RememberLastSession` gates everything else — `Parameters.cpp:1827`).
2. `navigator.storage.persist()` — risk R6's recorded mitigation. Reported, never assumed:
   `inspect().persistence` carries what the browser answered.
3. Each recorded file, *planned* before anything is created (`#planSessionFile`): read the backup if
   there is one; read the file if the handle is there and permission is **already** granted; ask
   N++'s two questions where they apply. Planning first is what keeps the tab order the order that
   was recorded, and what lets the "inaccessible files" question be asked once.
4. Open them in order; the recorded active tab is shown; the split is reopened if the session had one.
5. Prune: a backup no open document claims is stale by definition, and this is the only quiet moment
   to look.

### 2.5 Permissions are a restore's weak spot, and the port says so

A page may only *ask* for file permission during a user gesture, and a restore is not one. So a
recorded handle whose permission is merely `"prompt"` counts as inaccessible — which is exactly
N++'s missing-file case, answered the same two ways (drop it, or open a read-only placeholder). The
check tests both, including that the placeholder refuses typing.

---

## 3. What a page has that N++ does not

1. **There is no "exit".** N++ flushes the session in `WM_ENDSESSION` and can *ask* before closing,
   which is why it cannot lose unsaved work without consent. A page can be reloaded, crashed or
   evicted by the browser with no such moment. The port's answer is the snapshot interval plus, when
   that protection is switched off, an explicit report naming the documents whose edits are gone
   (scope §8 criterion 6: nothing may be lost *silently*). `inspect().session.unsavedLost` counts them.
2. **A restore can be raced.** `start()` creates the welcome buffer synchronously — an acceptance
   check that reads the app the moment it loads must not find an empty window — and restores
   asynchronously. If the user opens a file while the restore is still in flight, the restore still
   puts the *tabs* back but leaves the *front tab* alone (`#userActedDuringRestore`). N++ never has
   this problem because it restores before its window accepts input.

Both are recorded in `DEVIATIONS_FROM_NPP`, together with the storage-format difference, the missing
Dark Mode, the unbound zoom keys and the icon-set-free toolbar value.

---

## 4. Evidence

| What | Where | Result |
|---|---|---|
| The whole task, end to end, in real Chrome, everything asserted **after a real reload** | `python3 scripts/verify-task7.py` | **82/82**, twice |
| The storage logic without a browser: N++'s backup naming, the preference defaults and ranges, the restore decision table, the line/offset conversions, and the fail-soft contract (Node has neither IndexedDB nor OPFS) | `node --experimental-strip-types scripts/test-session.mjs` | **75/75** |
| Regressions | `verify-task3.py` 58/58 · `verify-task4.py` 44/44 · `verify-task4-pickers.py` (real OS chooser) · `verify-task5.py` 105/105 · `verify-task6.py` 67/67 · `test-file-io.mjs` 45/45 · `test-languages.mjs` 238/238 · `spike-r2-split.py` PASS · `npm run build` | see PROGRESS.md |

### The defects this task found (all fixed, all recorded in the session log)

1. **Folds were erased when the split opened.** `#mirrorFolds`/`#mirrorBookmarks` compared *states*,
   so a freshly mounted clone — which legitimately starts empty — read as "the document has no folds"
   and cleared the other pane's. They compare *changes* now (a per-view signature).
2. **A restored document lost its grammar.** `#loadLanguage` reconfigures the views that exist when
   it resolves, and during a restore none exist yet. The restore awaits the grammar and puts it in
   the state at creation.
3. **The overview ruler showed no structure for a view mounted on an already-parsed state** (a
   restored document, or one re-activated instead of re-opened). It walks the tree at construction.
4. **A document id could repeat**, so a newly opened file shared the active document's id and
   `#show()` returned early: the file opened but never came to the front. Ids come from one
   monotonic counter now.
5. **A redundant warning after the user had already agreed to lose edits** ("reload it and lose the
   changes made in Notepad++" *is* the warning). The answer is now respected.
