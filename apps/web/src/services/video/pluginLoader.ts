import videojs from 'video.js';

interface VideoJSPlugin {
  (player: any, options?: any): void;
}

interface PluginLoaderOptions {
  timeout?: number;
  retries?: number;
}

const pluginRegistry = {
  'http-streaming': () => import('@videojs/http-streaming'),
  'quality-levels': () => import('videojs-contrib-quality-levels'),
  'hls-quality-selector': () => import('videojs-hls-quality-selector'),
  'sprite-thumbnails': () => import('videojs-sprite-thumbnails')
};

const loadedPlugins = new Map<string, any>();

export async function loadPlugin(
  pluginName: keyof typeof pluginRegistry,
  options: PluginLoaderOptions = {}
): Promise<VideoJSPlugin | null> {
  const { timeout = 5000, retries = 2 } = options;

  if (loadedPlugins.has(pluginName)) {
    return loadedPlugins.get(pluginName);
  }

  if (videojs.getPlugin?.(pluginName)) {
    const plugin = videojs.getPlugin(pluginName);
    if (plugin && typeof plugin === 'function') {
      loadedPlugins.set(pluginName, plugin as VideoJSPlugin);
      return plugin as VideoJSPlugin;
    }
  }

  const pluginLoader = pluginRegistry[pluginName];
  if (!pluginLoader) {
    console.warn(`Plugin ${pluginName} not found in registry`);
    return null;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Plugin load timeout: ${pluginName}`)), timeout);
      });

      const pluginPromise = pluginLoader();
      const moduleImport = await Promise.race([pluginPromise, timeoutPromise]) as any;

      let plugin: VideoJSPlugin;
      if (moduleImport.default?.default) {
        plugin = moduleImport.default.default;
      } else if (moduleImport.default) {
        plugin = moduleImport.default;
      } else {
        plugin = moduleImport;
      }

      loadedPlugins.set(pluginName, plugin);
      return plugin;

    } catch (error) {
      lastError = error as Error;
      console.warn(`Attempt ${attempt + 1} failed to load plugin ${pluginName}:`, error);

      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  console.error(`Failed to load plugin ${pluginName} after ${retries + 1} attempts:`, lastError);
  return null;
}

export async function loadPlugins(
  pluginNames: (keyof typeof pluginRegistry)[],
  options: PluginLoaderOptions = {}
): Promise<Map<string, VideoJSPlugin | null>> {
  const results = new Map<string, VideoJSPlugin | null>();

  const loadPromises = pluginNames.map(async (pluginName) => {
    const plugin = await loadPlugin(pluginName, options);
    results.set(pluginName, plugin);
    return { pluginName, plugin };
  });

  await Promise.allSettled(loadPromises);
  return results;
}

/**
 * Schedules a callback to run when the runtime is idle.
 * Falls back to setTimeout in environments without requestIdleCallback (Node.js, Cloudflare Workers).
 *
 * @param callback - Function to execute when idle
 * @param timeout - Fallback timeout in milliseconds (default: 100ms)
 */
function scheduleIdleCallback(callback: () => void | Promise<void>, timeout = 100): void {
  if (typeof requestIdleCallback !== 'undefined') {
    // Browser environment with requestIdleCallback support
    requestIdleCallback(() => {
      void callback();
    });
  } else {
    // Cloudflare Workers, Node.js, or other environments without requestIdleCallback
    setTimeout(() => {
      void callback();
    }, timeout);
  }
}

export async function preloadPlugins(
  pluginNames: (keyof typeof pluginRegistry)[]
): Promise<void> {
  scheduleIdleCallback(async () => {
    await loadPlugins(pluginNames, { timeout: 10000, retries: 1 });
  });
}

export function isPluginLoaded(pluginName: string): boolean {
  return loadedPlugins.has(pluginName) || Boolean(videojs.getPlugin?.(pluginName));
}

export function getLoadedPlugin(pluginName: string): VideoJSPlugin | null {
  return loadedPlugins.get(pluginName) || videojs.getPlugin?.(pluginName) || null;
}
