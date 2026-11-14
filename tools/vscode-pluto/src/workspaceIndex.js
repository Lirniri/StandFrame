// In-memory index of all Pluto/Lua files and module manifests of a workspace.
// Free of VS Code dependencies so it can be unit-tested with plain Node.

"use strict";

const { parse } = require("./parser");

/**
 * @typedef {import("./parser").PlutoSymbol & { file: FileRecord }} IndexedSymbol
 * @typedef {{ key: string, path: string, symbols: IndexedSymbol[], blocks: any[], unclosed: number, returnName: string|null, requires: any[], lineCount: number }} FileRecord
 * @typedef {{ key: string, path: string, dir: string, id: string, name?: string, description?: string, version?: string, main?: string }} Manifest
 */

function normalizePath(p)
{
	return p.replace(/\\/g, "/");
}

class WorkspaceIndex
{
	constructor()
	{
		/** @type {Map<string, FileRecord>} */
		this.files = new Map();
		/** @type {Map<string, Manifest>} */
		this.manifests = new Map();
		this._dirty = true;
		/** @type {Map<string, IndexedSymbol[]>} */
		this._byName = new Map();
		/** @type {Map<string, IndexedSymbol[]>} */
		this._byContainer = new Map();
		/** @type {IndexedSymbol[]} */
		this._globals = [];
		/**
		 * Open documents that are excluded from the index (by ignore files or exclude settings).
		 * They are analyzed so they work on their own, but are invisible to every other file.
		 * @type {Map<string, FileRecord>}
		 */
		this.detached = new Map();
		/** The file the current request is for; an excluded file can still see its own symbols. */
		this.current = null;
	}

	/**
	 * @param {string} key Unique identifier of the file (its URI).
	 * @param {string} path File system path.
	 * @param {string} text
	 * @param {boolean} [excluded] Keep the file out of the shared index.
	 * @param {{ calls?: boolean }} [options] Parser options; `calls` is only needed for open documents.
	 * @returns {FileRecord}
	 */
	setFile(key, path, text, excluded, options)
	{
		const parsed = parse(text, options);
		/** @type {FileRecord} */
		const record = Object.assign(parsed, { key, path: normalizePath(path), excluded: !!excluded });
		for (const sym of record.symbols)
		{
			sym.file = record;
		}
		if (excluded)
		{
			this.detached.set(key, record);
			if (this.files.delete(key))
			{
				this._dirty = true;
			}
		}
		else
		{
			this.detached.delete(key);
			this.files.set(key, record);
			this._dirty = true;
		}
		return record;
	}

	/**
	 * @param {string} key
	 * @returns {FileRecord|undefined}
	 */
	getFile(key)
	{
		return this.files.get(key) || this.detached.get(key);
	}

	removeFile(key)
	{
		this.detached.delete(key);
		if (this.files.delete(key))
		{
			this._dirty = true;
		}
	}

	/**
	 * Sets the file that subsequent lookups are made from.
	 * @param {FileRecord|null} record
	 */
	setCurrent(record)
	{
		this.current = record;
	}

	// The current file, if it is excluded from the index (its symbols are then merged into lookups).
	_overlay()
	{
		const c = this.current;
		if (!c || !c.excluded || this.detached.get(c.key) !== c)
		{
			return null;
		}
		if (!c._maps)
		{
			c._maps = { byName: new Map(), byContainer: new Map(), globals: [] };
			addSymbols(c, c._maps.byName, c._maps.byContainer, c._maps.globals);
		}
		return c._maps;
	}

	/**
	 * Indexed files plus the current file if it is excluded.
	 * @returns {FileRecord[]}
	 */
	visibleFiles()
	{
		const out = [...this.files.values()];
		if (this._overlay())
		{
			out.push(this.current);
		}
		return out;
	}

	_containerMembers(name)
	{
		const base = this._byContainer.get(name) || [];
		const overlay = this._overlay();
		const extra = overlay ? overlay.byContainer.get(name) : null;
		return extra ? base.concat(extra) : base;
	}

	/**
	 * Registers a module manifest (info.json). Returns false if it has no usable `id`.
	 */
	setManifest(key, path, jsonText)
	{
		this.manifests.delete(key);
		let data;
		try
		{
			data = JSON.parse(jsonText.replace(/^﻿/, ""));
		}
		catch (e)
		{
			return false;
		}
		if (!data || typeof data != "object" || typeof data.id != "string" || !data.id)
		{
			return false;
		}
		const normalized = normalizePath(path);
		const str = (v) => typeof v == "string" ? v : undefined;
		this.manifests.set(key, {
			key,
			path: normalized,
			dir: normalized.slice(0, normalized.lastIndexOf("/")),
			id: data.id,
			name: str(data.name) || str(data.title),
			description: str(data.description),
			version: str(data.version),
			author: str(data.author),
			main: str(data.main) || str(data.entry) || str(data.script),
		});
		return true;
	}

	removeManifest(key)
	{
		this.manifests.delete(key);
	}

	clear()
	{
		this.files.clear();
		this.detached.clear();
		this.manifests.clear();
		this._dirty = true;
	}

	_build()
	{
		if (!this._dirty)
		{
			return;
		}
		this._byName = new Map();
		this._byContainer = new Map();
		this._globals = [];
		for (const file of this.files.values())
		{
			addSymbols(file, this._byName, this._byContainer, this._globals);
		}
		this._dirty = false;
	}

	/**
	 * All indexed, non-local declarations with this name (including members).
	 * @returns {IndexedSymbol[]}
	 */
	lookup(name)
	{
		this._build();
		const base = this._byName.get(name) || [];
		const overlay = this._overlay();
		const extra = overlay ? overlay.byName.get(name) : null;
		return extra ? base.concat(extra) : base;
	}

	/**
	 * Symbols that are visible from every file.
	 * @returns {IndexedSymbol[]}
	 */
	globals()
	{
		this._build();
		const overlay = this._overlay();
		return overlay ? this._globals.concat(overlay.globals) : this._globals;
	}

	/**
	 * The declaration(s) of a class with this name.
	 * @returns {IndexedSymbol[]}
	 */
	classes(name)
	{
		return this.lookup(name).filter(s => s.kind == "class" && !s.container);
	}

	/**
	 * Direct members of a container plus those inherited through `extends`.
	 * @param {string} container
	 * @param {FileRecord} [preferFile] If given, same-named containers local to other files are ignored.
	 * @returns {IndexedSymbol[]}
	 */
	members(container, preferFile)
	{
		this._build();
		const out = [];
		const seen = new Set();
		const visited = new Set();
		let current = container;
		while (current && !visited.has(current))
		{
			visited.add(current);
			const direct = this._containerMembers(current);
			for (const sym of direct)
			{
				// Shadowing: a subclass member hides the parent's member of the same name.
				if (!seen.has(sym.name) || current == container)
				{
					out.push(sym);
				}
			}
			for (const sym of direct)
			{
				seen.add(sym.name);
			}
			const cls = this.classes(current);
			const decl = (preferFile && cls.find(c => c.file === preferFile)) || cls[0];
			current = decl ? decl.extends : null;
		}
		return out;
	}

	/**
	 * Resolves a module name as passed to `require` to a file or manifest in the workspace.
	 * @param {string} moduleName
	 * @param {string} [fromPath] Path of the requiring file, used to prefer nearby matches.
	 * @returns {{ file?: FileRecord, manifest?: Manifest, path: string }|null}
	 */
	resolveModule(moduleName, fromPath)
	{
		for (const manifest of this.manifests.values())
		{
			if (manifest.id == moduleName)
			{
				const entry = this._manifestEntry(manifest);
				return { manifest, file: entry || undefined, path: entry ? entry.path : manifest.path };
			}
		}
		if (moduleName.startsWith("pluto:"))
		{
			return null;
		}
		const rel = normalizePath(moduleName).replace(/\.(pluto|lua)$/, "").replace(/^\.\//, "");
		const variants = rel.includes("/") ? [rel] : [rel.replace(/\./g, "/"), rel];
		const suffixes = [];
		for (const v of variants)
		{
			suffixes.push("/" + v + ".pluto", "/" + v + ".lua", "/" + v + "/init.pluto", "/" + v + "/init.lua");
		}
		const fromDir = fromPath ? normalizePath(fromPath).replace(/\/[^/]*$/, "") : "";
		let best = null;
		let bestScore = -1;
		for (const file of this.files.values())
		{
			const lower = file.path.toLowerCase();
			const idx = suffixes.findIndex(s => lower.endsWith(s.toLowerCase()));
			if (idx == -1)
			{
				continue;
			}
			// Prefer earlier suffixes (.pluto over .lua), then files close to the requiring file.
			const score = (suffixes.length - idx) + commonPrefixLength(file.path, fromDir) / 1000;
			if (score > bestScore)
			{
				best = file;
				bestScore = score;
			}
		}
		return best ? { file: best, path: best.path } : null;
	}

	_manifestEntry(manifest)
	{
		const candidates = [];
		if (manifest.main)
		{
			candidates.push(manifest.dir + "/" + manifest.main.replace(/^\.\//, ""));
		}
		for (const base of ["init", "main", "index", manifest.id])
		{
			candidates.push(manifest.dir + "/" + base + ".pluto", manifest.dir + "/" + base + ".lua");
		}
		for (const candidate of candidates)
		{
			for (const file of this.files.values())
			{
				if (file.path.toLowerCase() == candidate.toLowerCase())
				{
					return file;
				}
			}
		}
		return null;
	}

	/**
	 * What a file provides to those who `require` it.
	 * @param {FileRecord} file
	 * @returns {IndexedSymbol[]}
	 */
	moduleExports(file)
	{
		const out = [];
		if (file.returnName)
		{
			out.push(...this.members(file.returnName, file).filter(s => s.file === file));
		}
		for (const sym of file.symbols)
		{
			if (sym.exported && !out.includes(sym))
			{
				out.push(sym);
			}
		}
		return out;
	}
}

/**
 * Adds the symbols of a file that other files can see to the lookup tables.
 */
function addSymbols(file, byName, byContainer, globals)
{
	for (const sym of file.symbols)
	{
		if (sym.kind == "parameter" || sym.anonymous || (sym.local && sym.kind == "variable" && !sym.isTable && !sym.module))
		{
			continue; // plain locals are only ever looked up within their own file
		}
		push(byName, sym.name, sym);
		if (sym.container)
		{
			push(byContainer, sym.container, sym);
		}
		else if (!sym.local)
		{
			globals.push(sym);
		}
		// Members of an unscoped enum are also plain globals.
		if (sym.kind == "enumMember" && !sym.scoped && sym.container)
		{
			globals.push(sym);
		}
	}
}

function push(map, key, value)
{
	const list = map.get(key);
	if (list)
	{
		list.push(value);
	}
	else
	{
		map.set(key, [value]);
	}
}

function commonPrefixLength(a, b)
{
	let i = 0;
	while (i < a.length && i < b.length && a[i] == b[i])
	{
		++i;
	}
	return i;
}

module.exports = { WorkspaceIndex, normalizePath };
