export { ProxyMux } from './proxy-mux.js';
export { encodeHttpRequest, decodeHttpRequest, encodeHttpResponse, decodeHttpResponse, encodeHttpResponseChunk, decodeHttpResponseChunk } from './request-codec.js';
export { detectProviderFromHeaders, detectProviderFromPath, resolveProvider, IDLEAI_PROVIDER_HEADER } from './provider-detection.js';
export {
  detectRequestModelApiProtocol,
  inferProviderDefaultModelApiProtocols,
  selectTargetProtocolForRequest,
  transformAnthropicMessagesRequestToOpenAIChat,
  transformOpenAIChatResponseToAnthropicMessage,
  type TargetProtocolSelection,
  type AnthropicToOpenAIRequestTransformResult,
} from './model-api-adapter.js';
