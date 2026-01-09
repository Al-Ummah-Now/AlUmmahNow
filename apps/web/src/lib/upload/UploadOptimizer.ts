import { DeviceCapabilities } from '@al-ummah/shared-types';

/**
 * Monitors device memory usage
 */
class MemoryMonitor {
  getAvailableMemory(): number {
    // Use Performance Memory API if available (Chrome/Edge)
    if ('memory' in performance) {
      const memory = (performance as unknown as { memory: { jsHeapSizeLimit: number; usedJSHeapSize: number } }).memory;
      return memory.jsHeapSizeLimit - memory.usedJSHeapSize;
    }

    // Fallback estimate based on device
    const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
    return isMobile ? 512 * 1024 * 1024 : 2 * 1024 * 1024 * 1024;
  }

  getUsedMemory(): number {
    if ('memory' in performance) {
      const memory = (performance as unknown as { memory: { jsHeapSizeLimit: number; usedJSHeapSize: number } }).memory;
      return memory.usedJSHeapSize;
    }
    return 0;
  }

  getTotalMemory(): number {
    if ('memory' in performance) {
      const memory = (performance as unknown as { memory: { jsHeapSizeLimit: number; usedJSHeapSize: number } }).memory;
      return memory.jsHeapSizeLimit;
    }
    const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
    return isMobile ? 1 * 1024 * 1024 * 1024 : 4 * 1024 * 1024 * 1024;
  }
}

/**
 * Monitors network bandwidth
 */
class BandwidthMonitor {
  private measurements: number[] = [];
  private lastMeasurementTime: number = 0;
  private lastBytesTransferred: number = 0;

  addMeasurement(bytesPerSecond: number): void {
    this.measurements.push(bytesPerSecond);
    // Keep only last 10 measurements
    if (this.measurements.length > 10) {
      this.measurements.shift();
    }
  }

  getAverageBandwidth(): number {
    if (this.measurements.length === 0) {
      // Initial estimate based on connection type
      if ('connection' in navigator) {
        const conn = (navigator as { connection?: { effectiveType?: string } }).connection;
        const effectiveType = conn?.effectiveType;
        switch (effectiveType) {
          case '4g': return 5 * 1024 * 1024;   // 5MB/s
          case '3g': return 1 * 1024 * 1024;   // 1MB/s
          case '2g': return 256 * 1024;        // 256KB/s
          default: return 2 * 1024 * 1024;     // 2MB/s
        }
      }
      return 2 * 1024 * 1024; // Default 2MB/s
    }

    const sum = this.measurements.reduce((a, b) => a + b, 0);
    return sum / this.measurements.length;
  }

  updateBandwidth(bytesTransferred: number): void {
    const now = Date.now();
    if (this.lastMeasurementTime > 0) {
      const timeElapsed = (now - this.lastMeasurementTime) / 1000; // Convert to seconds
      const bytesThisPeriod = bytesTransferred - this.lastBytesTransferred;
      if (timeElapsed > 0) {
        const bytesPerSecond = bytesThisPeriod / timeElapsed;
        this.addMeasurement(bytesPerSecond);
      }
    }
    this.lastMeasurementTime = now;
    this.lastBytesTransferred = bytesTransferred;
  }
}

/**
 * Optimizes upload settings based on device capabilities and network conditions
 */
export class UploadOptimizer {
  private memoryMonitor: MemoryMonitor;
  private bandwidthMonitor: BandwidthMonitor;
  private deviceCapabilities: DeviceCapabilities;

  constructor() {
    this.memoryMonitor = new MemoryMonitor();
    this.bandwidthMonitor = new BandwidthMonitor();
    this.deviceCapabilities = this.detectCapabilities();
  }

  /**
   * Determine optimal number of concurrent uploads
   */
  getOptimalConcurrency(): number {
    const factors = {
      memory: this.getMemoryFactor(),
      bandwidth: this.getBandwidthFactor(),
      device: this.getDeviceFactor(),
      browser: this.getBrowserFactor(),
    };

    // Calculate weighted average
    const weights = { memory: 0.3, bandwidth: 0.4, device: 0.2, browser: 0.1 };
    const score = Object.entries(factors).reduce((sum, [key, value]) => {
      return sum + (value * weights[key as keyof typeof weights]);
    }, 0);

    // Map score to concurrency (1-5)
    if (score >= 0.8) return 5;
    if (score >= 0.6) return 4;
    if (score >= 0.4) return 3;
    if (score >= 0.2) return 2;
    return 1;
  }

  /**
   * Determine optimal chunk size for TUS uploads
   */
  getOptimalChunkSize(): number {
    const bandwidth = this.bandwidthMonitor.getAverageBandwidth();
    const memory = this.memoryMonitor.getAvailableMemory();

    // Base chunk size on bandwidth (target 2-3 second chunks)
    let chunkSize = bandwidth * 2.5;

    // Constrain by memory (max 1% of available memory per chunk)
    const memoryLimit = memory * 0.01;
    chunkSize = Math.min(chunkSize, memoryLimit);

    // Apply min/max bounds
    const MIN_CHUNK = 1024 * 1024;      // 1MB minimum
    const MAX_CHUNK = 10 * 1024 * 1024; // 10MB maximum

    return Math.max(MIN_CHUNK, Math.min(MAX_CHUNK, Math.floor(chunkSize)));
  }

  /**
   * Update bandwidth measurement based on upload progress
   */
  updateBandwidth(bytesTransferred: number): void {
    this.bandwidthMonitor.updateBandwidth(bytesTransferred);
  }

  /**
   * Get device capabilities
   */
  getDeviceCapabilities(): DeviceCapabilities {
    return this.deviceCapabilities;
  }

  /**
   * Get current memory usage
   */
  getMemoryUsage(): {
    used: number;
    available: number;
    total: number;
    usagePercent: number;
  } {
    const used = this.memoryMonitor.getUsedMemory();
    const available = this.memoryMonitor.getAvailableMemory();
    const total = this.memoryMonitor.getTotalMemory();
    const usagePercent = total > 0 ? (used / total) * 100 : 0;

    return { used, available, total, usagePercent };
  }

  /**
   * Get current bandwidth estimate
   */
  getCurrentBandwidth(): number {
    return this.bandwidthMonitor.getAverageBandwidth();
  }

  /**
   * Calculate memory factor (0-1)
   */
  private getMemoryFactor(): number {
    const available = this.memoryMonitor.getAvailableMemory();
    if (available > 4 * 1024 * 1024 * 1024) return 1.0; // >4GB
    if (available > 2 * 1024 * 1024 * 1024) return 0.7; // >2GB
    if (available > 1 * 1024 * 1024 * 1024) return 0.4; // >1GB
    return 0.2;
  }

  /**
   * Calculate bandwidth factor (0-1)
   */
  private getBandwidthFactor(): number {
    const bandwidth = this.bandwidthMonitor.getAverageBandwidth();
    if (bandwidth > 10 * 1024 * 1024) return 1.0;  // >10MB/s
    if (bandwidth > 5 * 1024 * 1024) return 0.7;   // >5MB/s
    if (bandwidth > 1 * 1024 * 1024) return 0.4;   // >1MB/s
    return 0.2;
  }

  /**
   * Calculate device factor (0-1)
   */
  private getDeviceFactor(): number {
    if (this.deviceCapabilities.isDesktop) return 1.0;
    if (this.deviceCapabilities.isTablet) return 0.6;
    return 0.3; // Mobile
  }

  /**
   * Calculate browser factor (0-1)
   */
  private getBrowserFactor(): number {
    // Modern browsers with good Worker support
    if ('serviceWorker' in navigator && 'Worker' in window) return 1.0;
    return 0.5;
  }

  /**
   * Detect device capabilities
   */
  private detectCapabilities(): DeviceCapabilities {
    const hasTouch = 'ontouchstart' in window;
    const width = window.innerWidth;

    return {
      isDesktop: !hasTouch && width > 1024,
      isTablet: hasTouch && width > 768,
      isMobile: hasTouch && width <= 768,
      hasWebWorker: 'Worker' in window,
      cores: navigator.hardwareConcurrency || 2,
    };
  }

  /**
   * Check if device can handle batch uploads
   */
  canHandleBatchUpload(fileCount: number): boolean {
    const memory = this.memoryMonitor.getAvailableMemory();
    const minMemoryPerFile = 50 * 1024 * 1024; // 50MB per file

    return memory >= (fileCount * minMemoryPerFile);
  }

  /**
   * Get recommended batch size based on capabilities
   */
  getRecommendedBatchSize(): number {
    const concurrency = this.getOptimalConcurrency();
    const memory = this.memoryMonitor.getAvailableMemory();
    const memoryGb = memory / (1024 * 1024 * 1024);

    // Conservative estimates
    if (memoryGb > 4) return Math.min(15, concurrency * 5);
    if (memoryGb > 2) return Math.min(10, concurrency * 3);
    if (memoryGb > 1) return Math.min(5, concurrency * 2);
    return Math.min(3, concurrency);
  }
}
