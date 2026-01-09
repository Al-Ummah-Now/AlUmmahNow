/**
 * HTTP Test Client for API Testing
 * Provides authenticated and unauthenticated request capabilities
 */

export interface UserCredentials {
  email: string;
  password: string;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}

export interface TestResponse {
  status: number;
  statusText: string;
  headers: Headers;
  json(): Promise<any>;
  text(): Promise<string>;
}

export class TestClient {
  public baseUrl: string;
  private authToken?: string;
  private defaultTimeout: number = 30000;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Authenticate the client with user credentials
   */
  async authenticate(credentials: UserCredentials): Promise<void> {
    const response = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials)
    });

    if (response.status !== 200) {
      throw new Error(`Authentication failed: ${response.status}`);
    }

    const data = await response.json();
    this.authToken = data.token;
  }

  /**
   * Set authentication token directly
   */
  setAuthToken(token: string): void {
    this.authToken = token;
  }

  /**
   * Clear authentication token
   */
  clearAuth(): void {
    this.authToken = undefined;
  }

  /**
   * Make HTTP request with proper authentication and headers
   */
  async request(endpoint: string, options: RequestOptions = {}): Promise<TestResponse> {
    const url = `${this.baseUrl}${endpoint}`;
    const timeout = options.timeout || this.defaultTimeout;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'AlUmmah-Test-Client/1.0',
      ...(this.authToken && { Authorization: `Bearer ${this.authToken}` }),
      ...options.headers
    };

    // Remove Content-Type for requests without body
    if (!options.body && (options.method === 'GET' || options.method === 'DELETE')) {
      delete headers['Content-Type'];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Return a test response wrapper
      return new TestResponseWrapper(response);
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Convenience method for GET requests
   */
  async get(endpoint: string, headers?: Record<string, string>): Promise<TestResponse> {
    return this.request(endpoint, { method: 'GET', headers });
  }

  /**
   * Convenience method for POST requests
   */
  async post(endpoint: string, data?: any, headers?: Record<string, string>): Promise<TestResponse> {
    return this.request(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
      headers
    });
  }

  /**
   * Convenience method for PUT requests
   */
  async put(endpoint: string, data?: any, headers?: Record<string, string>): Promise<TestResponse> {
    return this.request(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
      headers
    });
  }

  /**
   * Convenience method for PATCH requests
   */
  async patch(endpoint: string, data?: any, headers?: Record<string, string>): Promise<TestResponse> {
    return this.request(endpoint, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
      headers
    });
  }

  /**
   * Convenience method for DELETE requests
   */
  async delete(endpoint: string, headers?: Record<string, string>): Promise<TestResponse> {
    return this.request(endpoint, { method: 'DELETE', headers });
  }

  /**
   * Upload file with multipart/form-data
   */
  async upload(endpoint: string, file: File, additionalData?: Record<string, any>): Promise<TestResponse> {
    const formData = new FormData();
    formData.append('file', file);

    if (additionalData) {
      Object.entries(additionalData).forEach(([key, value]) => {
        formData.append(key, String(value));
      });
    }

    const headers: Record<string, string> = {};
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }

    return this.request(endpoint, {
      method: 'POST',
      body: formData as any, // FormData will be handled correctly by fetch
      headers
    });
  }
}

/**
 * Wrapper class for Response to provide consistent interface
 */
class TestResponseWrapper implements TestResponse {
  private response: Response;

  constructor(response: Response) {
    this.response = response;
  }

  get status(): number {
    return this.response.status;
  }

  get statusText(): string {
    return this.response.statusText;
  }

  get headers(): Headers {
    return this.response.headers;
  }

  async json(): Promise<any> {
    return this.response.json();
  }

  async text(): Promise<string> {
    return this.response.text();
  }
}

/**
 * Create a test client with default configuration
 */
export function createTestClient(baseUrl?: string): TestClient {
  const defaultUrl = baseUrl || process.env.API_BASE_URL || 'http://127.0.0.1:3086';
  return new TestClient(defaultUrl);
}

/**
 * Create an authenticated test client
 */
export async function createAuthenticatedClient(
  credentials: UserCredentials,
  baseUrl?: string
): Promise<TestClient> {
  const client = createTestClient(baseUrl);
  await client.authenticate(credentials);
  return client;
}