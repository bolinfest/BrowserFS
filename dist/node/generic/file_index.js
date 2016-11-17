var node_fs_stats_1 = require('../core/node_fs_stats');
var path = require('path');
/**
 * A simple class for storing a filesystem index. Assumes that all paths passed
 * to it are *absolute* paths.
 *
 * Can be used as a partial or a full index, although care must be taken if used
 * for the former purpose, especially when directories are concerned.
 */
var FileIndex = (function () {
    /**
     * Constructs a new FileIndex.
     */
    function FileIndex() {
        // _index is a single-level key,value store that maps *directory* paths to
        // DirInodes. File information is only contained in DirInodes themselves.
        this._index = {};
        // Create the root directory.
        this.addPath('/', new DirInode());
    }
    /**
     * Static method for constructing indices from a JSON listing.
     * @param [Object] listing Directory listing generated by tools/XHRIndexer.coffee
     * @return [BrowserFS.FileIndex] A new FileIndex object.
     */
    FileIndex.fromListing = function (listing) {
        var idx = new FileIndex();
        // Add a root DirNode.
        var rootInode = new DirInode();
        idx._index['/'] = rootInode;
        var queue = [['', listing, rootInode]];
        while (queue.length > 0) {
            var inode = void 0;
            var next = queue.pop();
            var pwd = next[0];
            var tree = next[1];
            var parent_1 = next[2];
            var node = void 0;
            for (node in tree) {
                if (tree.hasOwnProperty(node)) {
                    var children = tree[node];
                    var name_1 = pwd + "/" + node;
                    if (children) {
                        idx._index[name_1] = inode = new DirInode();
                        queue.push([name_1, children, inode]);
                    }
                    else {
                        // This inode doesn't have correct size information, noted with -1.
                        inode = new FileInode(new node_fs_stats_1["default"](node_fs_stats_1.FileType.FILE, -1, 0x16D));
                    }
                    if (parent_1) {
                        parent_1._ls[node] = inode;
                    }
                }
            }
        }
        return idx;
    };
    /**
     * Runs the given function over all files in the index.
     */
    FileIndex.prototype.fileIterator = function (cb) {
        for (var path_1 in this._index) {
            if (this._index.hasOwnProperty(path_1)) {
                var dir = this._index[path_1];
                var files = dir.getListing();
                for (var i = 0; i < files.length; i++) {
                    var item = dir.getItem(files[i]);
                    if (isFileInode(item)) {
                        cb(item.getData());
                    }
                }
            }
        }
    };
    /**
     * Adds the given absolute path to the index if it is not already in the index.
     * Creates any needed parent directories.
     * @param [String] path The path to add to the index.
     * @param [BrowserFS.FileInode | BrowserFS.DirInode] inode The inode for the
     *   path to add.
     * @return [Boolean] 'True' if it was added or already exists, 'false' if there
     *   was an issue adding it (e.g. item in path is a file, item exists but is
     *   different).
     * @todo If adding fails and implicitly creates directories, we do not clean up
     *   the new empty directories.
     */
    FileIndex.prototype.addPath = function (path, inode) {
        if (!inode) {
            throw new Error('Inode must be specified');
        }
        if (path[0] !== '/') {
            throw new Error('Path must be absolute, got: ' + path);
        }
        // Check if it already exists.
        if (this._index.hasOwnProperty(path)) {
            return this._index[path] === inode;
        }
        var splitPath = this._split_path(path);
        var dirpath = splitPath[0];
        var itemname = splitPath[1];
        // Try to add to its parent directory first.
        var parent = this._index[dirpath];
        if (parent === undefined && path !== '/') {
            // Create parent.
            parent = new DirInode();
            if (!this.addPath(dirpath, parent)) {
                return false;
            }
        }
        // Add myself to my parent.
        if (path !== '/') {
            if (!parent.addItem(itemname, inode)) {
                return false;
            }
        }
        // If I'm a directory, add myself to the index.
        if (isDirInode(inode)) {
            this._index[path] = inode;
        }
        return true;
    };
    /**
     * Adds the given absolute path to the index if it is not already in the index.
     * The path is added without special treatment (no joining of adjacent separators, etc).
     * Creates any needed parent directories.
     * @param [String] path The path to add to the index.
     * @param [BrowserFS.FileInode | BrowserFS.DirInode] inode The inode for the
     *   path to add.
     * @return [Boolean] 'True' if it was added or already exists, 'false' if there
     *   was an issue adding it (e.g. item in path is a file, item exists but is
     *   different).
     * @todo If adding fails and implicitly creates directories, we do not clean up
     *   the new empty directories.
     */
    FileIndex.prototype.addPathFast = function (path, inode) {
        var itemNameMark = path.lastIndexOf('/');
        var parentPath = itemNameMark === 0 ? "/" : path.substring(0, itemNameMark);
        var itemName = path.substring(itemNameMark + 1);
        // Try to add to its parent directory first.
        var parent = this._index[parentPath];
        if (parent === undefined) {
            // Create parent.
            parent = new DirInode();
            this.addPathFast(parentPath, parent);
        }
        if (!parent.addItem(itemName, inode)) {
            return false;
        }
        // If adding a directory, add to the index as well.
        if (inode.isDir()) {
            this._index[path] = inode;
        }
        return true;
    };
    /**
     * Removes the given path. Can be a file or a directory.
     * @return [BrowserFS.FileInode | BrowserFS.DirInode | null] The removed item,
     *   or null if it did not exist.
     */
    FileIndex.prototype.removePath = function (path) {
        var splitPath = this._split_path(path);
        var dirpath = splitPath[0];
        var itemname = splitPath[1];
        // Try to remove it from its parent directory first.
        var parent = this._index[dirpath];
        if (parent === undefined) {
            return null;
        }
        // Remove myself from my parent.
        var inode = parent.remItem(itemname);
        if (inode === null) {
            return null;
        }
        // If I'm a directory, remove myself from the index, and remove my children.
        if (isDirInode(inode)) {
            var children = inode.getListing();
            for (var i = 0; i < children.length; i++) {
                this.removePath(path + '/' + children[i]);
            }
            // Remove the directory from the index, unless it's the root.
            if (path !== '/') {
                delete this._index[path];
            }
        }
        return inode;
    };
    /**
     * Retrieves the directory listing of the given path.
     * @return [String[]] An array of files in the given path, or 'null' if it does
     *   not exist.
     */
    FileIndex.prototype.ls = function (path) {
        var item = this._index[path];
        if (item === undefined) {
            return null;
        }
        return item.getListing();
    };
    /**
     * Returns the inode of the given item.
     * @param [String] path
     * @return [BrowserFS.FileInode | BrowserFS.DirInode | null] Returns null if
     *   the item does not exist.
     */
    FileIndex.prototype.getInode = function (path) {
        var splitPath = this._split_path(path);
        var dirpath = splitPath[0];
        var itemname = splitPath[1];
        // Retrieve from its parent directory.
        var parent = this._index[dirpath];
        if (parent === undefined) {
            return null;
        }
        // Root case
        if (dirpath === path) {
            return parent;
        }
        return parent.getItem(itemname);
    };
    /**
     * Split into a (directory path, item name) pair
     */
    FileIndex.prototype._split_path = function (p) {
        var dirpath = path.dirname(p);
        var itemname = p.substr(dirpath.length + (dirpath === "/" ? 0 : 1));
        return [dirpath, itemname];
    };
    return FileIndex;
}());
exports.FileIndex = FileIndex;
/**
 * Inode for a file. Stores an arbitrary (filesystem-specific) data payload.
 */
var FileInode = (function () {
    function FileInode(data) {
        this.data = data;
    }
    FileInode.prototype.isFile = function () { return true; };
    FileInode.prototype.isDir = function () { return false; };
    FileInode.prototype.getData = function () { return this.data; };
    FileInode.prototype.setData = function (data) { this.data = data; };
    return FileInode;
}());
exports.FileInode = FileInode;
/**
 * Inode for a directory. Currently only contains the directory listing.
 */
var DirInode = (function () {
    /**
     * Constructs an inode for a directory.
     */
    function DirInode(data) {
        if (data === void 0) { data = null; }
        this.data = data;
        this._ls = {};
    }
    DirInode.prototype.isFile = function () {
        return false;
    };
    DirInode.prototype.isDir = function () {
        return true;
    };
    DirInode.prototype.getData = function () { return this.data; };
    /**
     * Return a Stats object for this inode.
     * @todo Should probably remove this at some point. This isn't the
     *       responsibility of the FileIndex.
     * @return [BrowserFS.node.fs.Stats]
     */
    DirInode.prototype.getStats = function () {
        return new node_fs_stats_1["default"](node_fs_stats_1.FileType.DIRECTORY, 4096, 0x16D);
    };
    /**
     * Returns the directory listing for this directory. Paths in the directory are
     * relative to the directory's path.
     * @return [String[]] The directory listing for this directory.
     */
    DirInode.prototype.getListing = function () {
        return Object.keys(this._ls);
    };
    /**
     * Returns the inode for the indicated item, or null if it does not exist.
     * @param [String] p Name of item in this directory.
     * @return [BrowserFS.FileInode | BrowserFS.DirInode | null]
     */
    DirInode.prototype.getItem = function (p) {
        var item = this._ls[p];
        return item ? item : null;
    };
    /**
     * Add the given item to the directory listing. Note that the given inode is
     * not copied, and will be mutated by the DirInode if it is a DirInode.
     * @param [String] p Item name to add to the directory listing.
     * @param [BrowserFS.FileInode | BrowserFS.DirInode] inode The inode for the
     *   item to add to the directory inode.
     * @return [Boolean] True if it was added, false if it already existed.
     */
    DirInode.prototype.addItem = function (p, inode) {
        if (p in this._ls) {
            return false;
        }
        this._ls[p] = inode;
        return true;
    };
    /**
     * Removes the given item from the directory listing.
     * @param [String] p Name of item to remove from the directory listing.
     * @return [BrowserFS.FileInode | BrowserFS.DirInode | null] Returns the item
     *   removed, or null if the item did not exist.
     */
    DirInode.prototype.remItem = function (p) {
        var item = this._ls[p];
        if (item === undefined) {
            return null;
        }
        delete this._ls[p];
        return item;
    };
    return DirInode;
}());
exports.DirInode = DirInode;
function isFileInode(inode) {
    return inode && inode.isFile();
}
exports.isFileInode = isFileInode;
function isDirInode(inode) {
    return inode && inode.isDir();
}
exports.isDirInode = isDirInode;
//# sourceMappingURL=file_index.js.map