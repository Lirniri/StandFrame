// A minimal stand-in for the "vscode" module, just enough to run the providers under plain Node.

"use strict";

class Position
{
	constructor(line, character)
	{
		this.line = line;
		this.character = character;
	}
}

class Range
{
	constructor(a, b, c, d)
	{
		if (typeof a == "number")
		{
			this.start = new Position(a, b);
			this.end = new Position(c, d);
		}
		else
		{
			this.start = a;
			this.end = b;
		}
	}

	contains(other)
	{
		const le = (p, q) => p.line < q.line || (p.line == q.line && p.character <= q.character);
		return le(this.start, other.start) && le(other.end, this.end);
	}

	union(other)
	{
		const min = (p, q) => (p.line < q.line || (p.line == q.line && p.character <= q.character)) ? p : q;
		const max = (p, q) => min(p, q) === p ? q : p;
		return new Range(min(this.start, other.start), max(this.end, other.end));
	}
}

class Selection extends Range {}

class Uri
{
	constructor(scheme, path, fragment)
	{
		this.scheme = scheme;
		this.path = path;
		this.fragment = fragment || "";
		this.fsPath = path.replace(/^\/([A-Za-z]:)/, "$1");
	}

	static file(p)
	{
		p = p.replace(/\\/g, "/");
		return new Uri("file", p.startsWith("/") ? p : "/" + p);
	}

	static joinPath(base, ...parts)
	{
		return new Uri(base.scheme, [base.path.replace(/\/+$/, ""), ...parts].join("/"));
	}

	static parse(str)
	{
		const m = /^([a-z]+):\/\/([^#]*)(?:#(.*))?$/.exec(str);
		return new Uri(m[1], decodeURIComponent(m[2]), m[3]);
	}

	with(change)
	{
		return new Uri(this.scheme, this.path, change.fragment !== undefined ? change.fragment : this.fragment);
	}

	toString()
	{
		return this.scheme + "://" + this.path + (this.fragment ? "#" + this.fragment : "");
	}
}

class MarkdownString
{
	constructor(value)
	{
		this.value = value || "";
	}

	appendCodeblock(code, lang)
	{
		this.value += "\n```" + (lang || "") + "\n" + code + "\n```\n";
		return this;
	}

	appendMarkdown(text)
	{
		this.value += text;
		return this;
	}
}

class CompletionItem
{
	constructor(label, kind)
	{
		this.label = label;
		this.kind = kind;
	}
}

class Simple
{
	constructor(...args)
	{
		this.args = args;
	}
}

class DocumentSymbol
{
	constructor(name, detail, kind, range, selectionRange)
	{
		Object.assign(this, { name, detail, kind, range, selectionRange, children: [] });
	}
}

class SignatureHelp
{
	constructor()
	{
		this.signatures = [];
		this.activeSignature = 0;
		this.activeParameter = 0;
	}
}

class SignatureInformation
{
	constructor(label, documentation)
	{
		this.label = label;
		this.documentation = documentation;
		this.parameters = [];
	}
}

class ParameterInformation
{
	constructor(label, documentation)
	{
		this.label = label;
		this.documentation = documentation;
	}
}

class Hover
{
	constructor(contents, range)
	{
		this.contents = Array.isArray(contents) ? contents : [contents];
		this.range = range;
	}
}

class Location
{
	constructor(uri, position)
	{
		this.uri = uri;
		this.range = new Range(position, position);
	}
}

class FoldingRange
{
	constructor(start, end, kind)
	{
		Object.assign(this, { start, end, kind });
	}
}

class RelativePattern
{
	constructor(base, pattern)
	{
		this.base = base;
		this.pattern = pattern;
	}
}

const enumOf = (...names) => Object.fromEntries(names.map((n, i) => [n, i]));

/**
 * Creates a TextDocument look-alike.
 */
function createDocument(path, text, languageId)
{
	const lines = text.split(/\r?\n/);
	const uri = Uri.file(path);
	return {
		uri,
		fileName: uri.fsPath,
		languageId: languageId || "pluto",
		version: 1,
		lineCount: lines.length,
		isClosed: false,
		eol: 1,
		lineAt(line)
		{
			if (typeof line != "number")
			{
				line = line.line;
			}
			return { text: lines[line], range: new Range(line, 0, line, lines[line].length) };
		},
		getText(range)
		{
			if (!range)
			{
				return text;
			}
			return text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
		},
		offsetAt(position)
		{
			let offset = 0;
			for (let l = 0; l < position.line; ++l)
			{
				offset += lines[l].length + 1;
			}
			return offset + position.character;
		},
	};
}

const config = {};

module.exports = {
	Position,
	Range,
	Selection,
	Uri,
	MarkdownString,
	CompletionItem,
	DocumentSymbol,
	SignatureHelp,
	SignatureInformation,
	ParameterInformation,
	Hover,
	Location,
	FoldingRange,
	RelativePattern,
	SymbolInformation: Simple,
	SymbolKind: enumOf("File", "Module", "Namespace", "Package", "Class", "Method", "Property", "Field", "Constructor", "Enum", "Interface", "Function", "Variable", "Constant", "String", "Number", "Boolean", "Array", "Object", "Key", "Null", "EnumMember", "Struct", "Event", "Operator", "TypeParameter"),
	CompletionItemKind: enumOf("Text", "Method", "Function", "Constructor", "Field", "Variable", "Class", "Interface", "Module", "Property", "Unit", "Value", "Enum", "Keyword", "Snippet", "Color", "File", "Reference", "Folder", "EnumMember", "Constant"),
	CompletionItemTag: { Deprecated: 1 },
	SymbolTag: { Deprecated: 1 },
	CompletionTriggerKind: { Invoke: 0, TriggerCharacter: 1 },
	FoldingRangeKind: { Comment: 1, Imports: 2, Region: 3 },
	TextDocumentChangeReason: { Undo: 1, Redo: 2 },
	EndOfLine: { LF: 1, CRLF: 2 },
	workspace: {
		workspaceFolders: [{ uri: Uri.file("/ws"), name: "ws", index: 0 }],
		textDocuments: [],
		asRelativePath(value)
		{
			const p = typeof value == "string" ? value.replace(/\\/g, "/") : value.path;
			return p.replace(/^\/ws\//, "");
		},
		getWorkspaceFolder(uri)
		{
			return uri.path.startsWith("/ws/") ? this.workspaceFolders[0] : undefined;
		},
		// Keys are stored fully qualified ("search.exclude"); settings of this extension may also be
		// stored without the "pluto." prefix ("outline.parameters").
		getConfiguration(section)
		{
			return {
				get(key, fallback)
				{
					const full = section ? section + "." + key : key;
					const short = full.replace(/^pluto\./, "");
					return full in config ? config[full] : short in config ? config[short] : fallback;
				},
			};
		},
	},
	window: {},
	createDocument,
	config,
};
