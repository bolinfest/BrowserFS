var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var api_error_1 = require('./api_error');
var events_1 = require('events');
var file_flag_1 = require('./file_flag');
var path = require('path');
var node_fs_stats_1 = require('./node_fs_stats');
/**
 * Wraps a callback function. Used for unit testing. Defaults to a NOP.
 */
var wrapCb = function (cb, numArgs) {
    return cb;
};
function normalizeMode(mode, def) {
    switch (typeof mode) {
        case 'number':
            // (path, flag, mode, cb?)
            return mode;
        case 'string':
            // (path, flag, modeString, cb?)
            var trueMode = parseInt(mode, 8);
            if (!isNaN(trueMode)) {
                return trueMode;
            }
            // Invalid string.
            return def;
        default:
            return def;
    }
}
function normalizeTime(time) {
    if (time instanceof Date) {
        return time;
    }
    else if (typeof time === 'number') {
        return new Date(time * 1000);
    }
    else {
        throw new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL, "Invalid time.");
    }
}
function normalizePath(p) {
    // Node doesn't allow null characters in paths.
    if (p.indexOf('\u0000') >= 0) {
        throw new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL, 'Path must be a string without null bytes.');
    }
    else if (p === '') {
        throw new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL, 'Path must not be empty.');
    }
    return path.resolve(p);
}
function normalizeOptions(options, defEnc, defFlag, defMode) {
    switch (typeof options) {
        case 'object':
            return {
                encoding: typeof options['encoding'] !== 'undefined' ? options['encoding'] : defEnc,
                flag: typeof options['flag'] !== 'undefined' ? options['flag'] : defFlag,
                mode: normalizeMode(options['mode'], defMode)
            };
        case 'string':
            return {
                encoding: options,
                flag: defFlag,
                mode: defMode
            };
        default:
            return {
                encoding: defEnc,
                flag: defFlag,
                mode: defMode
            };
    }
}
// The default callback is a NOP.
function nopCb() {
    // NOP.
}
function _setImmediate(callback) {
    // eta-conversion is necessary to appease TypeScript.
    Promise.resolve().then(function () { return callback(); });
}
var ReadStream = (function (_super) {
    __extends(ReadStream, _super);
    function ReadStream(filename, fs) {
        _super.call(this);
        this.close = null;
        this.readable = false;
        this.filename = filename;
        this.fs = fs;
        this.encoding = null;
        this.readable = false;
        // Just start streaming!
        this.read();
    }
    ReadStream.prototype.setEncoding = function (encoding) {
        this.encoding = encoding;
    };
    ReadStream.prototype.pause = function () {
        // Ignore.
    };
    ReadStream.prototype.resume = function () {
        // Ignore.
    };
    ReadStream.prototype.destroy = function () {
        // Nothing to do.
    };
    ReadStream.prototype.push = function (chunk, encoding) {
        throw Error('push() not supported yet');
    };
    ReadStream.prototype.read = function (size) {
        var _this = this;
        if (this.readable) {
            return null;
        }
        if (size == null) {
            var options = {};
            if (this.encoding != null) {
                options.encoding = this.encoding;
            }
            var contents_1 = this.fs.readFileSync(this.filename, options);
            this.readable = true;
            _setImmediate(function () { return _this.emit('data', contents_1); });
            _setImmediate(function () { return _this.emit('end'); });
            return contents_1;
        }
        else {
            throw Error('read(size) not supported yet');
        }
    };
    ReadStream.prototype._read = function (size) {
        this.read(size);
    };
    ReadStream.prototype.pipe = function (destination, options) {
        var contents = this.read();
        destination.write(contents, this.encoding);
        var endTheWriterWhenTheReaderEnds = options == null || options.end !== false;
        if (endTheWriterWhenTheReaderEnds) {
            destination.end();
        }
    };
    ReadStream.prototype.unpipe = function (destination) {
        throw Error('unpipe() not supported yet');
    };
    ReadStream.prototype.unshift = function (chunk) {
        throw Error('unshift() not supported yet');
    };
    ReadStream.prototype.wrap = function (oldStream) {
        throw Error('wrap() not supported yet');
    };
    return ReadStream;
}(events_1.EventEmitter));
/**
 * The node frontend to all filesystems.
 * This layer handles:
 *
 * * Sanity checking inputs.
 * * Normalizing paths.
 * * Resetting stack depth for asynchronous operations which may not go through
 *   the browser by wrapping all input callbacks using `setImmediate`.
 * * Performing the requested operation through the filesystem or the file
 *   descriptor, as appropriate.
 * * Handling optional arguments and setting default arguments.
 * @see http://nodejs.org/api/fs.html
 * @class
 */
var FS = (function () {
    function FS() {
        /* tslint:enable:variable-name */
        this.F_OK = 0;
        this.R_OK = 4;
        this.W_OK = 2;
        this.X_OK = 1;
        this.root = null;
        this.fdMap = {};
        this.nextFd = 100;
    }
    FS.prototype.initialize = function (rootFS) {
        if (!rootFS.constructor.isAvailable()) {
            throw new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL, 'Tried to instantiate BrowserFS with an unavailable file system.');
        }
        return this.root = rootFS;
    };
    /**
     * converts Date or number to a fractional UNIX timestamp
     * Grabbed from NodeJS sources (lib/fs.js)
     */
    FS.prototype._toUnixTimestamp = function (time) {
        if (typeof time === 'number') {
            return time;
        }
        else if (time instanceof Date) {
            return time.getTime() / 1000;
        }
        throw new Error("Cannot parse time: " + time);
    };
    /**
     * **NONSTANDARD**: Grab the FileSystem instance that backs this API.
     * @return [BrowserFS.FileSystem | null] Returns null if the file system has
     *   not been initialized.
     */
    FS.prototype.getRootFS = function () {
        if (this.root) {
            return this.root;
        }
        else {
            return null;
        }
    };
    // FILE OR DIRECTORY METHODS
    /**
     * Asynchronous rename. No arguments other than a possible exception are given
     * to the completion callback.
     * @param [String] oldPath
     * @param [String] newPath
     * @param [Function(BrowserFS.ApiError)] callback
     */
    FS.prototype.rename = function (oldPath, newPath, cb) {
        if (cb === void 0) { cb = nopCb; }
        var newCb = wrapCb(cb, 1);
        try {
            this.root.rename(normalizePath(oldPath), normalizePath(newPath), newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Synchronous rename.
     * @param [String] oldPath
     * @param [String] newPath
     */
    FS.prototype.renameSync = function (oldPath, newPath) {
        this.root.renameSync(normalizePath(oldPath), normalizePath(newPath));
    };
    /**
     * Test whether or not the given path exists by checking with the file system.
     * Then call the callback argument with either true or false.
     * @example Sample invocation
     *   fs.exists('/etc/passwd', function (exists) {
     *     util.debug(exists ? "it's there" : "no passwd!");
     *   });
     * @param [String] path
     * @param [Function(Boolean)] callback
     */
    FS.prototype.exists = function (path, cb) {
        if (cb === void 0) { cb = nopCb; }
        var newCb = wrapCb(cb, 1);
        try {
            return this.root.exists(normalizePath(path), newCb);
        }
        catch (e) {
            // Doesn't return an error. If something bad happens, we assume it just
            // doesn't exist.
            return newCb(false);
        }
    };
    /**
     * Test whether or not the given path exists by checking with the file system.
     * @param [String] path
     * @return [boolean]
     */
    FS.prototype.existsSync = function (path) {
        try {
            return this.root.existsSync(normalizePath(path));
        }
        catch (e) {
            // Doesn't return an error. If something bad happens, we assume it just
            // doesn't exist.
            return false;
        }
    };
    /**
     * Asynchronous `stat`.
     * @param [String] path
     * @param [Function(BrowserFS.ApiError, BrowserFS.node.fs.Stats)] callback
     */
    FS.prototype.stat = function (path, cb) {
        if (cb === void 0) { cb = nopCb; }
        var newCb = wrapCb(cb, 2);
        try {
            return this.root.stat(normalizePath(path), false, newCb);
        }
        catch (e) {
            return newCb(e, null);
        }
    };
    /**
     * Synchronous `stat`.
     * @param [String] path
     * @return [BrowserFS.node.fs.Stats]
     */
    FS.prototype.statSync = function (path) {
        return this.root.statSync(normalizePath(path), false);
    };
    /**
     * Asynchronous `lstat`.
     * `lstat()` is identical to `stat()`, except that if path is a symbolic link,
     * then the link itself is stat-ed, not the file that it refers to.
     * @param [String] path
     * @param [Function(BrowserFS.ApiError, BrowserFS.node.fs.Stats)] callback
     */
    FS.prototype.lstat = function (path, cb) {
        if (cb === void 0) { cb = nopCb; }
        var newCb = wrapCb(cb, 2);
        try {
            return this.root.stat(normalizePath(path), true, newCb);
        }
        catch (e) {
            return newCb(e, null);
        }
    };
    /**
     * Synchronous `lstat`.
     * `lstat()` is identical to `stat()`, except that if path is a symbolic link,
     * then the link itself is stat-ed, not the file that it refers to.
     * @param [String] path
     * @return [BrowserFS.node.fs.Stats]
     */
    FS.prototype.lstatSync = function (path) {
        return this.root.statSync(normalizePath(path), true);
    };
    FS.prototype.truncate = function (path, arg2, cb) {
        if (arg2 === void 0) { arg2 = 0; }
        if (cb === void 0) { cb = nopCb; }
        var len = 0;
        if (typeof arg2 === 'function') {
            cb = arg2;
        }
        else if (typeof arg2 === 'number') {
            len = arg2;
        }
        var newCb = wrapCb(cb, 1);
        try {
            if (len < 0) {
                throw new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL);
            }
            return this.root.truncate(normalizePath(path), len, newCb);
        }
        catch (e) {
            return newCb(e);
        }
    };
    /**
     * Synchronous `truncate`.
     * @param [String] path
     * @param [Number] len
     */
    FS.prototype.truncateSync = function (path, len) {
        if (len === void 0) { len = 0; }
        if (len < 0) {
            throw new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL);
        }
        return this.root.truncateSync(normalizePath(path), len);
    };
    /**
     * Asynchronous `unlink`.
     * @param [String] path
     * @param [Function(BrowserFS.ApiError)] callback
     */
    FS.prototype.unlink = function (path, cb) {
        if (cb === void 0) { cb = nopCb; }
        var newCb = wrapCb(cb, 1);
        try {
            return this.root.unlink(normalizePath(path), newCb);
        }
        catch (e) {
            return newCb(e);
        }
    };
    /**
     * Synchronous `unlink`.
     * @param [String] path
     */
    FS.prototype.unlinkSync = function (path) {
        return this.root.unlinkSync(normalizePath(path));
    };
    FS.prototype.open = function (path, flag, arg2, cb) {
        var _this = this;
        if (cb === void 0) { cb = nopCb; }
        var mode = normalizeMode(arg2, 0x1a4);
        cb = typeof arg2 === 'function' ? arg2 : cb;
        var newCb = wrapCb(cb, 2);
        try {
            this.root.open(normalizePath(path), file_flag_1.FileFlag.getFileFlag(flag), mode, function (e, file) {
                if (file) {
                    newCb(e, _this.getFdForFile(file));
                }
                else {
                    newCb(e);
                }
            });
        }
        catch (e) {
            newCb(e, null);
        }
    };
    /**
     * Synchronous file open.
     * @see http://www.manpagez.com/man/2/open/
     * @param [String] path
     * @param [String] flags
     * @param [Number?] mode defaults to `0644`
     * @return [BrowserFS.File]
     */
    FS.prototype.openSync = function (path, flag, mode) {
        if (mode === void 0) { mode = 0x1a4; }
        return this.getFdForFile(this.root.openSync(normalizePath(path), file_flag_1.FileFlag.getFileFlag(flag), normalizeMode(mode, 0x1a4)));
    };
    FS.prototype.readFile = function (filename, arg2, cb) {
        if (arg2 === void 0) { arg2 = {}; }
        if (cb === void 0) { cb = nopCb; }
        var options = normalizeOptions(arg2, null, 'r', null);
        cb = typeof arg2 === 'function' ? arg2 : cb;
        var newCb = wrapCb(cb, 2);
        try {
            var flag = file_flag_1.FileFlag.getFileFlag(options['flag']);
            if (!flag.isReadable()) {
                return newCb(new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL, 'Flag passed to readFile must allow for reading.'));
            }
            return this.root.readFile(normalizePath(filename), options.encoding, flag, newCb);
        }
        catch (e) {
            return newCb(e, null);
        }
    };
    FS.prototype.readFileSync = function (filename, arg2) {
        if (arg2 === void 0) { arg2 = {}; }
        var options = normalizeOptions(arg2, null, 'r', null);
        var flag = file_flag_1.FileFlag.getFileFlag(options.flag);
        if (!flag.isReadable()) {
            throw new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL, 'Flag passed to readFile must allow for reading.');
        }
        return this.root.readFileSync(normalizePath(filename), options.encoding, flag);
    };
    FS.prototype.writeFile = function (filename, data, arg3, cb) {
        if (arg3 === void 0) { arg3 = {}; }
        if (cb === void 0) { cb = nopCb; }
        var options = normalizeOptions(arg3, 'utf8', 'w', 0x1a4);
        cb = typeof arg3 === 'function' ? arg3 : cb;
        var newCb = wrapCb(cb, 1);
        try {
            var flag = file_flag_1.FileFlag.getFileFlag(options.flag);
            if (!flag.isWriteable()) {
                return newCb(new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL, 'Flag passed to writeFile must allow for writing.'));
            }
            return this.root.writeFile(normalizePath(filename), data, options.encoding, flag, options.mode, newCb);
        }
        catch (e) {
            return newCb(e);
        }
    };
    FS.prototype.writeFileSync = function (filename, data, arg3) {
        var options = normalizeOptions(arg3, 'utf8', 'w', 0x1a4);
        var flag = file_flag_1.FileFlag.getFileFlag(options.flag);
        if (!flag.isWriteable()) {
            throw new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL, 'Flag passed to writeFile must allow for writing.');
        }
        return this.root.writeFileSync(normalizePath(filename), data, options.encoding, flag, options.mode);
    };
    FS.prototype.appendFile = function (filename, data, arg3, cb) {
        if (cb === void 0) { cb = nopCb; }
        var options = normalizeOptions(arg3, 'utf8', 'a', 0x1a4);
        cb = typeof arg3 === 'function' ? arg3 : cb;
        var newCb = wrapCb(cb, 1);
        try {
            var flag = file_flag_1.FileFlag.getFileFlag(options.flag);
            if (!flag.isAppendable()) {
                return newCb(new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL, 'Flag passed to appendFile must allow for appending.'));
            }
            this.root.appendFile(normalizePath(filename), data, options.encoding, flag, options.mode, newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    FS.prototype.appendFileSync = function (filename, data, arg3) {
        var options = normalizeOptions(arg3, 'utf8', 'a', 0x1a4);
        var flag = file_flag_1.FileFlag.getFileFlag(options.flag);
        if (!flag.isAppendable()) {
            throw new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL, 'Flag passed to appendFile must allow for appending.');
        }
        return this.root.appendFileSync(normalizePath(filename), data, options.encoding, flag, options.mode);
    };
    // FILE DESCRIPTOR METHODS
    /**
     * Asynchronous `fstat`.
     * `fstat()` is identical to `stat()`, except that the file to be stat-ed is
     * specified by the file descriptor `fd`.
     * @param [BrowserFS.File] fd
     * @param [Function(BrowserFS.ApiError, BrowserFS.node.fs.Stats)] callback
     */
    FS.prototype.fstat = function (fd, cb) {
        if (cb === void 0) { cb = nopCb; }
        var newCb = wrapCb(cb, 2);
        try {
            var file = this.fd2file(fd);
            file.stat(newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Synchronous `fstat`.
     * `fstat()` is identical to `stat()`, except that the file to be stat-ed is
     * specified by the file descriptor `fd`.
     * @param [BrowserFS.File] fd
     * @return [BrowserFS.node.fs.Stats]
     */
    FS.prototype.fstatSync = function (fd) {
        return this.fd2file(fd).statSync();
    };
    /**
     * Asynchronous close.
     * @param [BrowserFS.File] fd
     * @param [Function(BrowserFS.ApiError)] callback
     */
    FS.prototype.close = function (fd, cb) {
        var _this = this;
        if (cb === void 0) { cb = nopCb; }
        var newCb = wrapCb(cb, 1);
        try {
            this.fd2file(fd).close(function (e) {
                if (!e) {
                    _this.closeFd(fd);
                }
                newCb(e);
            });
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Synchronous close.
     * @param [BrowserFS.File] fd
     */
    FS.prototype.closeSync = function (fd) {
        this.fd2file(fd).closeSync();
        this.closeFd(fd);
    };
    FS.prototype.ftruncate = function (fd, arg2, cb) {
        if (cb === void 0) { cb = nopCb; }
        var length = typeof arg2 === 'number' ? arg2 : 0;
        cb = typeof arg2 === 'function' ? arg2 : cb;
        var newCb = wrapCb(cb, 1);
        try {
            var file = this.fd2file(fd);
            if (length < 0) {
                throw new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL);
            }
            file.truncate(length, newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Synchronous ftruncate.
     * @param [BrowserFS.File] fd
     * @param [Number] len
     */
    FS.prototype.ftruncateSync = function (fd, len) {
        if (len === void 0) { len = 0; }
        var file = this.fd2file(fd);
        if (len < 0) {
            throw new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL);
        }
        file.truncateSync(len);
    };
    /**
     * Asynchronous fsync.
     * @param [BrowserFS.File] fd
     * @param [Function(BrowserFS.ApiError)] callback
     */
    FS.prototype.fsync = function (fd, cb) {
        if (cb === void 0) { cb = nopCb; }
        var newCb = wrapCb(cb, 1);
        try {
            this.fd2file(fd).sync(newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Synchronous fsync.
     * @param [BrowserFS.File] fd
     */
    FS.prototype.fsyncSync = function (fd) {
        this.fd2file(fd).syncSync();
    };
    /**
     * Asynchronous fdatasync.
     * @param [BrowserFS.File] fd
     * @param [Function(BrowserFS.ApiError)] callback
     */
    FS.prototype.fdatasync = function (fd, cb) {
        if (cb === void 0) { cb = nopCb; }
        var newCb = wrapCb(cb, 1);
        try {
            this.fd2file(fd).datasync(newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Synchronous fdatasync.
     * @param [BrowserFS.File] fd
     */
    FS.prototype.fdatasyncSync = function (fd) {
        this.fd2file(fd).datasyncSync();
    };
    FS.prototype.write = function (fd, arg2, arg3, arg4, arg5, cb) {
        if (cb === void 0) { cb = nopCb; }
        var buffer, offset, length, position = null;
        if (typeof arg2 === 'string') {
            // Signature 1: (fd, string, [position?, [encoding?]], cb?)
            var encoding = 'utf8';
            switch (typeof arg3) {
                case 'function':
                    // (fd, string, cb)
                    cb = arg3;
                    break;
                case 'number':
                    // (fd, string, position, encoding?, cb?)
                    position = arg3;
                    encoding = typeof arg4 === 'string' ? arg4 : 'utf8';
                    cb = typeof arg5 === 'function' ? arg5 : cb;
                    break;
                default:
                    // ...try to find the callback and get out of here!
                    cb = typeof arg4 === 'function' ? arg4 : typeof arg5 === 'function' ? arg5 : cb;
                    return cb(new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL, 'Invalid arguments.'));
            }
            buffer = new Buffer(arg2, encoding);
            offset = 0;
            length = buffer.length;
        }
        else {
            // Signature 2: (fd, buffer, offset, length, position?, cb?)
            buffer = arg2;
            offset = arg3;
            length = arg4;
            position = typeof arg5 === 'number' ? arg5 : null;
            cb = typeof arg5 === 'function' ? arg5 : cb;
        }
        var newCb = wrapCb(cb, 3);
        try {
            var file = this.fd2file(fd);
            if (position === undefined || position === null) {
                position = file.getPos();
            }
            file.write(buffer, offset, length, position, newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    FS.prototype.writeSync = function (fd, arg2, arg3, arg4, arg5) {
        var buffer, offset = 0, length, position;
        if (typeof arg2 === 'string') {
            // Signature 1: (fd, string, [position?, [encoding?]])
            position = typeof arg3 === 'number' ? arg3 : null;
            var encoding = typeof arg4 === 'string' ? arg4 : 'utf8';
            offset = 0;
            buffer = new Buffer(arg2, encoding);
            length = buffer.length;
        }
        else {
            // Signature 2: (fd, buffer, offset, length, position?)
            buffer = arg2;
            offset = arg3;
            length = arg4;
            position = typeof arg5 === 'number' ? arg5 : null;
        }
        var file = this.fd2file(fd);
        if (position === undefined || position === null) {
            position = file.getPos();
        }
        return file.writeSync(buffer, offset, length, position);
    };
    FS.prototype.read = function (fd, arg2, arg3, arg4, arg5, cb) {
        if (cb === void 0) { cb = nopCb; }
        var position, offset, length, buffer, newCb;
        if (typeof arg2 === 'number') {
            // legacy interface
            // (fd, length, position, encoding, callback)
            length = arg2;
            position = arg3;
            var encoding_1 = arg4;
            cb = typeof arg5 === 'function' ? arg5 : cb;
            offset = 0;
            buffer = new Buffer(length);
            // XXX: Inefficient.
            // Wrap the cb so we shelter upper layers of the API from these
            // shenanigans.
            newCb = wrapCb((function (err, bytesRead, buf) {
                if (err) {
                    return cb(err);
                }
                cb(err, buf.toString(encoding_1), bytesRead);
            }), 3);
        }
        else {
            buffer = arg2;
            offset = arg3;
            length = arg4;
            position = arg5;
            newCb = wrapCb(cb, 3);
        }
        try {
            var file = this.fd2file(fd);
            if (position === undefined || position === null) {
                position = file.getPos();
            }
            file.read(buffer, offset, length, position, newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    FS.prototype.readSync = function (fd, arg2, arg3, arg4, arg5) {
        var shenanigans = false;
        var buffer, offset, length, position, encoding;
        if (typeof arg2 === 'number') {
            length = arg2;
            position = arg3;
            encoding = arg4;
            offset = 0;
            buffer = new Buffer(length);
            shenanigans = true;
        }
        else {
            buffer = arg2;
            offset = arg3;
            length = arg4;
            position = arg5;
        }
        var file = this.fd2file(fd);
        if (position === undefined || position === null) {
            position = file.getPos();
        }
        var rv = file.readSync(buffer, offset, length, position);
        if (!shenanigans) {
            return rv;
        }
        else {
            return [buffer.toString(encoding), rv];
        }
    };
    /**
     * Asynchronous `fchown`.
     * @param [BrowserFS.File] fd
     * @param [Number] uid
     * @param [Number] gid
     * @param [Function(BrowserFS.ApiError)] callback
     */
    FS.prototype.fchown = function (fd, uid, gid, callback) {
        if (callback === void 0) { callback = nopCb; }
        var newCb = wrapCb(callback, 1);
        try {
            this.fd2file(fd).chown(uid, gid, newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Synchronous `fchown`.
     * @param [BrowserFS.File] fd
     * @param [Number] uid
     * @param [Number] gid
     */
    FS.prototype.fchownSync = function (fd, uid, gid) {
        this.fd2file(fd).chownSync(uid, gid);
    };
    /**
     * Asynchronous `fchmod`.
     * @param [BrowserFS.File] fd
     * @param [Number] mode
     * @param [Function(BrowserFS.ApiError)] callback
     */
    FS.prototype.fchmod = function (fd, mode, cb) {
        var newCb = wrapCb(cb, 1);
        try {
            var numMode = typeof mode === 'string' ? parseInt(mode, 8) : mode;
            this.fd2file(fd).chmod(numMode, newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Synchronous `fchmod`.
     * @param [BrowserFS.File] fd
     * @param [Number] mode
     */
    FS.prototype.fchmodSync = function (fd, mode) {
        var numMode = typeof mode === 'string' ? parseInt(mode, 8) : mode;
        this.fd2file(fd).chmodSync(numMode);
    };
    /**
     * Change the file timestamps of a file referenced by the supplied file
     * descriptor.
     * @param [BrowserFS.File] fd
     * @param [Date] atime
     * @param [Date] mtime
     * @param [Function(BrowserFS.ApiError)] callback
     */
    FS.prototype.futimes = function (fd, atime, mtime, cb) {
        if (cb === void 0) { cb = nopCb; }
        var newCb = wrapCb(cb, 1);
        try {
            var file = this.fd2file(fd);
            if (typeof atime === 'number') {
                atime = new Date(atime * 1000);
            }
            if (typeof mtime === 'number') {
                mtime = new Date(mtime * 1000);
            }
            file.utimes(atime, mtime, newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Change the file timestamps of a file referenced by the supplied file
     * descriptor.
     * @param [BrowserFS.File] fd
     * @param [Date] atime
     * @param [Date] mtime
     */
    FS.prototype.futimesSync = function (fd, atime, mtime) {
        this.fd2file(fd).utimesSync(normalizeTime(atime), normalizeTime(mtime));
    };
    // DIRECTORY-ONLY METHODS
    /**
     * Asynchronous `rmdir`.
     * @param [String] path
     * @param [Function(BrowserFS.ApiError)] callback
     */
    FS.prototype.rmdir = function (path, cb) {
        if (cb === void 0) { cb = nopCb; }
        var newCb = wrapCb(cb, 1);
        try {
            path = normalizePath(path);
            this.root.rmdir(path, newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Synchronous `rmdir`.
     * @param [String] path
     */
    FS.prototype.rmdirSync = function (path) {
        path = normalizePath(path);
        return this.root.rmdirSync(path);
    };
    /**
     * Asynchronous `mkdir`.
     * @param [String] path
     * @param [Number?] mode defaults to `0777`
     * @param [Function(BrowserFS.ApiError)] callback
     */
    FS.prototype.mkdir = function (path, mode, cb) {
        if (cb === void 0) { cb = nopCb; }
        if (typeof mode === 'function') {
            cb = mode;
            mode = 0x1ff;
        }
        var newCb = wrapCb(cb, 1);
        try {
            path = normalizePath(path);
            this.root.mkdir(path, mode, newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Synchronous `mkdir`.
     * @param [String] path
     * @param [Number?] mode defaults to `0777`
     */
    FS.prototype.mkdirSync = function (path, mode) {
        this.root.mkdirSync(normalizePath(path), normalizeMode(mode, 0x1ff));
    };
    /**
     * Asynchronous `readdir`. Reads the contents of a directory.
     * The callback gets two arguments `(err, files)` where `files` is an array of
     * the names of the files in the directory excluding `'.'` and `'..'`.
     * @param [String] path
     * @param [Function(BrowserFS.ApiError, String[])] callback
     */
    FS.prototype.readdir = function (path, cb) {
        if (cb === void 0) { cb = nopCb; }
        var newCb = wrapCb(cb, 2);
        try {
            path = normalizePath(path);
            this.root.readdir(path, newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Synchronous `readdir`. Reads the contents of a directory.
     * @param [String] path
     * @return [String[]]
     */
    FS.prototype.readdirSync = function (path) {
        path = normalizePath(path);
        return this.root.readdirSync(path);
    };
    // SYMLINK METHODS
    /**
     * Asynchronous `link`.
     * @param [String] srcpath
     * @param [String] dstpath
     * @param [Function(BrowserFS.ApiError)] callback
     */
    FS.prototype.link = function (srcpath, dstpath, cb) {
        if (cb === void 0) { cb = nopCb; }
        var newCb = wrapCb(cb, 1);
        try {
            srcpath = normalizePath(srcpath);
            dstpath = normalizePath(dstpath);
            this.root.link(srcpath, dstpath, newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Synchronous `link`.
     * @param [String] srcpath
     * @param [String] dstpath
     */
    FS.prototype.linkSync = function (srcpath, dstpath) {
        srcpath = normalizePath(srcpath);
        dstpath = normalizePath(dstpath);
        return this.root.linkSync(srcpath, dstpath);
    };
    FS.prototype.symlink = function (srcpath, dstpath, arg3, cb) {
        if (cb === void 0) { cb = nopCb; }
        var type = typeof arg3 === 'string' ? arg3 : 'file';
        cb = typeof arg3 === 'function' ? arg3 : cb;
        var newCb = wrapCb(cb, 1);
        try {
            if (type !== 'file' && type !== 'dir') {
                return newCb(new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL, "Invalid type: " + type));
            }
            srcpath = normalizePath(srcpath);
            dstpath = normalizePath(dstpath);
            this.root.symlink(srcpath, dstpath, type, newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Synchronous `symlink`.
     * @param [String] srcpath
     * @param [String] dstpath
     * @param [String?] type can be either `'dir'` or `'file'` (default is `'file'`)
     */
    FS.prototype.symlinkSync = function (srcpath, dstpath, type) {
        if (!type) {
            type = 'file';
        }
        else if (type !== 'file' && type !== 'dir') {
            throw new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL, "Invalid type: " + type);
        }
        srcpath = normalizePath(srcpath);
        dstpath = normalizePath(dstpath);
        return this.root.symlinkSync(srcpath, dstpath, type);
    };
    /**
     * Asynchronous readlink.
     * @param [String] path
     * @param [Function(BrowserFS.ApiError, String)] callback
     */
    FS.prototype.readlink = function (path, cb) {
        if (cb === void 0) { cb = nopCb; }
        var newCb = wrapCb(cb, 2);
        try {
            path = normalizePath(path);
            this.root.readlink(path, newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Synchronous readlink.
     * @param [String] path
     * @return [String]
     */
    FS.prototype.readlinkSync = function (path) {
        path = normalizePath(path);
        return this.root.readlinkSync(path);
    };
    // PROPERTY OPERATIONS
    /**
     * Asynchronous `chown`.
     * @param [String] path
     * @param [Number] uid
     * @param [Number] gid
     * @param [Function(BrowserFS.ApiError)] callback
     */
    FS.prototype.chown = function (path, uid, gid, cb) {
        if (cb === void 0) { cb = nopCb; }
        var newCb = wrapCb(cb, 1);
        try {
            path = normalizePath(path);
            this.root.chown(path, false, uid, gid, newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Synchronous `chown`.
     * @param [String] path
     * @param [Number] uid
     * @param [Number] gid
     */
    FS.prototype.chownSync = function (path, uid, gid) {
        path = normalizePath(path);
        this.root.chownSync(path, false, uid, gid);
    };
    /**
     * Asynchronous `lchown`.
     * @param [String] path
     * @param [Number] uid
     * @param [Number] gid
     * @param [Function(BrowserFS.ApiError)] callback
     */
    FS.prototype.lchown = function (path, uid, gid, cb) {
        if (cb === void 0) { cb = nopCb; }
        var newCb = wrapCb(cb, 1);
        try {
            path = normalizePath(path);
            this.root.chown(path, true, uid, gid, newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Synchronous `lchown`.
     * @param [String] path
     * @param [Number] uid
     * @param [Number] gid
     */
    FS.prototype.lchownSync = function (path, uid, gid) {
        path = normalizePath(path);
        this.root.chownSync(path, true, uid, gid);
    };
    /**
     * Asynchronous `chmod`.
     * @param [String] path
     * @param [Number] mode
     * @param [Function(BrowserFS.ApiError)] callback
     */
    FS.prototype.chmod = function (path, mode, cb) {
        if (cb === void 0) { cb = nopCb; }
        var newCb = wrapCb(cb, 1);
        try {
            var numMode = normalizeMode(mode, -1);
            if (numMode < 0) {
                throw new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL, "Invalid mode.");
            }
            this.root.chmod(normalizePath(path), false, numMode, newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Synchronous `chmod`.
     * @param [String] path
     * @param [Number] mode
     */
    FS.prototype.chmodSync = function (path, mode) {
        var numMode = normalizeMode(mode, -1);
        if (numMode < 0) {
            throw new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL, "Invalid mode.");
        }
        path = normalizePath(path);
        this.root.chmodSync(path, false, numMode);
    };
    /**
     * Asynchronous `lchmod`.
     * @param [String] path
     * @param [Number] mode
     * @param [Function(BrowserFS.ApiError)] callback
     */
    FS.prototype.lchmod = function (path, mode, cb) {
        if (cb === void 0) { cb = nopCb; }
        var newCb = wrapCb(cb, 1);
        try {
            var numMode = normalizeMode(mode, -1);
            if (numMode < 0) {
                throw new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL, "Invalid mode.");
            }
            this.root.chmod(normalizePath(path), true, numMode, newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Synchronous `lchmod`.
     * @param [String] path
     * @param [Number] mode
     */
    FS.prototype.lchmodSync = function (path, mode) {
        var numMode = normalizeMode(mode, -1);
        if (numMode < 1) {
            throw new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL, "Invalid mode.");
        }
        this.root.chmodSync(normalizePath(path), true, numMode);
    };
    /**
     * Change file timestamps of the file referenced by the supplied path.
     * @param [String] path
     * @param [Date] atime
     * @param [Date] mtime
     * @param [Function(BrowserFS.ApiError)] callback
     */
    FS.prototype.utimes = function (path, atime, mtime, cb) {
        if (cb === void 0) { cb = nopCb; }
        var newCb = wrapCb(cb, 1);
        try {
            this.root.utimes(normalizePath(path), normalizeTime(atime), normalizeTime(mtime), newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Change file timestamps of the file referenced by the supplied path.
     * @param [String] path
     * @param [Date] atime
     * @param [Date] mtime
     */
    FS.prototype.utimesSync = function (path, atime, mtime) {
        this.root.utimesSync(normalizePath(path), normalizeTime(atime), normalizeTime(mtime));
    };
    FS.prototype.realpath = function (path, arg2, cb) {
        if (cb === void 0) { cb = nopCb; }
        var cache = typeof (arg2) === 'object' ? arg2 : {};
        cb = typeof (arg2) === 'function' ? arg2 : nopCb;
        var newCb = wrapCb(cb, 2);
        try {
            path = normalizePath(path);
            this.root.realpath(path, cache, newCb);
        }
        catch (e) {
            newCb(e);
        }
    };
    /**
     * Synchronous `realpath`.
     * @param [String] path
     * @param [Object?] cache An object literal of mapped paths that can be used to
     *   force a specific path resolution or avoid additional `fs.stat` calls for
     *   known real paths.
     * @return [String]
     */
    FS.prototype.realpathSync = function (path, cache) {
        if (cache === void 0) { cache = {}; }
        path = normalizePath(path);
        return this.root.realpathSync(path, cache);
    };
    FS.prototype.watchFile = function (filename, arg2, listener) {
        if (listener === void 0) { listener = nopCb; }
        throw new api_error_1.ApiError(api_error_1.ErrorCode.ENOTSUP);
    };
    FS.prototype.unwatchFile = function (filename, listener) {
        if (listener === void 0) { listener = nopCb; }
        throw new api_error_1.ApiError(api_error_1.ErrorCode.ENOTSUP);
    };
    FS.prototype.watch = function (filename, arg2, listener) {
        if (listener === void 0) { listener = nopCb; }
        throw new api_error_1.ApiError(api_error_1.ErrorCode.ENOTSUP);
    };
    FS.prototype.access = function (path, arg2, cb) {
        if (cb === void 0) { cb = nopCb; }
        throw new api_error_1.ApiError(api_error_1.ErrorCode.ENOTSUP);
    };
    FS.prototype.accessSync = function (path, mode) {
        throw new api_error_1.ApiError(api_error_1.ErrorCode.ENOTSUP);
    };
    FS.prototype.createReadStream = function (path, options) {
        var readStream = new ReadStream(path, this);
        if (options != null && options.encoding != null) {
            readStream.setEncoding(options.encoding);
        }
        return readStream;
    };
    FS.prototype.createWriteStream = function (path, options) {
        throw new api_error_1.ApiError(api_error_1.ErrorCode.ENOTSUP);
    };
    /**
     * For unit testing. Passes all incoming callbacks to cbWrapper for wrapping.
     */
    FS.prototype.wrapCallbacks = function (cbWrapper) {
        wrapCb = cbWrapper;
    };
    FS.prototype.getFdForFile = function (file) {
        var fd = this.nextFd++;
        this.fdMap[fd] = file;
        return fd;
    };
    FS.prototype.fd2file = function (fd) {
        var rv = this.fdMap[fd];
        if (rv) {
            return rv;
        }
        else {
            throw new api_error_1.ApiError(api_error_1.ErrorCode.EBADF, 'Invalid file descriptor.');
        }
    };
    FS.prototype.closeFd = function (fd) {
        delete this.fdMap[fd];
    };
    /* tslint:disable:variable-name */
    // Exported fs.Stats.
    FS.Stats = node_fs_stats_1["default"];
    return FS;
}());
exports.__esModule = true;
exports["default"] = FS;
//# sourceMappingURL=FS.js.map