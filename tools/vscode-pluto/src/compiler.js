// Finding and running an external Pluto compiler to check code without executing it.
// Uses Node only (no VS Code API), so it can be unit-tested.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const childProcess = require("child_process");

const IS_WINDOWS = process.platform == "win32";

/**
 * Expands `${workspaceFolder}`, `${workspaceFolderBasename}`, `${userHome}`, `${env:NAME}`
 * and a leading `~` in a configured path. Relative paths are taken relative to the first workspace folder.
 * @param {string} value
 * @param {string[]} workspaceFolders File system paths.
 * @returns {string}
 */
function expandPath(value, workspaceFolders)
{
	const ws = workspaceFolders[0] || "";
	let out = value.trim()
		.replace(/\$\{workspaceFolder(?::([^}]+))?\}/g, function (_, name)
		{
			if (name)
			{
				const found = workspaceFolders.find(f => path.basename(f) == name);
				return found || ws;
			}
			return ws;
		})
		.replace(/\$\{workspaceFolderBasename\}/g, ws ? path.basename(ws) : "")
		.replace(/\$\{userHome\}/g, os.homedir())
		.replace(/\$\{env:([^}]+)\}/g, (_, name) => process.env[name] || "");
	if (out == "~" || out.startsWith("~/") || out.startsWith("~\\"))
	{
		out = path.join(os.homedir(), out.slice(1));
	}
	if (!path.isAbsolute(out) && ws && (out.includes("/") || out.includes("\\")))
	{
		out = path.join(ws, out);
	}
	return out && (path.isAbsolute(out) || /[\\/]/.test(out)) ? path.normalize(out) : out;
}

function isExecutableFile(p)
{
	try
	{
		const stat = fs.statSync(p);
		if (!stat.isFile())
		{
			return false;
		}
		if (!IS_WINDOWS)
		{
			fs.accessSync(p, fs.constants.X_OK);
		}
		return true;
	}
	catch (e)
	{
		return false;
	}
}

const NON_EXECUTABLE_EXT = /\.(pluto|lua|luac|dll|so|dylib|a|lib|h|hpp|c|cpp|txt|md|json|zip|gz|tar|7z|pdb|exp|ilk|obj|o|sh|bat|cmd|ps1|ico|png)$/i;

/**
 * Whether a file name looks like a Pluto compiler/interpreter binary, e.g. `plutoc.exe`, `pluto`, `pluto-linux-x64`.
 */
function isCompilerName(name)
{
	if (!/^plutoc?(?:$|[-_.])/i.test(name) || NON_EXECUTABLE_EXT.test(name))
	{
		return false;
	}
	if (IS_WINDOWS)
	{
		return /\.exe$/i.test(name);
	}
	return true;
}

/**
 * Parses the last version number found in a path, e.g. "pluto/0.10.1/plutoc.exe" → [0, 10, 1].
 */
function versionOf(p)
{
	const matches = normalize(p).match(/\d+(?:\.\d+)+/g);
	return matches ? matches[matches.length - 1].split(".").map(Number) : [];
}

function compareVersions(a, b)
{
	for (let i = 0; i < Math.max(a.length, b.length); ++i)
	{
		const d = (a[i] || 0) - (b[i] || 0);
		if (d)
		{
			return d;
		}
	}
	return 0;
}

function normalize(p)
{
	return p.replace(/\\/g, "/");
}

const TOP_DIRS = /^(bin|tools|vendor|deps|third_party|thirdparty|external|libs?|sdk|\.pluto|pluto.*)$/i;
const SKIP_DIRS = /^(node_modules|\.git|\.vs|\.vscode|\.idea|obj|__pycache__)$/i;

/**
 * Searches a workspace folder for a local Pluto compiler, e.g. `pluto/0.10.1/plutoc.exe`,
 * `tools/pluto/pluto.exe` or `bin/pluto`. Only well-known folders are searched, 4 levels deep at most.
 * @param {string} root
 * @returns {{ path: string, version: number[], mtime: number }[]}
 */
function findLocalCompilers(root)
{
	const found = [];
	let budget = 2000; // directory entries
	const walk = function (dir, depth, inside)
	{
		let entries;
		try
		{
			entries = fs.readdirSync(dir, { withFileTypes: true });
		}
		catch (e)
		{
			return;
		}
		for (const entry of entries)
		{
			if (--budget < 0)
			{
				return;
			}
			const full = path.join(dir, entry.name);
			if (entry.isDirectory())
			{
				if (depth < 4 && !SKIP_DIRS.test(entry.name) && (inside || TOP_DIRS.test(entry.name)))
				{
					walk(full, depth + 1, true);
				}
			}
			else if ((entry.isFile() || entry.isSymbolicLink()) && isCompilerName(entry.name) && isExecutableFile(full))
			{
				let mtime = 0;
				try
				{
					mtime = fs.statSync(full).mtimeMs;
				}
				catch (e) {}
				found.push({ path: full, version: versionOf(path.relative(root, full)), mtime });
			}
		}
	};
	walk(root, 0, false);
	return found;
}

/**
 * Picks the best compiler: `plutoc` (has a parse-only mode) over `pluto`, then the newest version, then the newest file.
 */
function pickBest(list)
{
	const score = (c) => /^plutoc/i.test(path.basename(c.path)) ? 1 : 0;
	return list.slice().sort((a, b) => (score(b) - score(a)) || compareVersions(b.version, a.version) || (b.mtime - a.mtime))[0] || null;
}

/**
 * Looks for `plutoc` / `pluto` on the PATH.
 * @returns {string|null}
 */
function findOnPath(envPath)
{
	const dirs = (envPath !== undefined ? envPath : process.env.PATH || process.env.Path || "").split(path.delimiter).filter(Boolean);
	const exts = IS_WINDOWS ? [".exe", ".com"] : [""];
	for (const name of ["plutoc", "pluto"])
	{
		for (const dir of dirs)
		{
			for (const ext of exts)
			{
				const full = path.join(dir.replace(/^"|"$/g, ""), name + ext);
				if (isExecutableFile(full))
				{
					return full;
				}
			}
		}
	}
	return null;
}

/**
 * Finds the compiler to use.
 * 1. `configured` (pluto.diagnostics.compilerPath), if set and it exists;
 * 2. a compiler inside of one of the workspace folders (only if `allowWorkspace`);
 * 3. `plutoc` / `pluto` on the PATH.
 * @param {{ configured?: string, workspaceFolders: string[], allowWorkspace?: boolean, envPath?: string }} options
 * @returns {{ path: string|null, source: "setting"|"workspace"|"path"|null, problem?: string }}
 */
function findCompiler(options)
{
	let problem;
	const configured = (options.configured || "").trim();
	if (configured)
	{
		const expanded = expandPath(configured, options.workspaceFolders);
		if (!path.isAbsolute(expanded) && !expanded.includes("/") && !expanded.includes("\\"))
		{
			// A bare command name: look it up on the PATH.
			const dirs = (options.envPath !== undefined ? options.envPath : process.env.PATH || "").split(path.delimiter).filter(Boolean);
			for (const dir of dirs)
			{
				for (const ext of IS_WINDOWS && !/\.\w+$/.test(expanded) ? [".exe", ".com"] : [""])
				{
					const full = path.join(dir, expanded + ext);
					if (isExecutableFile(full))
					{
						return { path: full, source: "setting" };
					}
				}
			}
		}
		else if (isExecutableFile(expanded))
		{
			return { path: expanded, source: "setting" };
		}
		problem = "pluto.diagnostics.compilerPath points to '" + expanded + "', which is not an executable file. Falling back to automatic detection.";
	}
	if (options.allowWorkspace !== false)
	{
		const all = [];
		for (const folder of options.workspaceFolders)
		{
			all.push(...findLocalCompilers(folder));
		}
		const best = pickBest(all);
		if (best)
		{
			return { path: best.path, source: "workspace", problem };
		}
	}
	const onPath = findOnPath(options.envPath);
	if (onPath)
	{
		return { path: onPath, source: "path", problem };
	}
	return { path: null, source: null, problem };
}

// Compiles stdin with `load` (which never runs the chunk) and reports the error, for interpreters without a parse-only flag.
const LOAD_ONLY_SCRIPT = "local s=io.read('a') local f,e=load(s,'=stdin') if not f then io.stderr:write(tostring(e),'\\n') os.exit(1) end";

/**
 * Command-line arguments that make the compiler only parse the code from stdin.
 * `plutoc -p -` parses without writing output; the `pluto` interpreter loads the chunk without calling it.
 */
function checkArgs(compilerPath)
{
	return /^plutoc/i.test(path.basename(compilerPath)) ? ["-p", "-"] : ["-e", LOAD_ONLY_SCRIPT];
}

/**
 * Runs the compiler on `text` (via stdin) and returns its combined output.
 * @param {string} compilerPath
 * @param {string} text
 * @param {{ cwd?: string, timeoutMs?: number }} [options]
 * @returns {{ promise: Promise<{ output: string, code: number|null, timedOut: boolean, error?: Error }>, cancel: () => void }}
 */
function runCheck(compilerPath, text, options)
{
	options = options || {};
	const env = Object.assign({}, process.env);
	for (const key of Object.keys(env))
	{
		if (/^LUA_INIT/i.test(key))
		{
			delete env[key]; // would run code before the check
		}
	}
	let child;
	let timer;
	let settled = false;
	const promise = new Promise(function (resolve)
	{
		const chunks = [];
		let size = 0;
		let timedOut = false;
		const finish = function (result)
		{
			if (!settled)
			{
				settled = true;
				clearTimeout(timer);
				resolve(result);
			}
		};
		try
		{
			child = childProcess.spawn(compilerPath, checkArgs(compilerPath), {
				cwd: options.cwd && fs.existsSync(options.cwd) ? options.cwd : undefined,
				env,
				windowsHide: true,
				stdio: ["pipe", "pipe", "pipe"],
			});
		}
		catch (error)
		{
			finish({ output: "", code: null, timedOut: false, error });
			return;
		}
		const collect = function (data)
		{
			if (size < 1024 * 1024)
			{
				chunks.push(data);
				size += data.length;
			}
		};
		child.stdout.on("data", collect);
		child.stderr.on("data", collect);
		child.on("error", error => finish({ output: Buffer.concat(chunks).toString("utf8"), code: null, timedOut, error }));
		child.on("close", code => finish({ output: Buffer.concat(chunks).toString("utf8"), code, timedOut }));
		timer = setTimeout(function ()
		{
			timedOut = true;
			child.kill();
		}, options.timeoutMs || 5000);
		child.stdin.on("error", () => {}); // EPIPE when the process exits early
		child.stdin.end(text, "utf8");
	});
	return {
		promise,
		cancel()
		{
			if (child && !settled)
			{
				settled = true;
				clearTimeout(timer);
				try
				{
					child.kill();
				}
				catch (e) {}
			}
		},
	};
}

/**
 * Turns compiler output into problems. Understands Lua-style messages (`chunk:line: message`),
 * Pluto's `warning:` messages and its source excerpts with `^^^` markers, which give the column.
 * @param {string} output
 * @param {string[]} [lines] Source lines, used to locate `near 'token'` when no column is given.
 * @returns {{ line: number, col: number|null, endCol: number|null, severity: "error"|"warning", message: string }[]}
 */
function parseCompilerOutput(output, lines)
{
	const text = output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "");
	const out = [];
	let current = null;
	let codeLine = null;
	const seen = new Set();
	for (const raw of text.split("\n"))
	{
		const header = /^(?:[\w.-]*plutoc?(?:\.exe)?:\s+)?(.*?):(\d+):\s*(.*)$/i.exec(raw);
		// The chunk name, without a program name prefix such as `D:\pluto\plutoc.exe: `.
		const chunk = header ? header[1].replace(/^.*:\s+/, "").trim() : "";
		if (header && !/^\s*\d*\s*\|/.test(raw) && /^(?:=?stdin|.*\.(?:pluto|lua)|\[string ".*"\])$/i.test(chunk))
		{
			let message = header[3].trim();
			// `Pluto warning: stdin:3: duplicate local declaration [var-shadow]`
			let severity = /\bwarning:\s*[^:]*$/i.test(header[1]) ? "warning" : "error";
			const w = /^warning:\s*(.*)$/i.exec(message);
			if (w)
			{
				severity = "warning";
				message = w[1];
			}
			message = message.replace(/^(?:syntax )?error:\s*/i, (m) => /syntax/i.test(m) ? "syntax error: " : "");
			current = { line: Math.max(0, parseInt(header[2], 10) - 1), col: null, endCol: null, severity, message };
			out.push(current);
			codeLine = null;
			continue;
		}
		if (!current)
		{
			continue;
		}
		const code = /^(\s*\d+\s*\|\s?)(.*)$/.exec(raw);
		if (code)
		{
			codeLine = { prefix: code[1].length, text: code[2] };
			continue;
		}
		const marker = /^(\s*\|\s?)(\s*)(\^+)(?:\s*(.*))?$/.exec(raw);
		if (marker && current.col === null)
		{
			const prefix = codeLine !== null ? codeLine.prefix : marker[1].length;
			let start = marker[1].length + marker[2].length - prefix;
			// The excerpt is printed without indentation: find where it is in the real line.
			const source = lines && lines[current.line];
			if (source !== undefined && codeLine && codeLine.text.trim())
			{
				const at = source.indexOf(codeLine.text.replace(/\s+$/, ""));
				start += at != -1 ? at : source.length - source.replace(/^\s+/, "").length;
			}
			current.col = Math.max(0, start);
			current.endCol = current.col + marker[3].length;
			const note = (marker[4] || "").replace(/^here:\s*/i, "").trim();
			if (note && !current.message.toLowerCase().includes(note.toLowerCase()))
			{
				current.message += " (" + note + ")";
			}
			continue;
		}
		const extra = /^\s*[+-]\s+(note|help|hint):\s*(.*)$/i.exec(raw) || /^\s*(note|help|hint):\s*(.*)$/i.exec(raw);
		if (extra)
		{
			current.message += "\n" + extra[1].toLowerCase() + ": " + extra[2].trim();
		}
	}
	for (const p of out)
	{
		if (p.col === null && lines && lines[p.line] !== undefined)
		{
			const near = /near '(.+?)'/.exec(p.message) || /near "(.+?)"/.exec(p.message);
			if (near && near[1] != "<eof>")
			{
				const idx = lines[p.line].indexOf(near[1]);
				if (idx != -1)
				{
					p.col = idx;
					p.endCol = idx + near[1].length;
				}
			}
		}
	}
	return out.filter(function (p)
	{
		const key = p.line + ":" + p.col + ":" + p.message;
		if (seen.has(key))
		{
			return false;
		}
		seen.add(key);
		return true;
	});
}

module.exports = {
	expandPath,
	findCompiler,
	findLocalCompilers,
	findOnPath,
	pickBest,
	versionOf,
	compareVersions,
	isCompilerName,
	checkArgs,
	runCheck,
	parseCompilerOutput,
};
