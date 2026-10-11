/**
 * The language registry — Task 6, decision **D9** (all 22 official `@codemirror/lang-*`
 * packages plus the `@codemirror/legacy-modes` long tail, each lazily imported so an
 * unopened language costs 0 bytes).
 *
 * Two kinds of language live here, and the difference is not cosmetic:
 *
 *   - **first-class** — a real Lezer grammar (`LRLanguage`). It gives a syntax *tree*:
 *     folding, indent-on-input, bracket matching and a future Function List all work.
 *   - **legacy** — a CodeMirror 5 stream parser wrapped in `StreamLanguage`. Highlighting
 *     only: **no fold service**, no tree. D9 accepted that trade for the long tail.
 *
 * Names and extensions are Notepad++'s own where Notepad++ has the language, so the
 * status bar says what N++ would say:
 *
 *   PowerEditor/src/ScintillaComponent/ScintillaEditView.cpp:99  `_langNameInfoArray`
 *       — every language's short and long name, in the order of the LangType enum.
 *   PowerEditor/src/Notepad_plus.cpp:2931   `getLangDesc(langType, getName = false)`
 *       — the status bar gets the **long** name ("C++ source file"), menus the short one.
 *   PowerEditor/src/Notepad_plus.cpp:3174   `setLangStatus()` — writes it to STATUSBAR_DOC_TYPE.
 *   PowerEditor/src/langs.model.xml         — each `<Language name= ext=…>`: the extension list.
 *   PowerEditor/src/Parameters.cpp:4445     `getLangFromExt()` — extension lookup.
 *   PowerEditor/src/ScintillaComponent/Buffer.cpp:1805 `detectLanguageFromTextBeginning()`
 *       — everything below about content detection is that function, ported.
 *   PowerEditor/bin/userDefineLangs/markdown._preinstalled.udl.xml — markdown has no lexer
 *       in N++; it ships as a UDL, whose ext list ("md markdown") is used here.
 *
 * This module is deliberately DOM-free and pulls in no CodeMirror code at import time —
 * every language is behind `load()`. That is what lets `scripts/test-languages.mjs` check
 * the whole table (all loaders included) in Node, with no browser.
 */
import type { Extension } from "@codemirror/state";
import type { StreamParser } from "@codemirror/language";

// The `.ts` extension is deliberate: the same specifier has to resolve in Node
// (`--experimental-strip-types`, used by the generator and `scripts/test-languages.mjs`) as
// well as in Vite, and Node does not do extensionless resolution. `allowImportingTsExtensions`
// in tsconfig.json makes it legal.
import { LEGACY_PARSERS } from "./legacy-modes.generated.ts";

/** Loads the language's CodeMirror extension on first use. */
export type LanguageLoader = () => Promise<Extension>;

export interface LanguageDefinition {
  /** Stable id — what a menu, a preference or a saved session will name. */
  readonly id: string;
  /** N++'s **short** name ("C++", "Normal text") — what N++ puts in its Language menu. */
  readonly name: string;
  /** N++'s **long** name ("C++ source file") — what N++ puts in the status bar. */
  readonly label: string;
  /** Extensions, lower-case, no leading dot. Empty when nothing identifies the language. */
  readonly extensions: readonly string[];
  /** Exact file names, for the well-known extensionless files (see `FILENAMES` below). */
  readonly filenames?: readonly string[];
  /** true = Lezer grammar (foldable, syntax tree); false = legacy stream parser. */
  readonly firstClass: boolean;
  /** The `@codemirror/lang-*` package or `legacy-modes` file this came from (evidence). */
  readonly origin: string;
  load: LanguageLoader;
}

/** N++'s "Normal text file" (`_langNameInfoArray` row 0, `L_TEXT`). */
export const PLAIN_TEXT = { id: "normal", name: "Normal text", label: "Normal text file" } as const;

const exts = (list: string): readonly string[] => (list ? list.split(" ") : []);

/* ------------------------------------------------------------------ first class */

/**
 * The 22 official packages. Several of them describe more than one Notepad++ language, so
 * this table has more rows than D9 has packages — `lang-javascript` alone covers
 * JavaScript, JSX, TypeScript and TSX (both N++ entries: `javascript.js` and `typescript`),
 * and `lang-cpp` covers N++'s separate **C** and **C++**.
 *
 * `lang-angular` is the one exception to "N++ has a name for it": N++ has no Angular
 * language, and an Angular template is just an `.html` file — so it carries no extension
 * and never wins a detection, exactly as N++ would behave.
 */
interface FirstClassSpec {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  /** N++'s `ext=` attribute, space-separated (`langs.model.xml`). */
  readonly ext: string;
  readonly origin: string;
  readonly load: LanguageLoader;
}

const FIRST_CLASS: readonly FirstClassSpec[] = [
  {
    id: "c",
    name: "C",
    label: "C source file",
    ext: "c lex", // langs.model.xml "c"
    origin: "@codemirror/lang-cpp",
    load: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  },
  {
    id: "cpp",
    name: "C++",
    label: "C++ source file",
    ext: "cpp cxx cc h hh hpp hxx ino", // langs.model.xml "cpp"
    origin: "@codemirror/lang-cpp",
    load: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  },
  {
    id: "css",
    name: "CSS",
    label: "Cascade Style Sheets File",
    ext: "css", // langs.model.xml "css"
    origin: "@codemirror/lang-css",
    load: () => import("@codemirror/lang-css").then((m) => m.css()),
  },
  {
    id: "go",
    name: "Go",
    label: "Go source file",
    ext: "go", // langs.model.xml "go"
    origin: "@codemirror/lang-go",
    load: () => import("@codemirror/lang-go").then((m) => m.go()),
  },
  {
    id: "html",
    name: "HTML",
    label: "Hyper Text Markup Language file",
    ext: "html htm shtml shtm xhtml xht hta", // langs.model.xml "html"
    origin: "@codemirror/lang-html",
    load: () => import("@codemirror/lang-html").then((m) => m.html()),
  },
  {
    id: "java",
    name: "Java",
    label: "Java source file",
    ext: "java", // langs.model.xml "java"
    origin: "@codemirror/lang-java",
    load: () => import("@codemirror/lang-java").then((m) => m.java()),
  },
  {
    id: "javascript",
    name: "JavaScript",
    label: "JavaScript file",
    ext: "js mjs jsm cjs", // langs.model.xml "javascript.js", minus `vue` — see DEVIATIONS
    origin: "@codemirror/lang-javascript",
    load: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  },
  {
    id: "jsx",
    name: "JavaScript",
    label: "JavaScript file",
    ext: "jsx",
    origin: "@codemirror/lang-javascript",
    load: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  },
  {
    id: "typescript",
    name: "TypeScript",
    label: "TypeScript file",
    ext: "ts", // langs.model.xml "typescript"
    origin: "@codemirror/lang-javascript",
    load: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true })),
  },
  {
    id: "tsx",
    name: "TypeScript",
    label: "TypeScript file",
    ext: "tsx",
    origin: "@codemirror/lang-javascript",
    load: () =>
      import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true, jsx: true })),
  },
  {
    id: "jinja",
    name: "Jinja",
    label: "Jinja template",
    ext: "jinja jinja2 j2", // N++ has no Jinja language; CM's `jinja2` legacy port is the same grammar family
    origin: "@codemirror/lang-jinja",
    load: () => import("@codemirror/lang-jinja").then((m) => m.jinja()),
  },
  {
    id: "json",
    name: "json",
    label: "JSON file",
    ext: "json", // langs.model.xml "json"
    origin: "@codemirror/lang-json",
    load: () => import("@codemirror/lang-json").then((m) => m.json()),
  },
  {
    id: "less",
    name: "LESS",
    label: "LESS file",
    ext: "less", // no N++ language
    origin: "@codemirror/lang-less",
    load: () => import("@codemirror/lang-less").then((m) => m.less()),
  },
  {
    id: "lezer",
    name: "Lezer",
    label: "Lezer grammar",
    ext: "grammar", // no N++ language
    origin: "@codemirror/lang-lezer",
    load: () => import("@codemirror/lang-lezer").then((m) => m.lezer()),
  },
  {
    id: "liquid",
    name: "Liquid",
    label: "Liquid template",
    ext: "liquid", // no N++ language
    origin: "@codemirror/lang-liquid",
    load: () => import("@codemirror/lang-liquid").then((m) => m.liquid()),
  },
  {
    id: "markdown",
    name: "Markdown",
    label: "Markdown file",
    ext: "md markdown", // markdown._preinstalled.udl.xml ext="md markdown"
    origin: "@codemirror/lang-markdown",
    load: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  },
  {
    id: "php",
    name: "PHP",
    label: "PHP Hypertext Preprocessor file",
    ext: "php php3 php4 php5 phps phpt phtml", // langs.model.xml "php"
    origin: "@codemirror/lang-php",
    load: () => import("@codemirror/lang-php").then((m) => m.php()),
  },
  {
    id: "python",
    name: "Python",
    label: "Python file",
    ext: "py pyw pyx pxd pxi pyi", // langs.model.xml "python"
    origin: "@codemirror/lang-python",
    load: () => import("@codemirror/lang-python").then((m) => m.python()),
  },
  {
    id: "rust",
    name: "Rust",
    label: "Rust file",
    ext: "rs", // langs.model.xml "rust"
    origin: "@codemirror/lang-rust",
    load: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  },
  {
    id: "sass",
    name: "Sass",
    label: "Sass file",
    ext: "sass scss", // no N++ language
    origin: "@codemirror/lang-sass",
    load: () => import("@codemirror/lang-sass").then((m) => m.sass()),
  },
  {
    id: "sql",
    name: "SQL",
    label: "Structured Query Language file",
    ext: "sql", // langs.model.xml "sql"
    origin: "@codemirror/lang-sql",
    load: () => import("@codemirror/lang-sql").then((m) => m.sql()),
  },
  {
    id: "mssql",
    name: "mssql",
    label: "Microsoft Transact-SQL (SQL Server) file",
    ext: "tsql", // langs.model.xml "mssql"
    origin: "@codemirror/lang-sql",
    load: () => import("@codemirror/lang-sql").then((m) => m.sql({ dialect: m.MSSQL })),
  },
  {
    id: "vue",
    name: "Vue",
    label: "Vue file",
    ext: "vue", // N++ maps .vue to JavaScript; CM has a Vue grammar (see DEVIATIONS_FROM_NPP)
    origin: "@codemirror/lang-vue",
    load: () => import("@codemirror/lang-vue").then((m) => m.vue()),
  },
  {
    id: "wast",
    name: "WebAssembly",
    label: "WebAssembly file",
    ext: "wast wat", // no N++ language
    origin: "@codemirror/lang-wast",
    load: () => import("@codemirror/lang-wast").then((m) => m.wast()),
  },
  {
    id: "xml",
    name: "XML",
    label: "eXtensible Markup Language file",
    ext: "xml xaml xsl xslt xsd xul kml svg mxml xsml wsdl xlf xliff xbl sxbl sitemap gml gpx plist slnx targets vcproj vcxproj csproj vbproj dbproj dproj wxs wixproj ilproj", // langs.model.xml "xml"
    origin: "@codemirror/lang-xml",
    load: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  },
  {
    id: "yaml",
    name: "YAML",
    label: "YAML Ain't Markup Language",
    ext: "yml yaml", // langs.model.xml "yaml"
    origin: "@codemirror/lang-yaml",
    load: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  },
  {
    id: "angular",
    name: "Angular",
    label: "Angular template",
    ext: "", // an Angular template is an .html file; N++ has no Angular language at all
    origin: "@codemirror/lang-angular",
    load: () => import("@codemirror/lang-angular").then((m) => m.angular()),
  },
];

/* --------------------------------------------------------------------- legacy */

/**
 * The long tail: one row per `@codemirror/legacy-modes` parser. `file` + `symbol` name the
 * generated loader in `legacy-modes.generated.ts`; `gen-language-registry.mjs` fails if any
 * parser the package exports is neither listed here nor accounted for in
 * `SUPERSEDED_BY_FIRST_CLASS` / `NOT_A_LANGUAGE`, so this table cannot silently fall behind
 * the package.
 */
interface LegacySpec {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly ext: string;
  readonly file: string;
  readonly symbol: string;
}

const LEGACY: readonly LegacySpec[] = [
  { id: "apl", name: "APL", label: "", ext: "apl", file: "apl", symbol: "apl" },
  { id: "asciiarmor", name: "ASCII Armor", label: "", ext: "asc", file: "asciiarmor", symbol: "asciiArmor" },
  { id: "asn1", name: "ASN.1", label: "Abstract Syntax Notation One file", ext: "mib asn asn1", file: "asn1", symbol: "asn1" },
  {
    // N++'s ASP language is `ext="asp aspx"` rendered by the hypertext lexer — i.e. HTML with
    // embedded script — which is what the vbScriptASP parser is.
    id: "asp",
    name: "ASP",
    label: "Active Server Pages script file",
    ext: "asp aspx",
    file: "vbscript",
    symbol: "vbScriptASP",
  },
  { id: "asterisk", name: "Asterisk", label: "", ext: "", file: "asterisk", symbol: "asterisk" },
  { id: "brainfuck", name: "Brainfuck", label: "", ext: "bf b", file: "brainfuck", symbol: "brainfuck" },
  {
    // No first-class C# grammar exists anywhere in the CM6 org — this legacy port is the
    // only C# mode, which is why the ledger's "C# coverage is unconfirmed" note is now
    // answered: `clike.js` exports `csharp`, and it is a real stream parser.
    id: "cs",
    name: "C#",
    label: "C# source file", // langs.model.xml "cs"; N++ renders it with the C lexer
    ext: "cs",
    file: "clike",
    symbol: "csharp",
  },
  { id: "scala", name: "Scala", label: "", ext: "scala sc sbt", file: "clike", symbol: "scala" },
  { id: "kotlin", name: "Kotlin", label: "", ext: "kt kts", file: "clike", symbol: "kotlin" },
  { id: "glsl", name: "GLSL", label: "", ext: "glsl vert frag geo", file: "clike", symbol: "shader" },
  { id: "nesc", name: "nesC", label: "", ext: "nc", file: "clike", symbol: "nesC" },
  { id: "objc", name: "Objective-C", label: "Objective-C source file", ext: "mm", file: "clike", symbol: "objectiveC" },
  { id: "objcpp", name: "Objective-C++", label: "", ext: "", file: "clike", symbol: "objectiveCpp" },
  { id: "squirrel", name: "Squirrel", label: "", ext: "nut", file: "clike", symbol: "squirrel" },
  { id: "ceylon", name: "Ceylon", label: "", ext: "ceylon", file: "clike", symbol: "ceylon" },
  { id: "dart", name: "Dart", label: "", ext: "dart", file: "clike", symbol: "dart" },
  { id: "clojure", name: "Clojure", label: "", ext: "clj cljs cljc edn", file: "clojure", symbol: "clojure" },
  { id: "cmake", name: "CMake", label: "CMake file", ext: "cmake", file: "cmake", symbol: "cmake" },
  { id: "cobol", name: "COBOL", label: "COmmon Business Oriented Language", ext: "cbl cbd cdb cdc cob cpy copy lst", file: "cobol", symbol: "cobol" },
  { id: "coffeescript", name: "CoffeeScript", label: "CoffeeScript file", ext: "coffee litcoffee", file: "coffeescript", symbol: "coffeeScript" },
  { id: "commonlisp", name: "Common Lisp", label: "", ext: "lisp lsp cl el asd", file: "commonlisp", symbol: "commonLisp" },
  { id: "crystal", name: "Crystal", label: "", ext: "cr", file: "crystal", symbol: "crystal" },
  { id: "cypher", name: "Cypher", label: "", ext: "cypher cyp", file: "cypher", symbol: "cypher" },
  { id: "d", name: "D", label: "D programming language", ext: "d", file: "d", symbol: "d" },
  { id: "diff", name: "Diff", label: "Diff file", ext: "diff patch", file: "diff", symbol: "diff" },
  { id: "dockerfile", name: "Dockerfile", label: "", ext: "dockerfile", file: "dockerfile", symbol: "dockerFile" },
  { id: "dtd", name: "DTD", label: "", ext: "dtd", file: "dtd", symbol: "dtd" },
  { id: "dylan", name: "Dylan", label: "", ext: "dylan dyl lid", file: "dylan", symbol: "dylan" },
  { id: "ebnf", name: "EBNF", label: "", ext: "ebnf", file: "ebnf", symbol: "ebnf" },
  { id: "ecl", name: "ECL", label: "", ext: "ecl", file: "ecl", symbol: "ecl" },
  { id: "eiffel", name: "Eiffel", label: "", ext: "e", file: "eiffel", symbol: "eiffel" },
  { id: "elm", name: "Elm", label: "", ext: "elm", file: "elm", symbol: "elm" },
  { id: "erlang", name: "Erlang", label: "Erlang file", ext: "erl hrl", file: "erlang", symbol: "erlang" },
  { id: "factor", name: "Factor", label: "", ext: "factor", file: "factor", symbol: "factor" },
  { id: "fcl", name: "FCL", label: "", ext: "fcl", file: "fcl", symbol: "fcl" },
  { id: "forth", name: "Forth", label: "Forth file", ext: "forth fth", file: "forth", symbol: "forth" },
  { id: "fortran", name: "Fortran free form", label: "Fortran free form source file", ext: "f for f90 f95 f2k f23", file: "fortran", symbol: "fortran" },
  { id: "gas", name: "Assembly (GNU)", label: "", ext: "", file: "gas", symbol: "gas" },
  { id: "gasarm", name: "ARM assembly", label: "", ext: "", file: "gas", symbol: "gasArm" },
  { id: "gherkin", name: "Gherkin", label: "", ext: "feature", file: "gherkin", symbol: "gherkin" },
  { id: "groovy", name: "Groovy", label: "", ext: "groovy gvy gy gsh", file: "groovy", symbol: "groovy" },
  { id: "haskell", name: "Haskell", label: "Haskell", ext: "hs lhs las", file: "haskell", symbol: "haskell" },
  { id: "haxe", name: "Haxe", label: "", ext: "hx", file: "haxe", symbol: "haxe" },
  { id: "hxml", name: "HXML", label: "", ext: "hxml", file: "haxe", symbol: "hxml" },
  { id: "http", name: "HTTP", label: "", ext: "", file: "http", symbol: "http" },
  { id: "idl", name: "IDL", label: "", ext: "idl", file: "idl", symbol: "idl" },
  { id: "jsonld", name: "JSON-LD", label: "", ext: "jsonld", file: "javascript", symbol: "jsonld" },
  { id: "julia", name: "Julia", label: "", ext: "jl", file: "julia", symbol: "julia" },
  { id: "livescript", name: "LiveScript", label: "", ext: "ls", file: "livescript", symbol: "liveScript" },
  { id: "lua", name: "Lua", label: "Lua source File", ext: "lua", file: "lua", symbol: "lua" },
  { id: "mathematica", name: "Mathematica", label: "", ext: "nb wl wls", file: "mathematica", symbol: "mathematica" },
  { id: "mbox", name: "mailbox", label: "", ext: "mbox", file: "mbox", symbol: "mbox" },
  { id: "mirc", name: "mIRC", label: "", ext: "mrc", file: "mirc", symbol: "mirc" },
  { id: "ocaml", name: "OCaml", label: "Categorical Abstract Machine Language", ext: "ml mli", file: "mllike", symbol: "oCaml" },
  { id: "fsharp", name: "F#", label: "", ext: "fs fsx fsi", file: "mllike", symbol: "fSharp" },
  { id: "sml", name: "Standard ML", label: "", ext: "sml sig fun", file: "mllike", symbol: "sml" },
  { id: "modelica", name: "Modelica", label: "", ext: "mo", file: "modelica", symbol: "modelica" },
  { id: "mscgen", name: "Mscgen", label: "", ext: "msc", file: "mscgen", symbol: "mscgen" },
  { id: "msgenny", name: "Msgenny", label: "", ext: "", file: "mscgen", symbol: "msgenny" },
  { id: "xu", name: "XU", label: "", ext: "", file: "mscgen", symbol: "xu" },
  { id: "mumps", name: "MUMPS", label: "", ext: "mumps", file: "mumps", symbol: "mumps" },
  { id: "nginx", name: "Nginx", label: "", ext: "", file: "nginx", symbol: "nginx" },
  { id: "nsis", name: "NSIS", label: "Nullsoft Scriptable Install System script file", ext: "nsi nsh", file: "nsis", symbol: "nsis" },
  { id: "ntriples", name: "N-Triples", label: "", ext: "nt", file: "ntriples", symbol: "ntriples" },
  { id: "matlab", name: "MATLAB", label: "MATrix LABoratory", ext: "m", file: "octave", symbol: "octave" },
  { id: "oz", name: "Oz", label: "", ext: "oz", file: "oz", symbol: "oz" },
  { id: "pascal", name: "Pascal", label: "Pascal source file", ext: "pas pp p inc lpr dpr", file: "pascal", symbol: "pascal" },
  { id: "pegjs", name: "PEG.js", label: "", ext: "pegjs peg", file: "pegjs", symbol: "pegjs" },
  { id: "perl", name: "Perl", label: "Perl source file", ext: "pl pm plx t", file: "perl", symbol: "perl" },
  { id: "pig", name: "Pig", label: "", ext: "pig", file: "pig", symbol: "pig" },
  { id: "powershell", name: "PowerShell", label: "Windows PowerShell", ext: "ps1 psm1 psd1", file: "powershell", symbol: "powerShell" },
  { id: "properties", name: "Properties file", label: "Properties file", ext: "properties conf cf cfg gitattributes gitconfig gitmodules editorconfig", file: "properties", symbol: "properties" },
  { id: "protobuf", name: "Protocol Buffers", label: "", ext: "proto", file: "protobuf", symbol: "protobuf" },
  { id: "pug", name: "Pug", label: "", ext: "pug jade", file: "pug", symbol: "pug" },
  { id: "puppet", name: "Puppet", label: "", ext: "", file: "puppet", symbol: "puppet" },
  { id: "cython", name: "Cython", label: "", ext: "pyx pxd pxi", file: "python", symbol: "cython" },
  { id: "q", name: "Q", label: "", ext: "q", file: "q", symbol: "q" },
  { id: "r", name: "R", label: "R programming language", ext: "r s splus", file: "r", symbol: "r" },
  { id: "rpmspec", name: "RPM spec", label: "", ext: "spec", file: "rpm", symbol: "rpmSpec" },
  { id: "rpmchanges", name: "RPM changes", label: "", ext: "", file: "rpm", symbol: "rpmChanges" },
  { id: "ruby", name: "Ruby", label: "Ruby file", ext: "rb rbw", file: "ruby", symbol: "ruby" },
  { id: "sas", name: "SAS", label: "SAS file", ext: "sas", file: "sas", symbol: "sas" },
  { id: "scheme", name: "Scheme", label: "Scheme file", ext: "scm smd ss", file: "scheme", symbol: "scheme" },
  { id: "shell", name: "Shell", label: "Unix script file", ext: "sh bash bsh csh profile bashrc bash_profile zsh ksh", file: "shell", symbol: "shell" },
  { id: "sieve", name: "Sieve", label: "", ext: "sieve", file: "sieve", symbol: "sieve" },
  { id: "smalltalk", name: "Smalltalk", label: "Smalltalk file", ext: "st", file: "smalltalk", symbol: "smalltalk" },
  { id: "solr", name: "Solr", label: "", ext: "", file: "solr", symbol: "solr" },
  { id: "sparql", name: "SPARQL", label: "", ext: "rq sparql", file: "sparql", symbol: "sparql" },
  { id: "spreadsheet", name: "Spreadsheet", label: "", ext: "", file: "spreadsheet", symbol: "spreadsheet" },
  { id: "stex", name: "sTeX", label: "", ext: "stex", file: "stex", symbol: "stex" },
  { id: "stexmath", name: "sTeX Math", label: "", ext: "", file: "stex", symbol: "stexMath" },
  { id: "stylus", name: "Stylus", label: "", ext: "styl", file: "stylus", symbol: "stylus" },
  { id: "swift", name: "Swift", label: "Swift file", ext: "swift", file: "swift", symbol: "swift" },
  { id: "tcl", name: "TCL", label: "Tool Command Language file", ext: "tcl itcl", file: "tcl", symbol: "tcl" },
  { id: "textile", name: "Textile", label: "", ext: "textile", file: "textile", symbol: "textile" },
  { id: "tiddlywiki", name: "TiddlyWiki", label: "", ext: "tid", file: "tiddlywiki", symbol: "tiddlyWiki" },
  { id: "tiki", name: "Tiki wiki", label: "", ext: "", file: "tiki", symbol: "tiki" },
  { id: "toml", name: "TOML", label: "Tom's Obvious Minimal Language file", ext: "toml", file: "toml", symbol: "toml" },
  { id: "troff", name: "Troff", label: "", ext: "roff troff man", file: "troff", symbol: "troff" },
  { id: "ttcn", name: "TTCN-3", label: "", ext: "ttcn ttcn3", file: "ttcn", symbol: "ttcn" },
  { id: "ttcncfg", name: "TTCN-3 config", label: "", ext: "", file: "ttcn-cfg", symbol: "ttcnCfg" },
  { id: "turtle", name: "Turtle", label: "", ext: "ttl", file: "turtle", symbol: "turtle" },
  { id: "vb", name: "Visual Basic", label: "Visual Basic file", ext: "vb vba", file: "vb", symbol: "vb" },
  { id: "vbscript", name: "VBScript", label: "", ext: "vbs", file: "vbscript", symbol: "vbScript" },
  { id: "velocity", name: "Velocity", label: "", ext: "vm", file: "velocity", symbol: "velocity" },
  { id: "verilog", name: "Verilog", label: "Verilog file", ext: "v sv vh svh", file: "verilog", symbol: "verilog" },
  { id: "tlv", name: "TL-Verilog", label: "", ext: "tlv", file: "verilog", symbol: "tlv" },
  { id: "vhdl", name: "VHDL", label: "VHSIC Hardware Description Language file", ext: "vhd vhdl", file: "vhdl", symbol: "vhdl" },
  { id: "webidl", name: "Web IDL", label: "", ext: "widl webidl", file: "webidl", symbol: "webIDL" },
  { id: "xquery", name: "XQuery", label: "", ext: "xq xquery xqm xqy", file: "xquery", symbol: "xQuery" },
  { id: "yacas", name: "Yacas", label: "", ext: "yacas", file: "yacas", symbol: "yacas" },
  { id: "z80", name: "Z80 assembly", label: "", ext: "z80", file: "z80", symbol: "z80" },
  { id: "ez80", name: "eZ80 assembly", label: "", ext: "ez80", file: "z80", symbol: "ez80" },
];

/**
 * Legacy parsers deliberately **not** registered as separate languages, each with the reason.
 * Most are the same language as a first-class grammar, which parses better and folds; a few
 * are dialects `lang-sql` does not ship, where the standard-SQL grammar stands in.
 *
 * The bucket exists so that "all 103 legacy mode files are accounted for" is a checked claim
 * (`scripts/gen-language-registry.mjs`) rather than a hope.
 */
export const SUPERSEDED_BY_FIRST_CLASS: Readonly<Record<string, string>> = {
  "clike:c": "C — @codemirror/lang-cpp",
  "clike:cpp": "C++ — @codemirror/lang-cpp",
  "clike:java": "Java — @codemirror/lang-java",
  "css:css": "CSS — @codemirror/lang-css",
  "css:sCSS": "SCSS — @codemirror/lang-sass",
  "css:less": "LESS — @codemirror/lang-less",
  "css:gss": "Closure stylesheets — @codemirror/lang-css stands in; no dedicated grammar exists",
  "go:go": "Go — @codemirror/lang-go",
  "javascript:javascript": "JavaScript — @codemirror/lang-javascript",
  "javascript:json": "JSON — @codemirror/lang-json",
  "javascript:typescript": "TypeScript — @codemirror/lang-javascript",
  "jinja2:jinja2": "Jinja — @codemirror/lang-jinja",
  "python:python": "Python — @codemirror/lang-python",
  "rust:rust": "Rust — @codemirror/lang-rust",
  "sass:sass": "Sass/SCSS — @codemirror/lang-sass",
  "sql:standardSQL": "SQL — @codemirror/lang-sql (StandardSQL dialect)",
  "sql:msSQL": "mssql — @codemirror/lang-sql (MSSQL dialect)",
  "sql:mySQL": "MySQL — @codemirror/lang-sql (MySQL dialect)",
  "sql:mariaDB": "MariaDB — @codemirror/lang-sql (MariaSQL dialect)",
  "sql:sqlite": "SQLite — @codemirror/lang-sql (SQLite dialect)",
  "sql:cassandra": "Cassandra CQL — @codemirror/lang-sql (Cassandra dialect)",
  "sql:plSQL": "PL/SQL — @codemirror/lang-sql (PLSQL dialect)",
  "sql:pgSQL": "PostgreSQL — @codemirror/lang-sql (PostgreSQL dialect)",
  "sql:hive": "HiveQL — no first-class dialect ships; the standard-SQL grammar stands in",
  "sql:gql": "GQL — no first-class dialect ships; the standard-SQL grammar stands in",
  "sql:gpSQL": "Greenplum — no first-class dialect ships; the standard-SQL grammar stands in",
  "sql:sparkSQL": "Spark SQL — no first-class dialect ships; the standard-SQL grammar stands in",
  "sql:esper": "Esper EPL — no first-class dialect ships; the standard-SQL grammar stands in",
  "wast:wast": "WebAssembly — @codemirror/lang-wast",
  "xml:xml": "XML — @codemirror/lang-xml",
  "xml:html": "HTML — @codemirror/lang-html",
  "yaml:yaml": "YAML — @codemirror/lang-yaml",
};

/** Exports that are not languages at all: the factories a parser is built with, and one keyword list. */
export const NOT_A_LANGUAGE: Readonly<Record<string, string>> = {
  "clike:clike": "factory — `clike(parserConfig)` builds the c/cpp/java/… parsers",
  "css:mkCSS": "factory — builds the css/sCSS/less/gss parsers",
  "css:keywords": "data — the CSS keyword list the stylesheet parsers use",
  "python:mkPython": "factory — builds python/cython",
  "simple-mode:simpleMode": "factory — builds a parser from a declarative config (UDL-style)",
  "sql:sql": "factory — `sql(dialect)` builds the SQL dialect parsers",
  "xml:mkXML": "factory — builds xml/html",
};

function legacyLoader(file: string, symbol: string): LanguageLoader {
  const thunk = LEGACY_PARSERS[`${file}:${symbol}`];
  if (!thunk) {
    // Thrown at first use rather than at import: a language that the generated table does
    // not carry must not stop the whole registry from loading.
    return () => Promise.reject(new Error(`no legacy parser for ${file}:${symbol}`));
  }
  return async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    // `StreamLanguage.define` is the public constructor (`new StreamLanguage()` is private),
    // and it wants `@codemirror/language`'s `StreamParser`. The legacy parsers are typed
    // against `@codemirror/streamparser`'s near-identical copy of that interface, whose
    // `StringStream` is a separate class — hence the single bridge cast, documented in the
    // generated file's header.
    return StreamLanguage.define((await thunk()) as unknown as StreamParser<unknown>);
  };
}

function legacyDefinition(spec: LegacySpec): LanguageDefinition {
  return {
    id: spec.id,
    name: spec.name,
    label: spec.label || spec.name,
    extensions: exts(spec.ext),
    firstClass: false,
    origin: `@codemirror/legacy-modes/mode/${spec.file}.js → ${spec.symbol}`,
    load: legacyLoader(spec.file, spec.symbol),
  };
}

/** Every language the MVP knows, first-class ones first (they win a tie during detection). */
export const LANGUAGES: readonly LanguageDefinition[] = [
  ...FIRST_CLASS.map((spec) => ({
    id: spec.id,
    name: spec.name,
    label: spec.label,
    extensions: exts(spec.ext),
    firstClass: true,
    origin: spec.origin,
    load: spec.load,
  })),
  ...LEGACY.map(legacyDefinition),
];

/**
 * Well-known files with no extension at all. **Beyond Notepad++**: N++ decides by extension
 * only (`Parameters.cpp:4445`), so a `Makefile` is "Normal text file" there unless the user
 * picks the language. These names are cheap to recognise, so they are — but it is an
 * addition, not fidelity, and D9's gap list bites here: a `Makefile` is deliberately *not*
 * in this table, because there is no makefile mode for it to point at. Every value here has
 * to name a language that exists, which `scripts/test-languages.mjs` asserts.
 */
export const FILENAMES: Readonly<Record<string, string>> = {
  dockerfile: "dockerfile",
  "cmakelists.txt": "cmake",
  rakefile: "ruby",
  gemfile: "ruby",
  "nginx.conf": "nginx",
};

/* ------------------------------------------------------------------- detection */

/**
 * Ported from `FileManager::detectLanguageFromTextBeginning` (Buffer.cpp:1805-1897), which
 * N++ runs **only** when the extension gave nothing and the file is not large
 * (Buffer.cpp:2133, gated by `DocumentFillPolicy::_detectLanguageFromContent = true`).
 *
 * Faithful in three ways that matter:
 *   1. leading whitespace is skipped, then at most **40** characters are considered — the
 *      comment in N++ says "shebangs can be large" (:1835) — and the line is cut at the
 *      first CR or LF (:1839-1843);
 *   2. the shebang table is searched **in N++'s order** with a *substring* test, so "sh"
 *      wins over the others whenever it appears anywhere in the line — `#!/usr/bin/fish`
 *      is therefore "Shell" (:1849-1874);
 *   3. the first-line patterns are ordered, and `<?` comes last on purpose (:1877-1884).
 *
 * One difference, stated rather than hidden: N++ strips a BOM here (:1817-1822) because it
 * is looking at raw bytes; this function is handed decoded text, and `src/file/file-io.ts`
 * removed the BOM before decoding, so there is nothing left to strip.
 */
export function detectLanguageFromContent(text: string): LanguageDefinition | null {
  let i = 0;
  while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) {
    i += 1;
  }
  if (i >= text.length) return null;

  let head = text.slice(i, i + 40);
  const stop = head.search(/[\r\n]/);
  if (stop >= 0) head = head.slice(0, stop);

  if (head.startsWith("#!")) {
    const shebangs: readonly (readonly [string, string])[] = [
      ["sh", "shell"],
      ["python", "python"],
      ["perl", "perl"],
      ["php", "php"],
      ["ruby", "ruby"],
      ["node", "javascript"],
    ];
    for (const [pattern, id] of shebangs) {
      if (head.includes(pattern)) return byId(id) ?? null;
    }
    return null; // N++: "Unrecognized shebang (there is always room for improvement ;-)"
  }

  const firstLine: readonly (readonly [string, string])[] = [
    ["<?xml", "xml"],
    ["<?php", "php"],
    ["<html", "html"],
    ["<!DOCTYPE html", "html"],
    ["<?", "php"],
  ];
  for (const [pattern, id] of firstLine) {
    if (head.startsWith(pattern) || head.includes(pattern)) return byId(id) ?? null;
  }
  return null;
}

/** N++ compares extensions case-insensitively; so does this. */
export function languageByExtension(extension: string): LanguageDefinition | null {
  const wanted = extension.toLowerCase();
  if (!wanted) return null;
  for (const language of LANGUAGES) {
    if (language.extensions.includes(wanted)) return language;
  }
  return null;
}

export function languageByFileName(fileName: string): LanguageDefinition | null {
  const id = FILENAMES[fileName.toLowerCase()];
  return id ? (byId(id) ?? null) : null;
}

/**
 * The detection order the plan asks for: extension, then the exact file name, then content.
 * N++ resolves a contested extension by the order of its own language table (it walks that
 * table *backwards* — `Parameters.cpp:4464`); this one resolves it by the order of
 * `LANGUAGES`, first-class first. The collisions that exist are named in
 * `scripts/test-languages.mjs` and asserted there rather than left to chance.
 */
export function detectLanguage(fileName: string, text: string): LanguageDefinition | null {
  const dot = fileName.lastIndexOf(".");
  const extension = dot > 0 ? fileName.slice(dot + 1) : "";
  return (
    languageByExtension(extension) ??
    languageByFileName(fileName) ??
    detectLanguageFromContent(text)
  );
}

export function byId(id: string): LanguageDefinition | undefined {
  return LANGUAGES.find((language) => language.id === id);
}

/** Counts for the status bar, `inspect()` and the acceptance check — measured, not asserted. */
export function languageStats(): {
  firstClass: number;
  legacy: number;
  total: number;
  extensions: number;
} {
  const seen = new Set<string>();
  let extensions = 0;
  for (const language of LANGUAGES) {
    for (const extension of language.extensions) {
      if (!seen.has(extension)) {
        seen.add(extension);
        extensions += 1;
      }
    }
  }
  return {
    firstClass: LANGUAGES.filter((language) => language.firstClass).length,
    legacy: LANGUAGES.filter((language) => !language.firstClass).length,
    total: LANGUAGES.length,
    extensions,
  };
}

/** Languages in the order a menu wants them: N++'s own name, case-insensitively. */
export function languagesByName(): LanguageDefinition[] {
  return [...LANGUAGES].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
