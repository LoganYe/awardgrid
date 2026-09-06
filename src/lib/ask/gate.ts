/**
 * Tool gate for the ask lane — the `canUseTool` implementation (kickoff §7.5 guardrails,
 * §0.2 #1 no scraping, #5 no credentials). Pure: no I/O, no logging; `gateDecision` is a
 * function of (toolName, input, pluginRoot) so every rule is unit-testable.
 *
 * Policy (deny is the default; every branch below is an explicit allow):
 *   Read / Glob / Grep   only when the target path resolves INSIDE the plugin root
 *   Skill                allowed (the SDK `skills` allowlist decides which); pruned names denied
 *   mcp__<server>__*     only the four kept remote servers (./mcp.ts)
 *   Bash                 a single pipeline: `curl …` (or `echo '<literal>' | …`, `jq …`) piped
 *                        into jq / head / tail / sort / uniq / wc / grep / rg /
 *                        `python3 -m json.tool`. No `;` `&&` `||` `&` backticks `$( )` `< >`
 *                        redirects, no unquoted newlines (backslash-newline continuation and
 *                        newlines inside single quotes are fine — that is how the skills write
 *                        multi-line curl/jq). `$VAR` / `${VAR}` expansions are allowed ONLY for
 *                        SEATS_AERO_API_KEY / DUFFEL_API_KEY_LIVE / IGNAV_API_KEY and ONLY as the
 *                        value of a curl `-H` header. curl: https only, host in
 *                        ALLOWED_CURL_HOSTS, no userinfo, no non-443 port, flag ALLOWLIST (unknown
 *                        flags are denied), no file reads/writes (-o -O -K -T -F -u --netrc
 *                        -d @file -H @file -H @- -w @file -w '%output{file}' …), no proxies,
 *                        no -k, methods GET/POST/HEAD only. Filters: clustered short flags are
 *                        parsed (grep -e<pat>, sort -o<file>) and abbreviated GNU long options
 *                        that could name a file (--fil=, --out=) are denied.
 *   everything else      denied (Write, Edit, MultiEdit, NotebookEdit, Task, Agent, WebFetch,
 *                        WebSearch, TodoWrite, KillShell, BashOutput, …).
 *
 * The decision message is short and never echoes header values or env var VALUES (only names).
 */
import path from "node:path";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { isKeptMcpTool, parseMcpToolName } from "./mcp";
import { isPrunedSkill } from "./pruned";
import { defaultPluginRoot } from "./skills";

export interface GateDecision {
  allow: boolean;
  reason: string;
}

export interface GateOptions {
  /** Absolute plugin root; Read/Glob/Grep and jq file arguments must stay inside it. */
  pluginRoot?: string;
}

/** HTTPS hosts curl may talk to (exact hostname match, lower-case). */
export const ALLOWED_CURL_HOSTS: readonly string[] = Object.freeze([
  "seats.aero",
  "api.duffel.com",
  "ignav.com",
  "en.wikipedia.org",
  "www.wheretocredit.com",
  "wheretocredit.com",
  "api.biltrewards.com",
]);

/** Env vars that may be expanded (only inside a curl `-H` value). Names only — values never appear here. */
export const ALLOWED_ENV_EXPANSIONS: readonly string[] = Object.freeze([
  "SEATS_AERO_API_KEY",
  "DUFFEL_API_KEY_LIVE",
  "IGNAV_API_KEY",
]);

/** Tools that are always denied even if the SDK offers them. */
export const DENIED_TOOLS: readonly string[] = Object.freeze([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Task",
  "Agent",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "KillShell",
  "BashOutput",
  "TaskOutput",
  "EnterPlanMode",
  "ExitPlanMode",
  "LS",
  // Seen in a real init (Claude Code 2.1.260) with the defaults above; none is needed by the kept
  // skills, so remove them from context as well (the gate denies them regardless).
  "AskUserQuestion",
  "CronCreate",
  "CronDelete",
  "CronList",
  "DesignSync",
  "EnterWorktree",
  "ExitWorktree",
  "ListAgents",
  "SendMessage",
  "ScheduleWakeup",
  "Workflow",
  "ToolSearch",
  "ReportFindings",
  "ListMcpResourcesTool",
  "ReadMcpResourceTool",
  "ReadMcpResourceDirTool",
]);

export const MAX_COMMAND_LENGTH = 8000;

const allow = (reason: string): GateDecision => ({ allow: true, reason });
const deny = (reason: string): GateDecision => ({ allow: false, reason });

// ---------------------------------------------------------------------------
// Path containment
// ---------------------------------------------------------------------------

/** True when `p` (absolute or relative to root) resolves to root or something under it. */
export function isInsideRoot(root: string, p: string): boolean {
  if (typeof p !== "string" || p.length === 0 || p.includes("\0") || p.startsWith("~"))
    return false;
  const absRoot = path.resolve(root);
  const resolved = path.resolve(absRoot, p);
  const rel = path.relative(absRoot, resolved);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function gateFileTool(
  toolName: string,
  input: Record<string, unknown>,
  root: string,
): GateDecision {
  const key = toolName === "Read" ? "file_path" : "path";
  const p = input[key];
  if (toolName === "Read") {
    if (typeof p !== "string" || p.length === 0) return deny("Read needs a file_path");
    return isInsideRoot(root, p)
      ? allow("read inside plugin root")
      : deny("Read is limited to the plugin directory");
  }
  // Glob / Grep: `path` is optional (defaults to cwd = plugin root).
  if (p !== undefined) {
    if (typeof p !== "string" || !isInsideRoot(root, p))
      return deny(`${toolName} is limited to the plugin directory`);
  }
  const pattern = input.pattern;
  if (toolName === "Glob") {
    if (typeof pattern !== "string") return deny("Glob needs a pattern");
    if (
      path.isAbsolute(pattern) ||
      pattern.split(/[\\/]/).includes("..") ||
      pattern.startsWith("~")
    ) {
      return deny("Glob pattern must stay inside the plugin directory");
    }
  }
  return allow(`${toolName} inside plugin root`);
}

// ---------------------------------------------------------------------------
// Shell tokenizer (POSIX-ish subset; anything it does not understand is a deny)
// ---------------------------------------------------------------------------

interface Token {
  /** Text with each allowed expansion kept as `$NAME`. */
  text: string;
  /** Names of env vars expanded in this token (allowed names only; others deny at parse time). */
  expansions: string[];
}

type ParseResult = { ok: true; segments: Token[][] } | { ok: false; reason: string };

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

function tokenize(command: string): ParseResult {
  const segments: Token[][] = [[]];
  let cur: Token | null = null;
  let state: "none" | "single" | "double" = "none";

  const ensure = (): Token => (cur ??= { text: "", expansions: [] });
  const endToken = (): void => {
    if (cur) segments[segments.length - 1]!.push(cur);
    cur = null;
  };

  /** Parses `$NAME` / `${NAME}` at index i (command[i] === "$"). Returns next index or a deny reason. */
  const expansion = (i: number): { next: number } | { reason: string } => {
    const after = command[i + 1];
    if (after === "(") return { reason: "command substitution is not allowed" };
    let name: string;
    let next: number;
    if (after === "{") {
      const close = command.indexOf("}", i + 2);
      if (close === -1) return { reason: "unterminated ${" };
      name = command.slice(i + 2, close);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
        return { reason: "only plain ${VAR} expansions are allowed" };
      next = close + 1;
    } else {
      const m = ENV_NAME.exec(command.slice(i + 1));
      if (!m) return { reason: "bare $ is not allowed" };
      name = m[0];
      next = i + 1 + name.length;
    }
    if (!ALLOWED_ENV_EXPANSIONS.includes(name))
      return { reason: `expansion of $${name} is not allowed` };
    const t = ensure();
    t.text += `$${name}`;
    t.expansions.push(name);
    return { next };
  };

  let i = 0;
  while (i < command.length) {
    const c = command[i]!;
    if (state === "single") {
      if (c === "'") state = "none";
      else ensure().text += c;
      i++;
      continue;
    }
    if (state === "double") {
      if (c === '"') {
        state = "none";
        i++;
      } else if (c === "\\") {
        const n = command[i + 1];
        if (n === "\n") {
          i += 2; // line continuation inside double quotes
        } else if (n === '"' || n === "\\" || n === "$" || n === "`") {
          ensure().text += n;
          i += 2;
        } else {
          ensure().text += "\\";
          i++;
        }
      } else if (c === "`") {
        return { ok: false, reason: "backticks are not allowed" };
      } else if (c === "$") {
        const r = expansion(i);
        if ("reason" in r) return { ok: false, reason: r.reason };
        i = r.next;
      } else {
        ensure().text += c;
        i++;
      }
      continue;
    }
    // unquoted
    if (c === " " || c === "\t") {
      endToken();
      i++;
    } else if (c === "\n" || c === "\r") {
      return { ok: false, reason: "newlines are not allowed (use backslash continuation)" };
    } else if (c === "\\") {
      const n = command[i + 1];
      if (n === undefined) return { ok: false, reason: "trailing backslash" };
      if (n === "\n" || n === "\r") {
        endToken();
        i += n === "\r" && command[i + 2] === "\n" ? 3 : 2;
      } else {
        ensure().text += n;
        i += 2;
      }
    } else if (c === "'") {
      ensure();
      state = "single";
      i++;
    } else if (c === '"') {
      ensure();
      state = "double";
      i++;
    } else if (c === "|") {
      if (command[i + 1] === "|") return { ok: false, reason: "|| is not allowed" };
      if (command[i + 1] === "&") return { ok: false, reason: "|& is not allowed" };
      endToken();
      if (segments[segments.length - 1]!.length === 0)
        return { ok: false, reason: "empty pipeline segment" };
      segments.push([]);
      i++;
    } else if (c === "`") {
      return { ok: false, reason: "backticks are not allowed" };
    } else if (
      c === ";" ||
      c === "&" ||
      c === "<" ||
      c === ">" ||
      c === "(" ||
      c === ")" ||
      c === "{" ||
      c === "}"
    ) {
      return { ok: false, reason: `shell operator '${c}' is not allowed` };
    } else if (c === "$") {
      const r = expansion(i);
      if ("reason" in r) return { ok: false, reason: r.reason };
      i = r.next;
    } else if (c === "#" && cur === null) {
      return { ok: false, reason: "comments are not allowed" };
    } else {
      ensure().text += c;
      i++;
    }
  }
  if (state !== "none") return { ok: false, reason: "unterminated quote" };
  endToken();
  if (segments[segments.length - 1]!.length === 0)
    return { ok: false, reason: "empty pipeline segment" };
  return { ok: true, segments };
}

// ---------------------------------------------------------------------------
// curl
// ---------------------------------------------------------------------------

const CURL_NOVALUE_LONG = new Set([
  "--silent",
  "--show-error",
  "--fail",
  "--fail-with-body",
  "--globoff",
  "--get",
  "--compressed",
  "--include",
  "--head",
  "--location",
  "--http1.1",
  "--http2",
  "--tlsv1.2",
  "--tlsv1.3",
  "--no-progress-meter",
  "--no-buffer",
  "--no-keepalive",
  "--retry-all-errors",
  "--ipv4",
  "--ipv6",
]);
const CURL_VALUE_LONG = new Set([
  "--header",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-ascii",
  "--data-urlencode",
  "--json",
  "--request",
  "--user-agent",
  "--referer",
  "--max-time",
  "--connect-timeout",
  "--retry",
  "--retry-delay",
  "--retry-max-time",
  "--write-out",
  "--url",
  "--max-redirs",
  "--limit-rate",
  "--range",
]);
/** Explicitly denied long flags (everything not in the two sets above is denied anyway; these get a clearer message). */
const CURL_DENY_LONG = new Set([
  "--verbose",
  "--output",
  "--remote-name",
  "--remote-name-all",
  "--config",
  "--upload-file",
  "--form",
  "--form-string",
  "--proxy",
  "--netrc",
  "--netrc-file",
  "--netrc-optional",
  "--user",
  "--insecure",
  "--cookie",
  "--cookie-jar",
  "--dump-header",
  "--stderr",
  "--libcurl",
  "--location-trusted",
  "--resolve",
  "--connect-to",
  "--interface",
  "--unix-socket",
  "--abstract-unix-socket",
  "--proxy-user",
  "--socks5",
  "--socks4",
  "--socks4a",
  "--socks5-hostname",
  "--output-dir",
  "--etag-save",
  "--etag-compare",
  "--create-dirs",
  "--remote-header-name",
  "--cert",
  "--key",
  "--cacert",
  "--capath",
  "--doh-url",
  "--aws-sigv4",
  "--oauth2-bearer",
  "--variable",
  "--expand-url",
  "--expand-header",
  "--expand-data",
]);

// short flags
const CURL_NOVALUE_SHORT = new Set(["s", "S", "f", "g", "G", "i", "I", "L", "N", "4", "6"]);
const CURL_VALUE_SHORT = new Set(["H", "d", "X", "A", "e", "m", "w", "r"]);
const CURL_DENY_SHORT = new Set([
  "v",
  "o",
  "O",
  "K",
  "T",
  "F",
  "x",
  "n",
  "u",
  "k",
  "b",
  "c",
  "D",
  "E",
  "J",
  "Q",
  "z",
  "P",
]);

const CURL_DATA_FLAGS = new Set([
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-ascii",
  "--data-urlencode",
  "--json",
]);
const CURL_ALLOWED_METHODS = new Set(["GET", "POST", "HEAD"]);

function validateCurlUrl(raw: string): GateDecision {
  if (!/^https:\/\//i.test(raw)) return deny("curl URLs must use https://");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return deny("curl URL is not a valid URL");
  }
  if (u.protocol !== "https:") return deny("curl URLs must use https://");
  if (u.username !== "" || u.password !== "") return deny("credentials in URLs are not allowed");
  if (u.port !== "" && u.port !== "443") return deny("only port 443 is allowed");
  const host = u.hostname.toLowerCase();
  if (!ALLOWED_CURL_HOSTS.includes(host)) return deny(`host ${host} is not in the allowed list`);
  return allow("url ok");
}

/** Validates the value of a curl flag. `flag` is the canonical spelling ("-H", "--data", …). */
function validateCurlValue(flag: string, value: Token, urls: string[]): GateDecision | null {
  if (flag === "-H" || flag === "--header") {
    // `-H @file` / `-H @-` makes curl read headers from a file / stdin (arbitrary local-file read
    // exfiltrated to the allowed host). Only literal header lines are allowed.
    if (/^\s*@/.test(value.text)) return deny("reading headers from a file is not allowed");
    return null;
  }
  if (value.expansions.length > 0) {
    return deny("environment variables may only be expanded inside a -H header value");
  }
  if (CURL_DATA_FLAGS.has(flag)) {
    if (/^@/.test(value.text) || (flag === "--data-urlencode" && /^[^=]*@/.test(value.text)))
      return deny("reading request data from a file is not allowed");
    return null;
  }
  if (flag === "-X" || flag === "--request") {
    return CURL_ALLOWED_METHODS.has(value.text.toUpperCase())
      ? null
      : deny(`HTTP method ${value.text} is not allowed`);
  }
  if (flag === "-w" || flag === "--write-out") {
    // `-w @file` reads the format from a file; `%output{path}` (curl >= 8.3) writes the rest of
    // the format to a file — an arbitrary file write. `%header{}` is harmless but not needed.
    if (/^\s*@/.test(value.text)) return deny("--write-out from a file is not allowed");
    if (/output\s*\{|header\s*\{/i.test(value.text))
      return deny("--write-out %output{}/%header{} directives are not allowed");
    return null;
  }
  if (flag === "--url") {
    urls.push(value.text);
    return null;
  }
  return null;
}

function gateCurl(args: Token[]): GateDecision {
  const urls: string[] = [];
  let endOfOptions = false;
  for (let i = 0; i < args.length; i++) {
    const t = args[i]!;
    const text = t.text;
    if (endOfOptions || !text.startsWith("-")) {
      if (t.expansions.length > 0)
        return deny("environment variables may only be expanded inside a -H header value");
      if (text === "-") return deny("reading from stdin is not allowed");
      urls.push(text);
      continue;
    }
    if (text === "--") {
      endOfOptions = true;
      continue;
    }
    if (text.startsWith("--")) {
      if (text.includes("=")) return deny(`curl flag ${text.split("=")[0]}= form is not allowed`);
      if (CURL_DENY_LONG.has(text) || text.startsWith("--trace") || text.startsWith("--proxy"))
        return deny(`curl flag ${text} is not allowed`);
      if (t.expansions.length > 0)
        return deny("environment variables may only be expanded inside a -H header value");
      if (CURL_NOVALUE_LONG.has(text)) continue;
      if (CURL_VALUE_LONG.has(text)) {
        const v = args[++i];
        if (!v) return deny(`curl flag ${text} needs a value`);
        const bad = validateCurlValue(text, v, urls);
        if (bad) return bad;
        continue;
      }
      return deny(`curl flag ${text} is not allowed`);
    }
    // short cluster, e.g. -sS, -sL, -H"…", -XPOST
    const letters = text.slice(1);
    if (letters.length === 0) return deny("reading from stdin is not allowed");
    for (let k = 0; k < letters.length; k++) {
      const ch = letters[k]!;
      if (CURL_DENY_SHORT.has(ch)) return deny(`curl flag -${ch} is not allowed`);
      if (CURL_NOVALUE_SHORT.has(ch)) continue;
      if (CURL_VALUE_SHORT.has(ch)) {
        const flag = `-${ch}`;
        const attached = letters.slice(k + 1);
        let v: Token | undefined;
        if (attached.length > 0) {
          v = { text: attached, expansions: t.expansions };
        } else {
          if (t.expansions.length > 0)
            return deny("environment variables may only be expanded inside a -H header value");
          v = args[++i];
          if (!v) return deny(`curl flag ${flag} needs a value`);
        }
        const bad = validateCurlValue(flag, v, urls);
        if (bad) return bad;
        break;
      }
      return deny(`curl flag -${ch} is not allowed`);
    }
  }
  if (urls.length === 0) return deny("curl needs a URL");
  for (const u of urls) {
    const d = validateCurlUrl(u);
    if (!d.allow) return d;
  }
  return allow("curl to an allowed host");
}

// ---------------------------------------------------------------------------
// filters (read stdin only)
// ---------------------------------------------------------------------------

function noExpansions(seg: Token[], name: string): GateDecision | null {
  return seg.some((t) => t.expansions.length > 0)
    ? deny(`environment variables are not allowed in ${name} arguments`)
    : null;
}

function gateJq(args: Token[], root: string, allowFileArgs: boolean): GateDecision {
  let positionals = 0;
  let namedArgs = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!.text;
    if (a === "--args" || a === "--jsonargs") {
      namedArgs = true;
      continue;
    }
    if (a === "--arg" || a === "--argjson") {
      i += 2;
      continue;
    }
    if (a === "--indent") {
      i += 1;
      continue;
    }
    if (a === "--slurpfile" || a === "--rawfile" || a === "-f" || a === "--from-file") {
      const file = a === "-f" || a === "--from-file" ? args[i + 1] : args[i + 2];
      if (a === "-f" || a === "--from-file") i += 1;
      else i += 2;
      if (!allowFileArgs || !file || !isInsideRoot(root, file.text))
        return deny("jq may only read files inside the plugin directory");
      continue;
    }
    if (a === "-L") return deny("jq -L is not allowed");
    if (a.startsWith("-") && a !== "-") continue; // other flags (-r -c -s -n -e -S -R -j -a …)
    positionals++;
    if (positionals > 1 && !namedArgs) {
      if (!allowFileArgs || !isInsideRoot(root, a))
        return deny("jq may only read files inside the plugin directory");
    }
  }
  return allow("jq");
}

const GREP_DENY = new Set([
  "-r",
  "-R",
  "--recursive",
  "--dereference-recursive",
  "-f",
  "--file",
  "--include",
  "--exclude",
  "--exclude-dir",
  "--exclude-from",
  "-d",
  "--directories",
  "--devices",
  "-D",
  "--pre", // rg: run a preprocessor command
  "--pre-glob",
  "--ignore-file",
  "--search-zip",
  "-z", // rg -z / --search-zip
]);
const GREP_VALUE = new Set([
  "-e",
  "--regexp",
  "-A",
  "--after-context",
  "-B",
  "--before-context",
  "-C",
  "--context",
  "-m",
  "--max-count",
  "--color",
  "--colour",
  "--label",
  "-t",
  "--type",
  "-g",
  "--glob",
]);
/** Short grep/rg flags that take a value (possibly glued: `-e<pat>`, `-m5`, `-A2`). */
const GREP_VALUE_SHORT = new Set(["e", "A", "B", "C", "m", "t", "g"]);
const GREP_DENY_SHORT = new Set(["r", "R", "f", "d", "D", "z"]);

/**
 * GNU getopt_long accepts any unambiguous prefix of a long option (`--fil=` == `--file=`), so a
 * denied long option must also be denied in every abbreviated spelling.
 */
function isAbbreviatedDeniedLong(base: string, denied: Set<string>): boolean {
  if (!base.startsWith("--") || base.length < 3) return false;
  for (const d of denied) if (d.startsWith("--") && d.startsWith(base)) return true;
  return false;
}

function gateGrep(args: Token[]): GateDecision {
  let positionals = 0;
  let patternGiven = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!.text;
    if (a === "--") {
      // remaining are positionals
      for (let k = i + 1; k < args.length; k++) positionals++;
      break;
    }
    if (a === "-") return deny("grep '-' is not allowed");
    if (a.startsWith("--")) {
      const base = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
      if (GREP_DENY.has(base) || isAbbreviatedDeniedLong(base, GREP_DENY))
        return deny(`grep flag ${base} is not allowed`);
      if (GREP_VALUE.has(base)) {
        if (base === "--regexp") patternGiven = true;
        if (!a.includes("=")) i += 1;
      }
      continue;
    }
    if (a.startsWith("-")) {
      // short cluster: `-in`, `-ie pat`, `-e<pat>`, `-m5`, `-A2`
      const letters = a.slice(1);
      for (let k = 0; k < letters.length; k++) {
        const ch = letters[k]!;
        if (GREP_DENY_SHORT.has(ch)) return deny(`grep flag -${ch} is not allowed`);
        if (GREP_VALUE_SHORT.has(ch)) {
          if (ch === "e") patternGiven = true;
          const attached = letters.slice(k + 1);
          if (attached.length === 0) i += 1; // value is the next token
          break;
        }
      }
      continue;
    }
    positionals++;
  }
  const allowedPositionals = patternGiven ? 0 : 1;
  if (positionals > allowedPositionals) return deny("grep may only read stdin (no file arguments)");
  if (positionals < allowedPositionals) return deny("grep needs a pattern");
  return allow("grep");
}

function gateHeadTail(name: string, args: Token[]): GateDecision {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!.text;
    if (/^-\d+$/.test(a)) continue; // head -5
    if (/^-[nc]\d+$/.test(a)) continue; // head -n20
    if (a === "-n" || a === "-c") {
      const v = args[++i]?.text;
      if (!v || !/^[+-]?\d+[kKmMgG]?$/.test(v)) return deny(`${name} ${a} needs a number`);
      continue;
    }
    if (
      a === "-q" ||
      a === "--quiet" ||
      a === "--silent" ||
      a === "-z" ||
      a === "--zero-terminated"
    )
      continue;
    if (a.startsWith("--lines=") || a.startsWith("--bytes=")) continue;
    return deny(`${name} may only read stdin (no file arguments)`);
  }
  return allow(name);
}

const SORT_DENY_LONG = new Set([
  "--output",
  "--temporary-directory",
  "--files0-from",
  "--compress-program",
  "--random-source",
  "--debug",
]);
/** Short sort flags that take a value (possibly glued: `-k2`, `-t,`). */
const SORT_VALUE_SHORT = new Set(["k", "t", "S"]);
/** Short sort flags that name a file / directory. */
const SORT_DENY_SHORT = new Set(["o", "T"]);

function gateSort(args: Token[]): GateDecision {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!.text;
    if (a === "-" || a === "--") return deny("sort may only read stdin (no file arguments)");
    if (a.startsWith("--")) {
      const base = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
      if (SORT_DENY_LONG.has(base) || isAbbreviatedDeniedLong(base, SORT_DENY_LONG))
        return deny("sort may not write files");
      if (
        !a.includes("=") &&
        (base === "--key" ||
          base === "--field-separator" ||
          base === "--buffer-size" ||
          base === "--parallel")
      )
        i += 1;
      continue;
    }
    if (a.startsWith("-")) {
      // short cluster: `-u`, `-rn`, `-k2`, `-o<file>`, `-uo<file>`
      const letters = a.slice(1);
      for (let k = 0; k < letters.length; k++) {
        const ch = letters[k]!;
        if (SORT_DENY_SHORT.has(ch)) return deny("sort may not write files");
        if (SORT_VALUE_SHORT.has(ch)) {
          if (letters.slice(k + 1).length === 0) i += 1;
          break;
        }
      }
      continue;
    }
    return deny("sort may only read stdin (no file arguments)");
  }
  return allow("sort");
}

function gateUniqWc(name: string, args: Token[]): GateDecision {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!.text;
    // `--files0-from=F` (and any GNU abbreviation of it, e.g. `--files0=F`) reads file names from F
    if (/^--files0/.test(a)) return deny(`${name} --files0-from is not allowed`);
    if (a === "-" || a === "--") return deny(`${name} may only read stdin (no file arguments)`);
    if (name === "uniq" && (a === "-f" || a === "-s" || a === "-w")) {
      i += 1;
      continue;
    }
    if (a.startsWith("-") && a.length > 1) continue;
    return deny(`${name} may only read stdin (no file arguments)`);
  }
  return allow(name);
}

function gatePython(args: Token[]): GateDecision {
  if (args.length < 2 || args[0]!.text !== "-m" || args[1]!.text !== "json.tool")
    return deny("python3 is only allowed as `python3 -m json.tool`");
  for (let i = 2; i < args.length; i++) {
    const a = args[i]!.text;
    if (
      a === "--sort-keys" ||
      a === "--no-ensure-ascii" ||
      a === "--compact" ||
      a === "--json-lines" ||
      a === "--tab" ||
      a === "--no-indent"
    )
      continue;
    if (a === "--indent") {
      const v = args[++i]?.text;
      if (!v || !/^\d+$/.test(v)) return deny("--indent needs a number");
      continue;
    }
    if (a.startsWith("--indent=")) continue;
    return deny("json.tool may only read stdin (no file arguments)");
  }
  return allow("python3 -m json.tool");
}

function gateEcho(args: Token[]): GateDecision {
  // A literal echo (no expansions — enforced by the caller) feeding jq is what several skills do.
  for (const a of args)
    if (a.text.startsWith("-") && !/^-[neE]+$/.test(a.text)) return deny("echo flag not allowed");
  return allow("echo of a literal");
}

const FILTERS = new Set(["jq", "head", "tail", "sort", "uniq", "wc", "grep", "rg", "python3"]);

function gateSegment(seg: Token[], index: number, root: string): GateDecision {
  const cmd = seg[0]!;
  if (cmd.expansions.length > 0 || cmd.text.includes("/"))
    return deny("command name must be a bare allowed program");
  const name = cmd.text;
  const args = seg.slice(1);
  if (index === 0) {
    if (name === "curl") return gateCurl(args);
    if (name === "echo") return noExpansions(args, "echo") ?? gateEcho(args);
    if (name === "jq") return noExpansions(args, "jq") ?? gateJq(args, root, true);
    return deny(
      `command '${name}' is not allowed (only curl, optionally piped into jq/head/tail/sort/uniq/wc/grep)`,
    );
  }
  if (!FILTERS.has(name)) return deny(`'${name}' is not an allowed pipeline filter`);
  const bad = noExpansions(args, name);
  if (bad) return bad;
  switch (name) {
    case "jq":
      return gateJq(args, root, true);
    case "grep":
    case "rg":
      return gateGrep(args);
    case "head":
    case "tail":
      return gateHeadTail(name, args);
    case "sort":
      return gateSort(args);
    case "uniq":
    case "wc":
      return gateUniqWc(name, args);
    case "python3":
      return gatePython(args);
    default:
      return deny(`'${name}' is not an allowed pipeline filter`);
  }
}

/** Pure Bash policy: returns the decision for one `command` string. Exported for tests. */
export function gateBashCommand(
  command: unknown,
  root: string = defaultPluginRoot(),
): GateDecision {
  if (typeof command !== "string") return deny("Bash needs a command string");
  if (command.trim().length === 0) return deny("empty command");
  if (command.length > MAX_COMMAND_LENGTH) return deny("command too long");
  if (command.includes("\0")) return deny("NUL byte in command");
  const parsed = tokenize(command);
  if (!parsed.ok) return deny(parsed.reason);
  for (let i = 0; i < parsed.segments.length; i++) {
    const d = gateSegment(parsed.segments[i]!, i, root);
    if (!d.allow) return d;
  }
  return allow(parsed.segments.length === 1 ? "single allowed command" : "allowed pipeline");
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** The policy. Deny by default; see the file header for the allow rules. */
export function gateDecision(
  toolName: string,
  input: Record<string, unknown>,
  opts: GateOptions = {},
): GateDecision {
  const root = opts.pluginRoot ?? defaultPluginRoot();
  const safeInput = input && typeof input === "object" ? input : {};
  if (typeof toolName !== "string" || toolName.length === 0) return deny("missing tool name");
  if (DENIED_TOOLS.includes(toolName)) return deny(`${toolName} is not available in the ask lane`);
  switch (toolName) {
    case "Read":
    case "Glob":
    case "Grep":
      return gateFileTool(toolName, safeInput, root);
    case "Skill": {
      const skill = safeInput.skill ?? safeInput.name ?? safeInput.command;
      if (typeof skill === "string" && isPrunedSkill(skill))
        return deny("that skill is not available in the ask lane");
      return allow("Skill");
    }
    case "Bash":
      return gateBashCommand(safeInput.command, root);
    default:
      if (parseMcpToolName(toolName)) {
        return isKeptMcpTool(toolName)
          ? allow("kept MCP server")
          : deny("that MCP server is not available in the ask lane");
      }
      return deny(`${toolName} is not available in the ask lane`);
  }
}

export interface MakeCanUseToolOptions extends GateOptions {
  /** Observability hook (tool name + decision only — never the input). */
  onDecision?: (toolName: string, decision: GateDecision) => void;
}

/** Build the SDK `canUseTool` callback from the pure policy. */
export function makeCanUseTool(opts: MakeCanUseToolOptions = {}): CanUseTool {
  const root = opts.pluginRoot ?? defaultPluginRoot();
  return async (toolName, input): Promise<PermissionResult> => {
    const d = gateDecision(toolName, input, { pluginRoot: root });
    opts.onDecision?.(toolName, d);
    return d.allow ? { behavior: "allow" } : { behavior: "deny", message: d.reason };
  };
}
