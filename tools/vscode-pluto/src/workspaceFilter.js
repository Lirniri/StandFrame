// Decides which files of the workspace are indexed, based on ignore files (.gitignore, .plutoignore, ...)
// and glob patterns from the settings (pluto.workspace.exclude, search.exclude, files.exclude).

"use strict";

const vscode = require("vscode");
const { IgnoreMatcher, GlobSet, enabledGlobs } = require("./ignore");

/** Always excluded, whatever the settings say. */
const ALWAYS_EXCLUDED_DIRS = new Set(["node_modules", ".git", ".vs"]);
const ALWAYS_EXCLUDED_GLOBS = ["**/node_modules/**", "**/.git/**", "**/.vs/**"];

class WorkspaceFilter
{
	constructor()
	{
		/** @type {Map<string, { folder: vscode.WorkspaceFolder, ignore: IgnoreMatcher, globs: GlobSet, ignoreFiles: string[], loadedFiles: string[] }>} */
		this._folders = new Map();
		this._decoder = new TextDecoder("utf-8");
	}

	/**
	 * The ignore files that apply to a workspace folder, relative to its root.
	 * @param {vscode.WorkspaceFolder|undefined} folder
	 * @returns {string[]}
	 */
	static ignoreFileNames(folder)
	{
		const config = vscode.workspace.getConfiguration("pluto.workspace", folder ? folder.uri : undefined);
		const names = new Set();
		const configured = config.get("ignoreFiles", [".gitignore", ".plutoignore"]);
		for (const name of Array.isArray(configured) ? configured : [])
		{
			if (typeof name == "string" && name.trim())
			{
				names.add(name.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, ""));
			}
		}
		// pluto.workspace.useGitignore has the final say over .gitignore.
		if (config.get("useGitignore", true))
		{
			names.add(".gitignore");
		}
		else
		{
			names.delete(".gitignore");
		}
		return [...names];
	}

	/**
	 * Re-reads the settings and ignore files of all workspace folders.
	 */
	async reload()
	{
		const folders = vscode.workspace.workspaceFolders || [];
		const next = new Map();
		await Promise.all(folders.map(async (folder) =>
		{
			const pluto = vscode.workspace.getConfiguration("pluto", folder.uri);
			const patterns = [];
			const add = (list) =>
			{
				for (const p of Array.isArray(list) ? list : [])
				{
					if (typeof p == "string" && p.trim())
					{
						patterns.push(p.trim());
					}
				}
			};
			add(pluto.get("workspace.exclude", []));
			add(pluto.get("index.exclude", [])); // legacy name of the setting above
			// Passing our own exclude pattern to findFiles disables files.exclude, so apply it ourselves.
			add(enabledGlobs(vscode.workspace.getConfiguration("files", folder.uri).get("exclude")));
			if (pluto.get("workspace.useSearchExclude", true))
			{
				add(enabledGlobs(vscode.workspace.getConfiguration("search", folder.uri).get("exclude")));
			}

			const ignore = new IgnoreMatcher();
			const ignoreFiles = WorkspaceFilter.ignoreFileNames(folder);
			const loadedFiles = [];
			for (const name of ignoreFiles)
			{
				try
				{
					const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, name));
					const slash = name.lastIndexOf("/");
					ignore.add(this._decoder.decode(bytes), slash == -1 ? "" : name.slice(0, slash));
					loadedFiles.push(name);
				}
				catch (e)
				{
					// The file doesn't exist in this folder; nothing to apply.
				}
			}
			next.set(folder.uri.toString(), { folder, ignore, globs: new GlobSet(patterns), ignoreFiles, loadedFiles });
		}));
		this._folders = next;
	}

	/**
	 * A cheap glob for `workspace.findFiles` that prunes what it can up front; everything else is
	 * filtered with `isExcluded`, which also understands ignore files and nested `{}` groups.
	 */
	findFilesExclude()
	{
		const simple = new Set(ALWAYS_EXCLUDED_GLOBS);
		for (const entry of this._folders.values())
		{
			// Only patterns without groups/commas can be safely combined, and only if every folder uses them.
			for (const p of entry.globs.patterns)
			{
				if (!/[{},]/.test(p.source) && p.source.startsWith("**/") && [...this._folders.values()].every(e => e.globs.patterns.some(q => q.source == p.source)))
				{
					simple.add(p.source);
				}
			}
		}
		return "{" + [...simple].join(",") + "}";
	}

	/**
	 * Workspace-relative path of a URI, or null if it is outside of all workspace folders.
	 * @param {vscode.Uri} uri
	 */
	_relative(uri)
	{
		const folder = vscode.workspace.getWorkspaceFolder(uri);
		if (!folder)
		{
			return null;
		}
		const base = folder.uri.path.replace(/\/+$/, "");
		if (!uri.path.startsWith(base + "/"))
		{
			return null;
		}
		return { folder, rel: uri.path.slice(base.length + 1) };
	}

	/**
	 * Why a file is excluded from the index, or null if it is included.
	 * @param {vscode.Uri} uri
	 * @returns {string|null}
	 */
	reason(uri)
	{
		const location = this._relative(uri);
		if (!location)
		{
			return null; // files outside of the workspace are only analyzed while open
		}
		const { folder, rel } = location;
		if (rel.split("/").some(part => ALWAYS_EXCLUDED_DIRS.has(part)))
		{
			return "always excluded folder";
		}
		const entry = this._folders.get(folder.uri.toString());
		if (!entry)
		{
			return null;
		}
		if (entry.globs.matches(rel))
		{
			return "exclude pattern";
		}
		if (entry.ignore.ignores(rel))
		{
			return "ignore file (" + entry.loadedFiles.join(", ") + ")";
		}
		return null;
	}

	/**
	 * @param {vscode.Uri} uri
	 */
	isExcluded(uri)
	{
		return this.reason(uri) !== null;
	}

	/**
	 * Patterns (relative to each workspace folder) of the ignore files to watch for changes.
	 * @returns {vscode.RelativePattern[]}
	 */
	watchPatterns()
	{
		const out = [];
		for (const folder of vscode.workspace.workspaceFolders || [])
		{
			const names = WorkspaceFilter.ignoreFileNames(folder).filter(n => !/[{}*?[\],]/.test(n));
			if (names.length)
			{
				out.push(new vscode.RelativePattern(folder, names.length == 1 ? names[0] : "{" + names.join(",") + "}"));
			}
		}
		return out;
	}
}

module.exports = { WorkspaceFilter };
