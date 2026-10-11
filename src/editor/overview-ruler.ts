/**
 * Overview ruler — Task 6 step 3, the "language-aware navigation aid".
 *
 * **Not a Notepad++ feature, and this file says so.** N++ has a Document Map (a minimap) and
 * nothing else; the planner's phrase "overview ruler" comes from VS Code, where the strip on
 * the right edge of the editor maps the *whole document* onto the pane's height. So this is an
 * addition, and the only fidelity question it has is which colours to use — those are N++'s
 * own Mark Styles (`stylers.model.xml`), cited below.
 *
 * What it draws, top to bottom over the document:
 *
 *   - **structure** — a tick at each line where the language's own fold service finds a
 *     foldable region (`foldNodeProp`, the same prop the fold gutter uses: functions, blocks,
 *     classes). This is the "language-aware" part, and it is the one that shows the D9
 *     trade-off in public: a first-class Lezer grammar has fold regions and therefore
 *     structure; a legacy `StreamLanguage` port has no fold service at all and therefore
 *     shows none. A 10 000-line JavaScript file gets a visible skeleton; the same file in a
 *     legacy mode gets marks and bookmarks only.
 *   - **search marks** — N++'s Mark Style 1 (bgColor `00FFFF`), the colour Task 5 already
 *     paints the marks themselves in.
 *   - **bookmarks** — N++'s bookmark colour `#5f7bd7` (the centre pixel of `bookmark14`).
 *   - **the viewport** — a translucent band matching the part of the document on screen.
 *     Position-based on purpose: it is mapped through the same document→pixel scale as the
 *     ticks, so the band really does sit over the ticks you can see in the editor.
 *
 * Clicking or dragging the strip scrolls the document to that point. It does **not** move the
 * caret: that is what the scrollbar does, and what N++'s Document Map click behaviour does not
 * do either.
 */
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { foldNodeProp, syntaxTree } from "@codemirror/language";

import { bookmarkPositions } from "../search/bookmarks";
import { markPositions } from "../search/find-replace";

/** Colours, all of them from `stylers.model.xml` — see the file header. */
export const RULER_COLORS = {
  background: "#e4e4e4", // GlobalStyles: Line number margin bgColor
  structure: "#808080", // GlobalStyles: Line number margin fgColor
  mark: "#00ffff", // GlobalStyles: Mark Style 1 bgColor
  bookmark: "#5f7bd7", // rgba_icons.h: bookmark14, centre pixel
  viewport: "rgba(128 128 128 / 22%)", // Line number margin fgColor, as a wash
  viewportEdge: "#808080",
} as const;

export const RULER_WIDTH = 13;

/** How many structure ticks are worth drawing before the strip is a solid block of grey. */
const STRUCTURE_LIMIT = 2000;

/** Structure is recomputed at most this often while typing: the tree walk is not free. */
const STRUCTURE_INTERVAL_MS = 250;

export interface RulerCounts {
  /** Foldable regions the language reported (0 for a legacy stream mode — see the header). */
  structure: number;
  /** Search marks painted by Task 5's Mark tab. */
  marks: number;
  /** Bookmarks, from the margin's own field. */
  bookmarks: number;
}

/**
 * Foldable region starts, from the syntax tree. One tree walk, not one `foldable()` call per
 * line: `foldNodeProp` is what the fold gutter consults, and a walk visits each *node* once.
 */
export function structurePositions(state: EditorState, limit = STRUCTURE_LIMIT): number[] {
  const positions: number[] = [];
  const tree = syntaxTree(state);
  if (tree.length === 0) return positions;

  const cursor = tree.cursor();
  do {
    // `cursor.node` is a SyntaxNode; the prop is the fold service the gutter also consults.
    const range = cursor.type.prop(foldNodeProp)?.(cursor.node, state);
    if (range && range.to > range.from) {
      positions.push(range.from);
      if (positions.length >= limit) break;
    }
  } while (cursor.next());
  return positions;
}

class RulerPlugin {
  readonly dom: HTMLElement;
  readonly counts: RulerCounts = { structure: 0, marks: 0, bookmarks: 0 };

  readonly #canvas: HTMLCanvasElement;
  readonly #viewport: HTMLElement;
  #structure: number[] = [];
  #structureAt = 0;
  #disposeDrag: (() => void) | null = null;

  constructor(readonly view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "npp-ruler";
    this.dom.setAttribute("role", "presentation");
    this.#canvas = document.createElement("canvas");
    this.#canvas.className = "npp-ruler-canvas";
    this.#viewport = document.createElement("div");
    this.#viewport.className = "npp-ruler-viewport";
    this.dom.append(this.#canvas, this.#viewport);
    this.dom.setAttribute("data-ruler", "present");
    view.dom.appendChild(this.dom);

    this.#disposeDrag = installDrag(this);
    this.#recount();
    this.#paint();
  }

  update(update: ViewUpdate): void {
    const treeMoved = syntaxTree(update.startState) !== syntaxTree(update.state);
    if (update.docChanged || treeMoved) {
      const now = performance.now();
      if (now - this.#structureAt >= STRUCTURE_INTERVAL_MS) {
        this.#structureAt = now;
        this.#structure = structurePositions(update.state);
      }
    }
    // Marks, bookmarks and folds all arrive as transactions that change no text.
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.geometryChanged ||
      update.transactions.length > 0 ||
      treeMoved
    ) {
      this.#recount();
      this.#paint();
    }
  }

  /** Recompute the structure now, bypassing the debounce — for the acceptance check. */
  refreshStructureNow(): void {
    this.#structureAt = performance.now();
    this.#structure = structurePositions(this.view.state);
    this.#recount();
    this.#paint();
  }

  destroy(): void {
    this.#disposeDrag?.();
    this.dom.remove();
  }

  #recount(): void {
    const state = this.view.state;
    this.counts.marks = markPositions(state).length;
    this.counts.bookmarks = bookmarkPositions(state).length;
    this.counts.structure = this.#structure.length;
  }

  /** Document position under a pointer y, and back again — the strip's whole coordinate system. */
  #positionAt(y: number): number {
    const height = Math.max(1, this.#canvas.clientHeight || this.dom.clientHeight);
    const ratio = Math.min(1, Math.max(0, y / height));
    return Math.round(ratio * this.view.state.doc.length);
  }

  #offsetOf(position: number): number {
    const height = Math.max(1, this.#canvas.clientHeight || this.dom.clientHeight);
    return (position / Math.max(1, this.view.state.doc.length)) * height;
  }

  #paint(): void {
    const { state } = this.view;
    const height = this.dom.clientHeight;
    const width = RULER_WIDTH;
    if (height === 0) return;

    const scale = Math.min(2, window.devicePixelRatio || 1);
    this.#canvas.width = width * scale;
    this.#canvas.height = height * scale;
    this.#canvas.style.width = `${width}px`;
    this.#canvas.style.height = `${height}px`;

    const context = this.#canvas.getContext("2d");
    if (!context) return;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = RULER_COLORS.background;
    context.fillRect(0, 0, width, height);

    // Structure first: it is the background layer, and the marks must stay readable on top.
    context.fillStyle = RULER_COLORS.structure;
    for (const position of this.#structure) {
      const y = Math.round(this.#offsetOf(position) * scale) / scale;
      context.fillRect(4, y, width - 8, 1);
    }

    context.fillStyle = RULER_COLORS.mark;
    for (const position of markPositions(state)) {
      const y = Math.round(this.#offsetOf(position) * scale) / scale;
      context.fillRect(0, y, width - 1, 2);
    }

    context.fillStyle = RULER_COLORS.bookmark;
    for (const position of bookmarkPositions(state)) {
      const y = Math.round(this.#offsetOf(position) * scale) / scale;
      context.fillRect(2, y - 2, width - 4, 5);
    }

    // The viewport band, mapped through the same scale as everything above.
    const top = this.#offsetOf(this.view.viewport.from);
    const bottom = this.#offsetOf(this.view.viewport.to);
    this.#viewport.style.top = `${top}px`;
    this.#viewport.style.height = `${Math.max(6, bottom - top)}px`;
    this.#viewport.hidden = false;
  }

  /** Scroll so that the document position under `y` sits at the top of the pane. */
  scrollTo(y: number): void {
    const position = this.#positionAt(y);
    this.view.dispatch({ effects: EditorView.scrollIntoView(position, { y: "start" }) });
  }
}

const rulerPlugin = ViewPlugin.fromClass(RulerPlugin);

/** Pointer handling: click jumps, drag scrolls, and the window listeners keep the drag alive. */
function installDrag(plugin: RulerPlugin): () => void {
  const down = (event: PointerEvent) => {
    event.preventDefault();
    plugin.scrollTo(event.clientY - plugin.dom.getBoundingClientRect().top);
    const move = (moveEvent: PointerEvent) => {
      plugin.scrollTo(moveEvent.clientY - plugin.dom.getBoundingClientRect().top);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  plugin.dom.addEventListener("pointerdown", down);
  return () => {
    plugin.dom.removeEventListener("pointerdown", down);
  };
}

export const rulerTheme: Extension = EditorView.theme({
  // Space is reserved for the strip rather than letting it cover the last column of text.
  ".cm-scroller": { paddingRight: `${RULER_WIDTH}px` },
  ".npp-ruler": {
    position: "absolute",
    top: "0",
    right: "0",
    bottom: "0",
    width: `${RULER_WIDTH}px`,
    cursor: "default",
    zIndex: "5",
    touchAction: "none",
  },
  ".npp-ruler-canvas": { display: "block", width: "100%", height: "100%" },
  ".npp-ruler-viewport": {
    position: "absolute",
    left: "0",
    right: "0",
    backgroundColor: RULER_COLORS.viewport,
    borderTop: `1px solid ${RULER_COLORS.viewportEdge}`,
    borderBottom: `1px solid ${RULER_COLORS.viewportEdge}`,
    pointerEvents: "none",
  },
});

export const overviewRuler: Extension = [rulerPlugin, rulerTheme];

/** The ruler's counts for the active view — what `inspect()` and the acceptance check read. */
export function rulerCounts(view: EditorView): RulerCounts | null {
  return view.plugin(rulerPlugin)?.counts ?? null;
}

/** Force a structure recomputation (the acceptance check needs it deterministic, not debounced). */
export function refreshStructure(view: EditorView): number {
  const plugin = view.plugin(rulerPlugin);
  if (!plugin) return 0;
  plugin.refreshStructureNow();
  return plugin.counts.structure;
}
