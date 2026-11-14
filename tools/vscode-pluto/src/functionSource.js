// Turns the source of a function into a compact, readable listing for hovers:
// comments removed, whitespace collapsed, indentation normalized to steps of two spaces and
// logical blocks separated by exactly one blank line. Free of VS Code dependencies.

"use strict";

const OPEN = "\u0001";
const CLOSE = "\u0002";
const INDENT = "  ";

// Lines that continue the block opened above them instead of starting a new statement.
const CONTINUATION = /^(?:(?:end|until|else|elseif|case|default|catch|pluto_catch)\b|[}\])])/;

function longBracketLevel(text, pos)
{
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
}

function longBracketEnd(text, pos, level)
{
	const close = "]" + "=".repeat(level) + "]";
	const idx = text.indexOf(close, pos + level + 2);
	return idx == -1 ? text.length : idx + close.length;
}

/**
 * Removes comments and replaces string literals with placeholders, so that the rest can be
 * reformatted without touching their contents.
 * @param {string} text
 * @returns {{ code: string, strings: string[] }}
 */
function scan(text)
{
	text = text.replace(/\r/g, "").replace(/[\u0001\u0002]/g, "");
	const strings = [];
	const stash = function (s)
	{
		strings.push(s);
		return OPEN + (strings.length - 1) + CLOSE;
	};
	let out = "";
	let i = 0;
	const n = text.length;
	while (i < n)
	{
		const c = text[i];
		if (c == "-" && text[i + 1] == "-")
		{
			const level = longBracketLevel(text, i + 2);
			if (level != -1)
			{
				i = longBracketEnd(text, i + 2, level);
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
			let j = i + 1;
			while (j < n && text[j] != c && text[j] != "\n")
			{
				j += text[j] == "\\" ? 2 : 1;
			}
			if (text[j] == c)
			{
				++j;
			}
			out += stash(text.slice(i, Math.min(j, n)));
			i = j;
			continue;
		}
		if (c == "[")
		{
			const level = longBracketLevel(text, i);
			if (level != -1)
			{
				const end = longBracketEnd(text, i, level);
				out += stash(text.slice(i, end));
				i = end;
				continue;
			}
		}
		out += c;
		++i;
	}
	return { code: out, strings };
}

function indentWidth(line)
{
	let w = 0;
	for (const c of line)
	{
		if (c == " ")
		{
			++w;
		}
		else if (c == "\t")
		{
			w += 4;
		}
		else
		{
			break;
		}
	}
	return w;
}

/**
 * Non-empty lines with their nesting level, derived from the original indentation
 * (whatever its step size, tabs or spaces).
 */
function toItems(code)
{
	const items = [];
	const widths = [];
	for (const raw of code.split("\n"))
	{
		const text = raw.trim().replace(/[ \t]+/g, " ");
		if (!text)
		{
			continue;
		}
		const w = indentWidth(raw);
		if (!widths.length)
		{
			widths.push(w);
		}
		while (widths.length > 1 && widths[widths.length - 1] > w)
		{
			widths.pop();
		}
		if (w > widths[widths.length - 1])
		{
			widths.push(w);
		}
		items.push({ level: widths.length - 1, text });
	}
	return items;
}

function kindOf(unit)
{
	if (unit.length > 1)
	{
		return "block";
	}
	const text = unit[0].text;
	return /^return\b/.test(text) ? "return" : /^(?:local|const)\b/.test(text) ? "decl" : "stmt";
}

/**
 * Lays out statements at `level`: nested runs are laid out recursively, and blank lines
 * (`null`) go between statements of different kinds and around multi-line statements.
 */
function layout(items, level, space, out)
{
	const units = [];
	let current = null;
	for (const item of items)
	{
		if (current && (item.level > level || CONTINUATION.test(item.text)))
		{
			current.push(item);
		}
		else
		{
			current = [item];
			units.push(current);
		}
	}
	let prevKind = null;
	for (const unit of units)
	{
		const kind = kindOf(unit);
		if (space && prevKind && (prevKind == "block" || kind == "block" || prevKind != kind))
		{
			out.push(null);
		}
		prevKind = kind;
		for (let i = 0; i < unit.length;)
		{
			if (unit[i].level > level)
			{
				let j = i;
				while (j < unit.length && unit[j].level > level)
				{
					++j;
				}
				const run = unit.slice(i, j);
				layout(run, level + 1, space && run.length >= 6, out);
				i = j;
			}
			else
			{
				out.push(unit[i]);
				++i;
			}
		}
	}
}

/**
 * Formats the source of a function (from its `function` line to the closing `end`).
 * @param {string} source
 * @param {{ maxLines?: number }} [options] `maxLines`: longest listing in lines, 0 for no limit.
 * @returns {string} Empty if there is nothing to show.
 */
function formatFunctionSource(source, options)
{
	const maxLines = options && options.maxLines > 0 ? Math.floor(options.maxLines) : 0;
	const { code, strings } = scan(source);
	const items = toItems(code);
	if (!items.length)
	{
		return "";
	}
	const last = items.length - 1;
	const closed = items.length > 1 && items[last].level == 0 && /^end\b/.test(items[last].text);
	for (let i = 1; i < (closed ? last : items.length); ++i)
	{
		items[i].level = Math.max(1, items[i].level);
	}
	if (closed)
	{
		items[last].text = items[last].text.replace(/[,;]$/, "");
	}
	// The header ends where its parentheses are balanced (parameters may span lines).
	let headerCount = 0;
	let balance = 0;
	for (const item of items)
	{
		++headerCount;
		balance += (item.text.match(/\(/g) || []).length - (item.text.match(/\)/g) || []).length;
		if (balance <= 0)
		{
			break;
		}
	}
	const body = items.slice(headerCount, closed ? last : undefined);
	const lines = items.slice(0, headerCount);
	if (body.length)
	{
		const spaced = body.length > 3;
		if (spaced)
		{
			lines.push(null);
		}
		layout(body, 1, spaced, lines);
		if (closed)
		{
			lines.push(items[last]);
		}
	}
	else if (closed && headerCount < items.length)
	{
		lines.push(items[last]);
	}
	let text = lines.map(l => l ? INDENT.repeat(l.level) + l.text : "").join("\n")
		.replace(new RegExp(OPEN + "(\\d+)" + CLOSE, "g"), (_, k) => strings[Number(k)]);
	const physical = text.split("\n");
	if (maxLines && physical.length > maxLines)
	{
		let kept = physical.slice(0, maxLines);
		while (kept.length && !kept[kept.length - 1].trim())
		{
			kept.pop();
		}
		kept.push(INDENT + "-- ... (+" + (physical.length - kept.length) + " строк)");
		text = kept.join("\n");
	}
	return text;
}

module.exports = { formatFunctionSource, scan };
