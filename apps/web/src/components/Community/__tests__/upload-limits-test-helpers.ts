/** Shared setup for the community upload limit tests: sized files and a jsdom image that loads. */
export const MB = 1024 * 1024;

/** A file that reports `size` bytes without allocating them. */
export function sizedFile(name: string, size: number, type: string): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

/** jsdom never loads images: this one "loads" as 800×600 as soon as it gets a src. */
export function installLoadingImage(): () => void {
  const realImage = window.Image;
  const realCreate = URL.createObjectURL;
  class LoadingImage {
    width = 800;
    height = 600;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      setTimeout(() => this.onload?.(), 0);
    }
  }
  (window as unknown as { Image: unknown }).Image = LoadingImage;
  URL.createObjectURL = () => 'blob:preview';
  return () => {
    window.Image = realImage;
    URL.createObjectURL = realCreate;
  };
}
