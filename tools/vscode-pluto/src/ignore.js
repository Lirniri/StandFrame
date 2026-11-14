// Path filtering for the workspace index: .gitignore-style ignore files and VS Code glob patterns.
// Free of VS Code dependencies so it can be unit-tested with plain Node. All paths are relative
// to a workspace folder and use forward slashes.

"use strict";

function escapeRegExp(c)
{
	return /[\\^$.*+?()[\]{}|/]/.test(c) ? "\\" + c : c;
}

// Converts a `[...]` character class starting at pattern[i]. Returns [regex source, next index] or null.
function charClass(pattern, i)
{
	let j = i + 1;
	let out = "[";
	if (pattern[j] == "!" || pattern[j] == "^")
	{
		out += "^";
		++j;
	}
	if (pattern[j] == "]")
	{
		out += "\\]";
		++j;
	}
	for (; j < pattern.length && pattern[j] != "]"; ++j)
	{
		const c = pattern[j];
		if (c == "\\" && j + 1 < pattern.length)
		{
			out += "\\" + pattern[++j];
		}
		else
		{
			out += c == "[" || c == "^" ? "\\" + c : c;
		}
	}
	return j < pattern.length ? [out + "]", j + 1] : null;
}

// ---------------------------------------------------------------------------------------------
// .gitignore
// ---------------------------------------------------------------------------------------------

/**
 * Converts one gitignore pattern (already stripped of `!`, leading and trailing `/`) to a regex.
 */
function gitignoreRegExp(pattern, anchored)
{
	let re = "";
	let i = 0;
	while (i < pattern.length)
	{
		const c = pattern[i];
		if (c == "*" && pattern[i + 1] == "*")
		{
			const atStart = i == 0;
			const slashAfter = pattern[i + 2] == "/";
			const atEnd = i + 2 == pattern.length;
			if (atStart && slashAfter)
			{
				re += "(?:.*/)?"; // `**/x`
				i += 3;
				continue;
			}
			if (atEnd && pattern[i - 1] == "/")
			{
				re += ".*"; // `x/**`
				i += 2;
				continue;
			}
			if (pattern[i - 1] == "/" && slashAfter)
			{
				re += "(?:.*/)?"; // `a/**/b`
				i += 3;
				continue;
			}
			re += "[^/]*"; // `**` elsewhere acts like `*`
			i += 2;
			continue;
		}
		if (c == "*")
		{
			re += "[^/]*";
		}
		else if (c == "?")
		{
			re += "[^/]";
		}
		else if (c == "[")
		{
			const cls = charClass(pattern, i);
			if (cls)
			{
				re += cls[0];
				i = cls[1];
				continue;
			}
			re += "\\[";
		}
		else if (c == "\\" && i + 1 < pattern.length)
		{
			re += escapeRegExp(pattern[++i]);
		}
		else
		{
			re += escapeRegExp(c);
		}
		++i;
	}
	return new RegExp("^" + (anchored ? "" : "(?:.*/)?") + re + "$");
}

/**
 * Parses the contents of a .gitignore-style file.
 * @param {string} text
 * @param {string} [base] Directory of the ignore file relative to the workspace folder ("" for the root).
 * @returns {{ re: RegExp, negate: boolean, dirOnly: boolean, base: string, source: string }[]}
 */
function parseIgnoreFile(text, base)
{
	base = (base || "").replace(/^\/+|\/+$/g, "");
	const rules = [];
	for (let line of text.replace(/^﻿/, "").split(/\r?\n/))
	{
		// Trailing spaces are ignored unless escaped.
		line = line.replace(/(?<!\\)\s+$/, "");
		if (!line || line.startsWith("#"))
		{
			continue;
		}
		let negate = false;
		if (line.startsWith("!"))
		{
			negate = true;
			line = line.slice(1);
		}
		else if (line.startsWith("\\!") || line.startsWith("\\#"))
		{
			line = line.slice(1);
		}
		let dirOnly = false;
		if (line.endsWith("/"))
		{
			dirOnly = true;
			line = line.replace(/\/+$/, "");
		}
		if (!line)
		{
			continue;
		}
		const anchored = line.includes("/");
		line = line.replace(/^\/+/, "");
		rules.push({ re: gitignoreRegExp(line, anchored), negate, dirOnly, base, source: line });
	}
	return rules;
}

class IgnoreMatcher
{
	constructor()
	{
		this.rules = [];
	}

	/**
	 * @param {string} text Contents of an ignore file.
	 * @param {string} [base] Its directory, relative to the workspace folder.
	 */
	add(text, base)
	{
		this.rules.push(...parseIgnoreFile(text, base));
		return this;
	}

	get empty()
	{
		return this.rules.length == 0;
	}

	// The decision of the last matching rule: true = ignored, false = re-included, null = no match.
	_decide(path, isDir)
	{
		let result = null;
		for (const rule of this.rules)
		{
			if (rule.dirOnly && !isDir)
			{
				continue;
			}
			let rel = path;
			if (rule.base)
			{
				if (!path.startsWith(rule.base + "/"))
				{
					continue;
				}
				rel = path.slice(rule.base.length + 1);
			}
			if (rule.re.test(rel))
			{
				result = !rule.negate;
			}
		}
		return result;
	}

	/**
	 * @param {string} path Relative path of a file (or a directory, with isDir).
	 * @param {boolean} [isDir]
	 */
	ignores(path, isDir)
	{
		if (this.empty)
		{
			return false;
		}
		const parts = path.replace(/^\/+|\/+$/g, "").split("/");
		// As in git, nothing inside an ignored directory can be re-included.
		for (let i = 1; i < parts.length; ++i)
		{
			if (this._decide(parts.slice(0, i).join("/"), true) === true)
			{
				return true;
			}
		}
		return this._decide(parts.join("/"), !!isDir) === true;
	}
}

// ---------------------------------------------------------------------------------------------
// VS Code glob patterns (files.exclude, search.exclude, settings)
// ---------------------------------------------------------------------------------------------

/**
 * Converts a VS Code glob pattern to a regex: `**`, `*`, `?`, `[...]` and nested `{a,b}` groups.
 * Like VS Code, patterns are matched against the whole path relative to the workspace folder,
 * so `*.lua` only matches at the root and `**\/*.lua` at any depth.
 * @param {string} glob
 */
function globToRegExp(glob)
{
	glob = glob.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
	let re = "";
	let depth = 0;
	for (let i = 0; i < glob.length; ++i)
	{
		const c = glob[i];
		if (c == "*" && glob[i + 1] == "*")
		{
			const startOfSegment = i == 0 || glob[i - 1] == "/";
			if (startOfSegment && glob[i + 2] == "/")
			{
				re += "(?:[^/]*/)*"; // `**/`: any number of directories
				i += 2;
			}
			else if (startOfSegment && i + 2 == glob.length)
			{
				re += ".*"; // trailing `**`
				i += 1;
			}
			else
			{
				re += "[^/]*";
				i += 1;
			}
		}
		else if (c == "*")
		{
			re += "[^/]*";
		}
		else if (c == "?")
		{
			re += "[^/]";
		}
		else if (c == "[")
		{
			const cls = charClass(glob, i);
			if (cls)
			{
				re += cls[0];
				i = cls[1] - 1;
			}
			else
			{
				re += "\\[";
			}
		}
		else if (c == "{")
		{
			re += "(?:";
			++depth;
		}
		else if (c == "}" && depth > 0)
		{
			re += ")";
			--depth;
		}
		else if (c == "," && depth > 0)
		{
			re += "|";
		}
		else
		{
			re += escapeRegExp(c);
		}
	}
	re += ")".repeat(depth);
	return new RegExp("^" + re + "$", process.platform == "win32" ? "i" : "");
}

class GlobSet
{
	/**
	 * @param {string[]} patterns
	 */
	constructor(patterns)
	{
		this.patterns = [];
		for (const p of patterns)
		{
			if (typeof p != "string" || !p.trim())
			{
				continue;
			}
			try
			{
				this.patterns.push({ source: p, re: globToRegExp(p.trim()) });
			}
			catch (e)
			{
				// An invalid pattern is skipped rather than breaking indexing.
			}
		}
	}

	get empty()
	{
		return this.patterns.length == 0;
	}

	/**
	 * True if the path or one of its parent directories matches a pattern
	 * (excluding a folder excludes everything inside of it).
	 * @param {string} path
	 */
	matches(path)
	{
		if (this.empty)
		{
			return false;
		}
		const parts = path.replace(/^\/+|\/+$/g, "").split("/");
		for (let i = 1; i <= parts.length; ++i)
		{
			const prefix = parts.slice(0, i).join("/");
			for (const p of this.patterns)
			{
				if (p.re.test(prefix))
				{
					return true;
				}
			}
		}
		return false;
	}
}

/**
 * Turns a `files.exclude` / `search.exclude` style object into a list of active patterns.
 * Entries with conditions (`{ "when": ... }`) are skipped.
 * @param {Record<string, boolean|object>|undefined} setting
 */
function enabledGlobs(setting)
{
	if (!setting || typeof setting != "object")
	{
		return [];
	}
	return Object.entries(setting).filter(([, v]) => v === true).map(([k]) => k);
}

module.exports = { IgnoreMatcher, parseIgnoreFile, GlobSet, globToRegExp, enabledGlobs };
