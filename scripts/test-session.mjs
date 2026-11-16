/**
 * Direct tests for the persistence layer — no browser, no framework.
 *
 * Run:  node --experimental-strip-types scripts/test-session.mjs
 *
 * Why this exists: Task 7's three storage modules hold the only copy of unsaved work (there is no
 * disk behind them) and they are the boundary where hand-edited or older records arrive. The parts
 * that can be tested without a browser are exactly the parts that decide *what those records mean*:
 * N++'s backup file naming, the preference defaults and ranges, the restore decision table, and the
 * line/offset conversions a restored caret and fold depend on. `scripts/verify-task7.py` covers what
 * needs a real page (IndexedDB, OPFS, reloads); this file covers the logic a reload would only
 * exercise by accident.
 */
import {
  BACKUP_DIRECTORY,
  backupFilePath,
  backupLeaf,
  isBackupPath,
  listBackups,
  readBackup,
  timestampForBackup,
  writeBackup,
} from "../src/storage/backup-store.ts";
import { requestPersistentStorage } from "../src/storage/persistent-storage.ts";
import {
  BASE_FONT_SIZE_PT,
  NPP_PREFERENCES,
  ZOOM_LIMITS,
  clampZoom,
  fontSizeForZoom,
  loadPreferences,
  normalisePreferences,
  savePreferences,
  zoomInRange,
} from "../src/storage/preferences.ts";
import {
  emptySession,
  lineNumbersToOffsets,
  lineStartOffset,
  loadSessionRecord,
  nextUntitledNumber,
  normaliseSession,
  saveSessionRecord,
  offsetToLine,
  offsetsToLineNumbers,
  restoreOutcome,
} from "../src/storage/session-store.ts";

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}${detail ? `  [${detail}]` : ""}`);
  }
}

/**
 * A `Text`-shaped adapter over a plain string, which is what `session-store.ts`'s position helpers
 * ask for (`LineSource`). The browser passes CodeMirror's own `Text`, so this adapter is only here
 * to exercise the *same* implementation the app runs rather than a copy of it.
 */
function lineSource(text) {
  const lines = text.split("\n");
  const fromOf = (number) => {
    let from = 0;
    for (let index = 0; index < number - 1; index += 1) from += lines[index].length + 1;
    return from;
  };
  return {
    lines: lines.length,
    line(number) {
      const wanted = Math.min(Math.max(1, number), lines.length);
      return { from: fromOf(wanted) };
    },
    lineAt(position) {
      const clamped = Math.min(Math.max(0, position), text.length);
      for (let index = 1; index <= lines.length; index += 1) {
        const from = fromOf(index);
        const to = from + lines[index - 1].length;
        if (clamped >= from && clamped <= to) return { number: index };
      }
      return { number: lines.length };
    },
  };
}

/* ───────────────────────────────────────── N++'s backup file naming (Buffer.cpp:1312-1324) ── */

const when = new Date(2026, 9, 11, 22, 34, 1); // local time, as N++'s localtime()+wcsftime is
check("timestamp format is N++'s %Y-%m-%d_%H%M%S", timestampForBackup(when) === "2026-10-11_223401",
  timestampForBackup(when));
check("backup path is N++'s backup\\FILENAME@TIMESTAMP",
  backupFilePath("foo.h", when) === "backup/foo.h@2026-10-11_223401", backupFilePath("foo.h", when));
check("an untitled buffer is named after its label",
  backupFilePath("new 4", when) === "backup/new 4@2026-10-11_223401", backupFilePath("new 4", when));
check("a path separator in a name cannot escape the backup directory",
  backupFilePath("a/b\\c", when) === "backup/a_b_c@2026-10-11_223401", backupFilePath("a/b\\c", when));
check("the directory name is N++'s `backup`", BACKUP_DIRECTORY === "backup");

check("backupLeaf reads the file name back", backupLeaf("backup/foo.h@2026-10-11_223401") === "foo.h@2026-10-11_223401");
check("a path outside the backup directory is refused", backupLeaf("recent/foo.h") === null);
check("a nested path is refused", backupLeaf("backup/a/b") === null);
check("the directory itself is not a file", backupLeaf("backup/") === null);
check("isBackupPath agrees", isBackupPath("backup/x@2026-10-11_223401") && !isBackupPath("backup/") && !isBackupPath(7));

/* ───────────────────────────────────────────────── N++'s preference values and ranges ── */

check("RememberLastSession defaults to N++'s true (Parameters.h:755)", NPP_PREFERENCES.rememberLastSession === true);
check("KeepSessionAbsentFileEntries defaults to N++'s false (Parameters.h:756)",
  NPP_PREFERENCES.keepSessionAbsentFileEntries === false);
check("snapshot mode defaults to N++'s yes (Parameters.cpp:6734)", NPP_PREFERENCES.snapshotMode === true);
check("snapshot timing defaults to N++'s 7000 ms (Parameters.h:869)", NPP_PREFERENCES.snapshotBackupTiming === 7000);
check("the toolbar is visible and standard by default (Parameters.cpp:6046)",
  NPP_PREFERENCES.toolbarVisible === true && NPP_PREFERENCES.toolbarLayout === "standard");
check("zoom defaults to N++'s 0 (Parameters.cpp:7288)", NPP_PREFERENCES.zoom === 0);
check("the base font size is stylers.model.xml's 10", BASE_FONT_SIZE_PT === 10);

check("an empty record yields N++'s defaults",
  JSON.stringify(normalisePreferences({})) === JSON.stringify(NPP_PREFERENCES));
check("junk yields N++'s defaults",
  JSON.stringify(normalisePreferences(null)) === JSON.stringify(NPP_PREFERENCES) &&
  JSON.stringify(normalisePreferences("nonsense")) === JSON.stringify(NPP_PREFERENCES));

const mixed = normalisePreferences({
  rememberLastSession: "yes",       // wrong type → default
  snapshotMode: false,              // honoured
  snapshotBackupTiming: 250,        // below the sane floor → default
  toolbarLayout: "fluent",          // a real N++ value this build does not have → default
  theme: "obsidian",                // a real N++ theme this build does not ship → default
  zoom: 999,                        // above Scintilla's range → clamped
  futureKey: true,                  // unknown keys are dropped
});
check("a wrong type falls back to N++'s default", mixed.rememberLastSession === true);
check("a valid value is honoured", mixed.snapshotMode === false);
check("an insanely short interval falls back to 7000", mixed.snapshotBackupTiming === 7000);
check("an unknown toolbar layout falls back", mixed.toolbarLayout === "standard");
check("an unknown theme falls back", mixed.theme === "notepadpp");
check("the zoom is clamped to Scintilla's maximum", mixed.zoom === ZOOM_LIMITS.max);
check("unknown keys do not survive", !("futureKey" in mixed));
check("the interval's upper bound is respected",
  normalisePreferences({ snapshotBackupTiming: 10 ** 9 }).snapshotBackupTiming === 7000);
check("a NaN zoom falls back to 0", normalisePreferences({ zoom: Number.NaN }).zoom === 0);

check("zoom 0 is the style's own size", fontSizeForZoom(0) === "10pt", fontSizeForZoom(0));
check("a zoom level is a point count", fontSizeForZoom(2) === "12pt", fontSizeForZoom(2));
check("a negative zoom shrinks the text", fontSizeForZoom(-4) === "6pt", fontSizeForZoom(-4));
check("the size never reaches zero", fontSizeForZoom(-10) === "1pt", fontSizeForZoom(-10));
check("clampZoom holds Scintilla's incremental limits (SCI_ZOOMIN/SCI_ZOOMOUT)",
  clampZoom(61) === 60 && clampZoom(-11) === -10 && clampZoom(0) === 0);
check("clampZoom survives nonsense", clampZoom(Number.NaN) === 0);
check("zoomInRange reports the documented range", zoomInRange(60) && zoomInRange(-10) && !zoomInRange(61));

/* ────────────────────────────────────────────────── N++'s session shape and clamps ── */

check("an empty session has both views and an active view",
  emptySession(1).activeView === 0 && emptySession(1).mainView.files.length === 0 &&
  emptySession(1).subView.files.length === 0 && emptySession(1).writtenAt === 1);

check("nothing stored is not an empty session", normaliseSession(null) === null);
check("a record with no files is not worth restoring", normaliseSession({ mainView: { files: [] } }) === null);
check("a record whose files are all junk is not worth restoring",
  normaliseSession({ mainView: { files: [{ nope: 1 }, 7] } }) === null);

const record = normaliseSession({
  activeView: 1,
  writtenAt: 1791730440229,
  mainView: {
    activeIndex: 9, // past the end → clamped to the last file
    files: [
      { name: "note.txt", language: "javascript", marks: [3, 3, "x"], folds: [7], selection: { anchor: -5, head: 12.7 } },
      { name: "new 2", wordWrap: true, dirty: true, untitled: true },
    ],
  },
  subView: { files: [] },
});
check("a usable record is accepted", record !== null);
check("the active index is clamped into the file list", record.mainView.activeIndex === 1, String(record?.mainView.activeIndex));
check("numbers are clamped to sane values",
  record.mainView.files[0].selection.anchor === 0 && record.mainView.files[0].selection.head === 13,
  JSON.stringify(record.mainView.files[0].selection));
check("marks keep numbers only (duplicates are the offsets helper's business)",
  JSON.stringify(record.mainView.files[0].marks) === "[3,3]", JSON.stringify(record.mainView.files[0].marks));
check("a missing format reads as UTF-8 with no BOM and LF",
  record.mainView.files[1].format.encoding === "utf-8" && record.mainView.files[1].format.bom === "none" &&
  record.mainView.files[1].format.eol === "LF", JSON.stringify(record.mainView.files[1].format));
check("dirty and untitled are read back", record.mainView.files[1].dirty === true && record.mainView.files[1].untitled === true);
check("the language id survives", record.mainView.files[0].language === "javascript");
check("a viewport always has a line", record.mainView.files[0].position.firstVisibleLine === 1);

/* ──────────────────────────────────────────────── N++'s restore decision table ── */

check("a backup wins over the file (Buffer.cpp:1239)",
  restoreOutcome({ untitled: false, accessible: true, hasBackup: true, keepAbsentFileEntries: false }) === "restore");
check("a backup restores a document whose file is gone (Buffer.cpp:1245)",
  restoreOutcome({ untitled: false, accessible: false, hasBackup: true, keepAbsentFileEntries: false }) === "restore");
check("a readable file with no backup is opened normally",
  restoreOutcome({ untitled: false, accessible: true, hasBackup: false, keepAbsentFileEntries: false }) === "restore");
check("with keep=off a missing file is dropped (NppIO.cpp:2553)",
  restoreOutcome({ untitled: false, accessible: false, hasBackup: false, keepAbsentFileEntries: false }) === "drop");
check("with keep=on a missing file becomes a placeholder",
  restoreOutcome({ untitled: false, accessible: false, hasBackup: false, keepAbsentFileEntries: true }) === "placeholder");
check("an untitled buffer is never a placeholder — there is no file to be inaccessible",
  restoreOutcome({ untitled: true, accessible: false, hasBackup: false, keepAbsentFileEntries: true }) === "drop");
check("an untitled buffer with a backup is restored",
  restoreOutcome({ untitled: true, accessible: false, hasBackup: true, keepAbsentFileEntries: false }) === "restore");

/* ────────────────────────────────────────── line ↔ offset conversion for a restore ── */

const source = lineSource("alpha\nbeta\ngamma");
check("line 1 starts at 0", lineStartOffset(source, 1) === 0);
check("a later line starts after the newlines", lineStartOffset(source, 2) === 6, String(lineStartOffset(source, 2)));
check("a line past the end clamps to the last line", lineStartOffset(source, 99) === 11, String(lineStartOffset(source, 99)));
check("line 0 clamps to line 1", lineStartOffset(source, 0) === 0);
check("an offset reads back as its line", offsetToLine(source, 6) === 2, String(offsetToLine(source, 6)));
check("an offset past the end clamps to the last line", offsetToLine(source, 500) === 3, String(offsetToLine(source, 500)));
check("a negative offset clamps to line 1", offsetToLine(source, -5) === 1);

check("mark lines become sorted, unique offsets",
  JSON.stringify(lineNumbersToOffsets(source, [3, 1, 1, 2])) === "[0,6,11]",
  JSON.stringify(lineNumbersToOffsets(source, [3, 1, 1, 2])));
check("offsets become sorted, unique line numbers",
  JSON.stringify(offsetsToLineNumbers(source, [11, 0, 0, 6])) === "[1,2,3]",
  JSON.stringify(offsetsToLineNumbers(source, [11, 0, 0, 6])));
check("junk in a mark list is ignored",
  JSON.stringify(lineNumbersToOffsets(source, [Number.NaN, 2])) === "[6]",
  JSON.stringify(lineNumbersToOffsets(source, [Number.NaN, 2])));

check("the next untitled number follows N++'s `new N` labels",
  nextUntitledNumber(["new 1", "new 7", "notes.txt"]) === 8, String(nextUntitledNumber(["new 1", "new 7", "notes.txt"])));
check("with no labels the first document is new 1", nextUntitledNumber([]) === 1);
check("a renamed buffer does not confuse the count", nextUntitledNumber(["my notes", "new 2"]) === 3);

/* ────────────────────────────────────────────────────────── the fail-soft contract ── */

/* Node has no `indexedDB` and no `navigator.storage`, which is exactly the condition these modules
   promise to survive: storage being unavailable may never break editing, and it may never be
   reported as success either. The imports at the top of this file already prove nothing touches a
   browser global at module scope — these checks prove what happens when one answers "no". */
const prefsWithoutStorage = await loadPreferences();
check("with no IndexedDB, the preferences are N++'s defaults",
  JSON.stringify(prefsWithoutStorage) === JSON.stringify(NPP_PREFERENCES), JSON.stringify(prefsWithoutStorage));
check("with no IndexedDB, nothing is reported as stored", (await loadSessionRecord()) === null);
check("with no IndexedDB, writing reports failure instead of throwing",
  (await saveSessionRecord(emptySession(1))) === false);
check("with no IndexedDB, storing a preference still returns what is in force",
  JSON.stringify(await savePreferences({})) === JSON.stringify(NPP_PREFERENCES));
check("with no OPFS, there are no backups rather than an error", (await listBackups()).length === 0);
check("with no OPFS, a body reports that it was not written", (await writeBackup("note.txt", "x")) === null);
check("with no OPFS, reading a backup reports absence", (await readBackup("backup/note.txt@2026-10-11_223401")) === null);
check("with no StorageManager, the persistence report is honest",
  (await requestPersistentStorage()).supported === false);

console.log(`\n${"=".repeat(60)}`);
console.log(failures.length === 0
  ? `TEST-SESSION: PASS  (${passed}/${passed} checks)`
  : `TEST-SESSION: FAIL  (${passed}/${passed + failures.length} checks)`);
if (failures.length > 0) console.log(`failed: ${failures.join("; ")}`);
console.log("=".repeat(60));
process.exit(failures.length === 0 ? 0 : 1);
