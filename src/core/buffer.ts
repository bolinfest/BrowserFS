/**
 * Buffer module. Exports an appropriate version of Buffer for the current
 * platform.
 */
import buffer_core = require('./buffer_core');
import buffer_core_array = require('./buffer_core_array');
import buffer_core_arraybuffer = require('./buffer_core_arraybuffer');
import buffer_core_imagedata = require('./buffer_core_imagedata');
import string_util = require('./string_util');

// BC implementations earlier in the array are preferred.
var BufferCorePreferences: buffer_core.BufferCoreImplementation[] = [
  buffer_core_arraybuffer.BufferCoreArrayBuffer,
  buffer_core_imagedata.BufferCoreImageData,
  buffer_core_array.BufferCoreArray
];

var PreferredBufferCore: buffer_core.BufferCoreImplementation = (function(): buffer_core.BufferCoreImplementation {
  var i: number, bci: buffer_core.BufferCoreImplementation;
  for (i = 0; i < BufferCorePreferences.length; i++) {
    bci = BufferCorePreferences[i];
    if (bci.isAvailable()) return bci;
  }
  // Should never happen; Array works in all browsers.
  throw new Error("This browser does not support any available BufferCore implementations.");
})();

/**
 * We extend Node's buffer interface to account for differences in the browser
 * environment.
 */
export interface BFSBuffer extends NodeBuffer {
  // It's not tractable to emulate array indexing by defining numeric properties
  // for each index of the buffer, so we have getters/setters.
  get(index: number): number;
  set(index: number, value: number): void;
  // Used by backends to get the backing data.
  getBufferCore(): buffer_core.BufferCore;
  // Used by backends in conjunction with getBufferCore() and the length
  // property to determine which segment of the backing memory is applicable
  // for a given operation.
  getOffset(): number;
  // Like Buffer.slice, but copies the Buffer contents.
  sliceCopy(start?: number, end?: number): NodeBuffer
}

/**
 * Superset of the Buffer singleton described in node.d.ts.
 */
export interface BFSBufferImplementation {
  new (ab: ArrayBuffer): NodeBuffer;
  new (str: string, encoding?: string): NodeBuffer;
  new (size: number): NodeBuffer;
  new (array: any[]): NodeBuffer;
  isBuffer(obj: any): boolean;
  byteLength(string: string, encoding?: string): number;
  concat(list: NodeBuffer[], totalLength?: number): NodeBuffer;
}

/**
 * Emulates Node's Buffer API. Wraps a BufferCore object that is responsible
 * for actually writing/reading data from some data representation in memory.
 */
export class Buffer implements BFSBuffer {
  // Note: This array property is *not* true, but it's required to satisfy
  //       TypeScript typings.
  [idx: number]: number;
  private data: buffer_core.BufferCore;
  private offset: number = 0;
  public length: number;

  /**
   * Constructs a buffer.
   * @param {(number|DataView|ArrayBuffer|Buffer|string)} arg1 - Instantiate a buffer of the indicated size, or
   *   from the indicated Array or String.
   * @param {string} [arg2=utf8] - Encoding to use if arg1 is a string
   */
  constructor (size: number);
  constructor (data: any[]);
  constructor (data: DataView);
  constructor (data: ArrayBuffer);
  constructor (data: NodeBuffer);
  constructor (data: string, encoding?: string);
  constructor (data: buffer_core.BufferCore, start?: number, end?: number);
  constructor (arg1: any, arg2: any = 'utf8', arg3?: number) {
    var i: number;
    // Node apparently allows you to construct buffers w/o 'new'.
    if (!(this instanceof Buffer)) {
      return new Buffer(arg1, arg2);
    }

    if (arg1 instanceof buffer_core.BufferCoreCommon) {
      // constructor (data: buffer_core.BufferCore, start?: number, end?: number)
      this.data = <buffer_core.BufferCore> arg1;
      var start = typeof arg2 === 'number' ? <number><any> arg2 : 0;
      var end = typeof arg3 === 'number' ? <number> arg3 : this.data.getLength();
      this.offset = start;
      this.length = end - start;
    } else if (typeof arg1 === 'number') {
      // constructor (size: number);
      if (arg1 !== (arg1 >>> 0)) {
        throw new TypeError('Buffer size must be a uint32.');
      }
      this.length = arg1;
      this.data = new PreferredBufferCore(arg1);
    } else if (typeof DataView !== 'undefined' && arg1 instanceof DataView) {
      // constructor (data: DataView);
      this.data = new buffer_core_arraybuffer.BufferCoreArrayBuffer(<DataView> arg1);
      this.length = arg1.byteLength;
    } else if (typeof ArrayBuffer !== 'undefined' && typeof arg1.byteLength === 'number') {
      // constructor (data: ArrayBuffer);
      // Note: Can't do 'instanceof ArrayBuffer' in Safari in some cases. :|
      this.data = new buffer_core_arraybuffer.BufferCoreArrayBuffer(<ArrayBuffer> arg1);
      this.length = arg1.byteLength;
    } else if (arg1 instanceof Buffer) {
      // constructor (data: Buffer);
      var argBuff = <Buffer> arg1;
      this.data = new PreferredBufferCore(arg1.length);
      this.length = arg1.length;
      argBuff.copy(this);
    } else if (Array.isArray(arg1) || (arg1 != null && typeof arg1 === 'object' && typeof arg1[0] === 'number')) {
      // constructor (data: number[]);
      this.data = new PreferredBufferCore(arg1.length);
      for (i = 0; i < arg1.length; i++) {
        this.data.writeUInt8(i, arg1[i]);
      }
      this.length = arg1.length;
    } else if (typeof arg1 === 'string') {
      // constructor (data: string, encoding?: string);
      this.length = Buffer.byteLength(arg1, arg2);
      this.data = new PreferredBufferCore(this.length);
      this.write(arg1, 0, this.length, arg2);
    } else {
      throw new Error("Invalid argument to Buffer constructor: " + arg1);
    }
  }

  /* TEST METHODS BEGIN */

  public static getAvailableBufferCores(): buffer_core.BufferCoreImplementation[] {
    return BufferCorePreferences.filter((bci) => bci.isAvailable());
  }

  public static getPreferredBufferCore(): buffer_core.BufferCoreImplementation {
    return PreferredBufferCore;
  }

  public static setPreferredBufferCore(bci: buffer_core.BufferCoreImplementation) {
    PreferredBufferCore = bci;
  }

  /* TEST METHODS END */

  public getBufferCore(): buffer_core.BufferCore {
    return this.data;
  }

  public getOffset(): number {
    return this.offset;
  }

  /**
   * **NONSTANDARD**: Set the octet at index. Emulates NodeJS buffer's index
   * operation. Octet can be signed or unsigned.
   * @param {number} index - the index to set the value at
   * @param {number} value - the value to set at the given index
   */
  public set(index: number, value: number): void {
    // In Node, the following happens:
    // buffer[0] = -1;
    // buffer[0]; // 255
    if (value < 0) {
      return this.writeInt8(value, index);
    } else {
      return this.writeUInt8(value, index);
    }
  }

  /**
   * **NONSTANDARD**: Get the octet at index.
   * @param {number} index - index to fetch the value at
   * @return {number} the value at the given index
   */
  public get(index: number): number {
    return this.readUInt8(index);
  }

  /**
   * Writes string to the buffer at offset using the given encoding.
   * If buffer did not contain enough space to fit the entire string, it will
   * write a partial amount of the string.
   * @param {string} str - Data to be written to buffer
   * @param {number} [offset=0] - Offset in the buffer to write to
   * @param {number} [length=this.length] - Number of bytes to write
   * @param {string} [encoding=utf8] - Character encoding
   * @return {number} Number of octets written.
   */
  public write(str: string, offset = 0, length = this.length, encoding = 'utf8'): number {
    // I hate Node's optional arguments.
    if (typeof offset === 'string') {
      // 'str' and 'encoding' specified
      encoding = "" + offset;
      offset = 0;
      length = this.length;
    } else if (typeof length === 'string') {
      // 'str', 'offset', and 'encoding' specified
      encoding = "" + length;
      length = this.length;
    }
    // Check for invalid offsets.
    if (offset > this.length || offset < 0) {
      throw new RangeError("Invalid offset.");
    }
    var strUtil = string_util.FindUtil(encoding);
    // Are we trying to write past the buffer?
    length = length + offset > this.length ? this.length - offset : length;
    offset += this.offset;
    return strUtil.str2byte(str,
      // Avoid creating a slice unless it's needed.
      offset === 0 && length === this.length ? this : new Buffer(this.data, offset, length + offset));
  }

  /**
   * Decodes a portion of the Buffer into a String.
   * @param {string} encoding - Character encoding to decode to
   * @param {number} [start=0] - Start position in the buffer
   * @param {number} [end=this.length] - Ending position in the buffer
   * @return {string} A string from buffer data encoded with encoding, beginning
   *   at start, and ending at end.
   */
  public toString(encoding = 'utf8', start = 0, end = this.length): string {
    if (!(start <= end)) {
      throw new Error("Invalid start/end positions: " + start + " - " + end);
    }
    if (start === end) {
      return '';
    }
    if (end > this.length) {
      end = this.length;
    }
    var strUtil = string_util.FindUtil(encoding);
    // Get the string representation of the given slice. Create a new buffer
    // if need be.
    return strUtil.byte2str(start === 0 && end === this.length ? this : new Buffer(this.data, start + this.offset, end + this.offset));
  }

  /**
   * Returns a JSON-representation of the Buffer instance, which is identical to
   * the output for JSON Arrays. JSON.stringify implicitly calls this function
   * when stringifying a Buffer instance.
   * @return {object} An object that can be used for JSON stringification.
   */
  public toJSON(): {type: string; data: number[]} {
    // Construct a byte array for the JSON 'data'.
    var len = this.length;
    var byteArr = new Array(len);
    for (var i = 0; i < len; i++) {
      byteArr[i] = this.readUInt8(i);
    }
    return {
      type: 'Buffer',
      data: byteArr
    };
  }

  /**
   * Returns a string with the first 50 hexadecimal values of the Buffer.
   */
  public inspect(): string {
    var digits: string[] = [], i: number, len = this.length < 50 ? this.length : 50;
    for (i = 0; i < len; i++) {
      digits.push(this.readUInt8(i).toString(16));
    }
    return `<Buffer ${digits.join(" ")}${this.length > 50 ? " ... " : ""}>`;
  }

  /**
   * Converts the buffer into an ArrayBuffer. Will attempt to use an underlying
   * ArrayBuffer, but will need to copy the data if the underlaying object is an
   * ArrayBufferView or not an ArrayBuffer.
   */
  public toArrayBuffer(): ArrayBuffer {
    var buffCore = this.getBufferCore();
    if (buffCore instanceof buffer_core_arraybuffer.BufferCoreArrayBuffer) {
      var dv = buffCore.getDataView(),
        ab = dv.buffer;
      if (dv.byteOffset === 0 && dv.byteLength === ab.byteLength) {
        return ab;
      } else {
        return ab.slice(dv.byteOffset, dv.byteLength);
      }
    } else {
      var ab = new ArrayBuffer(this.length),
        newBuff = new Buffer(ab);
      this.copy(newBuff, 0, 0, this.length);
      return ab;
    }
  }

  /**
   * Operates similar to Array#indexOf(). Accepts a String, Buffer or Number.
   * Strings are interpreted as UTF8. Buffers will use the entire buffer. So in order
   * to compare a partial Buffer use Buffer#slice(). Numbers can range from 0 to 255.
   */
  public indexOf(value: string | NodeBuffer | number, byteOffset: number = 0): number {
    var normalizedValue: NodeBuffer;
    if (typeof(value) === 'string') {
      normalizedValue = new Buffer(<string> value, 'utf8');
    } else if (Buffer.isBuffer(value)) {
      normalizedValue = <NodeBuffer> value;
    } else {
      normalizedValue = new Buffer(<number> value);
    }

    var valOffset = 0, currentVal: number, valLen = normalizedValue.length,
      bufLen = this.length;
    while (valOffset < valLen && byteOffset < bufLen) {
      if (normalizedValue.readUInt8(valOffset) == this.readUInt8(byteOffset)) {
        valOffset++;
      } else {
        // Doesn't match. Restart search.
        valOffset = 0;
      }
      byteOffset++;
    }

    if (valOffset == valLen) {
      return byteOffset - valLen;
    } else {
      return -1;
    }
  }

  /**
   * Does copy between buffers. The source and target regions can be overlapped.
   * All values passed that are undefined/NaN or are out of bounds are set equal
   * to their respective defaults.
   * @param {Buffer} target - Buffer to copy into
   * @param {number} [targetStart=0] - Index to start copying to in the targetBuffer
   * @param {number} [sourceStart=0] - Index in this buffer to start copying from
   * @param {number} [sourceEnd=this.length] - Index in this buffer stop copying at
   * @return {number} The number of bytes copied into the target buffer.
   */
  public copy(target: NodeBuffer, targetStart = 0, sourceStart = 0, sourceEnd = this.length): number {
    if (sourceStart < 0) {
      throw new RangeError('sourceStart out of bounds');
    }
    if (sourceEnd < 0) {
      throw new RangeError('sourceEnd out of bounds');
    }
    if (targetStart < 0) {
      throw new RangeError("targetStart out of bounds");
    }

    if (sourceEnd <= sourceStart || sourceStart >= this.length || targetStart > target.length) {
      return 0;
    }

    var bytesCopied = Math.min(sourceEnd - sourceStart, target.length - targetStart, this.length - sourceStart),
      i: number;
    // Copy as many 32-bit chunks as possible.
    // TODO: Alignment.
    for (i = 0; i < bytesCopied - 3; i += 4) {
      target.writeInt32LE(this.readInt32LE(sourceStart + i), targetStart + i);
    }
    // Copy any remaining bytes, if applicable
    for (i = bytesCopied & 0xFFFFFFFC; i < bytesCopied; i++) {
      target.writeUInt8(this.readUInt8(sourceStart + i), targetStart + i);
    }
    return bytesCopied;
  }

  /**
   * Returns a slice of this buffer.
   * @param {number} [start=0] - Index to start slicing from
   * @param {number} [end=this.length] - Index to stop slicing at
   * @return {Buffer} A new buffer which references the same
   *   memory as the old, but offset and cropped by the start (defaults to 0) and
   *   end (defaults to buffer.length) indexes. Negative indexes start from the end
   *   of the buffer.
   */
  public slice(start = 0, end = this.length): NodeBuffer {
    // Translate negative indices to positive ones.
    if (start < 0) {
      start += this.length;
      if (start < 0) {
        start = 0;
      }
    }
    if (end < 0) {
      end += this.length;
      if (end < 0) {
        end = 0;
      }
    }
    if (end > this.length) {
      end = this.length;
    }
    if (start > end) {
      start = end;
    }

    // Sanity check.
    if (start < 0 || end < 0 || start >= this.length || end > this.length) {
      throw new Error("Invalid slice indices.");
    }
    // Create a new buffer backed by the same BufferCore.
    return new Buffer(this.data, start + this.offset, end + this.offset);
  }

  /**
   * [NONSTANDARD] A copy-based version of Buffer.slice.
   */
  public sliceCopy(start: number = 0, end: number = this.length): NodeBuffer {
    // Translate negative indices to positive ones.
    if (start < 0) {
      start += this.length;
      if (start < 0) {
        start = 0;
      }
    }
    if (end < 0) {
      end += this.length;
      if (end < 0) {
        end = 0;
      }
    }
    if (end > this.length) {
      end = this.length;
    }
    if (start > end) {
      start = end;
    }

    // Sanity check.
    if (start < 0 || end < 0 || start >= this.length || end > this.length) {
      throw new Error("Invalid slice indices.");
    }

    // Copy the BufferCore.
    return new Buffer(this.data.copy(start + this.offset, end + this.offset));
  }

  /**
   * Fills the buffer with the specified value. If the offset and end are not
   * given it will fill the entire buffer.
   * @param {(string|number)} value - The value to fill the buffer with
   * @param {number} [offset=0]
   * @param {number} [end=this.length]
   */
  public fill(value: any, offset = 0, end = this.length): void {
    var i: number;
    offset = offset >> 0;
    end = end >>> 0;

    if (offset < 0 || end > this.length) {
      throw new RangeError('out of range index');
    } else if (end <= offset) {
      return;
    }

    if (typeof value !== 'string') {
      // Coerces various things to numbers. Node does this.
      value = value >>> 0;
    } else if (value.length === 1) {
      var code = value.charCodeAt(0);
      if (code < 256) {
        value = code;
      }
    }

    if (typeof value === 'number') {
      offset += this.offset;
      end += this.offset;
      this.data.fill(value, offset, end);
    } else if (value.length > 0) {
      var byteLen = Buffer.byteLength(value, 'utf8'),
        lastBulkWrite = end - byteLen;
      while (offset < lastBulkWrite) {
        this.write(value, offset, byteLen, 'utf8');
        offset += byteLen;
      }
      if (offset < end) {
        this.write(value, offset, end - offset, 'utf8');
      }
    }
  }

  public readUIntLE(offset: number, byteLength: number, noAssert = false): number {
    offset += this.offset;
    var value: number = 0;
    switch (byteLength) {
      case 1:
        return this.data.readUInt8(offset);
      case 2:
        return this.data.readUInt16LE(offset);
      case 3:
        return this.data.readUInt8(offset) | (this.data.readUInt16LE(offset + 1) << 8);
      case 4:
        return this.data.readUInt32LE(offset);
      case 6:
        // Shift right by 40 bits.
        // (Note: We shift by 23 to avoid introducing a sign bit!)
        value += (this.data.readUInt8(offset + 5) << 23) * 0x20000;
        // FALL-THRU
      case 5:
        // Shift right by 32 bits.
        value += (this.data.readUInt8(offset + 5) << 23) * 0x200;
        return value + this.data.readUInt32LE(offset);
      default:
        throw new Error(`Invalid byteLength: ${byteLength}`);
    }
  }

  public readUIntBE(offset: number, byteLength: number, noAssert = false): number {
    offset += this.offset;
    var value: number = 0;
    switch (byteLength) {
      case 1:
        return this.data.readUInt8(offset);
      case 2:
        return this.data.readUInt16BE(offset);
      case 3:
        return this.data.readUInt8(offset + 2) | (this.data.readUInt16BE(offset) << 8);
      case 4:
        return this.data.readUInt32BE(offset);
      case 6:
        // Shift right by 40 bits.
        // (Note: We shift by 23 to avoid introducing a sign bit!)
        value += (this.data.readUInt8(offset) << 23) * 0x20000;
        offset++;
        // FALL-THRU
      case 5:
        // Shift right by 32 bits.
        value += (this.data.readUInt8(offset) << 23) * 0x200;
        return value + this.data.readUInt32BE(offset + 1);
      default:
        throw new Error(`Invalid byteLength: ${byteLength}`);
    }
  }

  public readIntLE(offset: number, byteLength: number, noAssert = false): number {
    offset += this.offset;
    switch (byteLength) {
      case 1:
        return this.data.readInt8(offset);
      case 2:
        return this.data.readInt16LE(offset);
      case 3:
        return this.data.readUInt8(offset) | (this.data.readInt16LE(offset + 1) << 8);
      case 4:
        return this.data.readInt32LE(offset);
      case 6:
        // Shift right by 40 bits.
        // (Note: We shift by 23 to avoid introducing a sign bit!)
        return ((this.data.readInt8(offset + 5) << 23) * 0x20000) + this.readUIntLE(offset - this.offset, 5, noAssert);
      case 5:
        // Shift right by 32 bits.
        return ((this.data.readInt8(offset + 5) << 23) * 0x200) + this.data.readUInt32LE(offset);
      default:
        throw new Error(`Invalid byteLength: ${byteLength}`);
    }
  }

  public readIntBE(offset: number, byteLength: number, noAssert = false): number {
    offset += this.offset;
    switch (byteLength) {
      case 1:
        return this.data.readInt8(offset);
      case 2:
        return this.data.readInt16BE(offset);
      case 3:
        return this.data.readUInt8(offset + 2) | (this.data.readInt16BE(offset) << 8);
      case 4:
        return this.data.readInt32BE(offset);
      case 6:
        // Shift right by 40 bits.
        // (Note: We shift by 23 to avoid introducing a sign bit!)
        return ((this.data.readInt8(offset) << 23) * 0x20000) + this.readUIntBE(offset - this.offset + 1, 5, noAssert);
      case 5:
        // Shift right by 32 bits.
        return ((this.data.readInt8(offset) << 23) * 0x200) + this.data.readUInt32BE(offset + 1);
      default:
        throw new Error(`Invalid byteLength: ${byteLength}`);
    }
  }

  public readUInt8(offset: number, noAssert = false): number {
    offset += this.offset;
    return this.data.readUInt8(offset);
  }

  public readUInt16LE(offset: number, noAssert = false): number {
    offset += this.offset;
    return this.data.readUInt16LE(offset);
  }

  public readUInt16BE(offset: number, noAssert = false): number {
    offset += this.offset;
    return this.data.readUInt16BE(offset);
  }

  public readUInt32LE(offset: number, noAssert = false): number {
    offset += this.offset;
    return this.data.readUInt32LE(offset);
  }

  public readUInt32BE(offset: number, noAssert = false): number {
    offset += this.offset;
    return this.data.readUInt32BE(offset);
  }

  public readInt8(offset: number, noAssert = false): number {
    offset += this.offset;
    return this.data.readInt8(offset);
  }

  public readInt16LE(offset: number, noAssert = false): number {
    offset += this.offset;
    return this.data.readInt16LE(offset);
  }

  public readInt16BE(offset: number, noAssert = false): number {
    offset += this.offset;
    return this.data.readInt16BE(offset);
  }

  public readInt32LE(offset: number, noAssert = false): number {
    offset += this.offset;
    return this.data.readInt32LE(offset);
  }

  public readInt32BE(offset: number, noAssert = false): number {
    offset += this.offset;
    return this.data.readInt32BE(offset);
  }

  public readFloatLE(offset: number, noAssert = false): number {
    offset += this.offset;
    return this.data.readFloatLE(offset);
  }

  public readFloatBE(offset: number, noAssert = false): number {
    offset += this.offset;
    return this.data.readFloatBE(offset);
  }

  public readDoubleLE(offset: number, noAssert = false): number {
    offset += this.offset;
    return this.data.readDoubleLE(offset);
  }

  public readDoubleBE(offset: number, noAssert = false): number {
    offset += this.offset;
    return this.data.readDoubleBE(offset);
  }

  public writeUIntLE(value: number, offset: number, byteLength: number, noAssert = false): number {
    var rv = offset + byteLength;
    offset += this.offset;
    switch (byteLength) {
      case 1:
        this.data.writeUInt8(value, offset);
        break;
      case 2:
        this.data.writeUInt16LE(value, offset);
        break;
      case 3:
        this.data.writeUInt8(value & 0xFF, offset);
        this.data.writeUInt16LE(value >> 8, offset + 1);
        break;
      case 4:
        this.data.writeUInt32LE(value, offset);
        break;
      case 6:
        this.data.writeUInt8(value & 0xFF, offset);
        // "Bit shift", since we're over 32-bits.
        value = Math.floor(value / 256);
        offset++;
        // FALL-THRU
      case 5:
        this.data.writeUInt8(value & 0xFF, offset);
        // "Bit shift", since we're over 32-bits.
        value = Math.floor(value / 256);
        this.data.writeUInt32LE(value, offset + 1);
        break;
      default:
        throw new Error(`Invalid byteLength: ${byteLength}`);
    }
    return rv;
  }

  public writeUIntBE(value: number, offset: number, byteLength: number, noAssert = false): number {
    var rv = offset + byteLength;
    offset += this.offset;
    switch (byteLength) {
      case 1:
        this.data.writeUInt8(value, offset);
        break;
      case 2:
        this.data.writeUInt16BE(value, offset);
        break;
      case 3:
        this.data.writeUInt8(value & 0xFF, offset + 2);
        this.data.writeUInt16BE(value >> 8, offset);
        break;
      case 4:
        this.data.writeUInt32BE(value, offset);
        break;
      case 6:
        this.data.writeUInt8(value & 0xFF, offset + 5);
        // "Bit shift", since we're over 32-bits.
        value = Math.floor(value / 256);
        // FALL-THRU
      case 5:
        this.data.writeUInt8(value & 0xFF, offset + 4);
        // "Bit shift", since we're over 32-bits.
        value = Math.floor(value / 256);
        this.data.writeUInt32BE(value, offset);
        break;
      default:
        throw new Error(`Invalid byteLength: ${byteLength}`);
    }
    return rv;
  }

  public writeIntLE(value: number, offset: number, byteLength: number, noAssert = false): number {
    var rv = offset + byteLength;
    offset += this.offset;
    switch (byteLength) {
      case 1:
        this.data.writeInt8(value, offset);
        break;
      case 2:
        this.data.writeInt16LE(value, offset);
        break;
      case 3:
        this.data.writeUInt8(value & 0xFF, offset);
        this.data.writeInt16LE(value >> 8, offset + 1);
        break;
      case 4:
        this.data.writeInt32LE(value, offset);
        break;
      case 6:
        this.data.writeUInt8(value & 0xFF, offset);
        // "Bit shift", since we're over 32-bits.
        value = Math.floor(value / 256);
        offset++;
        // FALL-THRU
      case 5:
        this.data.writeUInt8(value & 0xFF, offset);
        // "Bit shift", since we're over 32-bits.
        value = Math.floor(value / 256);
        this.data.writeInt32LE(value, offset + 1);
        break;
      default:
        throw new Error(`Invalid byteLength: ${byteLength}`);
    }
    return rv;
  }

  public writeIntBE(value: number, offset: number, byteLength: number, noAssert = false): number {
    var rv = offset + byteLength;
    offset += this.offset;
    switch (byteLength) {
      case 1:
        this.data.writeInt8(value, offset);
        break;
      case 2:
        this.data.writeInt16BE(value, offset);
        break;
      case 3:
        this.data.writeUInt8(value & 0xFF, offset + 2);
        this.data.writeInt16BE(value >> 8, offset);
        break;
      case 4:
        this.data.writeInt32BE(value, offset);
        break;
      case 6:
        this.data.writeUInt8(value & 0xFF, offset + 5);
        // "Bit shift", since we're over 32-bits.
        value = Math.floor(value / 256);
        // FALL-THRU
      case 5:
        this.data.writeUInt8(value & 0xFF, offset + 4);
        // "Bit shift", since we're over 32-bits.
        value = Math.floor(value / 256);
        this.data.writeInt32BE(value, offset);
        break;
      default:
        throw new Error(`Invalid byteLength: ${byteLength}`);
    }
    return rv;
  }

  public writeUInt8(value: number, offset: number, noAssert = false): void {
    offset += this.offset;
    this.data.writeUInt8(offset, value);
  }

  public writeUInt16LE(value: number, offset: number, noAssert = false): void {
    offset += this.offset;
    this.data.writeUInt16LE(offset, value);
  }

  public writeUInt16BE(value: number, offset: number, noAssert = false): void {
    offset += this.offset;
    this.data.writeUInt16BE(offset, value);
  }

  public writeUInt32LE(value: number, offset: number, noAssert = false): void {
    offset += this.offset;
    this.data.writeUInt32LE(offset, value);
  }

  public writeUInt32BE(value: number, offset: number, noAssert = false): void {
    offset += this.offset;
    this.data.writeUInt32BE(offset, value);
  }

  public writeInt8(value: number, offset: number, noAssert = false): void {
    offset += this.offset;
    this.data.writeInt8(offset, value);
  }

  public writeInt16LE(value: number, offset: number, noAssert = false): void {
    offset += this.offset;
    this.data.writeInt16LE(offset, value);
  }

  public writeInt16BE(value: number, offset: number, noAssert = false): void {
    offset += this.offset;
    this.data.writeInt16BE(offset, value);
  }

  public writeInt32LE(value: number, offset: number, noAssert = false): void {
    offset += this.offset;
    this.data.writeInt32LE(offset, value);
  }

  public writeInt32BE(value: number, offset: number, noAssert = false): void {
    offset += this.offset;
    this.data.writeInt32BE(offset, value);
  }

  public writeFloatLE(value: number, offset: number, noAssert = false): void {
    offset += this.offset;
    this.data.writeFloatLE(offset, value);
  }

  public writeFloatBE(value: number, offset: number, noAssert = false): void {
    offset += this.offset;
    this.data.writeFloatBE(offset, value);
  }

  public writeDoubleLE(value: number, offset: number, noAssert = false): void {
    offset += this.offset;
    this.data.writeDoubleLE(offset, value);
  }

  public writeDoubleBE(value: number, offset: number, noAssert = false): void {
    offset += this.offset;
    this.data.writeDoubleBE(offset, value);
  }

  ///**************************STATIC METHODS********************************///

  /**
   * Checks if enc is a valid string encoding type.
   * @param {string} enc - Name of a string encoding type.
   * @return {boolean} Whether or not enc is a valid encoding type.
   */
  public static isEncoding(enc: string): boolean {
    try {
      string_util.FindUtil(enc);
    } catch (e) {
      return false;
    }
    return true;
  }

  public static compare(a: NodeBuffer, b: NodeBuffer): number {
    if (a === b) {
      return 0;
    } else {
      var i: number,
        aLen = a.length,
        bLen = b.length,
        cmpLength = Math.min(aLen, bLen),
        u1: number, u2: number;
      for (i = 0; i < cmpLength; i++) {
        u1 = a.readUInt8(i);
        u2 = b.readUInt8(i);
        if (u1 !== u2) {
          return u1 > u2 ? 1 : -1;
        }
      }
      if (aLen === bLen) {
        return 0;
      } else {
        return aLen > bLen ? 1 : -1;
      }
    }
  }

  /**
   * Tests if obj is a Buffer.
   * @param {object} obj - An arbitrary object
   * @return {boolean} True if this object is a Buffer.
   */
  public static isBuffer(obj: any): boolean {
    return obj instanceof Buffer;
  }

  /**
   * Gives the actual byte length of a string. This is not the same as
   * String.prototype.length since that returns the number of characters in a
   * string.
   * @param {string} str - The string to get the byte length of
   * @param {string} [encoding=utf8] - Character encoding of the string
   * @return {number} The number of bytes in the string
   */
  public static byteLength(str: string, encoding: string = 'utf8'): number {
    var strUtil = string_util.FindUtil(encoding);
    if (typeof(str) !== 'string') {
      str = "" + str;
    }
    return strUtil.byteLength(str);
  }

  /**
   * Returns a buffer which is the result of concatenating all the buffers in the
   * list together.
   * If the list has no items, or if the totalLength is 0, then it returns a
   * zero-length buffer.
   * If the list has exactly one item, then the first item of the list is
   * returned.
   * If the list has more than one item, then a new Buffer is created.
   * If totalLength is not provided, it is read from the buffers in the list.
   * However, this adds an additional loop to the function, so it is faster to
   * provide the length explicitly.
   * @param {Buffer[]} list - List of Buffer objects to concat
   * @param {number} [totalLength] - Total length of the buffers when concatenated
   * @return {Buffer}
   */
  public static concat(list: NodeBuffer[], totalLength?: number): NodeBuffer {
    var item: NodeBuffer;
    if (list.length === 0 || totalLength === 0) {
      return new Buffer(0);
    } else {
      if (totalLength == null) {
        // Calculate totalLength
        totalLength = 0;
        for (var i = 0; i < list.length; i++) {
          item = list[i];
          totalLength += item.length;
        }
      }
      var buf = new Buffer(totalLength);
      var curPos = 0;
      for (var j = 0; j < list.length; j++) {
        item = list[j];
        curPos += item.copy(buf, curPos);
      }
      return buf;
    }
  }

  /**
   * Returns a boolean of whether this and otherBuffer have the same bytes.
   */
  public equals(buffer: NodeBuffer): boolean {
    var i: number;
    if (buffer.length !== this.length) {
      return false;
    } else {
      // TODO: Bigger strides.
      for (i = 0; i < this.length; i++) {
        if (this.readUInt8(i) !== buffer.readUInt8(i)) {
          return false;
        }
      }
    }
  }

  /**
   * Returns a number indicating whether this comes before or after or is
   * the same as the otherBuffer in sort order.
   */
  public compare(buffer: NodeBuffer): number {
    return Buffer.compare(this, buffer);
  }
}

// Type-check the class.
var _: BFSBufferImplementation = Buffer;
