// Tests for the language features (parser, workspace index, providers).
// Runs under plain Node with a mocked "vscode" module: node test/language.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const vscode = require("./vscode-mock");
const originalLoad = Module._load;
Module._load = function (request, ...rest)
{
	return request == "vscode" ? vscode : originalLoad.call(this, request, ...rest);
};

const { parse, formatSignature, computeFolding } = require("../src/parser");
const { WorkspaceIndex } = require("../src/workspaceIndex");
const { Analyzer, findCall, chainAt, chainBefore } = require("../src/analysis");
const builtins = require("../src/builtins");
const { createProviders } = require("../src/providers");
const { closerFor } = require("../src/extension");

let failed = 0;
let passed = 0;
function test(name, fn)
{
	try
	{
		fn();
		++passed;
	}
	catch (e)
	{
		++failed;
		console.log("FAIL: " + name + "\n" + (e.stack || e));
	}
}

// ---------------------------------------------------------------------------------------------
// Fixture workspace
// ---------------------------------------------------------------------------------------------

const FILES = {
	"/ws/lib/animal.pluto": [
		"class Animal",
		"    legs = 4",
		"    function speak(sound: string)",
		"        print(sound)",
		"    end",
		"end",
	].join("\n"),
	"/ws/lib/human.pluto": [
		"-- A human being.",
		"-- Walks upright.",
		"class Human extends Animal",
		"    public name: string",
		"    static count = 0",
		"",
		"    --- Creates a human.",
		"    function __construct(name: string, age: number = 3)",
		"        self.name = name",
		"        self.age = age",
		"    end",
		"",
		"    -- Returns the name.",
		"    function getName(): string",
		"        return self.name",
		"    end",
		"",
		"    static function create(name: string, age?: number): Human",
		"        return new Human(name, age)",
		"    end",
		"end",
		"",
		"enum Color begin",
		"    RED,",
		"    GREEN = 5",
		"end",
		"",
		"--- Greets someone.",
		"function greet(who: string, loud?: bool): string",
		"    return \"hi \" .. who",
		"end",
	].join("\n"),
	"/ws/lib/util.lua": [
		"local M = {}",
		"--- Adds two numbers.",
		"function M.add(a, b) return a + b end",
		"function M:method(x) end",
		"M.version = 3",
		"local function hidden() end",
		"return M",
	].join("\n"),
	"/ws/mods/chat/init.pluto": "export function send(text: string) end\n",
};

const index = new WorkspaceIndex();
const analyzer = new Analyzer(index);
for (const [p, text] of Object.entries(FILES))
{
	index.setFile(vscode.Uri.file(p).toString(), p, text);
}
index.setManifest(vscode.Uri.file("/ws/mods/chat/info.json").toString(), "/ws/mods/chat/info.json",
	JSON.stringify({ id: "chat-module", name: "Chat", description: "Chat helpers", version: "1.2.0" }));

const service = {
	index,
	analyzer,
	getRecord(document)
	{
		return index.setFile(document.uri.toString(), document.uri.fsPath, document.getText(), false, { calls: true });
	},
};
const providers = createProviders(service);

// Creates /ws/main.pluto from text containing a `|` cursor marker.
function at(text)
{
	const offset = text.indexOf("|");
	assert(offset != -1, "missing cursor marker");
	const clean = text.slice(0, offset) + text.slice(offset + 1);
	const before = clean.slice(0, offset).split("\n");
	const document = vscode.createDocument("/ws/main.pluto", clean);
	return { document, position: new vscode.Position(before.length - 1, before[before.length - 1].length) };
}

function complete(text, context)
{
	const { document, position } = at(text);
	const items = providers.completionProvider.provideCompletionItems(document, position, null, context || { triggerKind: 0 }) || [];
	return { items, labels: items.map(i => i.label), get: (label) => items.find(i => i.label == label) };
}

function hover(text)
{
	const { document, position } = at(text);
	const h = providers.hoverProvider.provideHover(document, position);
	return h ? h.contents.map(c => c.value).join("\n---\n") : null;
}

function signature(text)
{
	const { document, position } = at(text);
	return providers.signatureProvider.provideSignatureHelp(document, position);
}

function definition(text)
{
	const { document, position } = at(text);
	return providers.definitionProvider.provideDefinition(document, position);
}

// ---------------------------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------------------------

test("parser: classes, methods and fields", function ()
{
	const { symbols } = parse(FILES["/ws/lib/human.pluto"]);
	const sig = (name) => formatSignature(symbols.find(s => s.name == name && s.kind != "parameter"));
	assert.strictEqual(sig("Human"), "class Human extends Animal");
	assert.strictEqual(sig("__construct"), "function Human:__construct(name: string, age: number = 3)");
	assert.strictEqual(sig("getName"), "function Human:getName(): string");
	assert.strictEqual(sig("create"), "static function Human.create(name: string, age?: number): Human");
	assert.strictEqual(sig("name"), "public Human.name: string");
	assert.strictEqual(sig("count"), "static Human.count = 0");
	assert.strictEqual(sig("greet"), "function greet(who: string, loud?: bool): string");
	assert.strictEqual(sig("GREEN"), "Color.GREEN = 5");
	assert.strictEqual(symbols.find(s => s.name == "Human").doc, "A human being.\nWalks upright.");
	assert.strictEqual(symbols.find(s => s.name == "__construct").doc, "Creates a human.");
	assert(symbols.some(s => s.name == "age" && s.kind == "field" && s.container == "Human"), "self.age is a field");
	assert.strictEqual(symbols.find(s => s.name == "Human").endLine, 20);
});

test("parser: Lua-style modules, lambdas and table members", function ()
{
	const { symbols, returnName } = parse([
		"local M = {",
		"    key = 1,",
		"    fn = function(a) end,",
		"    function meth(b) end,",
		"    static function st(c) end,",
		"}",
		"M.helper = function(q) end",
		"local lam = |a, b| -> a + b",
		"local f <const> = function(x) end",
		"globalFn = function(z) end",
		"$declare function tonumber(str: string, base: ?number): number",
		"return M",
	].join("\n"));
	const sig = (name) => formatSignature(symbols.find(s => s.name == name && s.kind != "parameter"));
	assert.strictEqual(sig("key"), "M.key = 1");
	assert.strictEqual(sig("fn"), "function M.fn(a)");
	assert.strictEqual(sig("meth"), "function M:meth(b)");
	assert.strictEqual(sig("st"), "static function M.st(c)");
	assert.strictEqual(sig("helper"), "function M.helper(q)");
	assert.strictEqual(sig("lam"), "local function lam(a, b)");
	assert.strictEqual(sig("f"), "local function f(x)");
	assert.strictEqual(sig("globalFn"), "function globalFn(z)");
	assert.strictEqual(sig("tonumber"), "function tonumber(str: string, base: ?number): number");
	assert.strictEqual(returnName, "M");
});

test("parser: block structure survives Pluto-specific syntax", function ()
{
	const source = [
		"local x = if a then 1 else 2",          // ternary: no `end`
		"local t = { class = 1, end = 2, enum = 3 }",
		"$if DEBUG then",
		"$end",
		"if a do b() end",                       // `do` instead of `then`
		"switch x do",
		"    case 1: if a then b() end",
		"    default:",
		"end",
		"repeat local r = 1 until r",
		"for t as v do end",
		"local s = [[ end if function ]]",
		"-- end end end",
		"--[==[ function ]==]",
		"::continue::",
		"goto continue",
		"local g = |x| -> do return x end",
		"local class = 1",
		"local str = \"if then\"",
		"enum class E begin A, B end",
		"function outer()",
		"    local function inner() end",
		"end",
	].join("\n");
	const parsed = parse(source);
	assert.strictEqual(parsed.unclosed, 0);
	const outer = parsed.symbols.find(s => s.name == "outer");
	assert.strictEqual(outer.endLine, outer.line + 2);
	const inner = parsed.symbols.find(s => s.name == "inner");
	assert.deepStrictEqual([inner.scopeStart, inner.scopeEnd], [outer.line + 1, outer.line + 2]);
});

test("parser: unclosed blocks are counted, malformed input never throws", function ()
{
	assert.strictEqual(parse("function f()\n  if x then\n").unclosed, 2);
	assert.strictEqual(parse("class A\n  function m()\n  end\n").unclosed, 1);
	for (const garbage of ["", "end end end", "}}}", "function", "class", "local", "function (", "local x = {{{", "\"unterminated", "--[[ open", "enum", "for", "new", "$", "a.b.", "|||"])
	{
		parse(garbage);
	}
});

test("parser: folding ranges", function ()
{
	const text = "if a then\n x()\nelseif b then\n y()\nelse\n z()\nend\n-- a\n-- b\n--#region R\nlocal q\n--#endregion\n--[[\n c\n]]";
	const ranges = computeFolding(text, parse(text));
	const has = (start, end, kind) => ranges.some(r => r.start == start && r.end == end && r.kind == kind);
	assert(has(0, 1), "if branch");
	assert(has(2, 3), "elseif branch");
	assert(has(4, 5), "else branch");
	assert(has(7, 8, "comment"), "line comments");
	assert(has(9, 11, "region"), "region");
	assert(has(12, 14, "comment"), "block comment");
});

// ---------------------------------------------------------------------------------------------
// Built-ins
// ---------------------------------------------------------------------------------------------

test("builtins: Pluto standard library is known", function ()
{
	for (const name of ["string.startswith", "string.endswith", "string.split", "table.contains", "io.listdir",
		"json.encode", "json.decode", "base64.encode", "crypto.sha256", "http.request", "url.parse", "regex.new",
		"print", "pairs", "string.format", "table.insert", "dumpvar"])
	{
		assert(builtins.functions.has(name), name);
	}
	for (const id of ["pluto:json", "pluto:regex", "pluto:crypto", "pluto:base64", "pluto:http", "pluto:url"])
	{
		assert(builtins.modules.some(m => m.id == id), id);
	}
	assert.strictEqual(builtins.formatBuiltinSignature(builtins.functions.get("string.split")), "function string.split(str, separator, limit?)");
	for (const kw of ["class", "extends", "new", "switch", "case", "default", "enum", "local", "function", "try", "catch", "pluto_use"])
	{
		assert(builtins.keywordMap.has(kw), kw);
	}
});

// ---------------------------------------------------------------------------------------------
// Analysis helpers
// ---------------------------------------------------------------------------------------------

test("analysis: expression chains", function ()
{
	assert.deepStrictEqual(chainBefore("  foo.bar:ba", 12), { receiver: ["foo", "bar"], seps: [".", ":"], prefix: "ba" });
	assert.deepStrictEqual(chainBefore("x = a?.b.", 9).receiver, ["a", "b"]);
	const c = chainAt("local v = foo.bar:baz()", 15);
	assert.deepStrictEqual(c.parts, ["foo", "bar"]);
	assert.strictEqual(chainAt("x = 123", 5), null);
});

test("analysis: findCall", function ()
{
	assert.deepStrictEqual(findCall("foo(a, b, "), { parts: ["foo"], seps: [], isNew: false, activeParam: 2 });
	assert.strictEqual(findCall("foo(a, {x, y, z}, bar(1, 2), ").activeParam, 3);
	assert.deepStrictEqual(findCall("local h = new Human(\"a, b\", ").parts, ["Human"]);
	assert.strictEqual(findCall("local h = new Human(\"a, b\", ").isNew, true);
	assert.strictEqual(findCall("local h = new Human(\"a, b\", ").activeParam, 1);
	assert.deepStrictEqual(findCall("a.b:c(1, f(2").parts, ["f"]);
	assert.strictEqual(findCall("function foo(a, "), null);
	assert.strictEqual(findCall("foo(1) + "), null);
	assert.strictEqual(findCall("x = (1 + "), null);
	assert.strictEqual(findCall("foo(1, 2) -- note (a, "), null);
});

// ---------------------------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------------------------

test("completion: keywords, built-ins, workspace symbols and locals", function ()
{
	const c = complete("local myLocal = 1\nlocal function helper(a) end\n|");
	for (const label of ["class", "extends", "switch", "pluto_use", "print", "dumpvar", "string", "json", "Human", "Animal", "greet", "Color", "RED", "myLocal", "helper"])
	{
		assert(c.labels.includes(label), "missing " + label);
	}
	assert(!c.labels.includes("hidden"), "locals of other files must not leak");
	assert.strictEqual(c.get("greet").detail, "function greet(who: string, loud?: bool): string");
	assert(c.get("greet").documentation.value.includes("Greets someone."));
	assert(c.get("greet").documentation.value.includes("[human.pluto:29]"));
	assert.strictEqual(c.get("try").tags[0], vscode.CompletionItemTag.Deprecated);
});

test("completion: locals respect scope", function ()
{
	const c = complete("function a(paramA)\n  local inner = 1\nend\nfunction b(paramB)\n  |\nend");
	assert(c.get("paramB") && c.get("paramB").kind == vscode.CompletionItemKind.Variable);
	// `inner` and `paramA` are out of scope; they may only show up as plain document words.
	assert.strictEqual(c.get("inner").kind, vscode.CompletionItemKind.Text);
	assert.strictEqual(c.get("paramA").kind, vscode.CompletionItemKind.Text);
});

test("completion: class members", function ()
{
	let c = complete("local h = new Human(\"x\")\nh:|");
	assert.deepStrictEqual(c.labels.sort(), ["__construct", "getName", "speak"]);
	c = complete("local h = new Human(\"x\")\nh.|");
	for (const label of ["name", "age", "legs", "getName", "speak"])
	{
		assert(c.labels.includes(label), "missing " + label);
	}
	c = complete("Human.|");
	assert(c.labels.includes("create") && c.labels.includes("count"));
	assert.strictEqual(c.get("create").detail, "static function Human.create(name: string, age?: number): Human");
	c = complete("class Kid extends Human\n  function play()\n    self:|\n  end\nend");
	assert(c.labels.includes("play") && c.labels.includes("getName") && c.labels.includes("speak"));
	c = complete("class Kid extends Human\n  function play()\n    parent:|\n  end\nend");
	assert(c.labels.includes("getName") && !c.labels.includes("play"));
	c = complete("function f(h: Human)\n  h:get|\nend");
	assert(c.labels.includes("getName"));
	c = complete("Color.|");
	assert.deepStrictEqual(c.labels.sort(), ["GREEN", "RED"]);
});

test("completion: built-in libraries and required modules", function ()
{
	let c = complete("string.|");
	for (const label of ["startswith", "endswith", "split", "format"])
	{
		assert(c.labels.includes(label), "missing " + label);
	}
	assert.strictEqual(c.get("split").detail, "function string.split(str, separator, limit?)");
	c = complete("local j = require \"pluto:json\"\nj.|");
	assert.deepStrictEqual(c.labels.sort(), ["decode", "encode"]);
	c = complete("local j = require(\"json\")\nj.|");
	assert.deepStrictEqual(c.labels.sort(), ["decode", "encode"]);
	c = complete("local util = require(\"lib.util\")\nutil.|");
	assert.deepStrictEqual(c.labels.sort(), ["add", "method", "version"]);
	c = complete("local chat = require(\"chat-module\")\nchat.|");
	assert.deepStrictEqual(c.labels, ["send"]);
	c = complete("local s = \"abc\"\ns:|");
	assert(c.labels.includes("split") && c.labels.includes("upper"));
	c = complete("(\"abc\"):|");
	assert(c.labels.includes("split"), "unknown receivers get string methods");
	c = complete("local t = {}\ntable.|");
	assert(c.labels.includes("contains") && c.labels.includes("insert"));
});

test("completion: module names inside require", function ()
{
	const c = complete("local x = require(\"|\")", { triggerKind: 1, triggerCharacter: "\"" });
	for (const label of ["pluto:json", "pluto:regex", "pluto:crypto", "pluto:base64", "pluto:http", "pluto:url", "chat-module", "lib.util", "lib.human"])
	{
		assert(c.labels.includes(label), "missing " + label);
	}
	assert(c.get("chat-module").detail.includes("mods/chat/info.json"));
	// A manifest id is offered in other strings only on explicit request.
	assert.deepStrictEqual(complete("print(\"|\")", { triggerKind: 1, triggerCharacter: "\"" }).labels, []);
	assert.deepStrictEqual(complete("print(\"|\")", { triggerKind: 0 }).labels, ["chat-module"]);
});

test("completion: stays quiet in comments, declarations and after concatenation", function ()
{
	assert.deepStrictEqual(complete("-- some comment |").labels, []);
	assert.deepStrictEqual(complete("local function na|").labels, []);
	assert.deepStrictEqual(complete("class Na|").labels, []);
	assert(complete("local x = a..|").labels.includes("print"), "`..` is not a member access");
	const c = complete("local h = new |");
	assert(c.labels.includes("Human") && !c.labels.includes("print"));
});

// ---------------------------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------------------------

test("hover: workspace declarations show signature, docs and source", function ()
{
	let h = hover("gre|et(\"x\")");
	assert(h.includes("function greet(who: string, loud?: bool): string"));
	assert(h.includes("Greets someone."));
	assert(h.includes("human.pluto:29"));
	h = hover("local h = new Hu|man(\"x\")");
	assert(h.includes("class Human extends Animal") && h.includes("A human being.") && h.includes("Walks upright."));
	assert(h.includes("function Human:__construct(name: string, age: number = 3)"));
	h = hover("local h = new Human(\"x\")\nh:getN|ame()");
	assert(h.includes("function Human:getName(): string") && h.includes("Returns the name."));
	h = hover("local h = new Human(\"x\")\nh:spe|ak()");
	assert(h.includes("function Animal:speak(sound: string)"), "inherited method");
	h = hover("local util = require(\"lib.util\")\nutil.ad|d(1, 2)");
	assert(h.includes("function M.add(a, b)") && h.includes("Adds two numbers.") && h.includes("util.lua:3"));
	h = hover("function f(count: number)\n  return cou|nt\nend");
	assert(h.includes("(parameter) count: number"));
});

test("hover: source link format", function ()
{
	// Other file, default "short": file name + line, full path as tooltip.
	let h = hover("gre|et(\"x\")");
	assert(h.includes("[human.pluto:29](file:///ws/lib/human.pluto#L29 \"lib/human.pluto\")"), h);
	assert(!h.includes("Defined in"));
	// Same file: just the line.
	h = hover("--- Local doc\nlocal function helper() end\nhel|per()");
	assert(h.includes("[Line 2](file:///ws/main.pluto#L2)"), h);
	vscode.config["hover.sourcePath"] = "relative";
	h = hover("gre|et(\"x\")");
	assert(h.includes("[lib/human.pluto:29]("), h);
	vscode.config["hover.sourcePath"] = "none";
	h = hover("gre|et(\"x\")");
	assert(!h.includes("human.pluto"), h);
	delete vscode.config["hover.sourcePath"];
});

test("hover: built-ins, modules and keywords", function ()
{
	let h = hover("string.spl|it(s, \",\")");
	assert(h.includes("function string.split(str, separator, limit?)") && h.includes("Splits a string by a separator."));
	h = hover("local s = \"\"\ns:starts|with(\"a\")");
	assert(h.includes("function string.startswith(str, prefix)"));
	h = hover("local json = require \"pluto:json\"\njson.enc|ode({})");
	assert(h.includes("function json.encode(data, format?)") && h.includes("pluto:json"));
	h = hover("local json = require \"pluto:js|on\"");
	assert(h.includes("(built-in module) pluto:json") && h.includes("`encode`"));
	h = hover("local c = require(\"chat-mod|ule\")");
	assert(h.includes("(module) chat-module 1.2.0") && h.includes("Chat helpers") && h.includes("mods/chat/info.json"));
	h = hover("swi|tch x do end");
	assert(h.includes("(keyword) switch"));
	assert.strictEqual(hover("-- gre|et"), null);
	assert.strictEqual(hover("local x = unknown|Thing"), null);
});

// ---------------------------------------------------------------------------------------------
// Signature help
// ---------------------------------------------------------------------------------------------

test("signature help: active parameter follows commas", function ()
{
	let s = signature("greet(|");
	assert.strictEqual(s.signatures[0].label, "greet(who: string, loud?: bool): string");
	assert.strictEqual(s.activeParameter, 0);
	assert.deepStrictEqual(s.signatures[0].parameters.map(p => s.signatures[0].label.slice(p.label[0], p.label[1])), ["who: string", "loud?: bool"]);
	s = signature("greet(\"a, b\", |");
	assert.strictEqual(s.activeParameter, 1);
	s = signature("greet(f(1, 2), {1, 2}, |");
	assert.strictEqual(s.activeParameter, 2, "past the last parameter");
	s = signature("local h = new Human(\"x\", |");
	assert.strictEqual(s.signatures[0].label, "new Human(name: string, age: number = 3)");
	assert.strictEqual(s.activeParameter, 1);
	s = signature("Human.create(|");
	assert.strictEqual(s.signatures[0].label, "Human.create(name: string, age?: number): Human");
	s = signature("string.split(s, |");
	assert.strictEqual(s.signatures[0].label, "string.split(str, separator, limit?)");
	assert.strictEqual(s.activeParameter, 1);
	s = signature("local s = \"\"\ns:split(|");
	assert.strictEqual(s.activeParameter, 1, "the receiver takes the first parameter");
	s = signature("print(1, 2, 3, |");
	assert.strictEqual(s.activeParameter, 0, "varargs stay highlighted");
	assert.strictEqual(signature("function foo(a, |"), undefined);
	assert.strictEqual(signature("unknownFn(|"), undefined);
});

// ---------------------------------------------------------------------------------------------
// Definition, outline, folding
// ---------------------------------------------------------------------------------------------

test("definition: classes, methods, functions, locals and require", function ()
{
	let d = definition("local h = new Hu|man(\"x\")");
	assert.strictEqual(d[0].uri.path, "/ws/lib/human.pluto");
	assert.strictEqual(d[0].range.start.line, 2);
	d = definition("local h = new Human(\"x\")\nh:getN|ame()");
	assert.deepStrictEqual([d[0].uri.path, d[0].range.start.line], ["/ws/lib/human.pluto", 13]);
	d = definition("gre|et()");
	assert.deepStrictEqual([d[0].uri.path, d[0].range.start.line], ["/ws/lib/human.pluto", 28]);
	d = definition("local value = 1\nprint(val|ue)");
	assert.deepStrictEqual([d[0].uri.path, d[0].range.start.line], ["/ws/main.pluto", 0]);
	d = definition("local util = require(\"lib.ut|il\")");
	assert.strictEqual(d[0].targetUri.path, "/ws/lib/util.lua");
	d = definition("local chat = require \"chat-mod|ule\"");
	assert.strictEqual(d[0].targetUri.path, "/ws/mods/chat/init.pluto");
	assert.strictEqual(definition("local j = require \"pluto:js|on\""), undefined);
	d = definition("local util = require(\"lib.util\")\nutil.ad|d(1, 2)");
	assert.deepStrictEqual([d[0].uri.path, d[0].range.start.line], ["/ws/lib/util.lua", 2]);
});

test("outline: hierarchy of classes, methods and functions", function ()
{
	const document = vscode.createDocument("/ws/lib/human.pluto", FILES["/ws/lib/human.pluto"]);
	const roots = providers.documentSymbolProvider.provideDocumentSymbols(document);
	assert.deepStrictEqual(roots.map(r => r.name), ["Human", "Color", "greet"]);
	const human = roots[0];
	assert.strictEqual(human.kind, vscode.SymbolKind.Class);
	assert.strictEqual(human.detail, "extends Animal");
	assert.deepStrictEqual(human.children.map(c => c.name), ["name", "count", "__construct", "age", "getName", "create"]);
	assert.strictEqual(human.children.find(c => c.name == "create").detail, "static (name: string, age?: number): Human");
	assert.deepStrictEqual(roots[1].children.map(c => c.name), ["RED", "GREEN"]);
	for (const node of [...roots, ...human.children])
	{
		assert(node.range.contains(node.selectionRange), node.name + ": selectionRange must be inside range");
	}

	const lua = providers.documentSymbolProvider.provideDocumentSymbols(vscode.createDocument("/ws/lib/util.lua", FILES["/ws/lib/util.lua"]));
	assert.deepStrictEqual(lua.map(r => r.name), ["M", "hidden"]);
	assert.deepStrictEqual(lua[0].children.map(c => c.name), ["add", "method", "version"]);

	const nested = providers.documentSymbolProvider.provideDocumentSymbols(vscode.createDocument("/ws/n.pluto",
		"function outer()\n  local function inner()\n    return 1\n  end\n  return inner\nend\nfunction Unknown:method()\nend"));
	assert.deepStrictEqual(nested.map(r => r.name), ["outer", "Unknown:method"]);
	assert.deepStrictEqual(nested[0].children.map(c => c.name), ["inner"]);
});

test("outline: locals, callbacks, constants and settings", function ()
{
	const source = [
		"local json = require \"pluto:json\"",
		"local SAVE_FOLDER = \"saves/\"",
		"--- @deprecated",
		"local function load(handle: int): ?table",
		"    local data = { handle = handle }",
		"    for i = 1, 3 do",
		"        local tmp = i",
		"    end",
		"    scheduler:add(function()",
		"        local inner = 1",
		"    end)",
		"    list:foreach(|item| -> do",
		"        print(item)",
		"    end)",
		"    return data",
		"end",
	].join("\n");
	const document = vscode.createDocument("/ws/outline.pluto", source);
	const K = vscode.SymbolKind;
	const flat = (nodes, depth = 0) => nodes.flatMap(n => [[depth, n.name, n.kind, n.detail], ...flat(n.children, depth + 1)]);

	let tree = flat(providers.documentSymbolProvider.provideDocumentSymbols(document));
	assert.deepStrictEqual(tree, [
		[0, "json", K.Module, "require \"pluto:json\""],
		[0, "SAVE_FOLDER", K.Constant, "string = \"saves/\""],
		[0, "load", K.Function, "(handle: int): ?table"],
		[1, "data", K.Object, "= { handle = handle }"],
		[2, "handle", K.Field, "= handle"],
		[1, "tmp", K.Variable, "= i"],
		[1, "scheduler:add() callback", K.Function, "()"],
		[2, "inner", K.Variable, "= 1"],
		[1, "list:foreach() callback", K.Function, "(item)"],
	]);
	const load = providers.documentSymbolProvider.provideDocumentSymbols(document)[2];
	assert.deepStrictEqual(load.tags, [vscode.SymbolTag.Deprecated]);

	Object.assign(vscode.config, {
		"outline.localVariables": false,
		"outline.loopVariables": true,
		"outline.parameters": true,
		"outline.anonymousFunctions": false,
		"outline.showValues": false,
	});
	try
	{
		tree = flat(providers.documentSymbolProvider.provideDocumentSymbols(document)).map(e => e.slice(0, 2).concat(e[3]));
		assert.deepStrictEqual(tree, [
			[0, "json", "require \"pluto:json\""],
			[0, "SAVE_FOLDER", "string"],
			[0, "load", "(handle: int): ?table"],
			[1, "handle", "int"],
			[1, "i", ""],
		]);
	}
	finally
	{
		for (const key of Object.keys(vscode.config))
		{
			delete vscode.config[key];
		}
	}
});

test("outline: function bodies, calls and the large-file guard", function ()
{
	const source = [
		"local module = {}",
		"function module.get_coords(entity: int)",
		"    local coords = v3.new(ENTITY.GET_ENTITY_COORDS(entity))",
		"    util.toast(\"x\")",
		"    util.toast(\"y\")",
		"    scheduler:add(function()",
		"        log(\"inner\")",
		"    end)",
		"    if not coords then return nil end",
		"    return coords",
		"end",
		"function module.get_health(entity: int): int",
		"    return ENTITY.GET_ENTITY_HEALTH(entity)",
		"end",
	].join("\n");
	const document = vscode.createDocument("/ws/body.pluto", source);
	const K = vscode.SymbolKind;
	const flat = (nodes, depth = 0) => nodes.flatMap(n => [[depth, n.name, n.detail], ...flat(n.children, depth + 1)]);
	const outline = () => flat(providers.documentSymbolProvider.provideDocumentSymbols(document));
	const reset = () => Object.keys(vscode.config).forEach(k => delete vscode.config[k]);
	try
	{
		// Default: locals and callbacks, no calls.
		assert.deepStrictEqual(outline(), [
			[0, "module", "= {}"],
			[1, "get_coords", "(entity: int)"],
			[2, "coords", "= v3.new(ENTITY.GET_ENTITY_COORDS(entity))"],
			[2, "scheduler:add() callback", "()"],
			[1, "get_health", "(entity: int): int"],
		]);

		// Statement calls and returns; the call with a callback is represented by the callback.
		vscode.config["outline.calls"] = "statements";
		assert.deepStrictEqual(outline(), [
			[0, "module", "= {}"],
			[1, "get_coords", "(entity: int)"],
			[2, "coords", "= v3.new(ENTITY.GET_ENTITY_COORDS(entity))"],
			[2, "util.toast()", "(\"x\")"],
			[2, "util.toast()", "(\"y\")"],
			[2, "scheduler:add() callback", "()"],
			[3, "log()", "(\"inner\")"],
			[2, "return", "nil"],
			[2, "return", "coords"],
			[1, "get_health", "(entity: int): int"],
			[2, "return", "ENTITY.GET_ENTITY_HEALTH(entity)"],
		]);
		const fn =providers.documentSymbolProvider.provideDocumentSymbols(document)[0].children[0];
		assert.strictEqual(fn.children.find(c => c.name == "util.toast()").kind, K.Event);
		assert.strictEqual(fn.children.find(c => c.name == "return").kind, K.Operator);

		// All calls, each callee once per function.
		vscode.config["outline.calls"] = "all";
		const all = outline().filter(e => e[1].endsWith("()")).map(e => e[0] + " " + e[1]);
		assert.deepStrictEqual(all, ["2 v3.new()", "2 ENTITY.GET_ENTITY_COORDS()", "2 util.toast()", "3 log()", "2 ENTITY.GET_ENTITY_HEALTH()"]);

		// Large-file guard: only signatures.
		const signaturesOnly = [
			[0, "module", "= {}"],
			[1, "get_coords", "(entity: int)"],
			[1, "get_health", "(entity: int): int"],
		];
		vscode.config["outline.maxFileLines"] = 10;
		assert.deepStrictEqual(outline(), signaturesOnly);
		vscode.config["outline.maxFileLines"] = 0; // no limit
		assert(outline().length > 3);
		vscode.config["outline.maxFileLines"] = 1000;
		vscode.config["outline.showFunctionBody"] = false;
		assert.deepStrictEqual(outline(), signaturesOnly);
	}
	finally
	{
		reset();
	}
});

test("parser: calls are only collected on request", function ()
{
	const src = "function f()\n  foo(1)\nend\nbar()\n";
	assert.strictEqual(parse(src).calls, undefined);
	const calls = parse(src, { calls: true }).calls;
	assert.deepStrictEqual(calls.map(c => c.name), ["foo()"], "calls outside of functions are skipped");
});

test("folding provider", function ()
{
	const document = vscode.createDocument("/ws/lib/human.pluto", FILES["/ws/lib/human.pluto"]);
	const ranges = providers.foldingProvider.provideFoldingRanges(document);
	assert(ranges.some(r => r.start == 2 && r.end == 19), "class");
	assert(ranges.some(r => r.start == 7 && r.end == 9), "constructor");
	assert(ranges.some(r => r.start == 0 && r.end == 1 && r.kind == vscode.FoldingRangeKind.Comment), "comment");
});

// ---------------------------------------------------------------------------------------------
// Auto-closing of blocks, language configuration, manifest
// ---------------------------------------------------------------------------------------------

test("auto-close: which lines get an `end`", function ()
{
	const expectEnd = ["function foo()", "local function foo(a, b)", "function Foo:bar(a: number): string", "if x then", "if x do",
		"for i = 1, 10 do", "for k, v in pairs(t) do", "while true do", "class Foo", "class Foo extends Bar", "local class Foo",
		"export class Foo", "switch x do", "try", "do", "enum Color begin", "local f = function(a)", "foo(function()", "\tstatic function create()",
		"M.x = function()  -- comment", "scheduler:add(|| -> do", "return function()"];
	for (const line of expectEnd)
	{
		assert.strictEqual(closerFor(line), "end", line);
	}
	assert.strictEqual(closerFor("repeat"), "until ");
	const expectNothing = ["", "local x = 1", "if x then return end", "else", "elseif y then", "case 1:", "default:", "catch e then",
		"-- if x then", "print(\"if x then\")", "function foo() end", "$if DEBUG then", "local t = {", "x = y", "$declare function f(a: string): number"];
	for (const line of expectNothing)
	{
		assert.strictEqual(closerFor(line), null, line);
	}
});

test("language configuration and manifest are consistent", function ()
{
	const root = path.join(__dirname, "..");
	const langConfig = JSON.parse(fs.readFileSync(path.join(root, "language-config.json"), "utf8").replace(/^\s*\/\/.*$/gm, ""));
	const inc = new RegExp(langConfig.indentationRules.increaseIndentPattern);
	const dec = new RegExp(langConfig.indentationRules.decreaseIndentPattern);
	for (const line of ["function foo()", "if x then", "for i = 1, 10 do", "while x do", "class Foo", "class Foo extends Bar", "switch x do", "try", "\tfunction method()", "local function f()"])
	{
		assert(inc.test(line), "should indent after: " + line);
	}
	for (const line of ["end", "\tend", "else", "elseif x then", "catch e then", "until x"])
	{
		assert(dec.test(line), "should outdent: " + line);
	}
	for (const rule of langConfig.onEnterRules)
	{
		new RegExp(rule.beforeText);
	}
	new RegExp(langConfig.folding.markers.start);

	// The TextMate preferences must carry the same patterns.
	const tm = fs.readFileSync(path.join(root, "Pluto.tmbundle", "Preferences", "Indentation Rules.tmPreferences"), "utf8");
	const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
	const strings = [...tm.matchAll(/<string>([\s\S]*?)<\/string>/g)].map(m => unescape(m[1]));
	assert(strings.includes(langConfig.indentationRules.increaseIndentPattern), "increaseIndentPattern out of sync");
	assert(strings.includes(langConfig.indentationRules.decreaseIndentPattern), "decreaseIndentPattern out of sync");

	const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
	assert(fs.existsSync(path.join(root, pkg.main)), "main entry point exists");
	assert(pkg.activationEvents.includes("onLanguage:pluto"));
	for (const contribution of [...pkg.contributes.snippets, ...pkg.contributes.grammars])
	{
		assert(fs.existsSync(path.join(root, contribution.path)), contribution.path);
	}
	for (const command of pkg.contributes.commands)
	{
		assert(pkg.activationEvents.includes("onCommand:" + command.command), command.command);
	}

	// Snippet files must be valid JSON-with-comments and provide the documented prefixes.
	const prefixes = new Set();
	for (const contribution of pkg.contributes.snippets)
	{
		const raw = fs.readFileSync(path.join(root, contribution.path), "utf8");
		const snippets = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
		for (const snippet of Object.values(snippets))
		{
			assert(snippet.body !== undefined, "snippet without body in " + contribution.path);
			for (const prefix of [].concat(snippet.prefix))
			{
				prefixes.add(prefix);
			}
		}
	}
	for (const prefix of ["class", "cls_ext", "fn", "switch", "try", "fori", "forp"])
	{
		assert(prefixes.has(prefix), "missing snippet prefix " + prefix);
	}
});

// ---------------------------------------------------------------------------------------------
// Workspace filtering: ignore files and exclude patterns
// ---------------------------------------------------------------------------------------------

const { IgnoreMatcher, GlobSet } = require("../src/ignore");

test("ignore files: .gitignore syntax", function ()
{
	const m = new IgnoreMatcher().add([
		"# comment",
		"build/",
		"*.log",
		"/root.pluto",
		"vendor/**",
		"!vendor/keep.pluto",
		"docs/**/gen.lua",
		"\\#hash.pluto",
		"\\!bang.pluto",
		"trailing.pluto   ",
		"tmp",
		"!tmp/x.pluto",
		"lib/*",
		"!lib/main.pluto",
		"*.gen.pluto",
		"!keep.gen.pluto",
		"file?.pluto",
		"[abc]x.pluto",
	].join("\n"));
	const expectations = {
		"build/a.pluto": true, "src/build/a.pluto": true, "buildx/a.pluto": false,
		"a.log": true, "x/a.log": true,
		"root.pluto": true, "src/root.pluto": false,
		"vendor/a.pluto": true, "vendor/keep.pluto": false,
		"docs/gen.lua": true, "docs/a/b/gen.lua": true, "gen.lua": false,
		"#hash.pluto": true, "!bang.pluto": true, "trailing.pluto": true,
		"tmp/x.pluto": true, // a file inside an excluded directory can't be re-included
		"lib/a.pluto": true, "lib/main.pluto": false, "lib/sub/a.pluto": true,
		"x.gen.pluto": true, "keep.gen.pluto": false, "src/keep.gen.pluto": false,
		"file1.pluto": true, "file12.pluto": false,
		"ax.pluto": true, "dx.pluto": false,
		"src/main.pluto": false,
	};
	for (const [p, expected] of Object.entries(expectations))
	{
		assert.strictEqual(m.ignores(p), expected, p);
	}
	// Patterns of an ignore file in a subdirectory are relative to that directory.
	const sub = new IgnoreMatcher().add("/gen.pluto\n*.tmp.pluto", "tools");
	assert.strictEqual(sub.ignores("tools/gen.pluto"), true);
	assert.strictEqual(sub.ignores("gen.pluto"), false);
	assert.strictEqual(sub.ignores("tools/deep/gen.pluto"), false);
	assert.strictEqual(sub.ignores("tools/deep/a.tmp.pluto"), true);
	assert.strictEqual(sub.ignores("a.tmp.pluto"), false);
});

test("exclude globs: VS Code syntax", function ()
{
	const g = new GlobSet(["**/node_modules", "*.lua", "out/**", "**/*.{gen,tmp}.pluto", "**/vendor/**", "{a,b}/**", "", 42]);
	const expectations = {
		"node_modules/a.pluto": true, "x/node_modules/y/a.pluto": true,
		"a.lua": true, "src/a.lua": false,
		"out/a.pluto": true, "src/out/a.pluto": false,
		"a.gen.pluto": true, "x/y/a.tmp.pluto": true, "a.pluto": false,
		"vendor/x.pluto": true, "lib/vendor/x.pluto": true,
		"a/x.pluto": true, "b/c/x.pluto": true, "c/x.pluto": false,
	};
	for (const [p, expected] of Object.entries(expectations))
	{
		assert.strictEqual(g.matches(p), expected, p);
	}
	assert.strictEqual(new GlobSet([]).matches("anything.pluto"), false);
});

test("index: excluded files are invisible to other files but work on their own", function ()
{
	const idx = new WorkspaceIndex();
	const an = new Analyzer(idx);
	const svc = {
		index: idx,
		analyzer: an,
		getRecord(document)
		{
			const excluded = document.uri.path.includes("/vendor/");
			const record = idx.setFile(document.uri.toString(), document.uri.fsPath, document.getText(), excluded);
			idx.setCurrent(record);
			return record;
		},
	};
	const p = createProviders(svc);
	idx.setFile("file:///ws/lib/shared.pluto", "/ws/lib/shared.pluto", "function sharedFn(a) end\n");
	const vendorText = "class VendorThing\n  function go(x) end\nend\nfunction vendorFn(b: number) end\n";
	idx.setFile("file:///ws/vendor/lib.pluto", "/ws/vendor/lib.pluto", vendorText, true);

	// From a normal file: vendor symbols are not offered, resolved or navigable.
	const main = vscode.createDocument("/ws/main.pluto", "vendorFn(1)\nsharedFn(1)\n");
	const items = p.completionProvider.provideCompletionItems(main, new vscode.Position(2, 0), null, { triggerKind: 0 });
	const labels = items.filter(i => i.kind != vscode.CompletionItemKind.Text).map(i => i.label);
	assert(labels.includes("sharedFn"));
	assert(!labels.includes("vendorFn") && !labels.includes("VendorThing"), "excluded symbols must not be suggested");
	assert.strictEqual(p.hoverProvider.provideHover(main, new vscode.Position(0, 3)), undefined);
	assert.strictEqual(p.definitionProvider.provideDefinition(main, new vscode.Position(0, 3)), undefined);
	assert.strictEqual(p.signatureProvider.provideSignatureHelp(main, new vscode.Position(0, 9)), undefined);
	assert(p.definitionProvider.provideDefinition(main, new vscode.Position(1, 3)), "included files still resolve");
	assert.strictEqual(idx.resolveModule("vendor.lib"), null, "require() can't reach excluded files");

	// From the excluded file itself: its own declarations work, and it still sees the workspace.
	const vendorDoc = vscode.createDocument("/ws/vendor/lib.pluto", vendorText + "vendorFn(1)\nlocal v = new VendorThing()\nv:go(1)\nsharedFn(1)\n");
	assert(p.hoverProvider.provideHover(vendorDoc, new vscode.Position(4, 3)).contents[0].value.includes("function vendorFn(b: number)"));
	assert.strictEqual(p.definitionProvider.provideDefinition(vendorDoc, new vscode.Position(4, 3))[0].range.start.line, 3);
	const own = p.completionProvider.provideCompletionItems(vendorDoc, new vscode.Position(6, 2), null, { triggerKind: 1, triggerCharacter: ":" });
	assert.deepStrictEqual(own.map(i => i.label), ["go"]);
	assert(p.definitionProvider.provideDefinition(vendorDoc, new vscode.Position(7, 3)));

	// Back in the normal file, the excluded file's symbols are gone again.
	assert.strictEqual(p.hoverProvider.provideHover(main, new vscode.Position(0, 3)), undefined);
	assert.strictEqual(idx.lookup("vendorFn").length, 0);
});

/**
 * The real LanguageService against an in-memory workspace, for the end-to-end behaviour of
 * ignore files and settings. Returns helpers to change files and settings.
 */
function createFakeWorkspace(files)
{
	const disk = new Map(Object.entries(files));
	const toPath = (uri) => uri.path;
	vscode.workspace.fs = {
		async stat(uri)
		{
			if (!disk.has(toPath(uri)))
			{
				throw new Error("ENOENT");
			}
			return { size: disk.get(toPath(uri)).length };
		},
		async readFile(uri)
		{
			if (!disk.has(toPath(uri)))
			{
				throw new Error("ENOENT");
			}
			return Buffer.from(disk.get(toPath(uri)));
		},
	};
	vscode.workspace.findFiles = async function (include)
	{
		const exts = include.includes("info.json") ? /\/info\.json$/ : include.includes("lua") ? /\.(pluto|lua)$/ : /\.pluto$/;
		return [...disk.keys()].filter(p => exts.test(p)).map(p => vscode.Uri.file(p));
	};
	vscode.workspace.textDocuments = [];
	return { disk };
}

const asyncTests = [];
// ---------------------------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------------------------

const { lintSource, lintManifest } = require("../src/lint");
const compiler = require("../src/compiler");

function lint(text, options)
{
	const record = index.setFile(vscode.Uri.file("/ws/lintme.pluto").toString(), "/ws/lintme.pluto", text);
	try
	{
		return lintSource(text, record, analyzer, options);
	}
	finally
	{
		index.removeFile(vscode.Uri.file("/ws/lintme.pluto").toString());
	}
}

test("lint: broken require paths", function ()
{
	const problems = lint([
		"local util = require(\"lib.util\")",
		"local chat = require \"chat-module\"",
		"local json = require(\"pluto:json\")",
		"local crypto = require \"crypto\"",
		"local nope = require(\"lib/missing\")",
		"local disk = require(\"ondisk\")",
	].join("\n"), { exists: p => p == "/ws/ondisk.lua", searchDirs: [] });
	assert.deepStrictEqual(problems.map(p => [p.code, p.line, p.col, p.endCol]), [["missing-module", 4, 21, 34]]);
	assert.strictEqual(problems[0].severity, "warning");
	assert(problems[0].message.includes("lib/missing"));
});

test("lint: calls with too few arguments", function ()
{
	const problems = lint([
		"greet()",                                  // 0: who missing
		"greet(\"bob\")",                           // 1: ok, loud is optional
		"local h = new Human()",                    // 2: name missing
		"local h2 = new Human(\"x\")",              // 3: ok, age has a default
		"Human.create()",                           // 4: name missing
		"local u = require(\"lib.util\")",
		"u.add(1)",                                 // 6: b missing
		"u:method()",                               // 7: x missing
		"u.method(u, 1)",                           // 8: ok
		"greet(...)",                               // 9: unknown count
		"greet(get())",                             // 10: unknown count
		"local function f(a, b) end",
		"f(1)",                                     // 12: b missing
		"local g = 5",
		"unknownThing.call()",                      // 14: unknown callee
		"function greet2(a) end",                   // 15: declaration
		"local x = { greet() }",                    // 16: who missing
		"greet((get()))",                           // 17: ok, exactly one value
	].join("\n"));
	assert.deepStrictEqual(problems.map(p => p.line), [0, 2, 4, 6, 7, 12, 16]);
	assert(problems.every(p => p.code == "missing-arguments" && p.severity == "warning"));
	assert(/'greet' expects at least 1 argument but got 0\. Required: who\./.test(problems[0].message), problems[0].message);
	assert(problems[1].message.includes("new Human"), problems[1].message);
	assert.strictEqual(problems[1].col, 10);
});

test("lint: info.json manifests", function ()
{
	const exists = p => p == "/ws/mods/new/main.pluto";
	const ok = lintManifest(JSON.stringify({ id: "new", entry: "main.pluto", dependencies: ["chat-module"] }, null, "\t"), "/ws/mods/new/info.json", index, { exists });
	assert.deepStrictEqual(ok, []);
	const text = "{\n\t\"entry\": \"start.pluto\",\n\t\"dependencies\": [\"chat-module\", \"ghost\"]\n}";
	const bad = lintManifest(text, "/ws/mods/new/info.json", index, { exists });
	assert.deepStrictEqual(bad.map(p => [p.code, p.severity, p.line]), [
		["manifest-id", "error", 0],
		["manifest-entry", "error", 1],
		["manifest-dependency", "warning", 2],
	]);
	assert.deepStrictEqual([bad[2].col, bad[2].endCol], [33, 40]);
	// An unrelated info.json is left alone.
	assert.deepStrictEqual(lintManifest("{\"name\": \"x\"}", "/elsewhere/info.json", index, {}), []);
	// The entry file can also be an indexed file.
	assert.deepStrictEqual(lintManifest("{\"id\": \"c\", \"entry\": \"init.pluto\"}", "/ws/mods/chat/info.json", index, {}), []);
});

test("compiler: output parsing", function ()
{
	const lines = ["local x = 1", "if x then", "  print(x y)", "end"];
	const out = compiler.parseCompilerOutput([
		"C:\\tools\\plutoc.exe: stdin:3: ')' expected near 'y'",
		"stdin:1: warning: unused local 'x' [unused]",
		"    1 | local x = 1",
		"      |       ^ here: declared here",
		"\x1b[31mstdin:4: syntax error: unexpected 'end'\x1b[0m",
	].join("\r\n"), lines);
	assert.deepStrictEqual(out.map(p => [p.line, p.severity, p.col, p.endCol]), [
		[2, "error", 10, 11],
		[0, "warning", 6, 7],
		[3, "error", null, null],
	]);
	assert.strictEqual(out[0].message, "')' expected near 'y'");
	assert(out[1].message.startsWith("unused local 'x' [unused]"), out[1].message);
	assert.strictEqual(out[2].message, "syntax error: unexpected 'end'");
	assert.deepStrictEqual(compiler.parseCompilerOutput("", lines), []);

	// Real Pluto 0.13 output: excerpts are printed without indentation, warnings have a prefix.
	const src = ["local function f()", "  local a = 1", "  local a = 2", "  print(a b)", "end"];
	const real = compiler.parseCompilerOutput([
		"Pluto warning: stdin:3: duplicate local declaration [var-shadow]",
		"    3 | local a = 2",
		"      | ^^^^^^^^^^^ here: this shadows the initial declaration of 'a' on line 2.",
		"C:\\Program Files\\pluto\\plutoc.exe: stdin:4: ')' expected near 'b'",
		"    4 | print(a b)",
		"      |         ^ here: this is invalid syntax.",
	].join("\n"), src);
	assert.deepStrictEqual(real.map(p => [p.line, p.severity, p.col, p.endCol]), [[2, "warning", 2, 13], [3, "error", 10, 11]]);
	assert.strictEqual(real[0].message, "duplicate local declaration [var-shadow] (this shadows the initial declaration of 'a' on line 2.)");
});

testAsync("compiler: a real plutoc checks stdin without running it (skipped when not installed)", async function ()
{
	const found = compiler.findOnPath();
	if (!found)
	{
		return;
	}
	const bad = await compiler.runCheck(found, "os.exit(3)\nlocal x = (\n").promise;
	const problems = compiler.parseCompilerOutput(bad.output, ["os.exit(3)", "local x = ("]);
	assert.notStrictEqual(bad.code, 3, "the code must not run");
	assert.strictEqual(problems.length, 1, bad.output);
	assert.strictEqual(problems[0].severity, "error");
	const good = await compiler.runCheck(found, "os.exit(3)\n").promise;
	assert.strictEqual(good.code, 0, good.output);
	assert.deepStrictEqual(compiler.parseCompilerOutput(good.output, []), []);
});

test("compiler: discovery prefers settings, then the newest local compiler, then PATH", function ()
{
	const os = require("os");
	const exe = process.platform == "win32" ? ".exe" : "";
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pluto-ws-"));
	const bin = fs.mkdtempSync(path.join(os.tmpdir(), "pluto-path-"));
	const touch = function (p)
	{
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, "");
		fs.chmodSync(p, 0o755);
		return p;
	};
	try
	{
		assert.deepStrictEqual(compiler.findCompiler({ workspaceFolders: [root], envPath: "" }), { path: null, source: null, problem: undefined });
		const onPath = touch(path.join(bin, "pluto" + exe));
		assert.deepStrictEqual(compiler.findCompiler({ workspaceFolders: [root], envPath: bin }), { path: onPath, source: "path", problem: undefined });
		touch(path.join(root, "pluto", "0.9.4", "plutoc" + exe));
		const newest = touch(path.join(root, "pluto", "0.10.1", "plutoc" + exe));
		touch(path.join(root, "pluto", "0.10.1", "pluto" + exe));
		touch(path.join(root, "src", "pluto" + exe)); // not a known folder
		assert.strictEqual(compiler.findCompiler({ workspaceFolders: [root], envPath: bin }).path, newest);
		const custom = touch(path.join(root, "custom", "my-pluto" + exe));
		const fromSetting = compiler.findCompiler({ configured: "${workspaceFolder}/custom/my-pluto" + exe, workspaceFolders: [root], envPath: bin });
		assert.deepStrictEqual([fromSetting.path, fromSetting.source], [custom, "setting"]);
		const broken = compiler.findCompiler({ configured: "${workspaceFolder}/nope" + exe, workspaceFolders: [root], envPath: bin });
		assert.deepStrictEqual([broken.path, broken.source], [newest, "workspace"]);
		assert(broken.problem.includes("not an executable"));
		assert.strictEqual(compiler.findCompiler({ workspaceFolders: [root], envPath: bin, allowWorkspace: false }).path, onPath);
		assert.deepStrictEqual(compiler.checkArgs(newest), ["-p", "-"]);
		assert.strictEqual(compiler.checkArgs(onPath)[0], "-e");
	}
	finally
	{
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(bin, { recursive: true, force: true });
	}
});

function testAsync(name, fn)
{
	asyncTests.push({ name, fn });
}

testAsync("service: ignore files and settings control what is indexed", async function ()
{
	const { LanguageService } = require("../src/extension");
	const { disk } = createFakeWorkspace({
		"/ws/.gitignore": "build/\n*.generated.pluto\n",
		"/ws/.plutoignore": "legacy/**\n",
		"/ws/src/main.pluto": "function mainFn() end\n",
		"/ws/build/out.pluto": "function buildFn() end\n",
		"/ws/src/api.generated.pluto": "function generatedFn() end\n",
		"/ws/legacy/old.lua": "function legacyFn() end\n",
		"/ws/vendor/dep.pluto": "function vendorFn() end\n",
		"/ws/vendor/info.json": "{ \"id\": \"vendor-dep\" }",
		"/ws/node_modules/x.pluto": "function nodeFn() end\n",
	});
	const names = (svc) => [...svc.index.files.values()].flatMap(f => f.symbols.filter(s => !s.container).map(s => s.name)).sort();
	const service = new LanguageService();
	try
	{
		await service.scan();
		assert.deepStrictEqual(names(service), ["mainFn", "vendorFn"]);
		assert.strictEqual(service.excludedCount, 4);
		assert.deepStrictEqual([...service.index.manifests.values()].map(m => m.id), ["vendor-dep"]);

		// pluto.workspace.exclude, applied incrementally.
		vscode.config["pluto.workspace.exclude"] = ["**/vendor/**"];
		await service.scan({ incremental: true });
		assert.deepStrictEqual(names(service), ["mainFn"]);
		assert.strictEqual(service.index.manifests.size, 0, "manifests in excluded folders are dropped too");

		// Editing an ignore file: the file it now covers is removed from the index.
		disk.set("/ws/.plutoignore", "legacy/**\nsrc/main.pluto\n");
		await service.scan({ incremental: true });
		assert.deepStrictEqual(names(service), []);

		// pluto.workspace.ignoreFiles without .plutoignore, and useGitignore off.
		vscode.config["pluto.workspace.ignoreFiles"] = [".gitignore"];
		vscode.config["pluto.workspace.useGitignore"] = false;
		await service.scan({ incremental: true });
		assert.deepStrictEqual(names(service), ["buildFn", "generatedFn", "legacyFn", "mainFn"]);

		// search.exclude, and pluto.workspace.useSearchExclude.
		vscode.config["search.exclude"] = { "**/build": true, "**/legacy/**": false };
		await service.scan({ incremental: true });
		assert.deepStrictEqual(names(service), ["generatedFn", "legacyFn", "mainFn"]);
		vscode.config["pluto.workspace.useSearchExclude"] = false;
		await service.scan({ incremental: true });
		assert.deepStrictEqual(names(service), ["buildFn", "generatedFn", "legacyFn", "mainFn"]);

		// files.exclude always applies; the legacy pluto.index.exclude setting still works.
		vscode.config["files.exclude"] = { "legacy": true };
		vscode.config["pluto.index.exclude"] = ["build/**"];
		await service.scan({ incremental: true });
		assert.deepStrictEqual(names(service), ["generatedFn", "mainFn"]);

		// A file created in an excluded folder is not picked up by the file watcher.
		disk.set("/ws/build/new.pluto", "function newBuildFn() end\n");
		await service.indexUri(vscode.Uri.file("/ws/build/new.pluto"));
		assert(!names(service).includes("newBuildFn"));

		// An excluded file that is open is analyzed on its own, without joining the index.
		const doc = vscode.createDocument("/ws/build/out.pluto", disk.get("/ws/build/out.pluto"));
		const record = service.getRecord(doc);
		assert.strictEqual(record.excluded, true);
		assert(!service.index.files.has(doc.uri.toString()));
		assert.strictEqual(service.index.lookup("buildFn").length, 1, "visible from the file itself");
		service.getRecord(vscode.createDocument("/ws/src/main.pluto", disk.get("/ws/src/main.pluto")));
		assert.strictEqual(service.index.lookup("buildFn").length, 0, "invisible from other files");
	}
	finally
	{
		service.dispose();
		for (const key of Object.keys(vscode.config))
		{
			delete vscode.config[key];
		}
	}
});

(async function ()
{
	for (const { name, fn } of asyncTests)
	{
		try
		{
			await fn();
			++passed;
		}
		catch (e)
		{
			++failed;
			console.log("FAIL: " + name + "\n" + (e.stack || e));
		}
	}
	console.log(passed + " passed, " + failed + " failed");
	if (failed)
	{
		process.exit(1);
	}
})();
