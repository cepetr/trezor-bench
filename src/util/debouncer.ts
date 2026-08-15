/**
 * Trailing-edge debouncer: `schedule()` (re)starts the delay, and the
 * callback runs once the delay elapses without another `schedule()` call.
 * `dispose()` cancels any pending run.
 */
export class Debouncer {
  private _timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly _delayMs: number,
    private readonly _callback: () => void
  ) {}

  schedule(): void {
    if (this._timer !== undefined) {
      clearTimeout(this._timer);
    }
    this._timer = setTimeout(() => {
      this._timer = undefined;
      this._callback();
    }, this._delayMs);
  }

  dispose(): void {
    if (this._timer !== undefined) {
      clearTimeout(this._timer);
      this._timer = undefined;
    }
  }
}
