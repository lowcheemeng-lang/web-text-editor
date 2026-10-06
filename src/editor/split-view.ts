/**
 * Two views over one document — split view and "clone to other view" (risk R2).
 *
 * CodeMirror 6 does *not* keep two views on one `EditorState` in sync: "States are
 * immutable values, and their updated forms held in the different views will simply
 * diverge" (https://codemirror.net/examples/split/). The official example therefore
 * uses two states and forwards document changes between them. This module is that
 * mechanism, adapted to N++ semantics:
 *
 *   - the document's state (owned by the workspace) carries `history()`; a cloned
 *     view's state does not, and its Mod-Z/Mod-Y run `undo`/`redo` on the owner, so
 *     the document has exactly one undo history — like N++'s clone-to-other-view;
 *   - every document-changing transaction is re-dispatched to the peer views with
 *     `syncAnnotation` attached, which is what stops views bouncing transactions
 *     back and forth;
 *   - selection and scroll are deliberately *not* forwarded: N++ gives each view
 *     its own caret. Measured behaviour is recorded in docs/r2-shared-state-spike.md.
 *
 * Two deliberate design choices beyond the example:
 *   1. the dispatcher resolves its peers *at dispatch time* (`runtime.views`) instead
 *      of closing over fixed view objects, because views come and go as the user
 *      switches tabs, closes documents and turns the split off;
 *   2. `EditorView.update()` (not `dispatch`) applies the incoming transaction, so
 *      the app sees exactly one `onUpdate` per transaction and no feedback loop.
 *
 * Evidence: `scripts/spike-r2-split.py` (real Chrome keystrokes, run before any
 * tab-strip code was written) and `scripts/verify-task3.py` (whole-app acceptance).
 */
import { Annotation, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** Marks a transaction a peer view already received, so it is never forwarded again. */
export const syncAnnotation = Annotation.define<boolean>();

/** Live views of one document. `views[0]` owns the undo history. */
export interface DocumentRuntime {
  /** Views currently showing this document, in creation order. */
  views: EditorView[];
  /** Called once per transaction applied by a view, after the view updated itself. */
  onUpdate?: (view: EditorView, transaction: Transaction) => void;
}

export function createDocumentRuntime(): DocumentRuntime {
  return { views: [] };
}

/** True for transactions that arrived from a peer view rather than from the user. */
export function isSyncTransaction(transaction: Transaction): boolean {
  return transaction.annotation(syncAnnotation) === true;
}

export type SyncDispatcher = (transaction: Transaction, view: EditorView) => void;

/**
 * The overridden `dispatch` every view of a document is constructed with
 * (`new EditorView({ dispatch: makeSyncDispatcher(runtime) })`).
 */
export function makeSyncDispatcher(runtime: DocumentRuntime): SyncDispatcher {
  return (transaction, view) => {
    view.update([transaction]);
    runtime.onUpdate?.(view, transaction);

    if (transaction.changes.empty || transaction.annotation(syncAnnotation)) return;

    const annotations: Annotation<unknown>[] = [syncAnnotation.of(true)];
    const userEvent = transaction.annotation(Transaction.userEvent);
    if (userEvent) annotations.push(Transaction.userEvent.of(userEvent));

    for (const peer of runtime.views) {
      if (peer !== view) peer.dispatch({ changes: transaction.changes, annotations });
    }
  };
}

/** Register a view of a document; the first one registered owns the history. */
export function registerView(runtime: DocumentRuntime, view: EditorView): void {
  if (!runtime.views.includes(view)) runtime.views.push(view);
}

/** Forget a view; returns true when the view that owned the history was removed. */
export function unregisterView(runtime: DocumentRuntime, view: EditorView): boolean {
  const index = runtime.views.indexOf(view);
  if (index === -1) return false;
  runtime.views.splice(index, 1);
  return index === 0;
}

/** The history-owning view of a document, if any is alive. */
export function ownerView(runtime: DocumentRuntime): EditorView | undefined {
  return runtime.views[0];
}
