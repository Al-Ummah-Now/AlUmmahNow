"use client";
export function assertIsNode(e: EventTarget | null): asserts e is Node {
  if (!e || !("nodeType" in e)) {
    throw new Error(`Node expected`);
  }
}

export type ObservableListner<T> = (target: T) => void;

export class Observable<T> {
  listeners: Array<ObservableListner<T>> = []; // initial listeners can be passed an an argument aswell
  value: T;

  constructor(target: T) {
    this.value = target;
  }

  public get() {
    return this.value;
  }

  public set(newValue: T) {
    if (this.value === newValue) return;
    this.value = newValue;
    this.listeners.forEach((l) => l(this.value));
  }

  public subscribe(listenerFunc: ObservableListner<T>) {
    this.listeners.push(listenerFunc);
    return () => this.unsubscribe(listenerFunc); // will be used inside React.useEffect
  }

  public unsubscribe(listenerFunc: ObservableListner<T>) {
    this.listeners = this.listeners.filter((l) => l !== listenerFunc);
  }
}
