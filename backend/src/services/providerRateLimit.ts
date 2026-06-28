/** Serializes provider calls and deduplicates identical in-flight requests. */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ProviderGate {
  private lastAt = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly minIntervalMs: number) {}

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = this.chain
      .catch(() => undefined)
      .then(async () => {
        const wait = this.minIntervalMs - (Date.now() - this.lastAt);
        if (wait > 0) await sleep(wait);
        this.lastAt = Date.now();
        return fn();
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.chain = promise;
    this.inFlight.set(key, promise);
    return promise as Promise<T>;
  }
}

/** Nominatim public policy: max 1 request per second. */
export const nominatimGate = new ProviderGate(1000);

/** Conservative spacing for the public Photon demo service. */
export const photonGate = new ProviderGate(250);
