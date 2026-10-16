type Listener = (data?: any) => void;

const listeners = new Map<string, Set<Listener>>();

export const bus = {
  on(event: string, listener: Listener): () => void {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  },
  emit(event: string, data?: any): void {
    listeners.get(event)?.forEach((listener) => listener(data));
  },
};
