// Generates src/builtins.generated.json from the official Pluto documentation.
//
// Usage:
//   git clone --depth 1 https://github.com/PlutoLang/plutolang.github.io
//   node scripts/gen-builtins.js "plutolang.github.io/docs/Runtime Environment"

const fs = require("fs");
const path = require("path");

const docsDir = process.argv[2];
if (!docsDir)
{
	console.error("Usage: node scripts/gen-builtins.js <path to 'docs/Runtime Environment'>");
	process.exit(1);
}

// Parameter names for commonly used functions, where the docs only describe parameters in prose.
const PARAM_OVERRIDES = {
	"string.split": ["str", "separator", "limit?"],
	"string.startswith": ["str", "prefix"],
	"string.endswith": ["str", "suffix"],
	"string.contains": ["str", "substring"],
	"string.strip": ["str", "chars?"],
	"string.lstrip": ["str", "chars?"],
	"string.rstrip": ["str", "chars?"],
	"string.partition": ["str", "separator", "fromend?"],
	"string.replace": ["str", "from", "to", "limit?"],
	"string.truncate": ["str", "length", "fromend?"],
	"string.formatint": ["int", "separator?", "group?"],
	"table.contains": ["t", "value"],
	"table.find": ["t", "callback"],
	"table.findkey": ["t", "callback"],
	"table.findindex": ["t", "callback"],
	"table.filter": ["t", "callback"],
	"table.filtered": ["t", "callback"],
	"table.map": ["t", "callback"],
	"table.mapped": ["t", "callback"],
	"table.reduce": ["t", "callback", "initial?"],
	"table.foreach": ["t", "callback"],
	"table.size": ["t"],
	"table.clear": ["t"],
	"table.keys": ["t"],
	"table.values": ["t"],
	"table.freeze": ["t"],
	"table.isfrozen": ["t"],
	"table.reverse": ["t"],
	"table.reversed": ["t"],
	"table.slice": ["t", "start", "stop?"],
	"table.chunk": ["t", "size"],
	"io.listdir": ["path", "recursive?"],
	"io.scandir": ["path", "recursive?"],
	"io.isdir": ["path"],
	"io.isfile": ["path"],
	"io.exists": ["path"],
	"io.copy": ["from", "to"],
	"io.contents": ["path", "contents?"],
	"io.makedir": ["path"],
	"io.mkdir": ["path"],
	"io.makedirs": ["path"],
	"io.mkdirs": ["path"],
	"io.absolute": ["path", "canonical?"],
	"io.relative": ["path", "base?"],
	"io.part": ["path", "part?"],
	"io.filesize": ["path"],
	"os.sleep": ["ms"],
	"http.request": ["url", "options?"],
	"url.encode": ["str", "encodespaces?"],
	"url.decode": ["str"],
	"url.parse": ["url"],
	"regex.new": ["pattern"],
	"dumpvar": ["value"],
	"exportvar": ["value"],
	"range": ["from", "to?", "step?"],
	"compareversions": ["a", "b"],
	"wcall": ["callback", "..."],
	"callonce": ["callback"],
	"sdiv": ["a", "b"],
	"udiv": ["a", "b"],
	"smod": ["a", "b"],
	"umod": ["a", "b"],
	"string.rfind": ["str", "pattern", "init?", "plain?"],
	"string.iswhitespace": ["str"],
	"string.uformat": ["format", "..."],
	"string.format": ["format", "..."],
	"string.casefold": ["str", "other"],
	"string.upper": ["str", "index?"],
	"string.lower": ["str", "index?"],
	"string.find": ["str", "pattern", "init?", "plain?"],
	"string.gsub": ["str", "pattern", "repl", "limit?"],
	"string.match": ["str", "pattern", "init?"],
	"string.sub": ["str", "i", "j?"],
	"string.byte": ["str", "i?", "j?"],
	"string.char": ["..."],
	"string.rep": ["str", "n", "separator?"],
	"string.tohex": ["str", "spaces?", "uppercase?"],
	"table.sort": ["t", "comparator?"],
	"table.sorted": ["t", "comparator?"],
	"table.reversed": ["t"],
	"table.reordered": ["t"],
	"table.deduped": ["t"],
	"table.deduplicated": ["t"],
	"table.isarray": ["t"],
	"io.rename": ["oldname", "newname"],
	"io.remove": ["path"],
	"io.writetime": ["path", "time?"],
	"io.currentdir": ["path?"],
	"io.chdir": ["path?"],
	"io.cwd": ["path?"],
	"io.chmod": ["path", "mode?"],
	"io.relative": ["path", "base?"],
	"regex.match": ["pattern", "str"],
	"assert.noerror": ["callback", "..."],
	"assert.haserror": ["callback", "..."],
	"assert.searcherror": ["substring", "callback", "..."],
	"scheduler.add": ["callback"],
	"scheduler.addloop": ["callback"],
	"scheduler.run": [],
	"crypto.random": [],
	"http.closeconnections": [],
};

// Documented with a heading like a function, but actually plain values.
const VALUES = new Set([
	"_PVERSION", "package.path", "os.platform", "os.arch", "math.inf", "ffi.nullptr",
	"utf8.charpattern", "scheduler.yieldfunc", "scheduler.errorfunc",
]);

function guessParamName(desc, used)
{
	const d = desc.toLowerCase();
	const candidates = [
		[/\bcallback\b|\bpredicate\b|\bfunction to\b/, "callback"],
		[/\bseparator\b|\bdelimiter\b/, "separator"],
		[/\bpath\b|\bfile stream\b|\bdirectory\b/, "path"],
		[/\burl\b/, "url"],
		[/\boptions\b/, "options"],
		[/\bpattern\b|\bregex\b/, "pattern"],
		[/\bkey\b/, "key"],
		[/\bindex\b|\bposition\b|\boffset\b/, "index"],
		[/\blimit\b|\bmaximum\b/, "limit"],
		[/\blength\b|\bsize\b|\bcount\b|\bamount\b|\bnumber of\b/, "n"],
		[/\btable\b|\barray\b/, "t"],
		[/\bstring\b|\btext\b|\bdata\b/, "str"],
		[/\binteger\b|\bnumber\b|\bvalue\b/, "value"],
		[/\bboolean\b|\bwhether\b|\bif true\b/, "flag"],
	];
	let name = "arg";
	for (const [re, n] of candidates)
	{
		if (re.test(d))
		{
			name = n;
			break;
		}
	}
	let unique = name;
	for (let i = 2; used.has(unique); ++i)
	{
		unique = name + i;
	}
	used.add(unique);
	return unique;
}

function isOptional(desc)
{
	return /\boptional(ly)?\b|\bdefaults? to\b|\bby default\b|\bif (provided|given|omitted)\b/i.test(desc);
}

function cleanText(text)
{
	return text
		.replace(/\[([^\]]+)\]\((?!https?:)[^)]*\)/g, "$1") // relative links don't work in hovers
		.replace(/^:::.*$/gm, "")
		.trim();
}

function parseFile(file)
{
	const base = path.basename(file, ".md");
	const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
	const intro = lines.filter(l => l.trim() && !/^(---|sidebar_|#)/.test(l))[0] || "";
	const needsRequire = /\brequire\b/.test(intro);
	const isGlobals = base.startsWith("Global");
	const lib = isGlobals ? null : base.toLowerCase();
	const entries = [];

	let i = 0;
	while (i < lines.length)
	{
		const m = /^### (`.+)$/.exec(lines[i]);
		if (!m)
		{
			++i;
			continue;
		}
		const names = [...m[1].matchAll(/`([^`]+)`/g)].map(x => x[1]);
		++i;
		const body = [];
		while (i < lines.length && !/^###? /.test(lines[i]) && !/^## /.test(lines[i]))
		{
			body.push(lines[i]);
			++i;
		}

		// Split body into description / parameters / returns; examples are dropped.
		const desc = [];
		const params = [];
		const returns = [];
		let section = "desc";
		let inCode = false;
		for (const line of body)
		{
			if (/^```/.test(line))
			{
				inCode = !inCode;
				continue;
			}
			if (inCode || line.trim() == "---")
			{
				continue;
			}
			const h = /^#### (.+)$/.exec(line);
			if (h)
			{
				section = h[1].toLowerCase();
				continue;
			}
			if (section == "desc")
			{
				desc.push(line);
			}
			else if (section == "parameters")
			{
				const p = /^\d+\.\s+(.*)$/.exec(line);
				if (p)
				{
					params.push(p[1]);
				}
			}
			else if (section == "returns")
			{
				returns.push(line);
			}
		}

		const description = cleanText(desc.join("\n")).split(/\n\s*\n/)[0] || "";
		for (const rawName of names)
		{
			if (!/^[A-Za-z_][\w.]*$/.test(rawName) || rawName.startsWith("__"))
			{
				continue; // metamethods and the like
			}
			let fullName = rawName;
			let isMethod = false;
			if (!rawName.includes("."))
			{
				if (isGlobals)
				{
					fullName = rawName;
				}
				else
				{
					// Bare names on a library page are instance methods, e.g. scheduler:add.
					fullName = lib + "." + rawName;
					isMethod = true;
				}
			}
			const used = new Set();
			const override = PARAM_OVERRIDES[fullName];
			const source = override && override.length != params.length
				? override.map((_, idx) => params[idx] || "")
				: params;
			const outParams = source.map((text, idx) =>
			{
				const named = /^`([A-Za-z_]\w*)`\s*(?:—|-|:)\s*(.*)$/.exec(text);
				let name, doc = text;
				if (override && override[idx])
				{
					name = override[idx];
				}
				else if (named)
				{
					name = named[1];
					doc = named[2];
					if (isOptional(doc))
					{
						name += "?";
					}
				}
				else
				{
					name = guessParamName(text, used);
					if (isOptional(text))
					{
						name += "?";
					}
				}
				if (named)
				{
					doc = named[2];
				}
				used.add(name.replace("?", ""));
				return { name, doc: cleanText(doc) };
			});
			const entry = { name: fullName, doc: description };
			if (!VALUES.has(fullName))
			{
				// null = the docs don't list parameters, so we don't know the arity.
				entry.params = (params.length || override) ? outParams : null;
			}
			if (returns.length)
			{
				entry.returns = cleanText(returns.join("\n")).split(/\n\s*\n/)[0];
			}
			if (isMethod)
			{
				entry.method = true;
			}
			if (names.length > 1)
			{
				entry.aliases = names.filter(n => n != rawName && /^[A-Za-z_][\w.]*$/.test(n) && !n.startsWith("__"));
			}
			entries.push(entry);
		}
	}
	return { lib, needsRequire, intro: cleanText(intro), entries };
}

const libs = {};
const functions = [];
for (const f of fs.readdirSync(docsDir).filter(f => f.endsWith(".md")).sort())
{
	const { lib, needsRequire, intro, entries } = parseFile(path.join(docsDir, f));
	if (lib && lib != "exception")
	{
		libs[lib] = { require: needsRequire, doc: intro };
	}
	functions.push(...entries);
}

// Some functions are documented once per mode (e.g. crypto.encrypt); keep the first entry
// but don't claim a fixed parameter list for it.
const seen = new Map();
for (let i = 0; i < functions.length; ++i)
{
	const fn = functions[i];
	if (seen.has(fn.name))
	{
		const first = seen.get(fn.name);
		if (JSON.stringify((first.params || []).map(p => p.name)) != JSON.stringify((fn.params || []).map(p => p.name)))
		{
			first.overloaded = true;
		}
		functions.splice(i--, 1);
		continue;
	}
	seen.set(fn.name, fn);
	if (!fn.doc && fn.returns)
	{
		fn.doc = "Returns: " + fn.returns;
	}
}

const out = path.join(__dirname, "..", "src", "builtins.generated.json");
fs.writeFileSync(out, JSON.stringify({ libs, functions }, null, "\t") + "\n");
console.log(`Wrote ${functions.length} entries for ${Object.keys(libs).length} libraries to ${out}`);
