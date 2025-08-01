"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CancellationToken = void 0;
exports.createTypeScriptBuilder = createTypeScriptBuilder;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const utils = __importStar(require("./utils"));
const ansi_colors_1 = __importDefault(require("ansi-colors"));
const typescript_1 = __importDefault(require("typescript"));
const vinyl_1 = __importDefault(require("vinyl"));
const source_map_1 = require("source-map");
var CancellationToken;
(function (CancellationToken) {
    CancellationToken.None = {
        isCancellationRequested() { return false; }
    };
})(CancellationToken || (exports.CancellationToken = CancellationToken = {}));
function normalize(path) {
    return path.replace(/\\/g, '/');
}
function createTypeScriptBuilder(config, projectFile, cmd) {
    const _log = config.logFn;
    const host = new LanguageServiceHost(cmd, projectFile, _log);
    const outHost = new LanguageServiceHost({ ...cmd, options: { ...cmd.options, sourceRoot: cmd.options.outDir } }, cmd.options.outDir ?? '', _log);
    const toBeCheckedForCycles = [];
    const service = typescript_1.default.createLanguageService(host, typescript_1.default.createDocumentRegistry());
    const lastBuildVersion = Object.create(null);
    const lastDtsHash = Object.create(null);
    const userWantsDeclarations = cmd.options.declaration;
    let oldErrors = Object.create(null);
    let headUsed = process.memoryUsage().heapUsed;
    let emitSourceMapsInStream = true;
    // always emit declaraction files
    host.getCompilationSettings().declaration = true;
    function file(file) {
        // support gulp-sourcemaps
        if (file.sourceMap) {
            emitSourceMapsInStream = false;
        }
        if (!file.contents) {
            host.removeScriptSnapshot(file.path);
            delete lastBuildVersion[normalize(file.path)];
        }
        else {
            host.addScriptSnapshot(file.path, new VinylScriptSnapshot(file));
        }
    }
    function baseFor(snapshot) {
        if (snapshot instanceof VinylScriptSnapshot) {
            return cmd.options.outDir || snapshot.getBase();
        }
        else {
            return '';
        }
    }
    function isExternalModule(sourceFile) {
        return sourceFile.externalModuleIndicator
            || /declare\s+module\s+('|")(.+)\1/.test(sourceFile.getText());
    }
    function build(out, onError, token = CancellationToken.None) {
        function checkSyntaxSoon(fileName) {
            return new Promise(resolve => {
                process.nextTick(function () {
                    if (!host.getScriptSnapshot(fileName, false)) {
                        resolve([]); // no script, no problems
                    }
                    else {
                        resolve(service.getSyntacticDiagnostics(fileName));
                    }
                });
            });
        }
        function checkSemanticsSoon(fileName) {
            return new Promise(resolve => {
                process.nextTick(function () {
                    if (!host.getScriptSnapshot(fileName, false)) {
                        resolve([]); // no script, no problems
                    }
                    else {
                        resolve(service.getSemanticDiagnostics(fileName));
                    }
                });
            });
        }
        function emitSoon(fileName) {
            return new Promise(resolve => {
                process.nextTick(function () {
                    if (/\.d\.ts$/.test(fileName)) {
                        // if it's already a d.ts file just emit it signature
                        const snapshot = host.getScriptSnapshot(fileName);
                        const signature = crypto_1.default.createHash('sha256')
                            .update(snapshot.getText(0, snapshot.getLength()))
                            .digest('base64');
                        return resolve({
                            fileName,
                            signature,
                            files: []
                        });
                    }
                    const output = service.getEmitOutput(fileName);
                    const files = [];
                    let signature;
                    for (const file of output.outputFiles) {
                        if (!emitSourceMapsInStream && /\.js\.map$/.test(file.name)) {
                            continue;
                        }
                        if (/\.d\.ts$/.test(file.name)) {
                            signature = crypto_1.default.createHash('sha256')
                                .update(file.text)
                                .digest('base64');
                            if (!userWantsDeclarations) {
                                // don't leak .d.ts files if users don't want them
                                continue;
                            }
                        }
                        const vinyl = new vinyl_1.default({
                            path: file.name,
                            contents: Buffer.from(file.text),
                            base: !config._emitWithoutBasePath && baseFor(host.getScriptSnapshot(fileName)) || undefined
                        });
                        if (!emitSourceMapsInStream && /\.js$/.test(file.name)) {
                            const sourcemapFile = output.outputFiles.filter(f => /\.js\.map$/.test(f.name))[0];
                            if (sourcemapFile) {
                                const extname = path_1.default.extname(vinyl.relative);
                                const basename = path_1.default.basename(vinyl.relative, extname);
                                const dirname = path_1.default.dirname(vinyl.relative);
                                const tsname = (dirname === '.' ? '' : dirname + '/') + basename + '.ts';
                                let sourceMap = JSON.parse(sourcemapFile.text);
                                sourceMap.sources[0] = tsname.replace(/\\/g, '/');
                                // check for an "input source" map and combine them
                                // in step 1 we extract all line edit from the input source map, and
                                // in step 2 we apply the line edits to the typescript source map
                                const snapshot = host.getScriptSnapshot(fileName);
                                if (snapshot instanceof VinylScriptSnapshot && snapshot.sourceMap) {
                                    const inputSMC = new source_map_1.SourceMapConsumer(snapshot.sourceMap);
                                    const tsSMC = new source_map_1.SourceMapConsumer(sourceMap);
                                    let didChange = false;
                                    const smg = new source_map_1.SourceMapGenerator({
                                        file: sourceMap.file,
                                        sourceRoot: sourceMap.sourceRoot
                                    });
                                    // step 1
                                    const lineEdits = new Map();
                                    inputSMC.eachMapping(m => {
                                        if (m.originalLine === m.generatedLine) {
                                            // same line mapping
                                            let array = lineEdits.get(m.originalLine);
                                            if (!array) {
                                                array = [];
                                                lineEdits.set(m.originalLine, array);
                                            }
                                            array.push([m.originalColumn, m.generatedColumn]);
                                        }
                                        else {
                                            // NOT SUPPORTED
                                        }
                                    });
                                    // step 2
                                    tsSMC.eachMapping(m => {
                                        didChange = true;
                                        const edits = lineEdits.get(m.originalLine);
                                        let originalColumnDelta = 0;
                                        if (edits) {
                                            for (const [from, to] of edits) {
                                                if (to >= m.originalColumn) {
                                                    break;
                                                }
                                                originalColumnDelta = from - to;
                                            }
                                        }
                                        smg.addMapping({
                                            source: m.source,
                                            name: m.name,
                                            generated: { line: m.generatedLine, column: m.generatedColumn },
                                            original: { line: m.originalLine, column: m.originalColumn + originalColumnDelta }
                                        });
                                    });
                                    if (didChange) {
                                        [tsSMC, inputSMC].forEach((consumer) => {
                                            consumer.sources.forEach((sourceFile) => {
                                                smg._sources.add(sourceFile);
                                                const sourceContent = consumer.sourceContentFor(sourceFile);
                                                if (sourceContent !== null) {
                                                    smg.setSourceContent(sourceFile, sourceContent);
                                                }
                                            });
                                        });
                                        sourceMap = JSON.parse(smg.toString());
                                        // const filename = '/Users/jrieken/Code/vscode/src2/' + vinyl.relative + '.map';
                                        // fs.promises.mkdir(path.dirname(filename), { recursive: true }).then(async () => {
                                        // 	await fs.promises.writeFile(filename, smg.toString());
                                        // 	await fs.promises.writeFile('/Users/jrieken/Code/vscode/src2/' + vinyl.relative, vinyl.contents);
                                        // });
                                    }
                                }
                                vinyl.sourceMap = sourceMap;
                            }
                        }
                        files.push(vinyl);
                    }
                    resolve({
                        fileName,
                        signature,
                        files
                    });
                });
            });
        }
        const newErrors = Object.create(null);
        const t1 = Date.now();
        const toBeEmitted = [];
        const toBeCheckedSyntactically = [];
        const toBeCheckedSemantically = [];
        const filesWithChangedSignature = [];
        const dependentFiles = [];
        const newLastBuildVersion = new Map();
        for (const fileName of host.getScriptFileNames()) {
            if (lastBuildVersion[fileName] !== host.getScriptVersion(fileName)) {
                toBeEmitted.push(fileName);
                toBeCheckedSyntactically.push(fileName);
                toBeCheckedSemantically.push(fileName);
            }
        }
        return new Promise(resolve => {
            const semanticCheckInfo = new Map();
            const seenAsDependentFile = new Set();
            function workOnNext() {
                let promise;
                // let fileName: string;
                // someone told us to stop this
                if (token.isCancellationRequested()) {
                    _log('[CANCEL]', '>>This compile run was cancelled<<');
                    newLastBuildVersion.clear();
                    resolve();
                    return;
                }
                // (1st) emit code
                else if (toBeEmitted.length) {
                    const fileName = toBeEmitted.pop();
                    promise = emitSoon(fileName).then(value => {
                        for (const file of value.files) {
                            _log('[emit code]', file.path);
                            out(file);
                        }
                        // remember when this was build
                        newLastBuildVersion.set(fileName, host.getScriptVersion(fileName));
                        // remeber the signature
                        if (value.signature && lastDtsHash[fileName] !== value.signature) {
                            lastDtsHash[fileName] = value.signature;
                            filesWithChangedSignature.push(fileName);
                        }
                        // line up for cycle check
                        const jsValue = value.files.find(candidate => candidate.basename.endsWith('.js'));
                        if (jsValue) {
                            outHost.addScriptSnapshot(jsValue.path, new ScriptSnapshot(String(jsValue.contents), new Date()));
                            toBeCheckedForCycles.push(normalize(jsValue.path));
                        }
                    }).catch(e => {
                        // can't just skip this or make a result up..
                        host.error(`ERROR emitting ${fileName}`);
                        host.error(e);
                    });
                }
                // (2nd) check syntax
                else if (toBeCheckedSyntactically.length) {
                    const fileName = toBeCheckedSyntactically.pop();
                    _log('[check syntax]', fileName);
                    promise = checkSyntaxSoon(fileName).then(diagnostics => {
                        delete oldErrors[fileName];
                        if (diagnostics.length > 0) {
                            diagnostics.forEach(d => onError(d));
                            newErrors[fileName] = diagnostics;
                            // stop the world when there are syntax errors
                            toBeCheckedSyntactically.length = 0;
                            toBeCheckedSemantically.length = 0;
                            filesWithChangedSignature.length = 0;
                        }
                    });
                }
                // (3rd) check semantics
                else if (toBeCheckedSemantically.length) {
                    let fileName = toBeCheckedSemantically.pop();
                    while (fileName && semanticCheckInfo.has(fileName)) {
                        fileName = toBeCheckedSemantically.pop();
                    }
                    if (fileName) {
                        _log('[check semantics]', fileName);
                        promise = checkSemanticsSoon(fileName).then(diagnostics => {
                            delete oldErrors[fileName];
                            semanticCheckInfo.set(fileName, diagnostics.length);
                            if (diagnostics.length > 0) {
                                diagnostics.forEach(d => onError(d));
                                newErrors[fileName] = diagnostics;
                            }
                        });
                    }
                }
                // (4th) check dependents
                else if (filesWithChangedSignature.length) {
                    while (filesWithChangedSignature.length) {
                        const fileName = filesWithChangedSignature.pop();
                        if (!isExternalModule(service.getProgram().getSourceFile(fileName))) {
                            _log('[check semantics*]', fileName + ' is an internal module and it has changed shape -> check whatever hasn\'t been checked yet');
                            toBeCheckedSemantically.push(...host.getScriptFileNames());
                            filesWithChangedSignature.length = 0;
                            dependentFiles.length = 0;
                            break;
                        }
                        host.collectDependents(fileName, dependentFiles);
                    }
                }
                // (5th) dependents contd
                else if (dependentFiles.length) {
                    let fileName = dependentFiles.pop();
                    while (fileName && seenAsDependentFile.has(fileName)) {
                        fileName = dependentFiles.pop();
                    }
                    if (fileName) {
                        seenAsDependentFile.add(fileName);
                        const value = semanticCheckInfo.get(fileName);
                        if (value === 0) {
                            // already validated successfully -> look at dependents next
                            host.collectDependents(fileName, dependentFiles);
                        }
                        else if (typeof value === 'undefined') {
                            // first validate -> look at dependents next
                            dependentFiles.push(fileName);
                            toBeCheckedSemantically.push(fileName);
                        }
                    }
                }
                // (last) done
                else {
                    resolve();
                    return;
                }
                if (!promise) {
                    promise = Promise.resolve();
                }
                promise.then(function () {
                    // change to change
                    process.nextTick(workOnNext);
                }).catch(err => {
                    console.error(err);
                });
            }
            workOnNext();
        }).then(() => {
            // check for cyclic dependencies
            const cycles = outHost.getCyclicDependencies(toBeCheckedForCycles);
            toBeCheckedForCycles.length = 0;
            for (const [filename, error] of cycles) {
                const cyclicDepErrors = [];
                if (error) {
                    cyclicDepErrors.push({
                        category: typescript_1.default.DiagnosticCategory.Error,
                        code: 1,
                        file: undefined,
                        start: undefined,
                        length: undefined,
                        messageText: `CYCLIC dependency: ${error}`
                    });
                }
                newErrors[filename] = cyclicDepErrors;
            }
        }).then(() => {
            // store the build versions to not rebuilt the next time
            newLastBuildVersion.forEach((value, key) => {
                lastBuildVersion[key] = value;
            });
            // print old errors and keep them
            for (const [key, value] of Object.entries(oldErrors)) {
                value.forEach(diag => onError(diag));
                newErrors[key] = value;
            }
            oldErrors = newErrors;
            // print stats
            const headNow = process.memoryUsage().heapUsed;
            const MB = 1024 * 1024;
            _log('[tsb]', `time:  ${ansi_colors_1.default.yellow((Date.now() - t1) + 'ms')} + \nmem:  ${ansi_colors_1.default.cyan(Math.ceil(headNow / MB) + 'MB')} ${ansi_colors_1.default.bgCyan('delta: ' + Math.ceil((headNow - headUsed) / MB))}`);
            headUsed = headNow;
        });
    }
    return {
        file,
        build,
        languageService: service
    };
}
class ScriptSnapshot {
    _text;
    _mtime;
    constructor(text, mtime) {
        this._text = text;
        this._mtime = mtime;
    }
    getVersion() {
        return this._mtime.toUTCString();
    }
    getText(start, end) {
        return this._text.substring(start, end);
    }
    getLength() {
        return this._text.length;
    }
    getChangeRange(_oldSnapshot) {
        return undefined;
    }
}
class VinylScriptSnapshot extends ScriptSnapshot {
    _base;
    sourceMap;
    constructor(file) {
        super(file.contents.toString(), file.stat.mtime);
        this._base = file.base;
        this.sourceMap = file.sourceMap;
    }
    getBase() {
        return this._base;
    }
}
class LanguageServiceHost {
    _cmdLine;
    _projectPath;
    _log;
    _snapshots;
    _filesInProject;
    _filesAdded;
    _dependencies;
    _dependenciesRecomputeList;
    _fileNameToDeclaredModule;
    _projectVersion;
    constructor(_cmdLine, _projectPath, _log) {
        this._cmdLine = _cmdLine;
        this._projectPath = _projectPath;
        this._log = _log;
        this._snapshots = Object.create(null);
        this._filesInProject = new Set(_cmdLine.fileNames);
        this._filesAdded = new Set();
        this._dependencies = new utils.graph.Graph();
        this._dependenciesRecomputeList = [];
        this._fileNameToDeclaredModule = Object.create(null);
        this._projectVersion = 1;
    }
    log(_s) {
        // console.log(s);
    }
    trace(_s) {
        // console.log(s);
    }
    error(s) {
        console.error(s);
    }
    getCompilationSettings() {
        return this._cmdLine.options;
    }
    getProjectVersion() {
        return String(this._projectVersion);
    }
    getScriptFileNames() {
        const res = Object.keys(this._snapshots).filter(path => this._filesInProject.has(path) || this._filesAdded.has(path));
        return res;
    }
    getScriptVersion(filename) {
        filename = normalize(filename);
        const result = this._snapshots[filename];
        if (result) {
            return result.getVersion();
        }
        return 'UNKNWON_FILE_' + Math.random().toString(16).slice(2);
    }
    getScriptSnapshot(filename, resolve = true) {
        filename = normalize(filename);
        let result = this._snapshots[filename];
        if (!result && resolve) {
            try {
                result = new VinylScriptSnapshot(new vinyl_1.default({
                    path: filename,
                    contents: fs_1.default.readFileSync(filename),
                    base: this.getCompilationSettings().outDir,
                    stat: fs_1.default.statSync(filename)
                }));
                this.addScriptSnapshot(filename, result);
            }
            catch (e) {
                // ignore
            }
        }
        return result;
    }
    static _declareModule = /declare\s+module\s+('|")(.+)\1/g;
    addScriptSnapshot(filename, snapshot) {
        this._projectVersion++;
        filename = normalize(filename);
        const old = this._snapshots[filename];
        if (!old && !this._filesInProject.has(filename) && !filename.endsWith('.d.ts')) {
            //                                              ^^^^^^^^^^^^^^^^^^^^^^^^^^
            //                                              not very proper!
            this._filesAdded.add(filename);
        }
        if (!old || old.getVersion() !== snapshot.getVersion()) {
            this._dependenciesRecomputeList.push(filename);
            // (cheap) check for declare module
            LanguageServiceHost._declareModule.lastIndex = 0;
            let match;
            while ((match = LanguageServiceHost._declareModule.exec(snapshot.getText(0, snapshot.getLength())))) {
                let declaredModules = this._fileNameToDeclaredModule[filename];
                if (!declaredModules) {
                    this._fileNameToDeclaredModule[filename] = declaredModules = [];
                }
                declaredModules.push(match[2]);
            }
        }
        this._snapshots[filename] = snapshot;
        return old;
    }
    removeScriptSnapshot(filename) {
        filename = normalize(filename);
        this._log('removeScriptSnapshot', filename);
        this._filesInProject.delete(filename);
        this._filesAdded.delete(filename);
        this._projectVersion++;
        delete this._fileNameToDeclaredModule[filename];
        return delete this._snapshots[filename];
    }
    getCurrentDirectory() {
        return path_1.default.dirname(this._projectPath);
    }
    getDefaultLibFileName(options) {
        return typescript_1.default.getDefaultLibFilePath(options);
    }
    directoryExists = typescript_1.default.sys.directoryExists;
    getDirectories = typescript_1.default.sys.getDirectories;
    fileExists = typescript_1.default.sys.fileExists;
    readFile = typescript_1.default.sys.readFile;
    readDirectory = typescript_1.default.sys.readDirectory;
    // ---- dependency management
    collectDependents(filename, target) {
        while (this._dependenciesRecomputeList.length) {
            this._processFile(this._dependenciesRecomputeList.pop());
        }
        filename = normalize(filename);
        const node = this._dependencies.lookup(filename);
        if (node) {
            node.incoming.forEach(entry => target.push(entry.data));
        }
    }
    getCyclicDependencies(filenames) {
        // Ensure dependencies are up to date
        while (this._dependenciesRecomputeList.length) {
            this._processFile(this._dependenciesRecomputeList.pop());
        }
        const cycles = this._dependencies.findCycles(filenames.sort((a, b) => a.localeCompare(b)));
        const result = new Map();
        for (const [key, value] of cycles) {
            result.set(key, value?.join(' -> '));
        }
        return result;
    }
    _processFile(filename) {
        if (filename.match(/.*\.d\.ts$/)) {
            return;
        }
        filename = normalize(filename);
        const snapshot = this.getScriptSnapshot(filename);
        if (!snapshot) {
            this._log('processFile', `Missing snapshot for: ${filename}`);
            return;
        }
        const info = typescript_1.default.preProcessFile(snapshot.getText(0, snapshot.getLength()), true);
        // (0) clear out old dependencies
        this._dependencies.resetNode(filename);
        // (1) ///-references
        info.referencedFiles.forEach(ref => {
            const resolvedPath = path_1.default.resolve(path_1.default.dirname(filename), ref.fileName);
            const normalizedPath = normalize(resolvedPath);
            this._dependencies.inertEdge(filename, normalizedPath);
        });
        // (2) import-require statements
        info.importedFiles.forEach(ref => {
            if (!ref.fileName.startsWith('.')) {
                // node module?
                return;
            }
            if (ref.fileName.endsWith('.css')) {
                return;
            }
            const stopDirname = normalize(this.getCurrentDirectory());
            let dirname = filename;
            let found = false;
            while (!found && dirname.indexOf(stopDirname) === 0) {
                dirname = path_1.default.dirname(dirname);
                let resolvedPath = path_1.default.resolve(dirname, ref.fileName);
                if (resolvedPath.endsWith('.js')) {
                    resolvedPath = resolvedPath.slice(0, -3);
                }
                const normalizedPath = normalize(resolvedPath);
                if (this.getScriptSnapshot(normalizedPath + '.ts')) {
                    this._dependencies.inertEdge(filename, normalizedPath + '.ts');
                    found = true;
                }
                else if (this.getScriptSnapshot(normalizedPath + '.d.ts')) {
                    this._dependencies.inertEdge(filename, normalizedPath + '.d.ts');
                    found = true;
                }
                else if (this.getScriptSnapshot(normalizedPath + '.js')) {
                    this._dependencies.inertEdge(filename, normalizedPath + '.js');
                    found = true;
                }
            }
            if (!found) {
                for (const key in this._fileNameToDeclaredModule) {
                    if (this._fileNameToDeclaredModule[key] && ~this._fileNameToDeclaredModule[key].indexOf(ref.fileName)) {
                        this._dependencies.inertEdge(filename, key);
                    }
                }
            }
        });
    }
}
//# sourceMappingURL=builder.js.map