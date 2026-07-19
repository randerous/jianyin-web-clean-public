export type SharedStateWriteOptions = {
  keepalive?: boolean;
};

type PendingWrite<T> = {
  state: T;
  options: SharedStateWriteOptions;
};

export function createSharedStateWriter<T>(
  write: (state: T, options?: SharedStateWriteOptions) => Promise<void>,
  onError: (error: unknown, state: T, options: SharedStateWriteOptions) => void
) {
  let inFlight: Promise<void> | null = null;
  let active: PendingWrite<T> | null = null;
  let pending: PendingWrite<T> | null = null;

  const pump = () => {
    if (inFlight || !pending) return;
    const next = pending;
    pending = null;
    active = next;
    inFlight = write(next.state, next.options)
      .catch((error) => onError(error, next.state, next.options))
      .finally(() => {
        inFlight = null;
        active = null;
        pump();
      });
  };

  return {
    enqueue(state: T) {
      pending = { state, options: {} };
      pump();
    },
    flush(state: T) {
      if (inFlight) {
        if (active?.state === state) return;
        pending = { state, options: { keepalive: true } };
        return;
      }
      pending = { state, options: { keepalive: true } };
      pump();
    }
  };
}
