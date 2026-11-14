// A tolerant, dependency-free scanner for Pluto & Lua source code.
//
// This is not a full parser: it tokenizes the source and tracks block structure well enough to
// extract declarations (classes, methods, fields, functions, enums, variables) with their scopes.
// It never throws on malformed input, as it runs on every keystroke.

"use strict";

const IDENT_START = /[A-Za-z_\u0080-\uFFFF]/;
const IDENT_PART = /[A-Za-z0-9_\u0080-\uFFFF]/;
const MULTI_PUNCT = ["...", "?.", "??", "->", "::", "==", "~=", "!=", "<=", ">=", "..", "//", "|>"];

/**
 * @typedef {{ t: "id"|"num"|"str"|"p", v: string, line: number, col: number, off: number, end: number }} Token
 */

/**
 * @param {string} text
 * @returns {Token[]}
 */
function tokenize(text)
{
	/** @type {Token[]} */
	const tokens = [];
	const n = text.length;
	let i = 0;
	let line = 0;
	let lineStart = 0;

	const longBracketLevel = function (pos)
	{
		// Returns the level of a long bracket opening at pos ("[[", "[=[", ...) or -1.
		if (text[pos] != "[")
		{
			return -1;
		}
		let p = pos + 1;
		while (text[p] == "=")
		{
			++p;
		}
		return text[p] == "[" ? p - pos - 1 : -1;
	};
	const skipLongBracket = function (pos, level)
	{
		// pos is at the opening "["; returns the offset just past the closing bracket.
		const close = "]" + "=".repeat(level) + "]";
		const idx = text.indexOf(close, pos + level + 2);
		return idx == -1 ? n : idx + close.length;
	};
	const advanceLines = function (from, to)
	{
		for (let p = from; p < to; ++p)
		{
			if (text.charCodeAt(p) == 10)
			{
				++line;
				lineStart = p + 1;
			}
		}
	};

	while (i < n)
	{
		const c = text[i];
		if (c == "\n")
		{
			++line;
			lineStart = ++i;
			continue;
		}
		if (c == " " || c == "\t" || c == "\r")
		{
			++i;
			continue;
		}
		if (c == "-" && text[i + 1] == "-")
		{
			const level = longBracketLevel(i + 2);
			if (level != -1)
			{
				const end = skipLongBracket(i + 2, level);
				advanceLines(i, end);
				i = end;
			}
			else
			{
				while (i < n && text[i] != "\n")
				{
					++i;
				}
			}
			continue;
		}
		if (c == "\"" || c == "'")
		{
			const start = i;
			const startLine = line;
			const startCol = i - lineStart;
			++i;
			while (i < n && text[i] != c && text[i] != "\n")
			{
				if (text[i] == "\\")
				{
					++i;
					if (text[i] == "\n")
					{
						++line;
						lineStart = i + 1;
					}
				}
				++i;
			}
			const value = text.slice(start + 1, i);
			if (text[i] == c)
			{
				++i;
			}
			tokens.push({ t: "str", v: value, line: startLine, col: startCol, off: start, end: i });
			continue;
		}
		if (c == "[")
		{
			const level = longBracketLevel(i);
			if (level != -1)
			{
				const end = skipLongBracket(i, level);
				const tok = { t: "str", v: text.slice(i + level + 2, Math.max(i + level + 2, end - level - 2)), line, col: i - lineStart, off: i, end };
				advanceLines(i, end);
				tokens.push(tok);
				i = end;
				continue;
			}
		}
		if (IDENT_START.test(c))
		{
			const start = i;
			++i;
			while (i < n && IDENT_PART.test(text[i]))
			{
				++i;
			}
			tokens.push({ t: "id", v: text.slice(start, i), line, col: start - lineStart, off: start, end: i });
			continue;
		}
		if (c >= "0" && c <= "9")
		{
			const start = i;
			++i;
			while (i < n && /[0-9A-Za-z_.]/.test(text[i]) && !(text[i] == "." && text[i + 1] == "."))
			{
				++i;
			}
			tokens.push({ t: "num", v: text.slice(start, i), line, col: start - lineStart, off: start, end: i });
			continue;
		}
		let punct = c;
		for (const m of MULTI_PUNCT)
		{
			if (text.startsWith(m, i))
			{
				punct = m;
				break;
			}
		}
		tokens.push({ t: "p", v: punct, line, col: i - lineStart, off: i, end: i + punct.length });
		i += punct.length;
	}
	return tokens;
}

const MODIFIERS = new Set(["public", "private", "protected", "static"]);
const STATEMENT_KEYWORDS = new Set([
	"local", "return", "if", "for", "while", "do", "end", "function", "then", "else", "elseif", "repeat",
	"until", "break", "continue", "goto", "switch", "case", "default", "class", "enum", "export", "begin",
	"try", "catch",
]);
const RESERVED = new Set([
	...STATEMENT_KEYWORDS, "and", "or", "not", "nil", "true", "false", "in", "as", "new", "self", "parent",
	"extends", "public", "private", "protected", "static",
]);

/**
 * @typedef {{ name: string, type?: string, optional?: boolean, default?: string, vararg?: boolean, visibility?: string }} Param
 *
 * @typedef {object} PlutoSymbol
 * @property {string} name
 * @property {"class"|"function"|"method"|"field"|"variable"|"parameter"|"enum"|"enumMember"} kind
 * @property {string|null} container Name of the owning class/table/enum, if any.
 * @property {"."|":"|null} sep How the member is accessed from its container.
 * @property {boolean} [static]
 * @property {boolean} [local]
 * @property {boolean} [exported]
 * @property {string} [visibility]
 * @property {Param[]} [params]
 * @property {string} [returnType]
 * @property {string} [type]
 * @property {string} [extends]
 * @property {string} [value]
 * @property {number} line
 * @property {number} col
 * @property {number} endLine
 * @property {number} [scopeStart] For locals: first line where the symbol is visible.
 * @property {number} [scopeEnd] For locals: last line where the symbol is visible.
 * @property {string} doc
 */

/**
 * A call or return statement inside a function body, collected for the Outline.
 * @typedef {{ kind: "call"|"return", name: string, detail: string, callee?: string, line: number, col: number, endLine: number, statement: boolean, hasCallback?: boolean }} BodyItem
 */

/**
 * @param {string} text
 * @param {{ calls?: boolean }} [options] `calls`: also collect calls and returns inside of functions.
 * @returns {{ symbols: PlutoSymbol[], blocks: { kind: string, startLine: number, endLine: number }[], unclosed: number, returnName: string|null, requires: { module: string, line: number }[], lineCount: number, calls?: BodyItem[] }}
 */
function parse(text, options)
{
	const tokens = tokenize(text);
	const lines = text.split(/\r?\n/);
	/** @type {PlutoSymbol[]} */
	const symbols = [];
	const blocks = [];
	const requires = [];
	let returnName = null;
	const collectCalls = !!(options && options.calls);
	/** @type {BodyItem[]} */
	const calls = [];

	// Unified stack of open blocks and table constructors.
	/** @type {{ kind: string, startLine: number, sym?: PlutoSymbol, awaiting?: string|null, name?: string|null, locals: PlutoSymbol[], scoped?: boolean }[]} */
	const stack = [];
	const fileLocals = [];
	const declaredLocals = new Set();
	const seenFields = new Set();

	const tok = (idx) => tokens[idx];
	const isP = (idx, v) => tokens[idx] !== undefined && tokens[idx].t == "p" && tokens[idx].v == v;
	const isId = (idx, v) => tokens[idx] !== undefined && tokens[idx].t == "id" && (v === undefined || tokens[idx].v == v);
	const top = () => stack[stack.length - 1];
	const isMemberAccess = (idx) => isP(idx - 1, ".") || isP(idx - 1, ":") || isP(idx - 1, "?.") || isP(idx - 1, "::") || isP(idx + 1, "::");
	const startsLine = (idx) => idx == 0 || tokens[idx - 1].line < tokens[idx].line;

	const docAbove = function (line)
	{
		const out = [];
		let l = line - 1;
		if (l >= 0 && /\]=*\]\s*$/.test(lines[l]) && !/^\s*--(?!\[=*\[)/.test(lines[l]))
		{
			// Block comment ending right above the declaration.
			const block = [];
			while (l >= 0)
			{
				block.unshift(lines[l]);
				if (/--\[=*\[/.test(lines[l]))
				{
					return block.join("\n").replace(/^\s*--\[=*\[\s*/, "").replace(/\s*\]=*\]\s*$/, "").split("\n").map(s => s.replace(/^\s+/, "")).join("\n").trim();
				}
				--l;
			}
			return "";
		}
		while (l >= 0)
		{
			const m = /^\s*---?(?!\[=*\[)\s?(.*)$/.exec(lines[l]);
			if (!m || /^\s*--\s*@pluto_use\b/.test(lines[l]))
			{
				break;
			}
			out.unshift(m[1].replace(/\s+$/, ""));
			--l;
		}
		return out.join("\n").trim();
	};

	const currentScopeBlock = function ()
	{
		for (let s = stack.length - 1; s >= 0; --s)
		{
			if (stack[s].kind != "{")
			{
				return stack[s];
			}
		}
		return null;
	};

	const addLocal = function (sym)
	{
		sym.local = true;
		sym.scopeStart = sym.line;
		sym.scopeEnd = Number.MAX_SAFE_INTEGER;
		const block = currentScopeBlock();
		(block ? block.locals : fileLocals).push(sym);
		declaredLocals.add(sym.name);
		symbols.push(sym);
		return sym;
	};

	const enclosingClassName = function ()
	{
		// The class (or Lua-style "class" table) that `self` refers to at the current position.
		for (let s = stack.length - 1; s >= 0; --s)
		{
			const b = stack[s];
			if (b.kind == "class" && b.sym)
			{
				return b.sym.name;
			}
			if (b.kind == "function" && b.sym && b.sym.container && b.sym.sep == ":")
			{
				return b.sym.container;
			}
		}
		return null;
	};

	const push = function (block)
	{
		block.locals = [];
		stack.push(block);
		return block;
	};

	const pop = function (endLine)
	{
		const block = stack.pop();
		if (!block)
		{
			return;
		}
		if (block.sym)
		{
			block.sym.endLine = endLine;
		}
		for (const l of block.locals)
		{
			l.scopeEnd = endLine;
		}
		if (block.kind != "{" || endLine > block.startLine)
		{
			blocks.push({ kind: block.kind, startLine: block.startLine, endLine, marks: block.marks });
		}
	};

	// Joins the source text of tokens [from, to) as they appear in the source.
	const sliceTokens = function (from, to)
	{
		if (from >= to || !tokens[from])
		{
			return "";
		}
		return text.slice(tokens[from].off, tokens[to - 1].end).replace(/\s+/g, " ").trim();
	};

	// Finds the index of the token closing the bracket opened at idx.
	const matchClose = function (idx, open, close)
	{
		let depth = 0;
		for (let j = idx; j < tokens.length; ++j)
		{
			if (tokens[j].t != "p")
			{
				continue;
			}
			if (tokens[j].v == open)
			{
				++depth;
			}
			else if (tokens[j].v == close && --depth == 0)
			{
				return j;
			}
		}
		return -1;
	};

	/**
	 * Parses a parameter list between tokens (from, to), exclusive of the delimiters.
	 * @returns {Param[]}
	 */
	const parseParams = function (from, to)
	{
		const params = [];
		let j = from;
		while (j < to)
		{
			// Find the end of this parameter (top-level comma).
			let depth = 0;
			let end = j;
			while (end < to)
			{
				const t = tokens[end];
				if (t.t == "p")
				{
					if (t.v == "(" || t.v == "{" || t.v == "[")
					{
						++depth;
					}
					else if (t.v == ")" || t.v == "}" || t.v == "]")
					{
						--depth;
					}
					else if (t.v == "," && depth == 0)
					{
						break;
					}
				}
				++end;
			}
			if (end > j)
			{
				/** @type {Param} */
				const param = { name: "" };
				let k = j;
				while (k < end && tokens[k].t == "id" && MODIFIERS.has(tokens[k].v) && k + 1 < end && tokens[k + 1].t == "id")
				{
					param.visibility = tokens[k].v;
					++k;
				}
				if (isP(k, "..."))
				{
					param.name = "...";
					param.vararg = true;
					++k;
				}
				else if (tokens[k].t == "id")
				{
					param.name = tokens[k].v;
					param.line = tokens[k].line;
					param.col = tokens[k].col;
					++k;
				}
				if (param.name)
				{
					if (isP(k, "?") && k < end)
					{
						param.optional = true;
						++k;
					}
					let eq = k;
					depth = 0;
					while (eq < end && !(isP(eq, "=") && depth == 0))
					{
						if (tokens[eq].t == "p" && "({[".includes(tokens[eq].v))
						{
							++depth;
						}
						else if (tokens[eq].t == "p" && ")}]".includes(tokens[eq].v))
						{
							--depth;
						}
						++eq;
					}
					if (isP(k, ":") && k < end)
					{
						param.type = sliceTokens(k + 1, eq);
						if (param.type.startsWith("?"))
						{
							param.optional = true;
						}
					}
					if (eq < end)
					{
						param.default = sliceTokens(eq + 1, end);
						param.optional = true;
					}
					params.push(param);
				}
			}
			j = end + 1;
		}
		return params;
	};

	// Reads `a.b.c` or `a.b:c` starting at idx. Returns { parts, sep, next } or null.
	const readDottedName = function (idx)
	{
		if (!isId(idx))
		{
			return null;
		}
		const parts = [tokens[idx].v];
		let sep = null;
		let j = idx + 1;
		while ((isP(j, ".") || isP(j, ":")) && isId(j + 1))
		{
			sep = tokens[j].v;
			parts.push(tokens[j + 1].v);
			j += 2;
			if (sep == ":")
			{
				break;
			}
		}
		return { parts, sep, next: j, nameTok: tokens[j - 1] };
	};

	// Reads `a.b.c` backwards ending at idx. Returns { parts, start } or null.
	const readDottedNameBackwards = function (idx)
	{
		if (!isId(idx))
		{
			return null;
		}
		const parts = [tokens[idx].v];
		let j = idx;
		while (isP(j - 1, ".") && isId(j - 2))
		{
			parts.unshift(tokens[j - 2].v);
			j -= 2;
		}
		return { parts, start: j };
	};

	// Parses the part of a function after its name: `(params)[: returnType]`.
	// Returns the index of the first token after the header, and fills in the symbol.
	const parseFunctionHeader = function (idx, sym)
	{
		if (!isP(idx, "("))
		{
			sym.params = [];
			return idx;
		}
		const close = matchClose(idx, "(", ")");
		if (close == -1)
		{
			sym.params = parseParams(idx + 1, tokens.length);
			return tokens.length;
		}
		sym.params = parseParams(idx + 1, close);
		let j = close + 1;
		if (isP(j, ":") && tokens[j].line == tokens[close].line)
		{
			// Return type hint: everything up to the end of the line or a statement keyword.
			const typeLine = tokens[j].line;
			let k = j + 1;
			let depth = 0;
			while (k < tokens.length && tokens[k].line == typeLine)
			{
				const t = tokens[k];
				if (t.t == "p" && "({[".includes(t.v))
				{
					++depth;
				}
				else if (t.t == "p" && ")}]".includes(t.v))
				{
					if (depth == 0)
					{
						break;
					}
					--depth;
				}
				else if (depth == 0 && t.t == "id" && STATEMENT_KEYWORDS.has(t.v) && !(t.v == "function" && isP(k + 1, "(")))
				{
					break;
				}
				else if (depth == 0 && t.t == "p" && (t.v == "=" || t.v == ";" || t.v == ","))
				{
					break;
				}
				++k;
			}
			sym.returnType = sliceTokens(j + 1, k);
			j = k;
		}
		return j;
	};

	const makeSym = function (props, nameTok)
	{
		return Object.assign({
			container: null,
			sep: null,
			line: nameTok.line,
			col: nameTok.col,
			endLine: nameTok.line,
			doc: "",
		}, props);
	};

	const addFunctionParams = function (sym, block)
	{
		for (const p of sym.params || [])
		{
			if (p.vararg || p.line === undefined)
			{
				continue;
			}
			const psym = makeSym({ name: p.name, kind: "parameter", type: p.type, local: true }, p);
			psym.owner = sym;
			psym.scopeStart = p.line;
			psym.scopeEnd = Number.MAX_SAFE_INTEGER;
			block.locals.push(psym);
			symbols.push(psym);
		}
	};

	// A display name for a function that isn't assigned to anything, e.g. `scheduler:add() callback`.
	const anonymousName = function (idx)
	{
		let depth = 0;
		for (let j = idx - 1; j >= 0 && j >= idx - 400; --j)
		{
			const tk = tokens[j];
			if (tk.t != "p")
			{
				if (depth == 0 && tk.t == "id" && tk.v == "return")
				{
					return "return function";
				}
				continue;
			}
			if (tk.v == ")" || tk.v == "]" || tk.v == "}")
			{
				++depth;
			}
			else if (tk.v == "(" || tk.v == "[" || tk.v == "{")
			{
				if (depth > 0)
				{
					--depth;
					continue;
				}
				if (tk.v != "(" || !isId(j - 1))
				{
					return "<function>";
				}
				const parts = [tokens[j - 1].v];
				let k = j - 1;
				while ((isP(k - 1, ".") || isP(k - 1, ":") || isP(k - 1, "?.")) && isId(k - 2))
				{
					parts.unshift(tokens[k - 2].v, tokens[k - 1].v == ":" ? ":" : ".");
					k -= 2;
				}
				return parts.join("") + "() callback";
			}
			else if (depth == 0 && tk.v == "=" )
			{
				return "<function>";
			}
		}
		return "<function>";
	};

	// Short source text of the comma-separated expressions starting at idx (first line only),
	// e.g. `local a, b = 1, {` → ["1", "{…}"]
	const initializers = function (idx)
	{
		const out = [];
		if (!tokens[idx])
		{
			return out;
		}
		const line = tokens[idx].line;
		let start = idx;
		let depth = 0;
		let k = idx;
		const flush = function (end, open)
		{
			let s = sliceTokens(start, end);
			if (open)
			{
				s += "…" + (s.includes("{") ? "}" : s.includes("(") ? ")" : "");
			}
			if (s.length > 40)
			{
				s = s.slice(0, 39) + "…";
			}
			if (s)
			{
				out.push(s);
			}
		};
		for (; k < tokens.length && tokens[k].line == line; ++k)
		{
			const tk = tokens[k];
			if (tk.t == "p" && "({[".includes(tk.v))
			{
				++depth;
			}
			else if (tk.t == "p" && ")}]".includes(tk.v))
			{
				if (--depth < 0)
				{
					break;
				}
			}
			else if (depth == 0 && tk.t == "p" && (tk.v == "," || tk.v == ";"))
			{
				flush(k, false);
				if (tk.v == ";")
				{
					return out;
				}
				start = k + 1;
			}
			else if (depth == 0 && tk.t == "id" && STATEMENT_KEYWORDS.has(tk.v) && tk.v != "function" && k > start)
			{
				break;
			}
		}
		flush(k, depth > 0);
		return out;
	};

	const insideFunction = () => stack.some(b => b.kind == "function");

	const truncate = (s, max) => s.length > max ? s.slice(0, max - 1) + "…" : s;

	// Records the call whose argument list opens at idx, e.g. `ENTITY.GET_ENTITY_COORDS(entity)`.
	const recordCall = function (idx)
	{
		if (!isId(idx - 1) || !insideFunction())
		{
			return;
		}
		let j = idx - 1;
		const parts = [tokens[j].v];
		while ((isP(j - 1, ".") || isP(j - 1, ":") || isP(j - 1, "?.")) && isId(j - 2))
		{
			parts.unshift(tokens[j - 2].v, tokens[j - 1].v == ":" ? ":" : ".");
			j -= 2;
		}
		// A receiver that isn't a plain name, e.g. `foo():bar()` or `t[1].x()`.
		const complexReceiver = isP(j - 1, ".") || isP(j - 1, ":") || isP(j - 1, "?.");
		const before = tokens[j - 1];
		if (before && before.t == "id" && before.v == "function")
		{
			return; // declaration, not a call
		}
		if (parts.length == 1 && RESERVED.has(parts[0]) && parts[0] != "self" && parts[0] != "parent")
		{
			return; // `if (`, `return (`, `and (`, ...
		}
		const isNew = !!before && before.t == "id" && (before.v == "new" || before.v == "pluto_new");
		const statement = !isNew && !complexReceiver && (!before || before.line < tokens[j].line || (before.t == "p" && before.v == ";")
			|| (before.t == "id" && ["then", "do", "else", "repeat"].includes(before.v)));

		// Arguments, as far as they go on this line.
		const line = tokens[idx].line;
		let depth = 0;
		let close = -1;
		let last = idx;
		let hasCallback = false;
		for (let k = idx; k < tokens.length && tokens[k].line == line; ++k)
		{
			const tk = tokens[k];
			last = k;
			if (tk.t == "id" && tk.v == "function")
			{
				hasCallback = true;
			}
			else if (tk.t == "p" && tk.v == "->")
			{
				hasCallback = true;
			}
			else if (tk.t == "p" && "({[".includes(tk.v))
			{
				++depth;
			}
			else if (tk.t == "p" && ")}]".includes(tk.v) && --depth == 0)
			{
				close = k;
				break;
			}
		}
		const args = close != -1 ? sliceTokens(idx + 1, close) : sliceTokens(idx + 1, last + 1) + " …";
		const callee = (complexReceiver ? "…" : "") + parts.join("");
		calls.push({
			kind: "call",
			name: (isNew ? "new " : "") + callee + "()",
			detail: "(" + truncate(args, 60) + ")",
			callee,
			line: tokens[j].line,
			col: tokens[j].col,
			endLine: tokens[j].line,
			statement,
			hasCallback: hasCallback || undefined,
		});
	};

	const declareAnonymous = function (idx)
	{
		const sym = makeSym({ name: anonymousName(idx), kind: "function", anonymous: true }, tokens[idx]);
		symbols.push(sym);
		return sym;
	};

	// Determines what an anonymous `function` / lambda at idx is being assigned to.
	// Returns { name, container, sep, local, nameTok, exported } or null.
	const assignmentTarget = function (idx)
	{
		if (!isP(idx - 1, "="))
		{
			return null;
		}
		let j = idx - 2;
		// Skip a type hint or attribute on the target: `local f: function =`, `local f <const> =`.
		if (isP(j, ">") && isId(j - 1) && isP(j - 2, "<"))
		{
			j -= 3;
		}
		const name = readDottedNameBackwards(j);
		if (!name)
		{
			return null;
		}
		const nameTok = tokens[j];
		const before = name.start - 1;
		const isLocal = isId(before, "local") || isId(before, "let") || isId(before, "const");
		const t = top();
		if (name.parts.length == 1)
		{
			if (!isLocal && t && (t.kind == "{" || t.kind == "class"))
			{
				const container = t.kind == "class" ? (t.sym && t.sym.name) : t.name;
				return { name: name.parts[0], container: container || null, sep: container ? "." : null, local: false, nameTok, inTable: true };
			}
			return { name: name.parts[0], container: null, sep: null, local: isLocal, nameTok, exported: isId(before, "export") };
		}
		let container = name.parts.slice(0, -1).join(".");
		if (name.parts[0] == "self")
		{
			const cls = enclosingClassName();
			if (!cls)
			{
				return null;
			}
			container = [cls, ...name.parts.slice(1, -1)].join(".");
		}
		return { name: name.parts[name.parts.length - 1], container, sep: ".", local: false, nameTok };
	};

	const declareFunction = function (props, nameTok, declLine)
	{
		const sym = makeSym(Object.assign({ kind: props.container ? "method" : "function" }, props), nameTok);
		sym.doc = docAbove(declLine);
		return sym;
	};

	let i = 0;
	while (i < tokens.length)
	{
		const t = tokens[i];

		if (t.t == "p")
		{
			if (t.v == "$")
			{
				// Preprocessor directive. `$declare function f(a: T): R` is worth indexing; the rest is skipped.
				const line = t.line;
				if (isId(i + 1, "declare") && isId(i + 2, "function"))
				{
					const name = readDottedName(i + 3);
					if (name)
					{
						const sym = declareFunction({
							name: name.parts[name.parts.length - 1],
							container: name.parts.length > 1 ? name.parts.slice(0, -1).join(".") : null,
							sep: name.sep,
							declared: true,
						}, name.nameTok, line);
						parseFunctionHeader(name.next, sym);
						symbols.push(sym);
					}
				}
				if (tokens[i + 1] && tokens[i + 1].t == "str")
				{
					++i; // $"interpolated string"
					continue;
				}
				while (i < tokens.length && tokens[i].line == line)
				{
					++i;
				}
				continue;
			}
			if (t.v == "{")
			{
				// Is this table being assigned to a name?
				let name = null;
				if (isP(i - 1, "="))
				{
					const target = readDottedNameBackwards(i - 2);
					if (target)
					{
						name = target.parts.join(".");
					}
				}
				push({ kind: "{", startLine: t.line, name });
				++i;
				continue;
			}
			if (t.v == "}")
			{
				// Recover from unbalanced input by unwinding to the nearest table.
				let s = stack.length - 1;
				while (s >= 0 && stack[s].kind != "{")
				{
					--s;
				}
				if (s >= 0)
				{
					while (stack.length > s)
					{
						pop(t.line);
					}
				}
				++i;
				continue;
			}
			const prev = tokens[i - 1];
			if (t.v == "|" && prev && ((prev.t == "p" && ["=", "(", ",", "{"].includes(prev.v)) || (prev.t == "id" && prev.v == "return")))
			{
				// Lambda: `local f = |a, b| -> a + b`, `scheduler:add(|| -> do ... end)`
				let close = i + 1;
				while (close < tokens.length && !isP(close, "|") && tokens[close].line == t.line)
				{
					++close;
				}
				if (isP(close, "|") && isP(close + 1, "->"))
				{
					const hasBody = isId(close + 2, "do");
					const target = assignmentTarget(i);
					let sym = null;
					if (target)
					{
						sym = declareFunction({
							name: target.name,
							container: target.container,
							sep: target.sep,
							local: target.local,
							lambda: true,
						}, target.nameTok, target.nameTok.line);
						sym.params = parseParams(i + 1, close);
						if (target.local)
						{
							// Already declared as a variable by the `local` statement; upgrade it.
							const existing = symbols.find(s => s.kind == "variable" && s.name == sym.name && s.line == sym.line && s.col == sym.col);
							if (existing)
							{
								Object.assign(existing, { kind: "function", params: sym.params, lambda: true, doc: sym.doc });
								delete existing.init;
								sym = existing;
							}
							else
							{
								addLocal(sym);
							}
						}
						else
						{
							symbols.push(sym);
						}
					}
					else if (hasBody)
					{
						sym = declareAnonymous(i);
						sym.lambda = true;
						sym.params = parseParams(i + 1, close);
					}
					if (hasBody)
					{
						// `-> do ... end`: the lambda's body is a block closed by `end`.
						const block = push({ kind: "function", startLine: t.line, sym });
						if (sym)
						{
							addFunctionParams(sym, block);
						}
						i = close + 3;
					}
					else
					{
						i = close + 2;
					}
					continue;
				}
			}
			if (collectCalls && t.v == "(")
			{
				recordCall(i);
			}
			++i;
			continue;
		}

		if (t.t == "str")
		{
			// require "module" / require("module")
			if (isId(i - 1, "require") || (isP(i - 1, "(") && isId(i - 2, "require")))
			{
				requires.push({ module: t.v, line: t.line, col: t.col, endCol: t.col + (t.end - t.off) });
			}
			++i;
			continue;
		}

		if (t.t != "id" || isMemberAccess(i))
		{
			// `self.field = value` / `Name.field = value` at the start of a statement.
			if (t.t == "id" && isP(i - 1, ".") && isP(i + 1, "=") && !isP(i + 2, "="))
			{
				const chain = readDottedNameBackwards(i);
				if (chain && chain.parts.length >= 2 && startsLine(chain.start) && !isId(i + 2, "function") && !isP(i + 2, "|"))
				{
					let container = chain.parts.slice(0, -1).join(".");
					let viaSelf = false;
					if (chain.parts[0] == "self")
					{
						const cls = enclosingClassName();
						container = cls ? [cls, ...chain.parts.slice(1, -1)].join(".") : null;
						viaSelf = true;
					}
					if (container && !seenFields.has(container + "." + t.v))
					{
						seenFields.add(container + "." + t.v);
						const sym = makeSym({ name: t.v, kind: "field", container, sep: ".", viaSelf }, t);
						sym.doc = docAbove(t.line);
						sym.init = initializers(i + 2)[0];
						if (isId(i + 2, "new") && isId(i + 3))
						{
							sym.type = tokens[i + 3].v;
						}
						symbols.push(sym);
					}
				}
			}
			++i;
			continue;
		}

		const cur = top();
		const inTable = cur !== undefined && cur.kind == "{";
		const word = t.v;

		// Reserved words used as table keys: `{ class = "key", end = 1 }`
		if (inTable && isP(i + 1, "=") && !isP(i + 2, "="))
		{
			if (!isId(i + 2, "function") && !isP(i + 2, "|") && cur.name && (isP(i - 1, "{") || isP(i - 1, ",") || isP(i - 1, ";") || startsLine(i)))
			{
				if (!seenFields.has(cur.name + "." + word))
				{
					seenFields.add(cur.name + "." + word);
					const sym = makeSym({ name: word, kind: "field", container: cur.name, sep: "." }, t);
					sym.doc = docAbove(t.line);
					sym.init = initializers(i + 2)[0];
					symbols.push(sym);
				}
			}
			++i;
			continue;
		}

		switch (word)
		{
		case "function":
		{
			if (isP(i - 1, ":") || isP(i - 1, "|") || isP(i - 1, "?") || isP(i - 1, "->"))
			{
				// Type hint, e.g. `callback: function`
				++i;
				continue;
			}
			const name = readDottedName(i + 1);
			let sym;
			let headerStart;
			if (name && isP(name.next, "("))
			{
				// Named function statement.
				let b = i - 1;
				let isStatic = false;
				let visibility;
				while (isId(b) && MODIFIERS.has(tokens[b].v))
				{
					if (tokens[b].v == "static")
					{
						isStatic = true;
					}
					else
					{
						visibility = tokens[b].v;
					}
					--b;
				}
				const isLocal = isId(b, "local");
				const exported = isId(b, "export");
				let container = null;
				let sep = null;
				if (name.parts.length > 1)
				{
					container = name.parts.slice(0, -1).join(".");
					sep = name.sep;
				}
				else if (cur && cur.kind == "class" && cur.sym)
				{
					container = cur.sym.name;
					sep = isStatic ? "." : ":";
				}
				else if (inTable)
				{
					// Pluto allows `function name() end` inside table constructors, creating methods.
					container = cur.name || null;
					sep = container ? (isStatic ? "." : ":") : null;
				}
				sym = declareFunction({
					name: name.parts[name.parts.length - 1],
					container,
					sep,
					static: isStatic || undefined,
					visibility,
					exported: exported || undefined,
				}, name.nameTok, t.line);
				headerStart = name.next;
				if (isLocal)
				{
					addLocal(sym);
				}
				else
				{
					symbols.push(sym);
				}
			}
			else if (isP(i + 1, "("))
			{
				// Anonymous function; see if it is assigned to something.
				const target = assignmentTarget(i);
				headerStart = i + 1;
				if (target)
				{
					const existing = target.local
						? symbols.find(s => s.kind == "variable" && s.name == target.name && s.line == target.nameTok.line && s.col == target.nameTok.col)
						: undefined;
					if (existing)
					{
						existing.kind = "function";
						existing.doc = docAbove(existing.line);
						delete existing.init;
						sym = existing;
					}
					else
					{
						sym = declareFunction({
							name: target.name,
							container: target.container,
							sep: target.sep,
							exported: target.exported || undefined,
						}, target.nameTok, target.nameTok.line);
						if (target.local)
						{
							addLocal(sym);
						}
						else
						{
							if (target.container)
							{
								seenFields.add(target.container + "." + target.name);
							}
							symbols.push(sym);
						}
					}
				}
				else
				{
					sym = declareAnonymous(i);
				}
			}
			else
			{
				++i;
				continue;
			}
			const holder = sym || { params: [] };
			const next = parseFunctionHeader(headerStart, holder);
			const block = push({ kind: "function", startLine: t.line, sym });
			addFunctionParams(holder, block);
			if (sym && sym.name == "__construct" && sym.container)
			{
				// Constructor promotion: `function __construct(public name)`
				for (const p of sym.params)
				{
					if (p.visibility && !seenFields.has(sym.container + "." + p.name))
					{
						seenFields.add(sym.container + "." + p.name);
						symbols.push(makeSym({ name: p.name, kind: "field", container: sym.container, sep: ".", type: p.type, visibility: p.visibility }, p));
					}
				}
			}
			i = Math.max(next, i + 1);
			continue;
		}

		case "class":
		case "pluto_class":
		{
			// `class Name [extends Base]`, or a class expression: `local Name = class [extends Base]`
			let nameTok = null;
			let j = i + 1;
			let isLocal = false;
			let exported = false;
			if (isP(i - 1, "=") && isId(i - 2))
			{
				nameTok = tokens[i - 2];
				isLocal = isId(i - 3, "local");
			}
			else if (isId(i + 1) && !RESERVED.has(tokens[i + 1].v) && !isP(i + 2, "=") && !isP(i + 2, ".") && !isP(i + 2, "(") && !isP(i + 2, ","))
			{
				nameTok = tokens[i + 1];
				j = i + 2;
				isLocal = isId(i - 1, "local");
				exported = isId(i - 1, "export");
			}
			else if (!(isId(i + 1, "extends") || isP(i - 1, "(") || isP(i - 1, ",") || isId(i - 1, "return")))
			{
				// `class` used as a plain identifier (Lua compatibility).
				++i;
				continue;
			}
			let sym;
			if (nameTok)
			{
				sym = symbols.find(s => s.kind == "variable" && s.name == nameTok.v && s.line == nameTok.line && s.col == nameTok.col);
				if (sym)
				{
					sym.kind = "class";
				}
				else
				{
					sym = makeSym({ name: nameTok.v, kind: "class", exported: exported || undefined }, nameTok);
					if (isLocal)
					{
						addLocal(sym);
					}
					else
					{
						symbols.push(sym);
					}
				}
				sym.doc = docAbove(t.line);
			}
			if (isId(j, "extends"))
			{
				const base = readDottedName(j + 1);
				if (base)
				{
					if (sym)
					{
						sym.extends = base.parts.join(".");
					}
					j = base.next;
				}
			}
			push({ kind: "class", startLine: t.line, sym });
			i = j;
			continue;
		}

		case "enum":
		case "pluto_enum":
		{
			let j = i + 1;
			let scoped = false;
			if (isId(j, "class"))
			{
				scoped = true;
				++j;
			}
			let sym;
			if (isId(j) && tokens[j].v != "begin" && isId(j + 1, "begin"))
			{
				sym = makeSym({ name: tokens[j].v, kind: "enum", scoped: scoped || undefined }, tokens[j]);
				sym.doc = docAbove(t.line);
				if (isId(i - 1, "local"))
				{
					addLocal(sym);
				}
				else
				{
					symbols.push(sym);
				}
				++j;
			}
			if (!isId(j, "begin"))
			{
				++i; // `enum` used as an identifier
				continue;
			}
			push({ kind: "enum", startLine: t.line, sym, scoped });
			i = j + 1;
			continue;
		}

		case "if":
		{
			// Ternary expression (`local x = if cond then a else b`) has no `end`.
			const prev = tokens[i - 1];
			if (prev && ((prev.t == "p" && ![")", "]", "}", ";", ":", "::"].includes(prev.v))
				|| (prev.t == "id" && ["return", "and", "or", "not"].includes(prev.v))))
			{
				++i;
				continue;
			}
			push({ kind: "if", startLine: t.line, awaiting: "then" });
			++i;
			continue;
		}

		case "elseif":
			if (cur && cur.kind == "if")
			{
				cur.awaiting = "then";
				(cur.marks = cur.marks || []).push(t.line);
			}
			++i;
			continue;

		case "else":
			if (cur && cur.kind == "if")
			{
				(cur.marks = cur.marks || []).push(t.line);
			}
			++i;
			continue;

		case "case":
		case "default":
		case "catch":
		case "pluto_catch":
			if (cur && (cur.kind == "switch" || cur.kind == "try") && startsLine(i))
			{
				(cur.marks = cur.marks || []).push(t.line);
			}
			++i;
			continue;

		case "then":
			if (cur && cur.awaiting == "then")
			{
				cur.awaiting = null;
			}
			++i;
			continue;

		case "while":
			push({ kind: "while", startLine: t.line, awaiting: "do" });
			++i;
			continue;

		case "switch":
		case "pluto_switch":
			if (isP(i + 1, "=") || isP(i + 1, ".") || isP(i + 1, ",") || isP(i + 1, ")") || isP(i + 1, "["))
			{
				++i; // identifier
				continue;
			}
			push({ kind: "switch", startLine: t.line, awaiting: "do" });
			++i;
			continue;

		case "for":
		{
			const block = push({ kind: "for", startLine: t.line, awaiting: "do" });
			// Loop variables: `for i = ...`, `for k, v in ...`, `for t as v do`
			let j = i + 1;
			const vars = [];
			while (isId(j) && !RESERVED.has(tokens[j].v))
			{
				vars.push(tokens[j]);
				if (!isP(j + 1, ","))
				{
					++j;
					break;
				}
				j += 2;
			}
			if (isP(j, "=") || isId(j, "in"))
			{
				for (const v of vars)
				{
					const sym = makeSym({ name: v.v, kind: "variable", local: true, loopVar: true }, v);
					sym.scopeStart = v.line;
					sym.scopeEnd = Number.MAX_SAFE_INTEGER;
					block.locals.push(sym);
					symbols.push(sym);
				}
			}
			else
			{
				// for-as: scan ahead on this line for `as name[, name]`
				let k = i + 1;
				while (k < tokens.length && tokens[k].line == t.line && !isId(k, "do"))
				{
					if (isId(k, "as"))
					{
						let a = k + 1;
						while (isId(a) && !RESERVED.has(tokens[a].v))
						{
							const sym = makeSym({ name: tokens[a].v, kind: "variable", local: true, loopVar: true }, tokens[a]);
							sym.scopeStart = t.line;
							sym.scopeEnd = Number.MAX_SAFE_INTEGER;
							block.locals.push(sym);
							symbols.push(sym);
							if (!isP(a + 1, ","))
							{
								break;
							}
							a += 2;
						}
						break;
					}
					++k;
				}
			}
			++i;
			continue;
		}

		case "do":
			if (cur && (cur.awaiting == "do" || cur.awaiting == "then"))
			{
				cur.awaiting = null; // Pluto accepts `do` in place of `then`
			}
			else
			{
				push({ kind: "do", startLine: t.line });
			}
			++i;
			continue;

		case "repeat":
			push({ kind: "repeat", startLine: t.line });
			++i;
			continue;

		case "until":
			if (cur && cur.kind == "repeat")
			{
				pop(t.line);
			}
			++i;
			continue;

		case "try":
		case "pluto_try":
			// Removed from Pluto, but still found in older code bases.
			if (startsLine(i) && (!tokens[i + 1] || tokens[i + 1].line > t.line || (tokens[i + 1].t == "id" && !isP(i + 2, "=") && !isP(i + 2, ","))))
			{
				push({ kind: "try", startLine: t.line });
			}
			++i;
			continue;

		case "end":
			if (cur && cur.kind != "{")
			{
				pop(t.line);
			}
			++i;
			continue;

		case "local":
		case "let":
		case "const":
		{
			if (word != "local" && !(isId(i + 1) && startsLine(i)))
			{
				break;
			}
			if (isId(i + 1, "function") || isId(i + 1, "class") || isId(i + 1, "enum"))
			{
				if (isId(i + 1, "class") && isP(i + 2, "="))
				{
					// local class = ...
				}
				else
				{
					++i;
					continue;
				}
			}
			// local a <const>, b: type = ...
			let j = i + 1;
			const declared = [];
			while (isId(j))
			{
				const nameTok = tokens[j];
				const sym = makeSym({ name: nameTok.v, kind: "variable" }, nameTok);
				++j;
				if (word == "const")
				{
					sym.attrib = "const";
				}
				if (isP(j, "<") && isId(j + 1) && isP(j + 2, ">"))
				{
					sym.attrib = tokens[j + 1].v;
					j += 3;
				}
				if (isP(j, ":"))
				{
					let k = j + 1;
					let depth = 0;
					while (k < tokens.length && tokens[k].line == nameTok.line)
					{
						const tk = tokens[k];
						if (tk.t == "p" && "({[".includes(tk.v))
						{
							++depth;
						}
						else if (tk.t == "p" && ")}]".includes(tk.v))
						{
							--depth;
						}
						else if (depth == 0 && tk.t == "p" && (tk.v == "," || tk.v == "="))
						{
							break;
						}
						++k;
					}
					sym.type = sliceTokens(j + 1, k);
					j = k;
				}
				declared.push(sym);
				if (!isP(j, ","))
				{
					break;
				}
				++j;
			}
			if (declared.length && isP(j, "=") && !isP(j + 1, "="))
			{
				// Infer the type of the first variable from simple initializers.
				const first = declared[0];
				const v = j + 1;
				initializers(v).forEach(function (init, idx)
				{
					if (declared[idx])
					{
						declared[idx].init = init;
					}
				});
				if (!first.type)
				{
					if (isId(v, "new") && isId(v + 1))
					{
						const cls = readDottedName(v + 1);
						first.type = cls.parts.join(".");
					}
					else if (isId(v, "require") && (tokens[v + 1] && (tokens[v + 1].t == "str" || (isP(v + 1, "(") && tokens[v + 2] && tokens[v + 2].t == "str"))))
					{
						first.module = tokens[v + 1].t == "str" ? tokens[v + 1].v : tokens[v + 2].v;
					}
					else if (tokens[v] && tokens[v].t == "str" && !isP(v + 1, ".") && !isP(v + 1, ":"))
					{
						first.type = "string";
					}
					else if (isP(v, "{"))
					{
						first.isTable = true;
					}
				}
			}
			for (const sym of declared)
			{
				sym.doc = docAbove(t.line);
				addLocal(sym);
			}
			i = Math.max(j, i + 1);
			continue;
		}

		case "return":
			if (stack.length == 0 && isId(i + 1) && (!tokens[i + 2] || tokens[i + 2].line > tokens[i + 1].line))
			{
				returnName = tokens[i + 1].v;
			}
			if (collectCalls && insideFunction())
			{
				const next = tokens[i + 1];
				const values = next && next.line == t.line && !(next.t == "id" && ["end", "else", "elseif", "until", "case", "default"].includes(next.v))
					? initializers(i + 1).join(", ")
					: "";
				calls.push({ kind: "return", name: "return", detail: values, line: t.line, col: t.col, endLine: t.line, statement: true });
			}
			++i;
			continue;

		default:
			break;
		}

		// Class body: fields like `public name: string = "x"`, `static count = 0`, `age`
		if (cur && cur.kind == "class" && cur.sym && !RESERVED.has(word) && !isId(i + 1, "function"))
		{
			let b = i - 1;
			let isStatic = false;
			let visibility;
			while (isId(b) && MODIFIERS.has(tokens[b].v) && tokens[b].line == t.line)
			{
				if (tokens[b].v == "static")
				{
					isStatic = true;
				}
				else
				{
					visibility = tokens[b].v;
				}
				--b;
			}
			const first = startsLine(b + 1);
			const next = tokens[i + 1];
			const ends = !next || next.line > t.line || isP(i + 1, "=") || isP(i + 1, ":") || isP(i + 1, ";");
			if (first && ends && !isP(i + 1, "==") && !(isP(i + 1, "=") && (isId(i + 2, "function") || isP(i + 2, "|"))))
			{
				const key = cur.sym.name + "." + word;
				if (!seenFields.has(key))
				{
					seenFields.add(key);
					const sym = makeSym({ name: word, kind: "field", container: cur.sym.name, sep: ".", static: isStatic || undefined, visibility }, t);
					sym.doc = docAbove(t.line);
					if (isP(i + 1, ":"))
					{
						let k = i + 2;
						while (k < tokens.length && tokens[k].line == t.line && !isP(k, "="))
						{
							++k;
						}
						sym.type = sliceTokens(i + 2, k);
						if (isP(k, "="))
						{
							sym.init = initializers(k + 1)[0];
						}
					}
					else if (isP(i + 1, "="))
					{
						sym.init = initializers(i + 2)[0];
					}
					symbols.push(sym);
				}
			}
			++i;
			continue;
		}

		// Enum members
		if (cur && cur.kind == "enum" && !RESERVED.has(word) && (isId(i - 1, "begin") || isP(i - 1, ",") || startsLine(i)))
		{
			const sym = makeSym({
				name: word,
				kind: "enumMember",
				container: cur.sym ? cur.sym.name : null,
				sep: cur.sym ? "." : null,
				scoped: cur.scoped || undefined,
			}, t);
			if (isP(i + 1, "=") && tokens[i + 2])
			{
				sym.value = tokens[i + 2].v;
			}
			sym.doc = docAbove(t.line);
			symbols.push(sym);
			++i;
			continue;
		}

		// Global assignment at the start of a statement: `Name = value`
		if (!inTable && !RESERVED.has(word) && startsLine(i) && isP(i + 1, "=") && !isP(i + 2, "=")
			&& !isId(i + 2, "function") && !isP(i + 2, "|") && !isId(i + 2, "class") && !declaredLocals.has(word))
		{
			if (!seenFields.has("_G." + word))
			{
				seenFields.add("_G." + word);
				const sym = makeSym({ name: word, kind: "variable", global: true }, t);
				sym.doc = docAbove(t.line);
				sym.init = initializers(i + 2)[0];
				if (isId(i + 2, "new") && isId(i + 3))
				{
					sym.type = readDottedName(i + 3).parts.join(".");
				}
				else if (isP(i + 2, "{"))
				{
					sym.isTable = true;
				}
				symbols.push(sym);
			}
		}
		++i;
	}

	// Close whatever is left open at the end of the file.
	const unclosed = stack.filter(b => b.kind != "{").length;
	const lastLine = Math.max(0, lines.length - 1);
	while (stack.length)
	{
		pop(lastLine);
	}

	const result = { symbols, blocks, unclosed, returnName, requires, lineCount: lines.length };
	if (collectCalls)
	{
		result.calls = calls;
	}
	return result;
}

/**
 * @param {Param[]|null|undefined} params
 */
function formatParams(params)
{
	if (!params)
	{
		return "...";
	}
	return params.map(function (p)
	{
		let s = (p.visibility ? p.visibility + " " : "") + p.name;
		if (p.optional && !(p.type && p.type.startsWith("?")) && p.default === undefined)
		{
			s += "?";
		}
		if (p.type)
		{
			s += ": " + p.type;
		}
		if (p.default !== undefined)
		{
			s += " = " + p.default;
		}
		return s;
	}).join(", ");
}

/**
 * Human-readable declaration for a symbol, e.g. `function Foo:bar(a: number, b?: string): bool`.
 * @param {PlutoSymbol} sym
 */
function formatSignature(sym)
{
	const qualified = sym.container ? sym.container + (sym.sep || ".") + sym.name : sym.name;
	switch (sym.kind)
	{
	case "class":
		return (sym.local ? "local " : "") + "class " + sym.name + (sym.extends ? " extends " + sym.extends : "");
	case "enum":
		return "enum " + (sym.scoped ? "class " : "") + sym.name;
	case "enumMember":
		return qualified + (sym.value !== undefined ? " = " + sym.value : "");
	case "function":
	case "method":
		return (sym.local ? "local " : "") + (sym.static ? "static " : "") + "function " + qualified
			+ "(" + formatParams(sym.params) + ")" + (sym.returnType ? ": " + sym.returnType : "");
	case "field":
		return (sym.visibility ? sym.visibility + " " : "") + (sym.static ? "static " : "") + qualified + (sym.type ? ": " + sym.type : "") + (sym.init ? " = " + sym.init : "");
	case "parameter":
		return "(parameter) " + sym.name + (sym.type ? ": " + sym.type : "");
	default:
		return (sym.local ? "local " : "") + sym.name + (sym.attrib ? " <" + sym.attrib + ">" : "") + (sym.type ? ": " + sym.type : "") + (sym.init ? " = " + sym.init : "");
	}
}

/**
 * Folding ranges for a parsed document: blocks (with their else/case branches), multi-line
 * comments, and `--#region` / `--#endregion` markers. Lines are zero-based and inclusive;
 * the closing line of a block is left visible.
 * @param {string} text
 * @param {{ blocks: { kind: string, startLine: number, endLine: number, marks?: number[] }[] }} parsed
 * @returns {{ start: number, end: number, kind?: "comment"|"region" }[]}
 */
function computeFolding(text, parsed)
{
	const out = [];
	for (const block of parsed.blocks)
	{
		// A block is split at its branches: if | elseif | else, switch | case | default.
		const points = [block.startLine, ...(block.marks || []).filter(l => l > block.startLine && l < block.endLine), block.endLine];
		for (let p = 0; p + 1 < points.length; ++p)
		{
			if (block.kind == "switch" && p == 0 && points.length > 2)
			{
				continue; // the switch as a whole is added below
			}
			if (points[p + 1] - 1 > points[p])
			{
				out.push({ start: points[p], end: points[p + 1] - 1 });
			}
		}
		if (block.kind == "switch" && points.length > 2 && block.endLine - 1 > block.startLine)
		{
			out.push({ start: block.startLine, end: block.endLine - 1 });
		}
	}

	const lines = text.split(/\r?\n/);
	const regions = [];
	let commentStart = -1;
	let inBlockComment = null;
	for (let l = 0; l <= lines.length; ++l)
	{
		const line = l < lines.length ? lines[l] : "";
		if (inBlockComment)
		{
			if (line.includes(inBlockComment.close))
			{
				if (l > inBlockComment.start)
				{
					out.push({ start: inBlockComment.start, end: l, kind: "comment" });
				}
				inBlockComment = null;
			}
			continue;
		}
		const region = /^\s*--\s*#?(region|endregion)\b/.exec(line);
		const block = /^\s*--\[(=*)\[/.exec(line);
		const isLineComment = /^\s*--/.test(line) && !block && !region && l < lines.length;
		if (isLineComment)
		{
			if (commentStart == -1)
			{
				commentStart = l;
			}
			continue;
		}
		if (commentStart != -1)
		{
			if (l - 1 > commentStart)
			{
				out.push({ start: commentStart, end: l - 1, kind: "comment" });
			}
			commentStart = -1;
		}
		if (region)
		{
			if (region[1] == "region")
			{
				regions.push(l);
			}
			else if (regions.length)
			{
				out.push({ start: regions.pop(), end: l, kind: "region" });
			}
		}
		else if (block)
		{
			const close = "]" + block[1] + "]";
			if (!line.slice(line.indexOf("[", line.indexOf("--")) + block[1].length + 2).includes(close))
			{
				inBlockComment = { start: l, close };
			}
		}
	}
	return out;
}

module.exports = { tokenize, parse, formatParams, formatSignature, computeFolding, RESERVED };
