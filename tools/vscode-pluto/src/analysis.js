// Name & type resolution on top of the workspace index and the built-in library tables.
// Free of VS Code dependencies so it can be unit-tested with plain Node.

"use strict";

const { tokenize } = require("./parser");
const builtins = require("./builtins");

const IDENT = "[A-Za-z_\\u0080-\\uFFFF][A-Za-z0-9_\\u0080-\\uFFFF]*";
const CHAIN_BEFORE = new RegExp("((?:" + IDENT + "\\s*(?:\\?\\.|\\.|:)\\s*)*)(" + IDENT + ")?$");
const IDENT_CHAR = /[A-Za-z0-9_\u0080-\uFFFF]/;

/**
 * Splits `a.b:c` into its parts and separators.
 */
function splitChain(text)
{
	const parts = [];
	const seps = [];
	const re = new RegExp("(" + IDENT + ")\\s*(\\?\\.|\\.|:)?", "g");
	let m;
	while ((m = re.exec(text)) !== null)
	{
		parts.push(m[1]);
		if (m[2])
		{
			seps.push(m[2] == "?." ? "." : m[2]);
		}
	}
	return { parts, seps };
}

/**
 * The (possibly incomplete) member expression ending at the cursor, for completion.
 * `foo.bar:ba|` → { receiver: ["foo", "bar"], seps: [".", ":"], prefix: "ba" }
 * @param {string} lineText
 * @param {number} col
 */
function chainBefore(lineText, col)
{
	const m = CHAIN_BEFORE.exec(lineText.slice(0, col));
	if (!m)
	{
		return { receiver: [], seps: [], prefix: "" };
	}
	const { parts, seps } = splitChain(m[1]);
	return { receiver: parts, seps, prefix: m[2] || "" };
}

/**
 * The member expression under the cursor, up to and including the word the cursor is on.
 * Hovering `bar` in `foo.bar:baz()` → { parts: ["foo", "bar"], seps: ["."], start, end }
 * @param {string} lineText
 * @param {number} col
 */
function chainAt(lineText, col)
{
	let start = col;
	let end = col;
	while (start > 0 && IDENT_CHAR.test(lineText[start - 1]))
	{
		--start;
	}
	while (end < lineText.length && IDENT_CHAR.test(lineText[end]))
	{
		++end;
	}
	if (start == end || /[0-9]/.test(lineText[start]))
	{
		return null;
	}
	const before = chainBefore(lineText, start);
	if (before.prefix)
	{
		return null;
	}
	return {
		parts: [...before.receiver, lineText.slice(start, end)],
		seps: before.seps,
		start,
		end,
		word: lineText.slice(start, end),
		// `new Foo(...)`: hovering Foo should describe the constructor's class.
		lastSep: before.seps.length ? before.seps[before.seps.length - 1] : null,
	};
}

/**
 * If the cursor is inside the string of a `require`, returns the module name and its range.
 * @param {string} lineText
 * @param {number} col
 */
function requireAt(lineText, col)
{
	const re = /\brequire\s*\(?\s*(["'])([^"']*)\1?/g;
	let m;
	while ((m = re.exec(lineText)) !== null)
	{
		const start = m.index + m[0].indexOf(m[1]) + 1;
		const end = start + m[2].length;
		if (col >= start && col <= end)
		{
			return { module: m[2], start, end };
		}
	}
	return null;
}

function normalizeType(type)
{
	if (!type)
	{
		return null;
	}
	const candidates = type.replace(/[?()]/g, "").split("|").map(s => s.trim()).filter(s => s && s != "nil" && s != "void");
	return candidates.length ? candidates[0] : null;
}

const PRIMITIVE_LIBS = { string: "string", table: "table" };

class Analyzer
{
	/**
	 * @param {import("./workspaceIndex").WorkspaceIndex} index
	 */
	constructor(index)
	{
		this.index = index;
	}

	/**
	 * Local variables, parameters and local functions visible at a line of a file.
	 * Later declarations shadow earlier ones.
	 * @param {import("./workspaceIndex").FileRecord} file
	 * @param {number} line
	 * @returns {Map<string, import("./workspaceIndex").IndexedSymbol>}
	 */
	visibleLocals(file, line)
	{
		const out = new Map();
		if (!file)
		{
			return out;
		}
		for (const sym of file.symbols)
		{
			if (!sym.local || sym.scopeStart === undefined || sym.scopeStart > line || sym.scopeEnd < line)
			{
				continue;
			}
			const prev = out.get(sym.name);
			if (!prev || prev.scopeStart <= sym.scopeStart)
			{
				out.set(sym.name, sym);
			}
		}
		return out;
	}

	/**
	 * The class that `self` refers to at the given line.
	 */
	enclosingClass(file, line)
	{
		let best = null;
		for (const sym of file ? file.symbols : [])
		{
			if (sym.line > line || sym.endLine < line)
			{
				continue;
			}
			const name = sym.kind == "class" ? sym.name
				: (sym.kind == "method" && sym.container && (sym.sep == ":" || !sym.static)) ? sym.container
				: null;
			if (name && (!best || sym.line >= best.line))
			{
				best = { name, line: sym.line };
			}
		}
		return best ? best.name : null;
	}

	/**
	 * Members of a container as seen from a file. If the file declares its own local with that
	 * name, same-named containers of other files are not mixed in.
	 */
	membersOf(container, file)
	{
		const all = this.index.members(container, file);
		if (file)
		{
			const head = container.split(".")[0];
			if (file.symbols.some(s => s.local && s.name == head && !s.container && s.kind != "parameter"))
			{
				const own = all.filter(s => s.file === file);
				if (own.length)
				{
					return own;
				}
			}
		}
		return all;
	}

	/**
	 * Resolves the receiver of a member access to something members can be listed for.
	 * @param {import("./workspaceIndex").FileRecord} file
	 * @param {number} line
	 * @param {string[]} parts
	 * @returns {{ container?: string, lib?: string, moduleFile?: import("./workspaceIndex").FileRecord, unknown?: boolean }}
	 */
	resolveReceiver(file, line, parts)
	{
		if (!parts.length)
		{
			return { unknown: true };
		}
		const head = parts[0];
		/** @type {{ container?: string, lib?: string, moduleFile?: any, unknown?: boolean }} */
		let cur;
		const local = this.visibleLocals(file, line).get(head);
		if (head == "self" && !local)
		{
			const cls = this.enclosingClass(file, line);
			cur = cls ? { container: cls } : { unknown: true };
		}
		else if (head == "parent" && !local)
		{
			const cls = this.enclosingClass(file, line);
			const decl = cls ? this.index.classes(cls)[0] : null;
			cur = decl && decl.extends ? { container: decl.extends } : { unknown: true };
		}
		else if (local)
		{
			cur = this._fromSymbol(local, file) || { container: head, weak: !(local.isTable || local.kind == "class" || local.kind == "enum") };
		}
		else
		{
			const global = this.index.lookup(head).find(s => !s.container && !s.local && (s.type || s.module));
			if (global)
			{
				cur = this._fromSymbol(global, file);
			}
			else if (builtins.libs.has(head) && !this.index.lookup(head).some(s => !s.container && !s.local))
			{
				cur = { lib: head };
			}
			else
			{
				cur = { container: head, weak: !this.index.lookup(head).some(s => !s.container) };
			}
		}

		for (let i = 1; i < parts.length && cur && !cur.unknown; ++i)
		{
			const name = parts[i];
			if (cur.lib)
			{
				cur = builtins.members.has(cur.lib + "." + name) ? { lib: cur.lib + "." + name } : { unknown: true };
				continue;
			}
			const pool = cur.moduleFile ? this.index.moduleExports(cur.moduleFile) : this.membersOf(cur.container, file);
			const member = pool.find(s => s.name == name);
			const typed = member ? this._fromSymbol(member, file) : null;
			if (typed)
			{
				cur = typed;
			}
			else if (cur.container)
			{
				cur = { container: cur.container + "." + name };
			}
			else
			{
				cur = { container: name, weak: true };
			}
		}
		return cur || { unknown: true };
	}

	_fromSymbol(sym, file)
	{
		if (sym.module)
		{
			const lib = builtins.libForModule(sym.module);
			const resolved = this.index.resolveModule(sym.module, file ? file.path : undefined);
			if (resolved && resolved.file)
			{
				return { moduleFile: resolved.file };
			}
			if (lib)
			{
				return { lib };
			}
			return { unknown: true };
		}
		const type = normalizeType(sym.type);
		if (type)
		{
			if (PRIMITIVE_LIBS[type])
			{
				return { lib: PRIMITIVE_LIBS[type], instance: true };
			}
			if (/^(number|int|integer|float|bool|boolean|function|userdata|any)$/.test(type))
			{
				return { unknown: true };
			}
			return { container: type, instance: true };
		}
		return null;
	}

	/**
	 * Lists what can follow `receiver.` or `receiver:`.
	 * @returns {{ symbols: import("./workspaceIndex").IndexedSymbol[], builtins: import("./builtins").Builtin[], guessed: boolean }}
	 */
	completeMembers(file, line, receiverParts, sep)
	{
		const target = this.resolveReceiver(file, line, receiverParts);
		const result = { symbols: [], builtins: [], guessed: false };
		if (target.lib)
		{
			result.builtins = builtins.members.get(target.lib) || [];
			return result;
		}
		if (target.moduleFile)
		{
			result.symbols = this.index.moduleExports(target.moduleFile);
			return result;
		}
		if (target.container)
		{
			result.symbols = this.membersOf(target.container, file).filter(s => !s.local || s.file === file);
		}
		if (!result.symbols.length && (target.unknown || target.weak))
		{
			// We don't know what the receiver is. Strings and tables have default metatables in
			// Pluto, so `value:split(...)` works on any string; offer those plus known methods.
			result.guessed = true;
			if (sep == ":")
			{
				result.builtins = [...(builtins.members.get("string") || []), ...(builtins.members.get("table") || [])];
				const seen = new Set();
				for (const sym of this._allMembers())
				{
					if (sym.kind == "method" && !sym.static && !seen.has(sym.name) && (!sym.local || sym.file === file))
					{
						seen.add(sym.name);
						result.symbols.push(sym);
					}
				}
			}
		}
		return result;
	}

	_allMembers()
	{
		const out = [];
		for (const file of this.index.visibleFiles())
		{
			for (const sym of file.symbols)
			{
				if (sym.container)
				{
					out.push(sym);
				}
			}
		}
		return out;
	}

	/**
	 * Resolves a member expression to its declaration(s) and/or built-in documentation.
	 * @param {import("./workspaceIndex").FileRecord} file
	 * @param {number} line
	 * @param {string[]} parts
	 * @param {{ isNew?: boolean, lastSep?: string }} [opts]
	 * @returns {{ symbols: import("./workspaceIndex").IndexedSymbol[], builtin?: import("./builtins").Builtin, lib?: string, keyword?: { name: string, doc: string } }}
	 */
	resolve(file, line, parts, opts)
	{
		opts = opts || {};
		const name = parts[parts.length - 1];
		const visible = (s) => !s.local || s.file === file;
		const preferOwn = (list) => list.slice().sort((a, b) => (b.file === file) - (a.file === file));

		if (parts.length == 1)
		{
			const local = this.visibleLocals(file, line).get(name);
			if (local)
			{
				return { symbols: [local] };
			}
			if (name == "self" || name == "parent")
			{
				const target = this.resolveReceiver(file, line, [name]);
				if (target.container)
				{
					const cls = this.index.classes(target.container).filter(visible);
					if (cls.length)
					{
						return { symbols: preferOwn(cls) };
					}
				}
			}
			const all = this.index.lookup(name).filter(visible);
			const top = all.filter(s => !s.container || (s.kind == "enumMember" && !s.scoped));
			if (top.length)
			{
				return { symbols: preferOwn(top) };
			}
			const result = { symbols: [] };
			if (builtins.functions.has(name))
			{
				result.builtin = builtins.functions.get(name);
			}
			else if (builtins.libs.has(name))
			{
				result.lib = name;
			}
			else if (builtins.keywordMap.has(name))
			{
				result.keyword = builtins.keywordMap.get(name);
			}
			return result;
		}

		const target = this.resolveReceiver(file, line, parts.slice(0, -1));
		if (target.lib)
		{
			const entry = builtins.functions.get(target.lib + "." + name);
			return { symbols: [], builtin: entry && !entry.table ? entry : undefined };
		}
		if (target.moduleFile)
		{
			return { symbols: this.index.moduleExports(target.moduleFile).filter(s => s.name == name) };
		}
		if (target.container)
		{
			const found = this.membersOf(target.container, file).filter(s => s.name == name && visible(s));
			if (found.length)
			{
				return { symbols: preferOwn(found) };
			}
		}
		// Unknown receiver: fall back to every member with this name.
		const result = { symbols: preferOwn(this.index.lookup(name).filter(s => s.container && visible(s))) };
		if (!result.symbols.length && opts.lastSep == ":")
		{
			result.builtin = builtins.functions.get("string." + name) || builtins.functions.get("table." + name);
		}
		return result;
	}

	/**
	 * What a call expression invokes: the function itself, or a class's constructor for `new`.
	 */
	resolveCallee(file, line, parts, opts)
	{
		opts = opts || {};
		const resolved = this.resolve(file, line, parts, opts);
		const out = { symbols: [], builtin: resolved.builtin };
		for (const sym of resolved.symbols)
		{
			if (sym.kind == "class")
			{
				const ctor = this.membersOf(sym.name, sym.file).find(s => s.name == "__construct");
				if (ctor)
				{
					out.symbols.push(ctor);
				}
			}
			else if (sym.params)
			{
				out.symbols.push(sym);
			}
		}
		return out;
	}
}

/**
 * Finds the call the offset is inside of, and which argument it is at.
 * @param {string} text Source text up to the cursor.
 * @returns {{ parts: string[], seps: string[], isNew: boolean, activeParam: number, line: number }|null}
 */
function findCall(text)
{
	// Bound the work for huge files: start at a line boundary at most ~20k characters back.
	let base = 0;
	if (text.length > 20000)
	{
		base = text.indexOf("\n", text.length - 20000) + 1;
	}
	const tokens = tokenize(base ? text.slice(base) : text);
	/** @type {{ kind: string, idx: number, commas: number }[]} */
	const stack = [];
	for (let i = 0; i < tokens.length; ++i)
	{
		const t = tokens[i];
		if (t.t == "str" && i == tokens.length - 1)
		{
			// An unterminated string at the very end means the cursor is inside of it.
			const raw = text.slice(base + t.off, base + t.end);
			const quote = raw[0];
			if ((quote == "\"" || quote == "'") && (raw.length < 2 || raw[raw.length - 1] != quote || raw[raw.length - 2] == "\\"))
			{
				break;
			}
		}
		if (t.t != "p")
		{
			continue;
		}
		if (t.v == "(" || t.v == "{" || t.v == "[")
		{
			stack.push({ kind: t.v, idx: i, commas: 0 });
		}
		else if (t.v == ")" || t.v == "}" || t.v == "]")
		{
			stack.pop();
		}
		else if (t.v == "," && stack.length)
		{
			++stack[stack.length - 1].commas;
		}
	}
	for (let s = stack.length - 1; s >= 0; --s)
	{
		if (stack[s].kind != "(")
		{
			continue;
		}
		const open = stack[s].idx;
		let j = open - 1;
		if (!tokens[j] || tokens[j].t != "id")
		{
			continue; // parenthesized expression, not a call
		}
		const parts = [tokens[j].v];
		const seps = [];
		while (j >= 2 && tokens[j - 1].t == "p" && (tokens[j - 1].v == "." || tokens[j - 1].v == ":" || tokens[j - 1].v == "?.") && tokens[j - 2].t == "id")
		{
			seps.unshift(tokens[j - 1].v == "?." ? "." : tokens[j - 1].v);
			parts.unshift(tokens[j - 2].v);
			j -= 2;
		}
		const before = tokens[j - 1];
		if (before && before.t == "id" && before.v == "function")
		{
			return null; // inside the parameter list of a declaration
		}
		if (parts.length == 1 && /^(if|while|and|or|not|return|elseif|until|in|function|local|for|switch|case)$/.test(parts[0]))
		{
			continue;
		}
		return {
			parts,
			seps,
			isNew: !!before && before.t == "id" && (before.v == "new" || before.v == "pluto_new"),
			activeParam: stack[s].commas,
		};
	}
	return null;
}

module.exports = { Analyzer, chainBefore, chainAt, requireAt, findCall, normalizeType, splitChain };
