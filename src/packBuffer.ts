import { pack } from "msgpackr";
import { Buffer } from "buffer";

/**
 * Pack a value into a buffer using msgpackr.
 * 
 * This is necessary because of two unfortunate details of our dependencies:
 * - msgpackr: pack returns a Uint8Array in the browser, and Buffer in Node.js,
 *     and is incorrectly typed as returning Buffer.
 * - sha3: Hash functions don't work with Uint8Array.
 */
export default function packBuffer(value: unknown): Buffer {
  const packed = pack(value) as Uint8Array | Buffer;

  if (Buffer.isBuffer(packed)) {
    return packed;
  }

  return Buffer.from(packed);
}
