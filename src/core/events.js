/** Minimal pub/sub used to keep systems from importing each other directly. */
export class Emitter {
  constructor() {
    this._map = new Map();
  }

  on(type, fn) {
    if (!this._map.has(type)) this._map.set(type, new Set());
    this._map.get(type).add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off(type, fn) {
    this._map.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this._map.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] handler for "${type}" threw`, err);
      }
    }
  }
}

export const bus = new Emitter();
