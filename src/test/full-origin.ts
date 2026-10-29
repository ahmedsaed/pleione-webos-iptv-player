import { vi } from 'vitest';

// Models a full IndexedDB origin as Chromium enforces it: any put aborts its
// transaction with QuotaExceededError, and room comes back only once a
// transaction that deletes from one of `freedBy` commits.
export function fillOrigin(freedBy: readonly string[]): {
  readonly full: boolean;
  restore(): void;
} {
  const state = { full: true };
  const realPut = IDBObjectStore.prototype.put;
  const realDelete = IDBObjectStore.prototype.delete;
  const realClear = IDBObjectStore.prototype.clear;
  const freeOnCommit = (store: IDBObjectStore) => {
    if (state.full && freedBy.indexOf(store.name) >= 0) {
      store.transaction.addEventListener('complete', () => { state.full = false; });
    }
  };
  const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(
    function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (state.full) {
        this.transaction.abort();
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      return realPut.apply(this, args);
    },
  );
  const del = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(
    function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['delete']>) {
      freeOnCommit(this);
      return realDelete.apply(this, args);
    },
  );
  const clear = vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(
    function (this: IDBObjectStore) {
      freeOnCommit(this);
      return realClear.apply(this);
    },
  );
  return {
    get full() { return state.full; },
    restore() {
      put.mockRestore();
      del.mockRestore();
      clear.mockRestore();
    },
  };
}
