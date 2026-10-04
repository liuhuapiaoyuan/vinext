export type DevWatchTopologyEvent = {
  filePath: string;
  kind: "add" | "unlink";
};

export type DevWatchEventCoalescer = {
  enqueue(kind: DevWatchTopologyEvent["kind"], filePath: string): void;
  flush(): void;
  dispose(): void;
};

const DEFAULT_FLUSH_DELAY_MS = 75;

/**
 * Coalesce editor save events before invalidating expensive dev-server state.
 *
 * Some editors replace a file with an unlink followed by an add. The route
 * graph only needs the final filesystem snapshot, so handling both events
 * separately needlessly repeats scans, type generation, and reloads.
 */
export function createDevWatchEventCoalescer(
  onFlush: (events: DevWatchTopologyEvent[]) => void,
  options: { delayMs?: number; normalize?: (filePath: string) => string } = {},
): DevWatchEventCoalescer {
  const normalize = options.normalize ?? ((filePath: string) => filePath);
  const pending = new Map<string, DevWatchTopologyEvent>();
  const delayMs = options.delayMs ?? DEFAULT_FLUSH_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const flush = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (pending.size === 0) return;

    const events = [...pending.values()];
    pending.clear();
    onFlush(events);
  };

  return {
    enqueue(kind, filePath) {
      if (disposed) return;
      pending.set(normalize(filePath), { filePath, kind });
      if (timer === undefined) timer = setTimeout(flush, delayMs);
    },
    flush,
    dispose() {
      disposed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      pending.clear();
    },
  };
}
