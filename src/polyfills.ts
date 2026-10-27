/* pdfjs-dist 6.x calls the TC39 upsert methods on Map/WeakMap while rendering
   pages. Those methods only exist in recent Chromium builds; on slightly older
   browsers opening a PDF fails with
   "getOrInsertComputed is not a function" before any data is read.
   Install the standard semantics here so PDF import works everywhere.
   This file is imported before React, so it runs before the PDF chunk loads. */

type UpsertStore = {
  has(key: unknown): boolean
  get(key: unknown): unknown
  set(key: unknown, value: unknown): unknown
}

function installUpsert(proto: object) {
  const store = proto as UpsertStore & Record<string, unknown>
  if (typeof store.getOrInsert !== 'function') {
    Object.defineProperty(proto, 'getOrInsert', {
      configurable: true,
      writable: true,
      value(this: UpsertStore, key: unknown, value: unknown) {
        if (!this.has(key)) this.set(key, value)
        return this.get(key)
      },
    })
  }
  if (typeof store.getOrInsertComputed !== 'function') {
    Object.defineProperty(proto, 'getOrInsertComputed', {
      configurable: true,
      writable: true,
      value(this: UpsertStore, key: unknown, compute: (key: unknown) => unknown) {
        if (!this.has(key)) this.set(key, compute(key))
        return this.get(key)
      },
    })
  }
}

installUpsert(Map.prototype)
installUpsert(WeakMap.prototype)
