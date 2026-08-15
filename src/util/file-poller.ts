/**
 * Interval-based change detection for a fixed set of files, as a fallback
 * for hosts where file-system watchers are not dependable.
 */
import * as fs from "fs";

/**
 * Periodic fallback for file-system watchers: samples each watched file's
 * `size:mtimeMs` signature on an interval and reports when any signature
 * moved since the last sample. Complements VS Code watchers, which are not
 * reliable for every transition on paths outside the open workspace folders.
 */
export class FilePoller {
  private _timer: ReturnType<typeof setInterval> | undefined;
  private _paths: ReadonlyArray<string> = [];
  private _states = new Map<string, string>();

  constructor(
    private readonly _intervalMs: number,
    private readonly _onChange: () => void
  ) {}

  /**
   * Starts (or restarts) polling `paths`, taking a fresh signature baseline.
   * An empty list stops polling.
   */
  start(paths: ReadonlyArray<string>): void {
    this._stop();
    this._paths = [...paths];
    this._states = this._capture();
    if (this._paths.length === 0) {
      return;
    }
    this._timer = setInterval(() => this._poll(), this._intervalMs);
  }

  /**
   * Re-baselines the signatures without reporting a change. Call after a
   * reload has already observed the current file contents, so the next tick
   * does not re-report them.
   */
  resync(): void {
    this._states = this._capture();
  }

  dispose(): void {
    this._stop();
    this._paths = [];
    this._states.clear();
  }

  private _stop(): void {
    if (this._timer !== undefined) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
  }

  private _poll(): void {
    const next = this._capture();
    const changed = this._paths.some((p) => this._states.get(p) !== next.get(p));
    if (!changed) {
      return;
    }
    this._states = next;
    this._onChange();
  }

  private _capture(): Map<string, string> {
    return new Map(this._paths.map((p) => [p, fileSignature(p)]));
  }
}

function fileSignature(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? `${stat.size}:${stat.mtimeMs}` : "missing";
  } catch {
    return "missing";
  }
}
