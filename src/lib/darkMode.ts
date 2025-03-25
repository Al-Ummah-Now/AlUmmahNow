"use client";
import { Observable, ObservableListner } from "./utility";

export class DarkModeStore {
  darkMode: Observable<boolean>;

  constructor() {
    const dark = localStorage.getItem("darkmode") == "true";
    this.darkMode = new Observable(dark.valueOf());
    this.darkMode.subscribe(this.saveDarkMode);
  }

  saveDarkMode(value: boolean) {
    localStorage.setItem("darkmode", value.toString());
  }

  public get() {
    return this.darkMode.get();
  }

  public set(newValue: boolean) {
    this.darkMode.set(newValue);
  }

  public subscribe(listenerFunc: ObservableListner<boolean>) {
    return this.darkMode.subscribe(listenerFunc);
  }
}

export const darkModeStore = new DarkModeStore();
