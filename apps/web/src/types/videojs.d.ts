import videojs from 'video.js';

declare module 'video.js' {
  export interface HlsQualitySelectorOptions {
    displayCurrentQuality?: boolean;
    vjsIconClass?: string;
  }

  export type VideoJsEventCallback = (event?: Event) => void;

  export interface Player {
    hlsQualitySelector?: (options?: HlsQualitySelectorOptions) => void;
    pictureInPictureEnabled?: boolean;
    requestPictureInPicture?: () => Promise<void>;
    isDisposed(): boolean;
    dispose(): void;
    play(): Promise<void>;
    pause(): void;
    paused(): boolean;
    currentTime(): number;
    currentTime(seconds: number): void;
    duration(): number;
    volume(): number;
    volume(percentAsDecimal: number): void;
    muted(): boolean;
    muted(muted: boolean): void;
    src(source: string | Array<{ src: string; type: string }>): void;
    poster(url: string): void;
    on(event: string, callback: VideoJsEventCallback): void;
    off(event: string, callback?: VideoJsEventCallback): void;
    one(event: string, callback: VideoJsEventCallback): void;
    ready(callback: () => void): void;
  }

  export interface PlayerOptions {
    controls?: boolean;
    autoplay?: boolean | string;
    preload?: string;
    width?: number;
    height?: number;
    loop?: boolean;
    muted?: boolean;
    poster?: string;
    sources?: Array<{
      src: string;
      type: string;
    }>;
    responsive?: boolean;
    fluid?: boolean;
    playbackRates?: number[];
    html5?: {
      hls?: {
        enableLowInitialPlaylist?: boolean;
        smoothQualityChange?: boolean;
        overrideNative?: boolean;
      };
    };
    [key: string]: any;
  }

  export default function videojs(
    element: Element | string,
    options?: PlayerOptions,
    ready?: () => void
  ): Player;
}
