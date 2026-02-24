import type { Provider, SerializedHttpRequest, SerializedHttpResponse, SerializedHttpResponseChunk } from '@antseed/node';
import { HttpRelay, type RelayConfig } from './http-relay.js';

export interface BaseProviderConfig {
  name: string;
  models: string[];
  pricing: Provider['pricing'];
  relay: RelayConfig;
}

/**
 * Convenience base class that wires HttpRelay to the Provider interface.
 * Pattern adapted from provider-anthropic's AnthropicProvider.
 */
export class BaseProvider implements Provider {
  readonly name: string;
  readonly models: string[];
  readonly pricing: Provider['pricing'];
  readonly maxConcurrency: number;

  private readonly _relay: HttpRelay;
  private _activeCount = 0;

  private readonly _pending = new Map<
    string,
    { resolve: (res: SerializedHttpResponse) => void; reject: (err: Error) => void }
  >();

  constructor(config: BaseProviderConfig) {
    this.name = config.name;
    this.models = config.models;
    this.pricing = config.pricing;
    this.maxConcurrency = config.relay.maxConcurrency;

    this._relay = new HttpRelay(config.relay, {
      onResponse: (response: SerializedHttpResponse) => {
        this._resolvePending(response.requestId, response);
      },
      onResponseChunk: (_chunk: SerializedHttpResponseChunk) => {
        // Chunks are accumulated by HttpRelay into a complete response
      },
    });
  }

  private _resolvePending(requestId: string, response: SerializedHttpResponse): void {
    const entry = this._pending.get(requestId);
    if (entry) {
      this._pending.delete(requestId);
      entry.resolve(response);
    }
  }

  async init(): Promise<void> {
    if (this._relay['_config'].tokenProvider) {
      await this._relay['_config'].tokenProvider.getToken();
    }
  }

  async handleRequest(req: SerializedHttpRequest): Promise<SerializedHttpResponse> {
    this._activeCount++;
    try {
      const responsePromise = new Promise<SerializedHttpResponse>((resolve, reject) => {
        this._pending.set(req.requestId, { resolve, reject });
      });

      // Fire the relay (it calls onResponse when done)
      await this._relay.handleRequest(req);

      return await responsePromise;
    } catch (err) {
      this._pending.delete(req.requestId);
      throw err;
    } finally {
      this._activeCount--;
    }
  }

  getCapacity(): { current: number; max: number } {
    return {
      current: this._activeCount,
      max: this.maxConcurrency,
    };
  }
}
