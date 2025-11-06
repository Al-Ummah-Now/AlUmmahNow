# Task 2.4: Step 3 - RTMP Server/Key Setup

**Phase**: 2 - Go Live Creator Tools
**Type**: Architecture Specification
**Estimated Time**: 6 hours
**Dependencies**: Task 2.1 (GoLive Wizard)
**Status**: 📝 Not Started

---

## Goal

Create a secure RTMP credentials display component with intelligent server selection, copy-to-clipboard functionality, QR code generation for mobile, and software-specific configuration guides.

## Architecture Pattern

**Pattern**: Secure Credential Display with Copy Protection and Audit Logging
**Strategy**: Masked keys with one-click reveal, copy protection, and usage tracking

## Component Structure

```typescript
// File: /apps/web/src/components/GoLiveForm/RTMPSetupStep.tsx
interface RTMPSetupStepProps {
  streamId: string;
  rtmpUrl: string;
  streamKey: string;
  onNext: () => void;
  onBack: () => void;
  onTestConnection?: () => Promise<boolean>;
}

interface RTMPConfig {
  rtmpUrl: string;
  streamKey: string;
  backupUrl?: string;
  preferredIngest?: string;
  customSettings?: StreamSettings;
}

interface StreamSettings {
  bitrate: number;
  resolution: '720p' | '1080p' | '1440p' | '4k';
  fps: 30 | 60;
  keyframeInterval: number;
  encoder: 'x264' | 'nvenc' | 'qsv' | 'h264_videotoolbox';
}

// Stream key manager with security
class StreamKeyManager {
  private key: string;
  private shown: boolean = false;
  private copyCount: number = 0;
  private maxCopies: number = 10;

  constructor(encryptedKey: string) {
    this.key = this.decrypt(encryptedKey);
  }

  private decrypt(encrypted: string): string {
    // Client-side decryption with session key
    return decryptWithSessionKey(encrypted);
  }

  getMasked(): string {
    const visible = 4;
    const masked = this.key.length - (visible * 2);
    return `${this.key.slice(0, visible)}${'•'.repeat(masked)}${this.key.slice(-visible)}`;
  }

  show(): string | null {
    if (this.shown) {
      console.warn('Stream key already shown');
    }
    this.shown = true;
    this.logAccess('show');
    return this.key;
  }

  async copy(): Promise<boolean> {
    if (this.copyCount >= this.maxCopies) {
      throw new Error('Copy limit exceeded. Contact support if you need a new key.');
    }

    this.copyCount++;
    this.logAccess('copy');

    try {
      await navigator.clipboard.writeText(this.key);
      return true;
    } catch (error) {
      return this.fallbackCopy();
    }
  }

  private fallbackCopy(): boolean {
    const textarea = document.createElement('textarea');
    textarea.value = this.key;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      document.execCommand('copy');
      return true;
    } finally {
      document.body.removeChild(textarea);
    }
  }

  private logAccess(action: string): void {
    // Audit log for security
    console.log(`Stream key ${action} at ${new Date().toISOString()}`);
    // Send to analytics/security log
    trackEvent('stream_key_access', {
      action,
      timestamp: Date.now(),
      copyCount: this.copyCount
    });
  }
}
```

## Data Flow

```
Stream Created → Generate RTMP Credentials → Encrypt Stream Key
       ↓                    ↓                        ↓
Select Best Server → Display Masked Key → User Reveals Key
       ↓                                            ↓
Copy to Clipboard → Audit Log → Configure Streaming Software
       ↓                                            ↓
Test Connection → Show Success/Error → Enable Next Step
```

## Dependencies

- **clipboard-copy** - Secure clipboard access
- **qrcode.react** - QR code generation for mobile
- **react-syntax-highlighter** - Config file display

## Integration Points

- RTMP ingest server selection API
- Connection quality testing endpoint
- Streaming software detection
- Help documentation system
- Analytics for usage tracking

## Performance Considerations

```typescript
// Intelligent server selection based on latency
const selectBestIngestServer = async (): Promise<string> => {
  const servers = [
    { url: 'rtmp://ingest-us.alummahnow.net/live', region: 'us', name: 'United States' },
    { url: 'rtmp://ingest-eu.alummahnow.net/live', region: 'eu', name: 'Europe' },
    { url: 'rtmp://ingest-ap.alummahnow.net/live', region: 'ap', name: 'Asia Pacific' }
  ];

  // Parallel latency testing
  const pingResults = await Promise.all(
    servers.map(async (server) => ({
      ...server,
      latency: await pingServer(server.url)
    }))
  );

  // Sort by latency and return best
  const sorted = pingResults.sort((a, b) => a.latency - b.latency);
  console.log('Server selection:', sorted);

  return sorted[0].url;
};

// Ping server for latency measurement
const pingServer = async (url: string): Promise<number> => {
  const start = performance.now();
  try {
    await fetch(`${url}/health`, { method: 'HEAD', cache: 'no-cache' });
    return performance.now() - start;
  } catch (error) {
    return Infinity; // Server unreachable
  }
};
```

## Security Considerations

- **Stream Key Encryption**: Keys encrypted in transit and at rest
- **Copy Limit Enforcement**: Max 10 copies per key
- **Audit Logging**: All access logged for security
- **Key Rotation**: Auto-rotate keys on suspicious activity
- **No Plain Text Storage**: Never store keys in localStorage/sessionStorage

```typescript
// Secure clipboard with watermark
const copyWithWatermark = async (text: string): Promise<boolean> => {
  const watermarked = `${text}\n\n[Al Ummah Now Stream Key - Keep Confidential]`;

  try {
    await navigator.clipboard.writeText(watermarked);

    // Auto-clear clipboard after 30 seconds
    setTimeout(async () => {
      try {
        await navigator.clipboard.writeText('');
      } catch (e) {
        // Ignore errors (user may have copied something else)
      }
    }, 30000);

    return true;
  } catch (error) {
    console.error('Clipboard write failed:', error);
    return false;
  }
};
```

## Error Handling

```typescript
// Connection test with detailed diagnostics
const testRTMPConnection = async (url: string, key: string): Promise<TestResult> => {
  try {
    const response = await fetch('/api/test-rtmp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, key })
    });

    const result = await response.json();

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        suggestions: getDiagnosticSuggestions(result.error)
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: 'Connection test failed',
      suggestions: [
        'Check your firewall settings',
        'Verify port 1935 is not blocked',
        'Try the backup RTMP server',
        'Contact support if issue persists'
      ]
    };
  }
};

const getDiagnosticSuggestions = (error: string): string[] => {
  if (error.includes('firewall')) {
    return [
      'Allow outbound connections on port 1935',
      'Check your router firewall settings',
      'Try disabling VPN temporarily'
    ];
  }

  if (error.includes('auth')) {
    return [
      'Verify you copied the stream key correctly',
      'Try generating a new stream key',
      'Ensure no extra spaces in the key'
    ];
  }

  if (error.includes('bandwidth')) {
    return [
      'Your internet speed may be too slow',
      'Try reducing bitrate to 2500 kbps',
      'Close other bandwidth-heavy applications'
    ];
  }

  return ['Try again in a few moments', 'Contact support for assistance'];
};
```

## Type Safety

```typescript
// OBS Studio configuration generator
interface OBSConfig {
  settings: {
    service: 'Custom';
    server: string;
    key: string;
  };
  output: {
    mode: 'Simple' | 'Advanced';
    videoBitrate: number;
    audioBitrate: number;
    encoder: string;
    preset: string;
  };
  video: {
    baseResolution: string;
    outputResolution: string;
    fps: number;
  };
}

const generateOBSConfig = (rtmp: RTMPConfig): OBSConfig => ({
  settings: {
    service: 'Custom',
    server: rtmp.rtmpUrl,
    key: rtmp.streamKey
  },
  output: {
    mode: 'Simple',
    videoBitrate: rtmp.customSettings?.bitrate || 4000,
    audioBitrate: 128,
    encoder: 'x264',
    preset: 'veryfast'
  },
  video: {
    baseResolution: '1920x1080',
    outputResolution: rtmp.customSettings?.resolution || '1920x1080',
    fps: rtmp.customSettings?.fps || 30
  }
});

// Software-specific configurations
type StreamingSoftware = 'obs' | 'streamlabs' | 'xsplit' | 'wirecast' | 'vmix' | 'other';

interface SoftwareConfig {
  name: string;
  icon: string;
  downloadUrl: string;
  instructions: string[];
  configTemplate: (rtmp: RTMPConfig) => any;
}
```

## Testing Criteria

- [ ] RTMP URL displays correctly
- [ ] Stream key masked by default
- [ ] Reveal button shows full key
- [ ] Copy button copies to clipboard
- [ ] Copy limit enforced (max 10)
- [ ] Audit logging works
- [ ] Best server auto-selected
- [ ] Connection test succeeds
- [ ] QR code generates for mobile
- [ ] Software-specific configs generated

## Acceptance Criteria

- [ ] Display RTMP URL (e.g., `rtmp://ingest.alummahnow.net/live`)
- [ ] Display masked stream key (e.g., `abc1•••••••••xyz9`)
- [ ] "Show Key" button reveals full key
- [ ] Copy buttons for URL and key
- [ ] Success feedback on copy (checkmark, toast)
- [ ] Server selection with latency test
- [ ] QR code for mobile streaming apps
- [ ] OBS Studio configuration export
- [ ] Connection test button with diagnostics
- [ ] Firewall/NAT detection warnings
- [ ] Software-specific setup guides

## Related Tasks

- **Depends On**: Task 2.1 (GoLive Wizard)
- **Blocks**: Task 2.5 (Review Step)
- **Related**: Task 2.6 (StreamSetupComponent), Task 2.13 (Error Handling)

## References

- [ADR-002: Phase 2 Architecture](/docs/architecture/ADR-002-phase2-golive-architecture.md#task-4-step-3-rtmp-setup)
- [RTMP Specification](https://en.wikipedia.org/wiki/Real-Time_Messaging_Protocol)
- [OBS Studio Configuration](https://obsproject.com/kb/)

---

**Last Updated**: 2025-11-06
**Reviewed By**: N/A
**Implementation Status**: Not Started
