import type { PersistedState } from "../types";

export type SharedStateWriteOptions = {
  keepalive?: boolean;
};

type PendingWrite = {
  state: PersistedState;
  options: SharedStateWriteOptions;
};

export function createSharedStateWriter(
  write: (state: PersistedState, options?: SharedStateWriteOptions) => Promise<void>,
  onError: () => void
) {
  let inFlight: Promise<void> | null = null;
  let pending: PendingWrite | null = null;

  const pump = () => {
    if (inFlight || !pending) return;
    const next = pending;
    pending = null;
    inFlight = write(next.state, next.options)
      .catch(() => onError())
      .finally(() => {
        inFlight = null;
        pump();
      });
  };

  return {
    enqueue(state: PersistedState) {
      pending = { state, options: {} };
      pump();
    },
    flush(state: PersistedState) {
      if (inFlight) {
        pending = null;
        void write(state, { keepalive: true }).catch(() => onError());
        return;
      }
      pending = { state, options: { keepalive: true } };
      pump();
    }
  };
}
