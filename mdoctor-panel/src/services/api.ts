const RAW_API_BASE = process.env.NEXT_PUBLIC_API_URL?.trim();

export const API_BASE = RAW_API_BASE ? RAW_API_BASE.replace(/\/$/, '') : '';

type RequestBody = Record<string, unknown> | unknown[] | null;

interface RequestOptions {
  body?: RequestBody;
  headers?: HeadersInit;
  timeoutMs?: number;
}

export type ApiErrorCode = 'missing_api_url' | 'unauthorized' | 'timeout' | 'network' | 'http' | 'parse';

export class ApiError extends Error {
  code: ApiErrorCode;
  status?: number;

  constructor(code: ApiErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

function readToken() {
  if (typeof window === 'undefined') {
    return null;
  }

  const directToken = window.localStorage.getItem('mdoctor_auth_token');
  if (directToken) {
    return directToken;
  }

  const session = window.localStorage.getItem('mdoctor_panel_mock_session');
  if (!session) {
    return null;
  }

  try {
    const parsed = JSON.parse(session) as { token?: string };
    return parsed.token || null;
  } catch {
    return null;
  }
}

async function request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, options: RequestOptions = {}): Promise<T> {
  if (!API_BASE) {
    throw new ApiError('missing_api_url', 'NEXT_PUBLIC_API_URL is not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
  const token = readToken();

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      body: method === 'GET' ? undefined : JSON.stringify(options.body ?? {}),
    });

    if (response.status === 401) {
      throw new ApiError('unauthorized', 'Unauthorized API request', 401);
    }

    if (!response.ok) {
      throw new ApiError('http', `API request failed: ${response.status}`, response.status);
    }

    try {
      return response.json() as Promise<T>;
    } catch {
      throw new ApiError('parse', 'API response is not valid JSON');
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('timeout', 'API request timed out');
    }

    throw new ApiError('network', 'Network request failed');
  } finally {
    clearTimeout(timeout);
  }
}

export const apiClient = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) => request<T>('GET', path, options),
  post: <T>(path: string, body?: RequestBody, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('POST', path, { ...options, body: body ?? null }),
  patch: <T>(path: string, body?: RequestBody, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('PATCH', path, { ...options, body: body ?? null }),
};

export interface EligibilityRequest {
  condition: string;
  previous_prescription?: boolean;
  continuous_use_proof?: boolean;
  flags?: string[];
  [key: string]: unknown;
}

export interface EligibilityResponse {
  success: boolean;
  eligible: boolean;
  reason: string;
  timestamp: string;
}

export async function checkEligibility(data: EligibilityRequest): Promise<EligibilityResponse> {
  return apiClient.post<EligibilityResponse>('/api/eligibility', data);
}
