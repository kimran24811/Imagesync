/** Single-user FIFO: avoid competing 1080p compositors exhausting RAM/GPU memory. */
export class RenderQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  get size() {
    return this.pending;
  }
  enqueue<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.pending >= 4)
      return Promise.reject(
        new Error(
          'Four renders are already active or queued. Wait or cancel one before exporting again.'
        )
      );
    this.pending++;
    const result = this.tail
      .catch(() => {})
      .then(() => {
        if (signal?.aborted) throw new Error('Render cancelled.');
        return task();
      });
    this.tail = result;
    void result
      .finally(() => {
        this.pending--;
      })
      .catch(() => {});
    return result;
  }
}
