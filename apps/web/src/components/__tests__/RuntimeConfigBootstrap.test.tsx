import { render } from '@testing-library/react';
import { RuntimeConfigBootstrap } from '../RuntimeConfigBootstrap';
import { getApiUrl, getWebSocketUrl } from '@/lib/runtime-config';

const config = { API_URL: 'https://api.example', WEBSOCKET_URL: 'wss://rt.example/ws', AUTH_PROFILE_URL: '' };

describe('RuntimeConfigBootstrap', () => {
  afterEach(() => {
    delete window.__RUNTIME_CONFIG__;
  });

  it('supplies the config when the inline script did not run', () => {
    render(<RuntimeConfigBootstrap config={config} />);
    expect(getApiUrl()).toBe('https://api.example');
    expect(getWebSocketUrl()).toBe('wss://rt.example/ws');
  });

  it('keeps a config the inline script already set', () => {
    window.__RUNTIME_CONFIG__ = { API_URL: 'https://first.example' };
    render(<RuntimeConfigBootstrap config={config} />);
    expect(getApiUrl()).toBe('https://first.example');
  });
});
