// Tiny event-emitter store for page-scoped state.
//
// Usage:
//   import { createStore } from "./store.js";
//   const store = createStore({ profile: null });
//   store.on("profile", (next) => render(next));
//   store.set("profile", data);
//   const current = store.get("profile");

export function createStore(initial = {}) {
  const state = { ...initial };
  const listeners = new Map();   // key -> Set<fn>

  function on(key, fn) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
    return () => listeners.get(key).delete(fn);
  }

  function emit(key, value) {
    const fns = listeners.get(key);
    if (!fns) return;
    for (const fn of fns) {
      try { fn(value); } catch (err) { console.error("[store] listener threw", err); }
    }
  }

  function get(key) { return state[key]; }

  function set(key, value) {
    state[key] = value;
    emit(key, value);
  }

  function update(key, fn) {
    const next = fn(state[key]);
    state[key] = next;
    emit(key, next);
    return next;
  }

  return { on, get, set, update };
}
