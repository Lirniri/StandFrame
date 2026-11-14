// Static knowledge about the Pluto language: keywords, standard library and built-in modules.
//
// The Pluto-specific library functions live in builtins.generated.json, which is produced from the
// official documentation by scripts/gen-builtins.js. Plain Lua functions are listed by hand below.

"use strict";

const generated = require("./builtins.generated.json");

/**
 * @typedef {{ name: string, lib: string|null, short: string, params?: { name: string, doc?: string }[]|null, doc: string, returns?: string, method?: boolean, overloaded?: boolean, aliases?: string[] }} Builtin
 */

// "signature": "description" — parsed into the same shape as the generated entries.
const LUA_STD = {
	"assert(v, message?)": "Raises an error if `v` is false or nil; otherwise returns all its arguments.",
	"collectgarbage(opt?, arg?)": "Generic interface to the garbage collector.",
	"dofile(filename?)": "Opens the named file and executes its content as a chunk.",
	"error(message, level?)": "Raises an error with `message` as the error object.",
	"getmetatable(object)": "Returns the metatable of the given object, if any.",
	"ipairs(t)": "Iterates over the array part of `t`: `for i, v in ipairs(t) do`.",
	"load(chunk, chunkname?, mode?, env?)": "Loads a chunk and returns it as a function.",
	"loadfile(filename?, mode?, env?)": "Loads a chunk from a file and returns it as a function.",
	"next(t, index?)": "Returns the next index of the table and its associated value.",
	"pairs(t)": "Iterates over all key–value pairs of `t`: `for k, v in pairs(t) do`.",
	"pcall(f, ...)": "Calls `f` in protected mode. Returns `true` plus results, or `false` plus the error.",
	"print(...)": "Prints its arguments to stdout, converting each with `tostring`.",
	"rawequal(v1, v2)": "Checks whether `v1` is equal to `v2`, without invoking `__eq`.",
	"rawget(t, index)": "Gets the real value of `t[index]`, without invoking `__index`.",
	"rawlen(v)": "Returns the length of `v`, without invoking `__len`.",
	"rawset(t, index, value)": "Sets the real value of `t[index]`, without invoking `__newindex`.",
	"require(modname)": "Loads the given module. Built-in Pluto modules are available as `pluto:<name>`.",
	"select(index, ...)": "Returns all arguments after argument number `index`, or the argument count for `\"#\"`.",
	"setmetatable(t, metatable)": "Sets the metatable for the given table and returns the table.",
	"tonumber(e, base?)": "Converts its argument to a number, or returns nil.",
	"tostring(v)": "Converts any value to a string in a human-readable format.",
	"type(v)": "Returns the type of its argument as a string.",
	"xpcall(f, msgh, ...)": "Like `pcall`, but with a custom message handler.",
	"warn(msg, ...)": "Emits a warning.",

	"string.gmatch(str, pattern, init?)": "Returns an iterator over all matches of `pattern` in the string.",

	"table.concat(t, sep?, i?, j?)": "Concatenates the elements of an array into a string.",
	"table.insert(t, pos?, value)": "Inserts `value` at position `pos` in `t` (by default, at the end).",
	"table.remove(t, pos?)": "Removes and returns the element at position `pos` (by default, the last one).",
	"table.unpack(t, i?, j?)": "Returns the elements from the given array.",
	"table.pack(...)": "Returns a new table with all arguments stored into keys 1, 2, etc. and a field `n`.",
	"table.move(a1, f, e, t, a2?)": "Moves elements from table `a1` to table `a2`.",

	"math.abs(x)": "Returns the absolute value of `x`.",
	"math.ceil(x)": "Returns the smallest integral value greater than or equal to `x`.",
	"math.floor(x)": "Returns the largest integral value less than or equal to `x`.",
	"math.max(x, ...)": "Returns the argument with the maximum value.",
	"math.min(x, ...)": "Returns the argument with the minimum value.",
	"math.sqrt(x)": "Returns the square root of `x`.",
	"math.random(m?, n?)": "Returns a pseudo-random number: a float in [0,1), or an integer in [1,m] or [m,n].",
	"math.randomseed(x?, y?)": "Seeds the pseudo-random generator.",
	"math.sin(x)": "Returns the sine of `x` (in radians).",
	"math.cos(x)": "Returns the cosine of `x` (in radians).",
	"math.tan(x)": "Returns the tangent of `x` (in radians).",
	"math.asin(x)": "Returns the arc sine of `x` (in radians).",
	"math.acos(x)": "Returns the arc cosine of `x` (in radians).",
	"math.atan(y, x?)": "Returns the arc tangent of `y/x` (in radians).",
	"math.exp(x)": "Returns e raised to the power `x`.",
	"math.log(x, base?)": "Returns the logarithm of `x` in the given base (default e).",
	"math.fmod(x, y)": "Returns the remainder of the division of `x` by `y` that rounds the quotient towards zero.",
	"math.modf(x)": "Returns the integral part of `x` and the fractional part of `x`.",
	"math.tointeger(x)": "Converts `x` to an integer if it is representable as one, otherwise returns nil.",
	"math.type(x)": "Returns `\"integer\"`, `\"float\"`, or nil if `x` is not a number.",
	"math.ult(m, n)": "Unsigned integer less-than comparison.",
	"math.pi": "The value of π.",
	"math.huge": "A value greater than any other numeric value.",
	"math.maxinteger": "The maximum value for an integer.",
	"math.mininteger": "The minimum value for an integer.",

	"io.open(filename, mode?)": "Opens a file in the given mode and returns a file handle, or nil plus an error message.",
	"io.close(file?)": "Closes `file`, or the default output file.",
	"io.read(...)": "Reads from the default input file according to the given formats.",
	"io.write(...)": "Writes each argument to the default output file.",
	"io.lines(filename?, ...)": "Returns an iterator over the lines of the given file.",
	"io.input(file?)": "Gets or sets the default input file.",
	"io.output(file?)": "Gets or sets the default output file.",
	"io.popen(prog, mode?)": "Starts `prog` in a separate process and returns a file handle to read from or write to it.",
	"io.tmpfile()": "Returns a handle for a temporary file.",
	"io.type(obj)": "Checks whether `obj` is a valid file handle.",
	"io.stdin": "Standard input file handle.",
	"io.stdout": "Standard output file handle.",
	"io.stderr": "Standard error file handle.",

	"os.time(t?)": "Returns the current time, or the time described by the table `t`.",
	"os.date(format?, time?)": "Returns a string or table containing date and time, formatted according to `format`.",
	"os.clock()": "Returns an approximation of the CPU time used by the program, in seconds.",
	"os.difftime(t2, t1)": "Returns the difference, in seconds, from time `t1` to time `t2`.",
	"os.exit(code?, close?)": "Terminates the host program.",
	"os.tmpname()": "Returns a string with a file name that can be used for a temporary file.",
	"os.setlocale(locale?, category?)": "Sets the current locale of the program.",

	"coroutine.create(f)": "Creates a new coroutine with body `f`.",
	"coroutine.resume(co, ...)": "Starts or continues the execution of coroutine `co`.",
	"coroutine.yield(...)": "Suspends the execution of the calling coroutine.",
	"coroutine.status(co)": "Returns the status of the coroutine `co` as a string.",
	"coroutine.wrap(f)": "Creates a coroutine and returns a function that resumes it each time it is called.",
	"coroutine.running()": "Returns the running coroutine plus a boolean, true when it is the main one.",
	"coroutine.isyieldable(co?)": "Returns true when the coroutine can yield.",
	"coroutine.close(co)": "Closes the coroutine `co`.",

	"debug.traceback(message?, level?)": "Returns a string with a traceback of the call stack.",
	"debug.getinfo(f, what?)": "Returns a table with information about a function.",
};

const LIB_DOCS = {
	debug: "Lua's debug library.",
};

/** @type {{ name: string, doc: string, deprecated?: boolean }[]} */
const KEYWORDS = [
	{ name: "and", doc: "Logical AND." },
	{ name: "as", doc: "Used in for-as loops: `for t as value do`." },
	{ name: "begin", doc: "Opens the body of an `enum`." },
	{ name: "break", doc: "Exits the innermost loop or switch case. Pluto also supports `break N` to exit multiple levels." },
	{ name: "case", doc: "A case inside a `switch` block: `case value:`." },
	{ name: "catch", doc: "Part of the try/catch statement, which was deprecated in Pluto 0.12.2 and has since been removed. Use `pcall`/`xpcall` instead.", deprecated: true },
	{ name: "class", doc: "Declares a class: `class Name [extends Base] ... end`." },
	{ name: "continue", doc: "Skips to the next iteration of the innermost loop." },
	{ name: "default", doc: "The fallback case inside a `switch` block: `default:`." },
	{ name: "do", doc: "Opens a block." },
	{ name: "else", doc: "Alternative branch of an `if` statement." },
	{ name: "elseif", doc: "Conditional alternative branch of an `if` statement." },
	{ name: "end", doc: "Closes a block." },
	{ name: "enum", doc: "Declares an enumeration: `enum [class] [Name] begin A, B, C end`." },
	{ name: "export", doc: "Export modifier: collects the declaration into the table returned by the file." },
	{ name: "extends", doc: "Specifies the parent of a class: `class Child extends Base`." },
	{ name: "false", doc: "Boolean false." },
	{ name: "for", doc: "Loop: `for i = 1, 10 do`, `for k, v in t do`, or `for t as v do`." },
	{ name: "function", doc: "Declares a function." },
	{ name: "goto", doc: "Jumps to a `::label::`." },
	{ name: "if", doc: "Conditional statement, or a ternary expression: `if cond then a else b`." },
	{ name: "in", doc: "Used in generic for loops and `in` expressions: `if x in t then`." },
	{ name: "instanceof", doc: "Checks if a table is an instance of a class: `obj instanceof Class`." },
	{ name: "local", doc: "Declares a local variable or function." },
	{ name: "new", doc: "Creates an instance of a class, calling `__construct` if it exists: `new Class(...)`." },
	{ name: "nil", doc: "The absence of a value." },
	{ name: "not", doc: "Logical NOT." },
	{ name: "or", doc: "Logical OR." },
	{ name: "parent", doc: "Refers to the parent class inside of a method: `parent:__construct(...)`." },
	{ name: "private", doc: "Class member modifier: only accessible via `self`." },
	{ name: "protected", doc: "Class member modifier." },
	{ name: "public", doc: "Class member modifier (the default)." },
	{ name: "pluto_use", doc: "Toggles Pluto keywords for compatibility with Lua code: `pluto_use \"0.6.0\"`, `pluto_use * = false, switch`." },
	{ name: "repeat", doc: "Loop: `repeat ... until condition`." },
	{ name: "return", doc: "Returns from a function or chunk." },
	{ name: "self", doc: "The instance a method was called on." },
	{ name: "static", doc: "Declares a function in a class or table that does not take `self`." },
	{ name: "switch", doc: "Switch block: `switch value do case 1: ... break default: ... end`." },
	{ name: "then", doc: "Opens the body of an `if`." },
	{ name: "true", doc: "Boolean true." },
	{ name: "try", doc: "The try/catch statement was deprecated in Pluto 0.12.2 and has since been removed. Use `pcall`/`xpcall` instead.", deprecated: true },
	{ name: "until", doc: "Ends a `repeat` loop with its exit condition." },
	{ name: "while", doc: "Loop: `while condition do ... end`." },
];

/** @type {Map<string, Builtin>} */
const functions = new Map();
/** @type {Map<string, Builtin[]>} */
const members = new Map();
/** @type {Builtin[]} */
const globals = [];
/** @type {Map<string, { require: boolean, doc: string }>} */
const libs = new Map(Object.entries(generated.libs));

function register(entry)
{
	if (functions.has(entry.name))
	{
		return;
	}
	const dot = entry.name.lastIndexOf(".");
	entry.lib = dot == -1 ? null : entry.name.slice(0, dot);
	entry.short = dot == -1 ? entry.name : entry.name.slice(dot + 1);
	functions.set(entry.name, entry);
	if (entry.lib === null)
	{
		globals.push(entry);
	}
	else
	{
		if (!members.has(entry.lib))
		{
			members.set(entry.lib, []);
		}
		members.get(entry.lib).push(entry);
		const root = entry.lib.split(".")[0];
		if (!libs.has(root))
		{
			libs.set(root, { require: false, doc: LIB_DOCS[root] || "" });
		}
	}
}

for (const fn of generated.functions)
{
	register(Object.assign({}, fn));
}
for (const [signature, doc] of Object.entries(LUA_STD))
{
	const m = /^([\w.]+)(?:\((.*)\))?$/.exec(signature);
	const entry = { name: m[1], doc };
	if (m[2] !== undefined)
	{
		entry.params = m[2].trim() ? m[2].split(",").map(p => ({ name: p.trim() })) : [];
	}
	register(entry);
}

// Sub-tables such as `wasm.global` are members of their parent library, too.
for (const lib of [...members.keys()])
{
	const dot = lib.lastIndexOf(".");
	if (dot != -1)
	{
		register({ name: lib, doc: "", table: true });
	}
}

/** Modules that are loaded via `require "pluto:<name>"`. */
const modules = [...libs.entries()]
	.filter(([, info]) => info.require)
	.map(([name, info]) => ({ id: "pluto:" + name, lib: name, doc: info.doc }));

/**
 * @param {Builtin} entry
 */
function formatBuiltinSignature(entry)
{
	if (entry.params === undefined)
	{
		return entry.name;
	}
	const name = entry.method ? entry.lib + ":" + entry.short : entry.name;
	return "function " + name + "(" + (entry.params ? entry.params.map(p => p.name).join(", ") : "...") + ")";
}

/**
 * Markdown documentation for a built-in function, including its parameter list.
 * @param {Builtin} entry
 */
function formatBuiltinDoc(entry)
{
	const out = [];
	if (entry.doc)
	{
		out.push(entry.doc);
	}
	const documented = (entry.params || []).filter(p => p.doc);
	if (documented.length)
	{
		out.push(documented.map(p => "- `" + p.name + "` — " + p.doc).join("\n"));
	}
	if (entry.returns && !entry.doc.startsWith("Returns: "))
	{
		out.push("**Returns:** " + entry.returns);
	}
	if (entry.overloaded)
	{
		out.push("*The parameters of this function depend on the mode; see the Pluto documentation.*");
	}
	if (entry.aliases && entry.aliases.length)
	{
		out.push("Aliases: " + entry.aliases.map(a => "`" + a + "`").join(", "));
	}
	const root = entry.lib ? entry.lib.split(".")[0] : null;
	if (root && libs.get(root) && libs.get(root).require)
	{
		out.push("Requires `local " + root + " = require \"pluto:" + root + "\"`");
	}
	return out.join("\n\n");
}

/**
 * Maps a module name as passed to `require` to a built-in library name, if it is one.
 * @param {string} moduleName
 * @returns {string|null}
 */
function libForModule(moduleName)
{
	const name = moduleName.startsWith("pluto:") ? moduleName.slice(6) : moduleName;
	const info = libs.get(name);
	return info && (info.require || moduleName.startsWith("pluto:")) ? name : null;
}

module.exports = {
	KEYWORDS,
	keywordMap: new Map(KEYWORDS.map(k => [k.name, k])),
	functions,
	members,
	globals,
	libs,
	modules,
	formatBuiltinSignature,
	formatBuiltinDoc,
	libForModule,
};
