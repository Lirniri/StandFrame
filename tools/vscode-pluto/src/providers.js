// VS Code language feature providers for Pluto.

"use strict";

const vscode = require("vscode");
const fs = require("fs");
const { formatFunctionSource } = require("./functionSource");
const builtins = require("./builtins");
const { formatSignature, formatParams, computeFolding } = require("./parser");
const { chainBefore, chainAt, requireAt, findCall, typeAnnotationAt, PRIMITIVE_TYPES } = require("./analysis");

const SYMBOL_KINDS = {
	class: vscode.SymbolKind.Class,
	function: vscode.SymbolKind.Function,
	method: vscode.SymbolKind.Method,
	field: vscode.SymbolKind.Field,
	variable: vscode.SymbolKind.Variable,
	parameter: vscode.SymbolKind.Variable,
	enum: vscode.SymbolKind.Enum,
	enumMember: vscode.SymbolKind.EnumMember,
};

/** Upper bound of calls/returns listed under a single function in the Outline. */
const MAX_CALLS_PER_FUNCTION = 50;

const COMPLETION_KINDS = {
	class: vscode.CompletionItemKind.Class,
	function: vscode.CompletionItemKind.Function,
	method: vscode.CompletionItemKind.Method,
	field: vscode.CompletionItemKind.Field,
	variable: vscode.CompletionItemKind.Variable,
	parameter: vscode.CompletionItemKind.Variable,
	enum: vscode.CompletionItemKind.Enum,
	enumMember: vscode.CompletionItemKind.EnumMember,
};

/**
 * Describes where the cursor is: in code, in a comment, or in a string (and where it started).
 * Only considers the current line, which is enough for everything but long strings/comments.
 * @param {string} before Text of the line up to the cursor.
 */
function lineContext(before)
{
	let quote = null;
	let stringStart = -1;
	for (let i = 0; i < before.length; ++i)
	{
		const c = before[i];
		if (quote)
		{
			if (c == "\\")
			{
				++i;
			}
			else if (c == quote)
			{
				quote = null;
			}
		}
		else if (c == "\"" || c == "'")
		{
			quote = c;
			stringStart = i + 1;
		}
		else if (c == "-" && before[i + 1] == "-")
		{
			return { kind: "comment" };
		}
	}
	return quote ? { kind: "string", start: stringStart } : { kind: "code" };
}

/**
 * The string literal the column is inside of, if any.
 */
function stringAt(lineText, col)
{
	const ctx = lineContext(lineText.slice(0, col));
	if (ctx.kind != "string")
	{
		return null;
	}
	const quote = lineText[ctx.start - 1];
	let end = ctx.start;
	while (end < lineText.length && lineText[end] != quote)
	{
		end += lineText[end] == "\\" ? 2 : 1;
	}
	return { value: lineText.slice(ctx.start, end), start: ctx.start, end: Math.min(end, lineText.length) };
}

/**
 * @param {import("./extension").LanguageService} service
 */
function createProviders(service)
{
	const { index, analyzer } = service;

	const uriOf = (file) => vscode.Uri.parse(file.key, true);
	const relPath = (file) => vscode.workspace.asRelativePath(uriOf(file), vscode.workspace.workspaceFolders !== undefined && vscode.workspace.workspaceFolders.length > 1);
	const locationOf = (sym) => new vscode.Location(uriOf(sym.file), new vscode.Position(sym.line, sym.col));

	const escapeLinkText = (s) => s.replace(/([\[\]\\*_`])/g, "\\$1");

	/**
	 * Link to a declaration. Within the same file it is just the line number; for other files the
	 * format follows `pluto.hover.sourcePath`. The full path is always available as the link's tooltip.
	 * @param {any} sym
	 * @param {any} fromFile The file the hover/completion was requested in.
	 */
	const sourceLink = function (sym, fromFile)
	{
		const mode = vscode.workspace.getConfiguration("pluto").get("hover.sourcePath", "short");
		if (mode == "none")
		{
			return "";
		}
		const line = sym.line + 1;
		const uri = uriOf(sym.file).with({ fragment: "L" + line }).toString();
		if (fromFile && sym.file.key == fromFile.key)
		{
			return "[Line " + line + "](" + uri + ")";
		}
		const rel = relPath(sym.file);
		const label = mode == "relative" ? rel : rel.slice(rel.lastIndexOf("/") + 1);
		return "[" + escapeLinkText(label) + ":" + line + "](" + uri + " \"" + rel.replace(/"/g, "'") + "\")";
	};

	/**
	 * @param {any} sym
	 * @param {any} [fromFile] When given, a link to the declaration is appended.
	 */
	const symbolMarkdown = function (sym, fromFile)
	{
		const md = new vscode.MarkdownString();
		md.appendCodeblock(formatSignature(sym), "pluto");
		if (sym.doc)
		{
			md.appendMarkdown(sym.doc.replace(/\n/g, "  \n") + "\n\n");
		}
		if (fromFile && sym.file)
		{
			md.appendMarkdown(sourceLink(sym, fromFile));
		}
		return md;
	};

	/**
	 * Current text of a file of the index: an open editor wins over what is on disk.
	 * @returns {string|null}
	 */
	const textOf = function (file, document)
	{
		if (document && file.key == document.uri.toString())
		{
			return document.getText();
		}
		const open = vscode.workspace.textDocuments.find(d => d.uri.toString() == file.key);
		if (open)
		{
			return open.getText();
		}
		try
		{
			if (fs.statSync(file.path).size > 2 * 1024 * 1024)
			{
				return null;
			}
			return fs.readFileSync(file.path, "utf8");
		}
		catch (e)
		{
			return null;
		}
	};

	/**
	 * Appends the formatted source of a function below a separator.
	 * @param {vscode.MarkdownString} md
	 * @param {any} sym
	 * @param {vscode.TextDocument} document
	 */
	const appendFunctionBody = function (md, sym, document)
	{
		const config = vscode.workspace.getConfiguration("pluto");
		if (!config.get("hover.showFunctionBody", true) || !sym.file || sym.endLine === undefined || sym.endLine < sym.line)
		{
			return;
		}
		const text = textOf(sym.file, document);
		if (text === null)
		{
			return;
		}
		const lines = text.split(/\r?\n/);
		// The index may be older than the text: make sure this is still a function.
		if (sym.endLine >= lines.length || !/\bfunction\b|->/.test(lines[sym.line]))
		{
			return;
		}
		const code = formatFunctionSource(lines.slice(sym.line, sym.endLine + 1).join("\n"), {
			maxLines: Number(config.get("hover.maxBodyLines", 25)) || 0,
		});
		if (!code)
		{
			return;
		}
		const longest = Math.max(0, ...(code.match(/`+/g) || []).map(s => s.length));
		const fence = "`".repeat(Math.max(3, longest + 1));
		md.appendMarkdown("\n\n---\n\n" + fence + "pluto\n" + code + "\n" + fence + "\n");
	};

	const builtinMarkdown = function (entry)
	{
		const md = new vscode.MarkdownString();
		md.appendCodeblock(builtins.formatBuiltinSignature(entry), "pluto");
		md.appendMarkdown(builtins.formatBuiltinDoc(entry));
		return md;
	};

	const moduleMarkdown = function (moduleName, document)
	{
		const md = new vscode.MarkdownString();
		const resolved = index.resolveModule(moduleName, document.uri.fsPath);
		if (resolved && resolved.manifest)
		{
			const m = resolved.manifest;
			md.appendCodeblock("(module) " + m.id + (m.version ? " " + m.version : ""), "pluto");
			if (m.name && m.name != m.id)
			{
				md.appendMarkdown("**" + m.name + "**\n\n");
			}
			if (m.description)
			{
				md.appendMarkdown(m.description + "\n\n");
			}
			md.appendMarkdown("*Manifest:* [" + vscode.workspace.asRelativePath(m.path) + "](" + vscode.Uri.file(m.path).toString() + ")");
			return md;
		}
		if (resolved && resolved.file)
		{
			md.appendCodeblock("(module) " + moduleName, "pluto");
			md.appendMarkdown("*File:* [" + relPath(resolved.file) + "](" + uriOf(resolved.file).toString() + ")");
			return md;
		}
		const lib = builtins.libForModule(moduleName);
		if (lib)
		{
			md.appendCodeblock("(built-in module) " + (moduleName.startsWith("pluto:") ? moduleName : "pluto:" + moduleName), "pluto");
			md.appendMarkdown(builtins.libs.get(lib).doc || "");
			const names = (builtins.members.get(lib) || []).map(e => "`" + e.short + "`");
			if (names.length)
			{
				md.appendMarkdown("\n\n" + names.slice(0, 40).join(", ") + (names.length > 40 ? ", …" : ""));
			}
			return md;
		}
		return null;
	};

	// ---------------------------------------------------------------------------------------
	// Completion
	// ---------------------------------------------------------------------------------------

	const symbolItem = function (sym, sortPrefix, fromFile)
	{
		const item = new vscode.CompletionItem(sym.name, COMPLETION_KINDS[sym.kind] || vscode.CompletionItemKind.Text);
		item.detail = formatSignature(sym);
		item.sortText = sortPrefix + sym.name;
		item.documentation = symbolMarkdown(sym, fromFile);
		return item;
	};

	const builtinItem = function (entry, sortPrefix, label)
	{
		const kind = entry.params === undefined
			? (entry.table ? vscode.CompletionItemKind.Module : vscode.CompletionItemKind.Constant)
			: (entry.method ? vscode.CompletionItemKind.Method : vscode.CompletionItemKind.Function);
		const item = new vscode.CompletionItem(label || entry.short, kind);
		item.detail = builtins.formatBuiltinSignature(entry);
		item.sortText = sortPrefix + entry.short;
		item.documentation = new vscode.MarkdownString(builtins.formatBuiltinDoc(entry));
		return item;
	};

	const moduleItems = function (document, range)
	{
		const items = [];
		const seen = new Set();
		const add = function (label, detail, doc, sortPrefix)
		{
			if (seen.has(label))
			{
				return;
			}
			seen.add(label);
			const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Module);
			item.detail = detail;
			item.documentation = doc ? new vscode.MarkdownString(doc) : undefined;
			item.sortText = sortPrefix + label;
			item.filterText = label;
			item.insertText = label;
			item.range = range;
			items.push(item);
		};
		for (const m of index.manifests.values())
		{
			add(m.id, "module" + (m.version ? " " + m.version : "") + " — " + vscode.workspace.asRelativePath(m.path),
				[m.name && m.name != m.id ? "**" + m.name + "**" : "", m.description || ""].filter(Boolean).join("\n\n"), "0");
		}
		for (const m of builtins.modules)
		{
			add(m.id, "built-in module", m.doc, "1");
		}
		// Files of the workspace, as module paths relative to the requiring file or its workspace folder.
		const folder = vscode.workspace.getWorkspaceFolder(document.uri);
		const here = document.uri.fsPath.replace(/\\/g, "/").replace(/\/[^/]*$/, "");
		const root = folder ? folder.uri.fsPath.replace(/\\/g, "/") : here;
		for (const file of index.files.values())
		{
			if (file.key == document.uri.toString())
			{
				continue;
			}
			const base = file.path.startsWith(here + "/") ? here : (file.path.startsWith(root + "/") ? root : null);
			if (!base)
			{
				continue;
			}
			let rel = file.path.slice(base.length + 1).replace(/\.(pluto|lua)$/, "").replace(/\/init$/, "");
			if (!rel || /[.\s]/.test(rel))
			{
				continue; // not expressible as a dotted module name
			}
			add(rel.replace(/\//g, "."), vscode.workspace.asRelativePath(file.path), "", "2");
		}
		return items;
	};

	const completionProvider = {
		/**
		 * @param {vscode.TextDocument} document
		 * @param {vscode.Position} position
		 * @param {vscode.CancellationToken} token
		 * @param {vscode.CompletionContext} context
		 */
		provideCompletionItems(document, position, token, context)
		{
			const lineText = document.lineAt(position.line).text;
			const before = lineText.slice(0, position.character);
			const ctx = lineContext(before);
			if (ctx.kind == "comment")
			{
				return undefined;
			}
			if (ctx.kind == "string")
			{
				const range = new vscode.Range(position.line, ctx.start, position.line, position.character);
				if (/\brequire\s*\(?\s*$/.test(before.slice(0, ctx.start - 1)))
				{
					return moduleItems(document, range);
				}
				// Module ids are also handy in other strings, but only when explicitly asked for.
				if (context.triggerKind == vscode.CompletionTriggerKind.Invoke && index.manifests.size)
				{
					return moduleItems(document, range).filter(i => i.sortText.startsWith("0"));
				}
				return undefined;
			}
			if (context.triggerCharacter == "\"" || context.triggerCharacter == "'")
			{
				return undefined;
			}

			const file = service.getRecord(document);
			const chain = chainBefore(lineText, position.character);
			const prefixStart = position.character - chain.prefix.length;

			// Type hint (`ped: |`, `function f(): |`): suggest types, not members of `ped`.
			if (isTypeHintPosition(before.slice(0, prefixStart)))
			{
				const items = [];
				for (const [name, doc] of PRIMITIVE_TYPES)
				{
					const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.TypeParameter || vscode.CompletionItemKind.Keyword);
					item.detail = "(type) " + name;
					item.documentation = new vscode.MarkdownString(doc);
					item.sortText = "0" + name;
					items.push(item);
				}
				const seen = new Set(PRIMITIVE_TYPES.keys());
				for (const sym of [...analyzer.visibleLocals(file, position.line).values(), ...index.globals()])
				{
					if ((sym.kind == "class" || sym.kind == "enum") && !sym.container && !seen.has(sym.name))
					{
						seen.add(sym.name);
						items.push(symbolItem(sym, "1", file));
					}
				}
				return items;
			}
			const charBefore = before[prefixStart - 1];
			const charBefore2 = before[prefixStart - 2];

			// Member access: `receiver.` / `receiver:`
			let memberSep = null;
			if (chain.receiver.length)
			{
				memberSep = chain.seps[chain.seps.length - 1];
			}
			else if ((charBefore == "." && charBefore2 != "." && !/[0-9]/.test(charBefore2 || "")) || (charBefore == ":" && charBefore2 != ":"))
			{
				memberSep = charBefore;
			}
			if (memberSep)
			{
				const found = analyzer.completeMembers(file, position.line, chain.receiver, memberSep);
				const items = [];
				const seen = new Set();
				for (const sym of found.symbols)
				{
					const isCallable = sym.kind == "method" || sym.kind == "function";
					if (memberSep == ":" && (!isCallable || sym.static))
					{
						continue;
					}
					if (seen.has(sym.name))
					{
						continue;
					}
					seen.add(sym.name);
					// Members that fit the access style are listed first.
					const fits = memberSep == ":" ? sym.sep == ":" : sym.sep != ":";
					items.push(symbolItem(sym, (found.guessed ? "2" : fits ? "0" : "1"), file));
				}
				for (const entry of found.builtins)
				{
					if (seen.has(entry.short) || (memberSep == ":" && entry.params === undefined))
					{
						continue;
					}
					seen.add(entry.short);
					items.push(builtinItem(entry, found.guessed ? "3" : "0"));
				}
				return items;
			}
			if (context.triggerCharacter == "." || context.triggerCharacter == ":")
			{
				return undefined;
			}

			// Don't get in the way while the user is naming a new declaration.
			if (/\b(?:function|local|class|enum|for|goto)\s+[\w.:]*$/.test(before) && !/\blocal\s+function\s+$/.test(before))
			{
				return undefined;
			}

			const items = [];
			const seen = new Set();
			const config = vscode.workspace.getConfiguration("pluto", document.uri);
			const classesOnly = /\b(?:new|extends|instanceof)\s+\w*$/.test(before);

			// Locals in scope
			if (!classesOnly)
			{
				for (const sym of analyzer.visibleLocals(file, position.line).values())
				{
					if (sym.line == position.line && sym.kind != "parameter" && sym.col >= prefixStart)
					{
						continue; // the name being typed right now
					}
					seen.add(sym.name);
					items.push(symbolItem(sym, "0", file));
				}
			}
			// Workspace declarations
			for (const sym of index.globals())
			{
				if (seen.has(sym.name) || (classesOnly && sym.kind != "class"))
				{
					continue;
				}
				seen.add(sym.name);
				items.push(symbolItem(sym, sym.file === file ? "1" : "2", file));
			}
			// Names that only exist as containers: `function Foo.bar()` without a declaration of Foo.
			if (!classesOnly)
			{
				for (const f of index.visibleFiles())
				{
					for (const sym of f.symbols)
					{
						const head = sym.container ? sym.container.split(".")[0] : null;
						if (head && !seen.has(head) && (!sym.local || f === file) && !index.lookup(head).some(s => !s.container && s.local && s.file !== file))
						{
							seen.add(head);
							const item = new vscode.CompletionItem(head, vscode.CompletionItemKind.Module);
							item.detail = "table — " + relPath(f);
							item.sortText = "2" + head;
							items.push(item);
						}
					}
				}
			}
			if (classesOnly)
			{
				return items;
			}
			// Built-in functions & libraries
			for (const entry of builtins.globals)
			{
				if (!seen.has(entry.name))
				{
					seen.add(entry.name);
					items.push(builtinItem(entry, "3"));
				}
			}
			for (const [name, info] of builtins.libs)
			{
				if (!seen.has(name))
				{
					seen.add(name);
					const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
					item.detail = info.require ? "library — require \"pluto:" + name + "\"" : "library";
					item.documentation = new vscode.MarkdownString(info.doc);
					item.sortText = "3" + name;
					items.push(item);
				}
			}
			// Keywords
			if (config.get("completion.keywords", true))
			{
				for (const kw of builtins.KEYWORDS)
				{
					if (seen.has(kw.name))
					{
						continue;
					}
					seen.add(kw.name);
					const item = new vscode.CompletionItem(kw.name, vscode.CompletionItemKind.Keyword);
					item.detail = kw.deprecated ? "keyword (removed from Pluto)" : "keyword";
					item.documentation = new vscode.MarkdownString(kw.doc);
					item.sortText = "4" + kw.name;
					if (kw.deprecated)
					{
						item.tags = [vscode.CompletionItemTag.Deprecated];
					}
					items.push(item);
				}
			}
			// Other words of this document, since a completion provider replaces word-based suggestions.
			if (config.get("completion.documentWords", true) && document.lineCount < 20000)
			{
				const text = document.getText();
				const re = /[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]{2,}/g;
				const offset = document.offsetAt(position);
				let m;
				let count = 0;
				while ((m = re.exec(text)) !== null && count < 3000)
				{
					if (!seen.has(m[0]) && !(m.index <= offset && offset <= m.index + m[0].length))
					{
						seen.add(m[0]);
						++count;
						const item = new vscode.CompletionItem(m[0], vscode.CompletionItemKind.Text);
						item.sortText = "5" + m[0];
						items.push(item);
					}
				}
			}
			return items;
		},
	};

	// ---------------------------------------------------------------------------------------
	// Hover
	// ---------------------------------------------------------------------------------------

	const hoverProvider = {
		/**
		 * @param {vscode.TextDocument} document
		 * @param {vscode.Position} position
		 */
		provideHover(document, position)
		{
			const lineText = document.lineAt(position.line).text;
			const ctx = lineContext(lineText.slice(0, position.character));
			if (ctx.kind == "comment")
			{
				return undefined;
			}
			const str = stringAt(lineText, position.character);
			if (str)
			{
				const req = requireAt(lineText, position.character);
				const isManifestId = [...index.manifests.values()].some(m => m.id == str.value);
				if (req || isManifestId)
				{
					const md = moduleMarkdown(req ? req.module : str.value, document);
					if (md)
					{
						return new vscode.Hover(md, new vscode.Range(position.line, str.start, position.line, str.end));
					}
				}
				return undefined;
			}
			const chain = typeHintChain(chainAt(lineText, position.character), lineText);
			if (!chain)
			{
				return undefined;
			}
			const range = new vscode.Range(position.line, chain.start, position.line, chain.end);
			if (chain.primitive)
			{
				// `int` in `ped: int = 0`: a built-in type, not a field named `int`.
				const md = new vscode.MarkdownString();
				md.appendCodeblock("(type) " + chain.word, "pluto");
				md.appendMarkdown(PRIMITIVE_TYPES.get(chain.word));
				return new vscode.Hover(md, range);
			}
			const file = service.getRecord(document);
			const resolved = analyzer.resolve(file, position.line, chain.parts, { lastSep: chain.lastSep });
			const contents = [];
			for (const sym of resolved.symbols.slice(0, 4))
			{
				// Hovering a class shows its constructor, too.
				const md = symbolMarkdown(sym, file);
				// The source is only shown when it is clear which function is meant.
				if (resolved.symbols.length == 1 && (sym.kind == "function" || sym.kind == "method") && Array.isArray(sym.params))
				{
					appendFunctionBody(md, sym, document);
				}
				contents.push(md);
				if (sym.kind == "class")
				{
					const ctor = analyzer.membersOf(sym.name, sym.file).find(s => s.name == "__construct");
					if (ctor)
					{
						contents.push(symbolMarkdown(ctor, null));
					}
				}
			}
			if (resolved.symbols.length > 4)
			{
				contents.push(new vscode.MarkdownString("*…and " + (resolved.symbols.length - 4) + " more declarations*"));
			}
			if (resolved.builtin)
			{
				contents.push(builtinMarkdown(resolved.builtin));
			}
			if (resolved.lib)
			{
				const info = builtins.libs.get(resolved.lib);
				const md = new vscode.MarkdownString();
				md.appendCodeblock("(library) " + resolved.lib, "pluto");
				md.appendMarkdown(info.doc + (info.require ? "\n\nRequires `local " + resolved.lib + " = require \"pluto:" + resolved.lib + "\"`" : ""));
				contents.push(md);
			}
			if (resolved.keyword && chain.parts.length == 1)
			{
				const md = new vscode.MarkdownString();
				md.appendCodeblock("(keyword) " + resolved.keyword.name, "pluto");
				md.appendMarkdown(resolved.keyword.doc);
				contents.push(md);
			}
			return contents.length ? new vscode.Hover(contents, range) : undefined;
		},
	};

	// ---------------------------------------------------------------------------------------
	// Signature help
	// ---------------------------------------------------------------------------------------

	const makeSignature = function (prefix, params, suffix, doc, paramDocs)
	{
		let label = prefix + "(";
		const infos = [];
		params.forEach(function (text, i)
		{
			if (i)
			{
				label += ", ";
			}
			const start = label.length;
			label += text;
			const info = new vscode.ParameterInformation([start, label.length]);
			if (paramDocs && paramDocs[i])
			{
				info.documentation = new vscode.MarkdownString(paramDocs[i]);
			}
			infos.push(info);
		});
		label += ")" + (suffix || "");
		const sig = new vscode.SignatureInformation(label, doc ? new vscode.MarkdownString(doc) : undefined);
		sig.parameters = infos;
		return sig;
	};

	const signatureProvider = {
		/**
		 * @param {vscode.TextDocument} document
		 * @param {vscode.Position} position
		 */
		provideSignatureHelp(document, position)
		{
			const call = findCall(document.getText(new vscode.Range(new vscode.Position(0, 0), position)));
			if (!call)
			{
				return undefined;
			}
			const file = service.getRecord(document);
			const lastSep = call.seps.length ? call.seps[call.seps.length - 1] : null;
			const callee = analyzer.resolveCallee(file, position.line, call.parts, { lastSep });
			const help = new vscode.SignatureHelp();
			const actives = [];
			const clamp = function (active, params)
			{
				if (!params.length)
				{
					return 0;
				}
				const variadic = params[params.length - 1].name == "..." || params[params.length - 1].vararg;
				return active >= params.length ? (variadic ? params.length - 1 : params.length) : active;
			};
			for (const sym of callee.symbols.slice(0, 8))
			{
				const qualified = sym.container ? sym.container + (sym.sep || ".") + sym.name : sym.name;
				const isCtor = sym.name == "__construct" && call.isNew;
				help.signatures.push(makeSignature(
					isCtor ? "new " + sym.container : qualified,
					sym.params.map(p => formatParams([p])),
					sym.returnType && !isCtor ? ": " + sym.returnType : "",
					sym.doc
				));
				// `obj:method(a)` on a function declared as `function T.method(self, a)`
				const shift = lastSep == ":" && sym.sep == "." && !isCtor && sym.params.length && sym.params[0].name == "self" ? 1 : 0;
				actives.push(clamp(call.activeParam + shift, sym.params));
			}
			if (callee.builtin && callee.builtin.params !== undefined)
			{
				const entry = callee.builtin;
				const params = entry.params || [{ name: "..." }];
				help.signatures.push(makeSignature(
					entry.method ? entry.lib + ":" + entry.short : entry.name,
					params.map(p => p.name),
					"",
					builtins.formatBuiltinDoc(entry),
					params.map(p => p.doc)
				));
				// `str:split(",")` passes the receiver as the first parameter of string.split.
				const shift = lastSep == ":" && !entry.method ? 1 : 0;
				actives.push(clamp(call.activeParam + shift, params));
			}
			if (!help.signatures.length)
			{
				return undefined;
			}
			help.activeSignature = 0;
			// Prefer an overload that has enough parameters for the current argument.
			for (let i = 0; i < help.signatures.length; ++i)
			{
				if (actives[i] < help.signatures[i].parameters.length)
				{
					help.activeSignature = i;
					break;
				}
			}
			help.activeParameter = actives[help.activeSignature];
			return help;
		},
	};

	// ---------------------------------------------------------------------------------------
	// Go to definition
	// ---------------------------------------------------------------------------------------

	const definitionProvider = {
		/**
		 * @param {vscode.TextDocument} document
		 * @param {vscode.Position} position
		 */
		provideDefinition(document, position)
		{
			const lineText = document.lineAt(position.line).text;
			const ctx = lineContext(lineText.slice(0, position.character));
			if (ctx.kind == "comment")
			{
				return undefined;
			}
			const str = stringAt(lineText, position.character);
			if (str)
			{
				const req = requireAt(lineText, position.character);
				const isManifestId = [...index.manifests.values()].some(m => m.id == str.value);
				if (!req && !isManifestId)
				{
					return undefined;
				}
				const resolved = index.resolveModule(req ? req.module : str.value, document.uri.fsPath);
				if (!resolved)
				{
					return undefined;
				}
				const target = resolved.file ? uriOf(resolved.file) : vscode.Uri.file(resolved.path);
				return [{
					originSelectionRange: new vscode.Range(position.line, str.start, position.line, str.end),
					targetUri: target,
					targetRange: new vscode.Range(0, 0, 0, 0),
				}];
			}
			const chain = typeHintChain(chainAt(lineText, position.character), lineText);
			if (!chain || chain.primitive)
			{
				return undefined; // built-in types have no declaration
			}
			const file = service.getRecord(document);
			const resolved = analyzer.resolve(file, position.line, chain.parts, { lastSep: chain.lastSep });
			const locations = resolved.symbols.filter(s => s.file).map(locationOf);
			return locations.length ? locations : undefined;
		},
	};

	// ---------------------------------------------------------------------------------------
	// Outline, breadcrumbs, workspace symbols, folding
	// ---------------------------------------------------------------------------------------

	const documentSymbolProvider = {
		/**
		 * @param {vscode.TextDocument} document
		 */
		provideDocumentSymbols(document)
		{
			const file = service.getRecord(document);
			const config = vscode.workspace.getConfiguration("pluto", document.uri);
			const opt = {
				localVariables: config.get("outline.localVariables", true),
				loopVariables: config.get("outline.loopVariables", false),
				parameters: config.get("outline.parameters", false),
				anonymousFunctions: config.get("outline.anonymousFunctions", true),
				fields: config.get("outline.fields", true),
				showValues: config.get("outline.showValues", true),
				calls: config.get("outline.calls", "none"),
			};
			// Contents of function bodies, unless switched off or the file is too large for it.
			const maxFileLines = Number(config.get("outline.maxFileLines", 1000)) || 0;
			const body = config.get("outline.showFunctionBody", true) && !(maxFileLines > 0 && document.lineCount > maxFileLines);
			if (!body)
			{
				Object.assign(opt, { localVariables: false, loopVariables: false, parameters: false, anonymousFunctions: false, calls: "none" });
			}
			const lastLine = document.lineCount - 1;
			const isFileLevel = (sym) => !sym.local || sym.scopeEnd == Number.MAX_SAFE_INTEGER;

			const kindOf = function (sym)
			{
				if (sym.kind == "call")
				{
					return vscode.SymbolKind.Event;
				}
				if (sym.kind == "return")
				{
					return vscode.SymbolKind.Operator;
				}
				if (sym.kind == "variable" || sym.kind == "field")
				{
					if (sym.module)
					{
						return vscode.SymbolKind.Module;
					}
					if (sym.attrib == "const" || sym.attrib == "close" || /^[A-Z][A-Z0-9_]*[A-Z0-9]$/.test(sym.name))
					{
						return vscode.SymbolKind.Constant;
					}
					if (sym.kind == "variable" && sym.isTable)
					{
						return sym.name == file.returnName ? vscode.SymbolKind.Module : vscode.SymbolKind.Object;
					}
					if (sym.kind == "field" && sym.static)
					{
						return vscode.SymbolKind.Property;
					}
				}
				if (sym.kind == "method" && sym.name == "__construct")
				{
					return vscode.SymbolKind.Constructor;
				}
				return SYMBOL_KINDS[sym.kind] || vscode.SymbolKind.Variable;
			};

			const detailOf = function (sym)
			{
				if (sym.kind == "call" || sym.kind == "return")
				{
					return sym.detail;
				}
				const parts = [];
				if (sym.visibility && sym.visibility != "public")
				{
					parts.push(sym.visibility);
				}
				if (sym.static)
				{
					parts.push("static");
				}
				if (sym.params)
				{
					parts.push("(" + formatParams(sym.params) + ")" + (sym.returnType ? ": " + sym.returnType : ""));
				}
				else if (sym.kind == "class" && sym.extends)
				{
					parts.push("extends " + sym.extends);
				}
				else if (sym.module)
				{
					parts.push("require \"" + sym.module + "\"");
				}
				else
				{
					if (sym.type)
					{
						parts.push(sym.type);
					}
					if (sym.value !== undefined)
					{
						parts.push("= " + sym.value);
					}
					else if (opt.showValues && sym.init && sym.init != sym.type)
					{
						parts.push("= " + sym.init);
					}
				}
				return parts.join(" ");
			};

			const make = function (sym, name)
			{
				const endLine = Math.min(Math.max(sym.endLine, sym.line), lastLine);
				const line = Math.min(sym.line, lastLine);
				const range = new vscode.Range(line, 0, endLine, document.lineAt(endLine).text.length);
				const lineLength = document.lineAt(line).text.length;
				const nameLength = sym.nameLength || (sym.anonymous ? (sym.lambda ? 1 : "function".length) : sym.name.length);
				const selection = new vscode.Range(line, Math.min(sym.col, lineLength), line, Math.min(sym.col + nameLength, lineLength));
				const node = new vscode.DocumentSymbol(name || sym.name || "?", detailOf(sym), kindOf(sym), range, selection);
				if (sym.doc && /@deprecated\b/i.test(sym.doc) && vscode.SymbolTag)
				{
					node.tags = [vscode.SymbolTag.Deprecated];
				}
				return node;
			};

			/** @type {{ sym: any, node: vscode.DocumentSymbol, member?: boolean }[]} */
			const nodes = [];
			const containers = new Map();
			const roots = [];
			const relevant = file.symbols.filter(function (sym)
			{
				if (sym.kind == "parameter")
				{
					return opt.parameters && sym.owner;
				}
				if (sym.anonymous)
				{
					return opt.anonymousFunctions;
				}
				if (sym.kind == "field" && sym.viaSelf)
				{
					return opt.fields;
				}
				if (!body && sym.local && !isFileLevel(sym))
				{
					return false; // declared inside of a function (or another block)
				}
				if (sym.kind == "variable")
				{
					if (sym.loopVar)
					{
						return opt.loopVariables;
					}
					return isFileLevel(sym) || opt.localVariables;
				}
				return true;
			});
			// Calls and returns inside of function bodies: "statements" or "all".
			if (opt.calls == "statements" || opt.calls == "all")
			{
				for (const c of file.calls || [])
				{
					if (c.kind == "call" && opt.calls == "statements" && !c.statement)
					{
						continue;
					}
					if (c.hasCallback && opt.anonymousFunctions)
					{
						continue; // shown as `callee() callback` already
					}
					relevant.push(Object.assign({}, c, { nameLength: c.callee ? c.callee.length : c.name.length }));
				}
			}
			const containerSyms = new Set();
			for (const sym of relevant)
			{
				if (!sym.container && (sym.kind == "class" || sym.kind == "enum" || sym.kind == "variable") && isFileLevel(sym) && !containers.has(sym.name))
				{
					const node = make(sym);
					containers.set(sym.name, node);
					containerSyms.add(sym);
					nodes.push({ sym, node });
				}
			}
			// Local tables of function bodies can hold members too: `local data = { key = 1 }`.
			/** @type {Map<string, { sym: any, node: vscode.DocumentSymbol }[]>} */
			const localContainers = new Map();
			for (const sym of relevant)
			{
				if (sym.kind == "variable" && !isFileLevel(sym) && sym.isTable)
				{
					const node = make(sym);
					if (!localContainers.has(sym.name))
					{
						localContainers.set(sym.name, []);
					}
					localContainers.get(sym.name).push({ sym, node });
					containerSyms.add(sym);
					nodes.push({ sym, node });
				}
			}
			const findContainer = function (sym)
			{
				let best = null;
				for (const c of localContainers.get(sym.container) || [])
				{
					if (c.sym.name == sym.container && c.sym.line <= sym.line && sym.line <= c.sym.scopeEnd && (!best || c.sym.line >= best.sym.line))
					{
						best = c;
					}
				}
				return best ? best.node : containers.get(sym.container);
			};
			// Members of a local table that isn't shown (outline.localVariables is off) are hidden as well.
			const nestedLocals = new Map();
			if (!opt.localVariables)
			{
				for (const s of file.symbols)
				{
					if (s.kind == "variable" && !isFileLevel(s))
					{
						if (!nestedLocals.has(s.name))
						{
							nestedLocals.set(s.name, []);
						}
						nestedLocals.get(s.name).push(s);
					}
				}
			}
			const hiddenLocal = (sym) => sym.container && (nestedLocals.get(sym.container) || []).some(s => s.line <= sym.line && sym.line <= s.scopeEnd);
			for (const sym of relevant)
			{
				if (containerSyms.has(sym) || hiddenLocal(sym))
				{
					continue;
				}
				const parent = sym.container ? findContainer(sym) : null;
				if (parent)
				{
					const node = make(sym);
					parent.children.push(node);
					// Lua-style `function Foo:bar()` may be declared outside of Foo's own range.
					if (!parent.range.contains(node.range))
					{
						parent.range = parent.range.union(node.range);
					}
					nodes.push({ sym, node, member: true });
				}
				else
				{
					const node = make(sym, sym.container ? sym.container + (sym.sep || ".") + sym.name : sym.name);
					nodes.push({ sym, node });
				}
			}
			// Calls per function are capped, and in "all" mode each callee is listed once.
			const bodyItems = new Map();
			const keepBodyItem = function (parentNode, item)
			{
				let seen = bodyItems.get(parentNode);
				if (!seen)
				{
					seen = new Set();
					bodyItems.set(parentNode, seen);
				}
				if (seen.size >= MAX_CALLS_PER_FUNCTION || (opt.calls == "all" && item.kind == "call" && seen.has(item.name)))
				{
					return false;
				}
				seen.add(item.kind == "call" ? item.name : "return@" + item.line + ":" + item.col);
				return true;
			};
			// Nest declarations inside the function that contains them.
			// Single pass in source order, with a stack of the functions that are still open.
			const nodeOf = new Map(nodes.map(n => [n.sym, n.node]));
			const sorted = nodes.slice().sort((a, b) => a.sym.line - b.sym.line || a.sym.col - b.sym.col);
			const open = [];
			for (const entry of sorted)
			{
				while (open.length && open[open.length - 1].sym.endLine < entry.sym.line)
				{
					open.pop();
				}
				const isFunction = entry.sym.kind == "function" || entry.sym.kind == "method";
				if (entry.member || entry.sym.kind == "parameter")
				{
					if (entry.sym.kind == "parameter")
					{
						const owner = nodeOf.get(entry.sym.owner);
						if (owner)
						{
							owner.children.push(entry.node);
						}
					}
					else if (isFunction)
					{
						open.push(entry);
					}
					continue;
				}
				let parent = null;
				for (let s = open.length - 1; s >= 0; --s)
				{
					const fn = open[s].sym;
					if (entry.sym.endLine <= fn.endLine && (fn.endLine > fn.line || entry.sym.line == fn.line))
					{
						parent = open[s];
						break;
					}
				}
				if (isFunction)
				{
					open.push(entry);
				}
				if (entry.sym.kind == "call" || entry.sym.kind == "return")
				{
					if (!parent || !keepBodyItem(parent.node, entry.sym))
					{
						continue;
					}
				}
				if (parent && parent.node.range.contains(entry.node.range))
				{
					parent.node.children.push(entry.node);
				}
				else
				{
					roots.push(entry.node);
				}
			}
			if (!body)
			{
				// Only signatures: nothing from inside of function bodies.
				for (const entry of nodes)
				{
					if (entry.sym.kind == "function" || entry.sym.kind == "method")
					{
						entry.node.children = [];
					}
				}
			}
			// Source order at every level.
			const sortNodes = function (list)
			{
				list.sort((a, b) => a.selectionRange.start.line - b.selectionRange.start.line || a.selectionRange.start.character - b.selectionRange.start.character);
				for (const n of list)
				{
					sortNodes(n.children);
				}
				return list;
			};
			return sortNodes(roots);
		},
	};

	const workspaceSymbolProvider = {
		provideWorkspaceSymbols(query)
		{
			const q = query.toLowerCase();
			const out = [];
			for (const file of index.files.values())
			{
				for (const sym of file.symbols)
				{
					if (sym.kind == "parameter" || sym.anonymous || (sym.local && sym.kind == "variable") || (sym.kind == "field" && sym.viaSelf))
					{
						continue;
					}
					const name = sym.container ? sym.container + (sym.sep || ".") + sym.name : sym.name;
					if (q && !fuzzyContains(name.toLowerCase(), q))
					{
						continue;
					}
					out.push(new vscode.SymbolInformation(name, SYMBOL_KINDS[sym.kind] || vscode.SymbolKind.Variable, sym.container || "", locationOf(sym)));
					if (out.length >= 2000)
					{
						return out;
					}
				}
			}
			return out;
		},
	};

	const foldingProvider = {
		/**
		 * @param {vscode.TextDocument} document
		 */
		provideFoldingRanges(document)
		{
			const file = service.getRecord(document);
			return computeFolding(document.getText(), file).map(function (r)
			{
				const kind = r.kind == "comment" ? vscode.FoldingRangeKind.Comment
					: r.kind == "region" ? vscode.FoldingRangeKind.Region
					: undefined;
				return new vscode.FoldingRange(r.start, r.end, kind);
			});
		},
	};

	return {
		completionProvider,
		hoverProvider,
		signatureProvider,
		definitionProvider,
		documentSymbolProvider,
		workspaceSymbolProvider,
		foldingProvider,
	};
}

// The text before the type being typed, e.g. `function f(ped: ?int|` or `local count: `.
const TYPE_TAIL = ":\\s*(?:[?\\w.]+\\s*\\|\\s*)*\\??\\s*$";
const TYPE_HINT_POSITIONS = [
	// parameter of a function declaration: `function f(a, ped: ` / `function(ped: `
	new RegExp("\\bfunction\\b[\\w.:\\s]*\\([^()]*\\b\\w+\\s*" + TYPE_TAIL),
	// return type: `function f(a): `
	new RegExp("\\bfunction\\b[\\w.:\\s]*\\([^()]*\\)\\s*" + TYPE_TAIL),
	// `local count: `, `local a: int, b: `, `public name: `, `static x: `
	new RegExp("^\\s*(?:(?:local|export|public|private|protected|static|const)\\s+)+(?:\\w+\\s*(?::\\s*[^,=]+)?,\\s*)*\\w+\\s*" + TYPE_TAIL),
	// class field without modifier, written with a space after the colon: `name: string`
	new RegExp("^\\s*\\w+:\\s+(?:[?\\w.]+\\s*\\|\\s*)*\\??\\s*$"),
];

/**
 * Whether completion at the end of `before` is inside a type hint.
 * `self:` / `obj:` (method calls) don't count.
 */
function isTypeHintPosition(before)
{
	return TYPE_HINT_POSITIONS.some(re => re.test(before));
}

/**
 * In a type hint (`ped: Ped`, `x: int`), the word is a type name on its own, not a member of what
 * precedes the `:`. Returns the chain to resolve, with `primitive` set for built-in types.
 */
function typeHintChain(chain, lineText)
{
	if (!chain)
	{
		return null;
	}
	const hint = typeAnnotationAt(lineText, chain.start, chain.end);
	if (!hint)
	{
		return chain;
	}
	return Object.assign({}, chain, { parts: [chain.word], seps: [], lastSep: null, primitive: hint.primitive });
}

function fuzzyContains(haystack, needle)
{
	let i = 0;
	for (const c of haystack)
	{
		if (c == needle[i])
		{
			++i;
			if (i == needle.length)
			{
				return true;
			}
		}
	}
	return needle.length == 0;
}

module.exports = { createProviders, lineContext, stringAt };
