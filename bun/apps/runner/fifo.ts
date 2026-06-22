export class FIFO {
  memorySize: number;
  memoryBlock: Uint8Array;

  // These indexes are zero based indexes for where the next read or write should go
  private writeIndex: number = 0;
  private readIndex: number = 0;
  // How many bytes are in the FIFO
  length: number = 0;

  /**
   * Create a new FIFO! For all of your FIFO needs!
   * @param initialSize The initial size of the FIFO. There is currently no way to resize the buffer.
   */
  constructor(initialSize: number = 2 * 1024 ** 2) {
    this.memoryBlock = new Uint8Array(initialSize);
    this.memorySize = initialSize;
  }
  /**
   * Write some bytes to the FIFO
   * @param data The bytes to write
   */
  write(data: Uint8Array) {
    if (this.length + data.length > this.memorySize) {
      throw new Error("FIFO overflow!");
    }
    const freeTailWriteSpace = this.memorySize - this.writeIndex;
    if (data.length > freeTailWriteSpace) {
      const preRolloverChunk = data.subarray(0, freeTailWriteSpace);
      const postRolloverChunk = data.subarray(freeTailWriteSpace);

      this.memoryBlock.set(preRolloverChunk, this.writeIndex);

      this.memoryBlock.set(postRolloverChunk, 0);
      this.writeIndex = postRolloverChunk.length % this.memorySize;
    } else {
      const newWriteIndex = this.writeIndex + data.length;

      this.memoryBlock.set(data, this.writeIndex);
      this.writeIndex = newWriteIndex % this.memorySize;
    }
    this.length += data.length;
  }
  /**
   * Read some bytes from the FIFO.
   * @param bytes The number of bytes to get. This method will throw if there is not enough data to satisfy the requirement. Check the length property to find the maximum allowed number.
   * @param safe If this parameter is false, the function MAY give a subarray of the underlying memory instead of a copy, but it will not always.
   * @returns A Uint8Array with the length specified from the FIFO
   */
  read(bytes: number, safe: boolean = true): Uint8Array {
    if (bytes > this.length) {
      throw new Error("FIFO underflow!");
    }
    this.length -= bytes;
    // The new read index is exclusive
    const newReadIndex = this.readIndex + bytes;
    // > as the new read index is exclusive
    if (newReadIndex > this.memorySize) {
      const preRolloverChunk = this.memoryBlock.subarray(this.readIndex);
      const newReadIndex = bytes - preRolloverChunk.length;
      const postRolloverChunk = this.memoryBlock.subarray(0, newReadIndex);
      this.readIndex = newReadIndex % this.memorySize;
      const outputChunk = new Uint8Array(bytes);
      outputChunk.set(preRolloverChunk, 0);
      outputChunk.set(postRolloverChunk, preRolloverChunk.length);
      return outputChunk;
    } else {
      const oldReadIndex = this.readIndex;
      this.readIndex = newReadIndex % this.memorySize;
      return safe
        ? this.memoryBlock.slice(oldReadIndex, newReadIndex)
        : this.memoryBlock.subarray(oldReadIndex, newReadIndex);
    }
  }
}
