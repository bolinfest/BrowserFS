var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var file_system_1 = require('../core/file_system');
var api_error_1 = require('../core/api_error');
var file_flag_1 = require('../core/file_flag');
var util_1 = require('../core/util');
var preload_file_1 = require('../generic/preload_file');
var xhr_1 = require('../generic/xhr');
var file_index_1 = require('../generic/file_index');
/**
 * Try to convert the given buffer into a string, and pass it to the callback.
 * Optimization that removes the needed try/catch into a helper function, as
 * this is an uncommon case.
 */
function tryToString(buff, encoding, cb) {
    try {
        cb(null, buff.toString(encoding));
    }
    catch (e) {
        cb(e);
    }
}
/**
 * A simple filesystem backed by XmlHttpRequests.
 */
var XmlHttpRequest = (function (_super) {
    __extends(XmlHttpRequest, _super);
    /**
     * Constructs the file system.
     * @param listingUrlOrObj index object or the path to the JSON file index generated by
     *   tools/XHRIndexer.coffee. This can be relative to the current webpage URL
     *   or absolutely specified.
     * @param prefixUrl The url prefix to use for all web-server requests.
     */
    function XmlHttpRequest(listingUrlOrObj, prefixUrl) {
        if (prefixUrl === void 0) { prefixUrl = ''; }
        _super.call(this);
        if (!listingUrlOrObj) {
            listingUrlOrObj = 'index.json';
        }
        // prefix_url must end in a directory separator.
        if (prefixUrl.length > 0 && prefixUrl.charAt(prefixUrl.length - 1) !== '/') {
            prefixUrl = prefixUrl + '/';
        }
        this.prefixUrl = prefixUrl;
        var listing = null;
        if (typeof (listingUrlOrObj) === "string") {
            listing = this._requestFileSync(listingUrlOrObj, 'json');
            if (!listing) {
                throw new Error("Unable to find listing at URL: ${listingUrlOrObj}");
            }
        }
        else {
            listing = listingUrlOrObj;
        }
        this._index = file_index_1.FileIndex.fromListing(listing);
    }
    XmlHttpRequest.isAvailable = function () {
        return typeof (XMLHttpRequest) !== "undefined" && XMLHttpRequest !== null;
    };
    XmlHttpRequest.prototype.empty = function () {
        this._index.fileIterator(function (file) {
            file.fileData = null;
        });
    };
    /**
     * Only requests the HEAD content, for the file size.
     */
    XmlHttpRequest.prototype._requestFileSizeAsync = function (path, cb) {
        xhr_1.getFileSizeAsync(this.getXhrPath(path), cb);
    };
    XmlHttpRequest.prototype._requestFileSizeSync = function (path) {
        return xhr_1.getFileSizeSync(this.getXhrPath(path));
    };
    XmlHttpRequest.prototype.getName = function () {
        return 'XmlHttpRequest';
    };
    XmlHttpRequest.prototype.diskSpace = function (path, cb) {
        // Read-only file system. We could calculate the total space, but that's not
        // important right now.
        cb(0, 0);
    };
    XmlHttpRequest.prototype.isReadOnly = function () {
        return true;
    };
    XmlHttpRequest.prototype.supportsLinks = function () {
        return false;
    };
    XmlHttpRequest.prototype.supportsProps = function () {
        return false;
    };
    XmlHttpRequest.prototype.supportsSynch = function () {
        return true;
    };
    /**
     * Special XHR function: Preload the given file into the index.
     * @param [String] path
     * @param [BrowserFS.Buffer] buffer
     */
    XmlHttpRequest.prototype.preloadFile = function (path, buffer) {
        var inode = this._index.getInode(path);
        if (file_index_1.isFileInode(inode)) {
            if (inode === null) {
                throw api_error_1.ApiError.ENOENT(path);
            }
            var stats = inode.getData();
            stats.size = buffer.length;
            stats.fileData = buffer;
        }
        else {
            throw api_error_1.ApiError.EISDIR(path);
        }
    };
    XmlHttpRequest.prototype.stat = function (path, isLstat, cb) {
        var inode = this._index.getInode(path);
        if (inode === null) {
            return cb(api_error_1.ApiError.ENOENT(path));
        }
        var stats;
        if (file_index_1.isFileInode(inode)) {
            stats = inode.getData();
            // At this point, a non-opened file will still have default stats from the listing.
            if (stats.size < 0) {
                this._requestFileSizeAsync(path, function (e, size) {
                    if (e) {
                        return cb(e);
                    }
                    stats.size = size;
                    cb(null, stats.clone());
                });
            }
            else {
                cb(null, stats.clone());
            }
        }
        else if (file_index_1.isDirInode(inode)) {
            stats = inode.getStats();
            cb(null, stats);
        }
        else {
            cb(api_error_1.ApiError.FileError(api_error_1.ErrorCode.EINVAL, path));
        }
    };
    XmlHttpRequest.prototype.statSync = function (path, isLstat) {
        var inode = this._index.getInode(path);
        if (inode === null) {
            throw api_error_1.ApiError.ENOENT(path);
        }
        var stats;
        if (file_index_1.isFileInode(inode)) {
            stats = inode.getData();
            // At this point, a non-opened file will still have default stats from the listing.
            if (stats.size < 0) {
                stats.size = this._requestFileSizeSync(path);
            }
        }
        else if (file_index_1.isDirInode(inode)) {
            stats = inode.getStats();
        }
        else {
            throw api_error_1.ApiError.FileError(api_error_1.ErrorCode.EINVAL, path);
        }
        return stats;
    };
    XmlHttpRequest.prototype.open = function (path, flags, mode, cb) {
        // INVARIANT: You can't write to files on this file system.
        if (flags.isWriteable()) {
            return cb(new api_error_1.ApiError(api_error_1.ErrorCode.EPERM, path));
        }
        var _this = this;
        // Check if the path exists, and is a file.
        var inode = this._index.getInode(path);
        if (inode === null) {
            return cb(api_error_1.ApiError.ENOENT(path));
        }
        if (file_index_1.isFileInode(inode)) {
            var stats_1 = inode.getData();
            switch (flags.pathExistsAction()) {
                case file_flag_1.ActionType.THROW_EXCEPTION:
                case file_flag_1.ActionType.TRUNCATE_FILE:
                    return cb(api_error_1.ApiError.EEXIST(path));
                case file_flag_1.ActionType.NOP:
                    // Use existing file contents.
                    // XXX: Uh, this maintains the previously-used flag.
                    if (stats_1.fileData) {
                        return cb(null, new preload_file_1.NoSyncFile(_this, path, flags, stats_1.clone(), stats_1.fileData));
                    }
                    // @todo be lazier about actually requesting the file
                    this._requestFileAsync(path, 'buffer', function (err, buffer) {
                        if (err) {
                            return cb(err);
                        }
                        // we don't initially have file sizes
                        stats_1.size = buffer.length;
                        stats_1.fileData = buffer;
                        return cb(null, new preload_file_1.NoSyncFile(_this, path, flags, stats_1.clone(), buffer));
                    });
                    break;
                default:
                    return cb(new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL, 'Invalid FileMode object.'));
            }
        }
        else {
            return cb(api_error_1.ApiError.EISDIR(path));
        }
    };
    XmlHttpRequest.prototype.openSync = function (path, flags, mode) {
        // INVARIANT: You can't write to files on this file system.
        if (flags.isWriteable()) {
            throw new api_error_1.ApiError(api_error_1.ErrorCode.EPERM, path);
        }
        // Check if the path exists, and is a file.
        var inode = this._index.getInode(path);
        if (inode === null) {
            throw api_error_1.ApiError.ENOENT(path);
        }
        if (file_index_1.isFileInode(inode)) {
            var stats = inode.getData();
            switch (flags.pathExistsAction()) {
                case file_flag_1.ActionType.THROW_EXCEPTION:
                case file_flag_1.ActionType.TRUNCATE_FILE:
                    throw api_error_1.ApiError.EEXIST(path);
                case file_flag_1.ActionType.NOP:
                    // Use existing file contents.
                    // XXX: Uh, this maintains the previously-used flag.
                    if (stats.fileData) {
                        return new preload_file_1.NoSyncFile(this, path, flags, stats.clone(), stats.fileData);
                    }
                    // @todo be lazier about actually requesting the file
                    var buffer = this._requestFileSync(path, 'buffer');
                    // we don't initially have file sizes
                    stats.size = buffer.length;
                    stats.fileData = buffer;
                    return new preload_file_1.NoSyncFile(this, path, flags, stats.clone(), buffer);
                default:
                    throw new api_error_1.ApiError(api_error_1.ErrorCode.EINVAL, 'Invalid FileMode object.');
            }
        }
        else {
            throw api_error_1.ApiError.EISDIR(path);
        }
    };
    XmlHttpRequest.prototype.readdir = function (path, cb) {
        try {
            cb(null, this.readdirSync(path));
        }
        catch (e) {
            cb(e);
        }
    };
    XmlHttpRequest.prototype.readdirSync = function (path) {
        // Check if it exists.
        var inode = this._index.getInode(path);
        if (inode === null) {
            throw api_error_1.ApiError.ENOENT(path);
        }
        else if (file_index_1.isDirInode(inode)) {
            return inode.getListing();
        }
        else {
            throw api_error_1.ApiError.ENOTDIR(path);
        }
    };
    /**
     * We have the entire file as a buffer; optimize readFile.
     */
    XmlHttpRequest.prototype.readFile = function (fname, encoding, flag, cb) {
        // Wrap cb in file closing code.
        var oldCb = cb;
        // Get file.
        this.open(fname, flag, 0x1a4, function (err, fd) {
            if (err) {
                return cb(err);
            }
            cb = function (err, arg) {
                fd.close(function (err2) {
                    if (!err) {
                        err = err2;
                    }
                    return oldCb(err, arg);
                });
            };
            var fdCast = fd;
            var fdBuff = fdCast.getBuffer();
            if (encoding === null) {
                cb(err, util_1.copyingSlice(fdBuff));
            }
            else {
                tryToString(fdBuff, encoding, cb);
            }
        });
    };
    /**
     * Specially-optimized readfile.
     */
    XmlHttpRequest.prototype.readFileSync = function (fname, encoding, flag) {
        // Get file.
        var fd = this.openSync(fname, flag, 0x1a4);
        try {
            var fdCast = fd;
            var fdBuff = fdCast.getBuffer();
            if (encoding === null) {
                return util_1.copyingSlice(fdBuff);
            }
            return fdBuff.toString(encoding);
        }
        finally {
            fd.closeSync();
        }
    };
    XmlHttpRequest.prototype.getXhrPath = function (filePath) {
        if (filePath.charAt(0) === '/') {
            filePath = filePath.slice(1);
        }
        return this.prefixUrl + filePath;
    };
    XmlHttpRequest.prototype._requestFileAsync = function (p, type, cb) {
        xhr_1.asyncDownloadFile(this.getXhrPath(p), type, cb);
    };
    XmlHttpRequest.prototype._requestFileSync = function (p, type) {
        return xhr_1.syncDownloadFile(this.getXhrPath(p), type);
    };
    return XmlHttpRequest;
}(file_system_1.BaseFileSystem));
exports.__esModule = true;
exports["default"] = XmlHttpRequest;
//# sourceMappingURL=XmlHttpRequest.js.map