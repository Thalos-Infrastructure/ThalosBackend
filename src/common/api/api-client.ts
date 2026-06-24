import { Logger } from '@nestjs/common';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ApiRequestConfig {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | boolean>;
  timeout?: number;
}

export class ApiClient {
  private readonly logger = new Logger(ApiClient.name);
  private readonly defaultTimeout = 30000; // 30 seconds

  async request<T>(config: ApiRequestConfig): Promise<ApiResponse<T>> {
    try {
      const url = this.buildUrl(config.url, config.query);
      const fetchOptions = this.buildFetchOptions(config);

      this.logger.debug(`[${config.method}] ${url} - Making request`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeout || this.defaultTimeout);

      try {
        const response = await fetch(url, {
          ...fetchOptions,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        const responseData = await this.parseResponse<T>(response);

        if (!response.ok) {
          this.logger.warn(`[${config.method}] ${url} - Error ${response.status}`, responseData);
          return {
            success: false,
            error: this.extractErrorMessage(responseData, response.status),
          };
        }

        this.logger.debug(`[${config.method}] ${url} - Success (${response.status})`);
        return {
          success: true,
          data: responseData,
        };
      } catch (error) {
        clearTimeout(timeout);
        throw error;
      }
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.logger.error(
        `[${config.method}] ${config.url} - Exception: ${errorMessage}`,
        error instanceof Error ? error.stack : '',
      );
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  async get<T>(
    url: string,
    options?: {
      headers?: Record<string, string>;
      query?: Record<string, string | number | boolean>;
      timeout?: number;
    },
  ): Promise<ApiResponse<T>> {
    return this.request<T>({
      method: 'GET',
      url,
      ...options,
    });
  }

  async post<T>(
    url: string,
    body: unknown,
    options?: {
      headers?: Record<string, string>;
      query?: Record<string, string | number | boolean>;
      timeout?: number;
    },
  ): Promise<ApiResponse<T>> {
    return this.request<T>({
      method: 'POST',
      url,
      body,
      ...options,
    });
  }

  async patch<T>(
    url: string,
    body: unknown,
    options?: {
      headers?: Record<string, string>;
      query?: Record<string, string | number | boolean>;
      timeout?: number;
    },
  ): Promise<ApiResponse<T>> {
    return this.request<T>({
      method: 'PATCH',
      url,
      body,
      ...options,
    });
  }

  async delete<T>(
    url: string,
    options?: {
      headers?: Record<string, string>;
      query?: Record<string, string | number | boolean>;
      timeout?: number;
    },
  ): Promise<ApiResponse<T>> {
    return this.request<T>({
      method: 'DELETE',
      url,
      ...options,
    });
  }

  async put<T>(
    url: string,
    body: unknown,
    options?: {
      headers?: Record<string, string>;
      query?: Record<string, string | number | boolean>;
      timeout?: number;
    },
  ): Promise<ApiResponse<T>> {
    return this.request<T>({
      method: 'PUT',
      url,
      body,
      ...options,
    });
  }

  private buildUrl(url: string, query?: Record<string, string | number | boolean>): string {
    if (!query || Object.keys(query).length === 0) {
      return url;
    }

    const urlObj = new URL(url);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        urlObj.searchParams.set(key, String(value));
      }
    });

    return urlObj.toString();
  }

  private buildFetchOptions(config: ApiRequestConfig): RequestInit {
    const options: RequestInit = {
      method: config.method,
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
    };

    // Only include body for methods that support it
    if (config.body && ['POST', 'PATCH', 'PUT'].includes(config.method)) {
      options.body = JSON.stringify(config.body);
    }

    return options;
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type');

    if (contentType?.includes('application/json')) {
      return (await response.json()) as T;
    }

    const text = await response.text();
    try {
      return (text ? JSON.parse(text) : null) as T;
    } catch {
      return text as T;
    }
  }

  private extractErrorMessage(error: unknown, status?: number): string {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return 'Request timeout';
      }
      return error.message;
    }

    if (typeof error === 'object' && error !== null) {
      if ('message' in error) {
        return String(error.message);
      }
      if ('error' in error) {
        return String(error.error);
      }
    }

    if (status) {
      return `HTTP ${status}`;
    }

    return 'Unknown error';
  }
}

export const apiClient = new ApiClient();
