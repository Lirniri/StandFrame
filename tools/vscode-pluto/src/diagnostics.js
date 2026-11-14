// Live diagnostics: problems reported by an external Pluto compiler (if one is found) plus the
// built-in static checks of ./lint, shown as squiggles and in the Problems panel.

"use strict";

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { lintSource, lintManifest } = require("./lint");
const compiler = require("./compiler");

const MANIFEST = /(^|\/)info\.json$/i;

class DiagnosticsManager
{
	/**
	 * @param {import("./extension").LanguageService} service
	 */
	constructor(service)
	{
		this.service = service;
		this.collection = vscode.languages.createDiagnosticCollection("pluto");
		this.output = null;
		/** Per document: compiler problems and lint problems, merged into the collection. */
		this._compiler = new Map();
		this._lint = new Map();
		this._timers = new Map();
		this._runs = new Map();
		this._runIds = new Map();
		/** @type {{ path: string|null, source: string|null }|null} */
		this._compiler_ = null;
		this._relintTimer = null;
	}

	_config()
	{
		const config = vscode.workspace.getConfiguration("pluto");
		return {
			enabled: config.get("diagnostics.enable", true),
			compilerPath: config.get("diagnostics.compilerPath", "") || "",
			debounceMs: Math.max(0, Number(config.get("diagnostics.debounceMs", 400)) || 0),
			indexEnabled: config.get("index.enabled", true),
		};
	}

	_log(message)
	{
		if (!this.output && vscode.window.createOutputChannel)
		{
			this.output = vscode.window.createOutputChannel("Pluto");
		}
		if (this.output)
		{
			this.output.appendLine("[" + new Date().toLocaleTimeString() + "] " + message);
		}
	}

	_trusted()
	{
		return vscode.workspace.isTrusted !== false;
	}

	/**
	 * The compiler to use, found once and cached until settings or workspace folders change.
	 * Running a program from the workspace is only allowed in trusted workspaces.
	 */
	compiler()
	{
		if (!this._compiler_)
		{
			if (!this._trusted())
			{
				this._compiler_ = { path: null, source: null };
				this._log("Workspace is not trusted: the Pluto compiler is not used, only built-in checks run.");
				return this._compiler_;
			}
			const folders = (vscode.workspace.workspaceFolders || []).filter(f => f.uri.scheme == "file").map(f => f.uri.fsPath);
			const found = compiler.findCompiler({ configured: this._config().compilerPath, workspaceFolders: folders });
			if (found.problem)
			{
				this._log(found.problem);
			}
			this._log(found.path
				? "Using Pluto compiler " + found.path + " (" + { setting: "from pluto.diagnostics.compilerPath", workspace: "found in the workspace", path: "found on PATH" }[found.source] + ")."
				: "No Pluto compiler found (pluto.diagnostics.compilerPath, workspace, PATH): only built-in checks run.");
			this._compiler_ = found;
		}
		return this._compiler_;
	}

	/** Forgets the detected compiler, e.g. after its setting changed. */
	resetCompiler()
	{
		this._compiler_ = null;
	}

	_isPluto(document)
	{
		return document.languageId == "pluto" || /\.pluto$/i.test(document.uri.path);
	}

	_isManifest(document)
	{
		return MANIFEST.test(document.uri.path);
	}

	/**
	 * Re-checks a document after the configured delay.
	 * @param {vscode.TextDocument} document
	 */
	schedule(document, immediate)
	{
		if (!this._isPluto(document) && !this._isManifest(document))
		{
			return;
		}
		const key = document.uri.toString();
		clearTimeout(this._timers.get(key));
		const config = this._config();
		if (!config.enabled)
		{
			this.clear(document.uri);
			return;
		}
		this._timers.set(key, setTimeout(() =>
		{
			this._timers.delete(key);
			if (!document.isClosed)
			{
				this.check(document);
			}
		}, immediate ? 0 : config.debounceMs));
	}

	/**
	 * Runs all checks on a document now.
	 * @param {vscode.TextDocument} document
	 * @returns {Promise<void>} Resolves when the compiler (if any) has finished.
	 */
	check(document)
	{
		const config = this._config();
		if (!config.enabled)
		{
			this.clear(document.uri);
			return Promise.resolve();
		}
		const key = document.uri.toString();
		if (this._isManifest(document))
		{
			this._lint.set(key, this._lintManifest(document, config));
			this._publish(document.uri);
			return Promise.resolve();
		}
		if (!this._isPluto(document))
		{
			return Promise.resolve();
		}
		try
		{
			this._lint.set(key, this._lintSource(document, config));
		}
		catch (e)
		{
			console.error("Pluto: lint failed", e);
			this._lint.set(key, []);
		}
		this._publish(document.uri);
		return this._runCompiler(document);
	}

	_exists(p)
	{
		try
		{
			return fs.statSync(p).isFile();
		}
		catch (e)
		{
			return false;
		}
	}

	_lintSource(document, config)
	{
		const record = this.service.getRecord(document);
		const local = document.uri.scheme == "file";
		const folders = (vscode.workspace.workspaceFolders || []).filter(f => f.uri.scheme == "file").map(f => f.uri.fsPath.replace(/\\/g, "/"));
		const problems = lintSource(document.getText(), record, this.service.analyzer, {
			exists: local ? (p) => this._exists(p) : undefined,
			searchDirs: folders,
			// Without an index, other files are unknown, so a missing module can't be told apart.
			requires: config.indexEnabled || local,
		});
		return problems.map(p => this._toDiagnostic(p, "pluto-lint"));
	}

	_lintManifest(document, config)
	{
		const problems = lintManifest(document.getText(), document.uri.fsPath, this.service.index, {
			exists: document.uri.scheme == "file" ? (p) => this._exists(p) : undefined,
			checkDependencies: config.indexEnabled,
		});
		return problems.map(p => this._toDiagnostic(p, "pluto-lint"));
	}

	_toDiagnostic(p, source)
	{
		const range = new vscode.Range(p.line, p.col, p.endLine, Math.max(p.endCol, p.endLine == p.line ? p.col + 1 : 0));
		const d = new vscode.Diagnostic(range, p.message, p.severity == "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
		d.source = source;
		if (p.code)
		{
			d.code = p.code;
		}
		return d;
	}

	_runCompiler(document)
	{
		const key = document.uri.toString();
		const previous = this._runs.get(key);
		if (previous)
		{
			previous.cancel();
			this._runs.delete(key);
		}
		const found = this.compiler();
		if (!found.path)
		{
			if (this._compiler.delete(key))
			{
				this._publish(document.uri);
			}
			return Promise.resolve();
		}
		const runId = (this._runIds.get(key) || 0) + 1;
		this._runIds.set(key, runId);
		const text = document.getText();
		const cwd = document.uri.scheme == "file" ? path.dirname(document.uri.fsPath) : undefined;
		const run = compiler.runCheck(found.path, text, { cwd, timeoutMs: 5000 });
		this._runs.set(key, run);
		return run.promise.then((result) =>
		{
			if (this._runIds.get(key) !== runId || document.isClosed)
			{
				return; // superseded
			}
			this._runs.delete(key);
			if (result.error)
			{
				// The compiler can't be started (deleted, no permission…): stop using it, quietly.
				this._log("Failed to run " + found.path + ": " + result.error.message + ". The compiler is disabled until settings change.");
				this._compiler_ = { path: null, source: null };
				this._compiler.delete(key);
				this._publish(document.uri);
				return;
			}
			if (result.timedOut)
			{
				this._log("Pluto compiler timed out on " + document.uri.fsPath + ".");
				return;
			}
			const lines = text.split(/\r?\n/);
			const problems = compiler.parseCompilerOutput(result.output, lines);
			if (!problems.length && result.code)
			{
				this._log("Pluto compiler exited with code " + result.code + " without a recognizable message:\n" + result.output.trim());
			}
			const diagnostics = problems.map((p) =>
			{
				const line = Math.min(p.line, Math.max(0, document.lineCount - 1));
				const lineText = lines[line] || "";
				let col = p.col;
				let endCol = p.endCol;
				if (col === null)
				{
					// No column: underline the whole line (without its indentation).
					col = lineText.length - lineText.replace(/^\s+/, "").length;
					endCol = Math.max(col + 1, lineText.replace(/\s+$/, "").length);
				}
				return this._toDiagnostic({ line, col, endLine: line, endCol: Math.max(endCol, col + 1), severity: p.severity, message: p.message }, "pluto");
			});
			this._compiler.set(key, diagnostics);
			this._publish(document.uri);
		});
	}

	_publish(uri)
	{
		const key = uri.toString();
		const all = [...(this._compiler.get(key) || []), ...(this._lint.get(key) || [])];
		this.collection.set(uri, all);
	}

	clear(uri)
	{
		const key = uri.toString();
		clearTimeout(this._timers.get(key));
		this._timers.delete(key);
		const run = this._runs.get(key);
		if (run)
		{
			run.cancel();
			this._runs.delete(key);
		}
		this._runIds.set(key, (this._runIds.get(key) || 0) + 1);
		this._compiler.delete(key);
		this._lint.delete(key);
		this.collection.delete(uri);
	}

	/** Re-checks all open documents (built-in checks only, unless `withCompiler`). */
	recheckAll(withCompiler)
	{
		const config = this._config();
		for (const document of vscode.workspace.textDocuments)
		{
			if (!this._isPluto(document) && !this._isManifest(document))
			{
				continue;
			}
			if (!config.enabled)
			{
				this.clear(document.uri);
			}
			else if (withCompiler)
			{
				this.check(document);
			}
			else
			{
				const key = document.uri.toString();
				try
				{
					this._lint.set(key, this._isManifest(document) ? this._lintManifest(document, config) : this._lintSource(document, config));
				}
				catch (e)
				{
					console.error("Pluto: lint failed", e);
				}
				this._publish(document.uri);
			}
		}
	}

	/** Re-runs the built-in checks of open documents soon, e.g. after files were added or removed. */
	recheckSoon()
	{
		clearTimeout(this._relintTimer);
		this._relintTimer = setTimeout(() => this.recheckAll(false), 500);
	}

	dispose()
	{
		clearTimeout(this._relintTimer);
		for (const timer of this._timers.values())
		{
			clearTimeout(timer);
		}
		for (const run of this._runs.values())
		{
			run.cancel();
		}
		this._timers.clear();
		this._runs.clear();
		this.collection.dispose();
		if (this.output)
		{
			this.output.dispose();
		}
	}
}

/**
 * Wires the diagnostics to editor and workspace events.
 * @param {vscode.ExtensionContext} context
 * @param {import("./extension").LanguageService} service
 * @param {Promise<void>} indexed Resolves when the first workspace scan has finished.
 */
function registerDiagnostics(context, service, indexed)
{
	const manager = new DiagnosticsManager(service);
	context.subscriptions.push(
		manager,
		vscode.workspace.onDidChangeTextDocument(function (event)
		{
			if (event.contentChanges.length)
			{
				manager.schedule(event.document);
			}
		}),
		vscode.workspace.onDidOpenTextDocument(document => manager.schedule(document, true)),
		vscode.workspace.onDidSaveTextDocument(document => manager.schedule(document, true)),
		vscode.workspace.onDidCloseTextDocument(document => manager.clear(document.uri)),
		vscode.workspace.onDidChangeConfiguration(function (event)
		{
			if (event.affectsConfiguration("pluto.diagnostics"))
			{
				manager.resetCompiler();
				manager.recheckAll(true);
			}
			else if (event.affectsConfiguration("pluto.index"))
			{
				manager.recheckSoon();
			}
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(function ()
		{
			manager.resetCompiler();
			manager.recheckSoon();
		})
	);
	if (vscode.workspace.onDidGrantWorkspaceTrust)
	{
		context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(function ()
		{
			manager.resetCompiler();
			manager.recheckAll(true);
		}));
	}
	// Other files appearing or disappearing can fix or break `require`s and manifest entries.
	const watcher = vscode.workspace.createFileSystemWatcher("**/{*.pluto,*.lua,info.json}");
	context.subscriptions.push(
		watcher,
		watcher.onDidCreate(() => manager.recheckSoon()),
		watcher.onDidChange(uri => MANIFEST.test(uri.path) && manager.recheckSoon()),
		watcher.onDidDelete(() => manager.recheckSoon())
	);

	// Built-in checks need the index, so check open documents once it is built.
	Promise.resolve(indexed).catch(() => {}).then(() => manager.recheckAll(true));
	return manager;
}

module.exports = { DiagnosticsManager, registerDiagnostics };
