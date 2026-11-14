// Built-in static checks that work on top of the workspace index, without a Pluto compiler:
// broken `require` paths, calls with too few arguments and problems in module manifests (info.json).
// Free of VS Code dependencies so it can be unit-tested with plain Node.

"use strict";

const { tokenize, RESERVED } = require("./parser");
const builtins = require("./builtins");
const { normalizePath } = require("./workspaceIndex");

/**
 * @typedef {{ line: number, col: number, endLine: number, endCol: number, severity: "error"|"warning", message: string, code: string }} LintProblem
 */

/**
 * Candidate paths (without workspace prefix) a module name may refer to.
 * @param {string} moduleName
 * @returns {string[]}
 */
function moduleCandidates(moduleName)
{
	const rel = normalizePath(moduleName).replace(/\.(pluto|lua)$/i, "").replace(/^\.\//, "");
	const variants = rel.includes("/") ? [rel] : [rel.replace(/\./g, "/"), rel];
	const out = [];
	for (const v of new Set(variants))
	{
		out.push(v + ".pluto", v + ".lua", v + "/init.pluto", v + "/init.lua");
	}
	return out;
}

/**
 * Checks a Pluto/Lua source file.
 * @param {string} text
 * @param {import("./workspaceIndex").FileRecord} file Up-to-date index record of the file.
 * @param {import("./analysis").Analyzer} analyzer
 * @param {{ exists?: (path: string) => boolean, searchDirs?: string[], requires?: boolean, calls?: boolean }} [options]
 *   `exists` / `searchDirs`: file system fallback for `require` targets that are not indexed.
 * @returns {LintProblem[]}
 */
function lintSource(text, file, analyzer, options)
{
	options = options || {};
	const out = [];
	if (options.requires !== false)
	{
		lintRequires(file, analyzer.index, options, out);
	}
	if (options.calls !== false)
	{
		lintCalls(text, file, analyzer, out);
	}
	return out;
}

function lintRequires(file, index, options, out)
{
	const fileDir = file.path.replace(/\/[^/]*$/, "");
	for (const req of file.requires || [])
	{
		const name = req.module;
		if (!name || /^pluto:/i.test(name) || builtins.libForModule(name) || /[?*]/.test(name))
		{
			continue;
		}
		if (index.resolveModule(name, file.path))
		{
			continue;
		}
		if (options.exists)
		{
			const dirs = [fileDir, ...(options.searchDirs || [])];
			const candidates = moduleCandidates(name);
			if (dirs.some(dir => candidates.some(c => options.exists(dir + "/" + c))))
			{
				continue;
			}
		}
		out.push({
			line: req.line,
			col: req.col !== undefined ? req.col : 0,
			endLine: req.line,
			endCol: req.endCol !== undefined ? req.endCol : 0,
			severity: "warning",
			message: "Module '" + name + "' not found: no matching .pluto or .lua file in the workspace.",
			code: "missing-module",
		});
	}
}

/**
 * Number of parameters a declaration requires, counting `self` of `:` methods.
 */
function requiredParams(sym)
{
	let n = 0;
	let counted = 0;
	for (const p of sym.params)
	{
		++counted;
		if (!(p.optional || p.vararg || p.name == "..." || p.default !== undefined))
		{
			n = counted; // a required parameter after optional ones makes those required too
		}
	}
	return n + (sym.sep == ":" ? 1 : 0);
}

function lintCalls(text, file, analyzer, out)
{
	const tokens = tokenize(text);
	const isP = (idx, v) => tokens[idx] !== undefined && tokens[idx].t == "p" && tokens[idx].v == v;
	const isId = (idx) => tokens[idx] !== undefined && tokens[idx].t == "id";
	for (let i = 1; i < tokens.length; ++i)
	{
		if (!isP(i, "(") || !isId(i - 1))
		{
			continue;
		}
		// Read the callee chain backwards: a.b.c / a.b:c
		const parts = [tokens[i - 1].v];
		const seps = [];
		let j = i - 1;
		while (j >= 2 && (isP(j - 1, ".") || isP(j - 1, ":") || isP(j - 1, "?.")) && isId(j - 2))
		{
			seps.unshift(tokens[j - 1].v == ":" ? ":" : ".");
			parts.unshift(tokens[j - 2].v);
			j -= 2;
		}
		const before = tokens[j - 1];
		if (before && before.t == "p" && (before.v == "." || before.v == ":" || before.v == "?." || before.v == "::"))
		{
			continue; // complex receiver: f().x(), t[1].x() …
		}
		if (before && before.t == "id" && (before.v == "function" || before.v == "class" || before.v == "extends"))
		{
			continue; // a declaration, not a call
		}
		const isNew = !!(before && before.t == "id" && before.v == "new");
		const head = parts[0];
		if (RESERVED.has(head) && head != "self" && head != "parent")
		{
			continue;
		}
		if (parts.slice(1).some(p => RESERVED.has(p) && p != "new"))
		{
			continue;
		}
		const args = countArgs(tokens, i);
		if (!args || args.open)
		{
			continue; // unbalanced, or the last argument may expand to several values
		}
		const lastSep = seps.length ? seps[seps.length - 1] : null;
		const candidates = calleeCandidates(analyzer, file, tokens[i].line, parts, isNew);
		if (!candidates.length)
		{
			continue;
		}
		const provided = args.count + (lastSep == ":" || isNew ? 1 : 0);
		const needed = Math.min(...candidates.map(requiredParams));
		if (provided >= needed)
		{
			continue;
		}
		const sym = candidates[0];
		const missing = sym.params.filter(p => !(p.optional || p.vararg || p.name == "..." || p.default !== undefined)).map(p => p.name);
		const display = isNew ? "new " + parts.join(".") : parts.slice(0, -1).map((p, k) => p + seps[k]).join("") + parts[parts.length - 1];
		const shownNeeded = needed - (lastSep == ":" || isNew ? 1 : 0);
		const start = tokens[isNew ? j - 1 : j];
		const end = tokens[args.close];
		out.push({
			line: start.line,
			col: start.col,
			endLine: end.line,
			endCol: end.col + 1,
			severity: "warning",
			message: "'" + display + "' expects at least " + shownNeeded + " argument" + (shownNeeded == 1 ? "" : "s")
				+ " but got " + args.count + "." + (missing.length ? " Required: " + missing.join(", ") + "." : ""),
			code: "missing-arguments",
		});
	}
}

/**
 * Counts the arguments of the call whose `(` is at token `open`.
 * `open: true` means the count is only a lower bound (last argument is `...` or a call).
 * @returns {{ count: number, close: number, open: boolean }|null}
 */
function countArgs(tokens, open)
{
	let depth = 0;
	let count = 0;
	let any = false;
	let argStart = open + 1;
	for (let k = open; k < tokens.length; ++k)
	{
		const t = tokens[k];
		if (t.t != "p")
		{
			if (depth == 1)
			{
				any = true;
			}
			continue;
		}
		if (t.v == "(" || t.v == "{" || t.v == "[")
		{
			if (depth >= 1)
			{
				any = true;
			}
			++depth;
		}
		else if (t.v == ")" || t.v == "}" || t.v == "]")
		{
			if (--depth == 0)
			{
				if (t.v != ")")
				{
					return null;
				}
				if (any)
				{
					++count;
				}
				return { count, close: k, open: any && lastArgExpands(tokens, argStart, k) };
			}
		}
		else if (depth == 1 && t.v == ",")
		{
			++count;
			any = false;
			argStart = k + 1;
		}
		else if (depth == 1)
		{
			any = true;
		}
		if (depth <= 0)
		{
			return null;
		}
	}
	return null;
}

// Whether an argument expression (tokens [from, to)) may produce several values: `...` or a call.
function lastArgExpands(tokens, from, to)
{
	const last = tokens[to - 1];
	if (!last)
	{
		return false;
	}
	if (last.t == "p" && last.v == "...")
	{
		return true;
	}
	if (last.t == "p" && last.v == ")")
	{
		// `(expr)` truncates to one value; `f(x)` doesn't.
		let depth = 0;
		for (let k = to - 1; k >= from; --k)
		{
			const t = tokens[k];
			if (t.t == "p" && (t.v == ")" || t.v == "]" || t.v == "}"))
			{
				++depth;
			}
			else if (t.t == "p" && (t.v == "(" || t.v == "[" || t.v == "{") && --depth == 0)
			{
				return k > from && (tokens[k - 1].t == "id" || (tokens[k - 1].t == "p" && (tokens[k - 1].v == ")" || tokens[k - 1].v == "]")));
			}
		}
		return true;
	}
	// f "str" / f { table } as the last argument
	if (last.t == "str" || (last.t == "p" && last.v == "}"))
	{
		const k = last.t == "str" ? to - 2 : -1;
		if (k >= from && tokens[k].t == "id" && !RESERVED.has(tokens[k].v))
		{
			return true;
		}
		if (last.v == "}")
		{
			return true; // be conservative with `f { ... }`
		}
	}
	return false;
}

/**
 * Declarations a call certainly refers to. Ambiguous or guessed callees yield nothing,
 * so that only reliable problems are reported.
 */
function calleeCandidates(analyzer, file, line, parts, isNew)
{
	const name = parts[parts.length - 1];
	const isFunc = (s) => Array.isArray(s.params) && (s.kind == "function" || s.kind == "method" || s.kind == "field" || s.kind == "variable");
	let symbols;
	if (parts.length == 1)
	{
		const local = analyzer.visibleLocals(file, line).get(name);
		if (local)
		{
			symbols = [local];
		}
		else
		{
			symbols = analyzer.index.lookup(name).filter(s => (!s.local || s.file === file) && !s.container);
		}
	}
	else
	{
		const target = analyzer.resolveReceiver(file, line, parts.slice(0, -1));
		if (target.moduleFile)
		{
			symbols = analyzer.index.moduleExports(target.moduleFile).filter(s => s.name == name);
		}
		else if (target.container && !target.weak && !target.unknown)
		{
			symbols = analyzer.membersOf(target.container, file).filter(s => s.name == name && (!s.local || s.file === file));
		}
		else
		{
			return [];
		}
	}
	if (!symbols.length)
	{
		return [];
	}
	if (isNew)
	{
		const ctors = [];
		for (const sym of symbols)
		{
			if (sym.kind != "class")
			{
				return [];
			}
			const ctor = analyzer.membersOf(sym.name, sym.file).find(s => s.name == "__construct");
			if (!ctor || !Array.isArray(ctor.params))
			{
				return []; // default constructor: accepts anything
			}
			ctors.push(Object.assign({}, ctor, { sep: ":" }));
		}
		return ctors;
	}
	// Every candidate must be a known function; anything else (a class, a table, a parameter) is skipped.
	return symbols.every(isFunc) ? symbols : [];
}

// ---------------------------------------------------------------------------------------------
// Module manifests (info.json)
// ---------------------------------------------------------------------------------------------

/**
 * Line/column of an offset in a text.
 */
function positionAt(text, offset)
{
	let line = 0;
	let lineStart = 0;
	for (let i = 0; i < offset && i < text.length; ++i)
	{
		if (text.charCodeAt(i) == 10)
		{
			++line;
			lineStart = i + 1;
		}
	}
	return { line, col: offset - lineStart };
}

function problemAt(text, start, end, severity, message, code)
{
	const a = positionAt(text, start);
	const b = positionAt(text, end);
	return { line: a.line, col: a.col, endLine: b.line, endCol: b.col, severity, message, code };
}

/**
 * Finds the value of a top-level key: offsets of the value (string values include the quotes).
 */
function findKey(text, key)
{
	const re = new RegExp("\"" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\"\\s*:\\s*", "g");
	const m = re.exec(text);
	if (!m)
	{
		return null;
	}
	return { keyStart: m.index, keyEnd: m.index + key.length + 2, valueStart: m.index + m[0].length };
}

/**
 * Whether a parsed info.json looks like a Pluto module manifest (rather than any other info.json).
 */
function isModuleManifest(data, hasSourcesNearby)
{
	if (!data || typeof data != "object" || Array.isArray(data))
	{
		return false;
	}
	return "entry" in data || "dependencies" in data || "main" in data || hasSourcesNearby;
}

/**
 * Checks a module manifest.
 * @param {string} text
 * @param {string} path File system path of the info.json.
 * @param {import("./workspaceIndex").WorkspaceIndex} index
 * @param {{ exists?: (path: string) => boolean, checkDependencies?: boolean }} [options]
 * @returns {LintProblem[]}
 */
function lintManifest(text, path, index, options)
{
	options = options || {};
	const out = [];
	let data;
	try
	{
		data = JSON.parse(text.replace(/^﻿/, ""));
	}
	catch (e)
	{
		return out; // syntax errors are reported by VS Code's JSON support
	}
	const normalized = normalizePath(path);
	const dir = normalized.slice(0, normalized.lastIndexOf("/"));
	const lowerDir = dir.toLowerCase() + "/";
	const hasSourcesNearby = [...index.files.values()].some(f => f.path.toLowerCase().startsWith(lowerDir));
	if (!isModuleManifest(data, hasSourcesNearby))
	{
		return out;
	}
	const firstBrace = Math.max(0, text.indexOf("{"));

	if (typeof data.id != "string" || !data.id.trim())
	{
		const k = findKey(text, "id");
		out.push(k
			? problemAt(text, k.keyStart, k.keyEnd, "error", "'id' must be a non-empty string.", "manifest-id")
			: problemAt(text, firstBrace, firstBrace + 1, "error", "Missing required field 'id'.", "manifest-id"));
	}

	for (const field of ["entry", "main"])
	{
		const value = data[field];
		if (value === undefined)
		{
			continue;
		}
		const k = findKey(text, field);
		const range = k ? valueRange(text, k.valueStart) : { start: firstBrace, end: firstBrace + 1 };
		if (typeof value != "string" || !value.trim())
		{
			out.push(problemAt(text, range.start, range.end, "error", "'" + field + "' must be a path to a .pluto or .lua file.", "manifest-entry"));
			continue;
		}
		const target = dir + "/" + normalizePath(value).replace(/^\.\//, "");
		const lower = target.toLowerCase();
		const indexed = [...index.files.values()].some(f => f.path.toLowerCase() == lower);
		if (!indexed && !(options.exists && options.exists(target)))
		{
			out.push(problemAt(text, range.start, range.end, "error", "Entry file '" + value + "' does not exist.", "manifest-entry"));
		}
	}

	if (options.checkDependencies !== false && data.dependencies !== undefined)
	{
		const known = new Set([...index.manifests.values()].map(m => m.id));
		if (typeof data.id == "string")
		{
			known.add(data.id);
		}
		const k = findKey(text, "dependencies");
		const depsStart = k ? k.valueStart : firstBrace;
		const depsRange = k ? valueRange(text, k.valueStart) : { start: firstBrace, end: firstBrace + 1 };
		let ids = [];
		if (Array.isArray(data.dependencies))
		{
			ids = data.dependencies.map(d => typeof d == "string" ? d : (d && typeof d == "object" && typeof d.id == "string" ? d.id : null));
		}
		else if (data.dependencies && typeof data.dependencies == "object")
		{
			ids = Object.keys(data.dependencies);
		}
		else
		{
			out.push(problemAt(text, depsRange.start, depsRange.end, "error", "'dependencies' must be an array of module ids.", "manifest-dependencies"));
		}
		let searchFrom = depsStart;
		for (const id of ids)
		{
			if (id === null)
			{
				continue;
			}
			const quoted = JSON.stringify(id);
			let at = text.indexOf(quoted, searchFrom);
			if (at == -1 || at > depsRange.end)
			{
				at = -1;
			}
			else
			{
				searchFrom = at + quoted.length;
			}
			if (!known.has(id))
			{
				out.push(at != -1
					? problemAt(text, at, at + quoted.length, "warning", "Unknown dependency '" + id + "': no info.json with this id in the workspace.", "manifest-dependency")
					: problemAt(text, depsRange.start, depsRange.end, "warning", "Unknown dependency '" + id + "': no info.json with this id in the workspace.", "manifest-dependency"));
			}
		}
	}
	return out;
}

/**
 * Offsets of the JSON value starting at `start` (string, array, object or scalar).
 */
function valueRange(text, start)
{
	const c = text[start];
	if (c == "\"")
	{
		let i = start + 1;
		while (i < text.length && text[i] != "\"")
		{
			i += text[i] == "\\" ? 2 : 1;
		}
		return { start, end: Math.min(text.length, i + 1) };
	}
	if (c == "[" || c == "{")
	{
		let depth = 0;
		let inString = false;
		for (let i = start; i < text.length; ++i)
		{
			const ch = text[i];
			if (inString)
			{
				if (ch == "\\")
				{
					++i;
				}
				else if (ch == "\"")
				{
					inString = false;
				}
			}
			else if (ch == "\"")
			{
				inString = true;
			}
			else if (ch == "[" || ch == "{")
			{
				++depth;
			}
			else if ((ch == "]" || ch == "}") && --depth == 0)
			{
				return { start, end: i + 1 };
			}
		}
		return { start, end: text.length };
	}
	const m = /^[^,}\]\s]*/.exec(text.slice(start));
	return { start, end: start + Math.max(1, m[0].length) };
}

module.exports = { lintSource, lintManifest, moduleCandidates, countArgs, requiredParams };
