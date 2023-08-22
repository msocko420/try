var __classPrivateFieldSet =
  (this && this.__classPrivateFieldSet) ||
  function (receiver, state, value, kind, f) {
    if (kind === 'm') throw new TypeError('Private method is not writable');
    if (kind === 'a' && !f) throw new TypeError('Private accessor was defined without a setter');
    if (typeof state === 'function' ? receiver !== state || !f : !state.has(receiver))
      throw new TypeError('Cannot write private member to an object whose class did not declare it');
    return (
      kind === 'a' ? f.call(receiver, value)
      : f ? (f.value = value)
      : state.set(receiver, value),
      value
    );
  };
var __classPrivateFieldGet =
  (this && this.__classPrivateFieldGet) ||
  function (receiver, state, kind, f) {
    if (kind === 'a' && !f) throw new TypeError('Private accessor was defined without a getter');
    if (typeof state === 'function' ? receiver !== state || !f : !state.has(receiver))
      throw new TypeError('Cannot read private member from an object whose class did not declare it');
    return (
      kind === 'm' ? f
      : kind === 'a' ? f.call(receiver)
      : f ? f.value
      : state.get(receiver)
    );
  };
var _AbstractPage_client;
import { VERSION } from './version.mjs';
import { Stream } from './streaming.mjs';
import { APIError, APIConnectionError, APIConnectionTimeoutError, APIUserAbortError } from './error.mjs';
import { getDefaultAgent } from 'openai/_shims/agent';
import { fetch, isPolyfilled as fetchIsPolyfilled } from 'openai/_shims/fetch';
import { isMultipartBody } from './uploads.mjs';
export { maybeMultipartFormRequestOptions, multipartFormRequestOptions, createForm } from './uploads.mjs';
const MAX_RETRIES = 2;
async function defaultParseResponse(props) {
  const { response } = props;
  if (props.options.stream) {
    // Note: there is an invariant here that isn't represented in the type system
    // that if you set `stream: true` the response type must also be `Stream<T>`
    return new Stream(response, props.controller);
  }
  const contentType = response.headers.get('content-type');
  if (contentType === null || contentType === void 0 ? void 0 : contentType.includes('application/json')) {
    const json = await response.json();
    debug('response', response.status, response.url, response.headers, json);
    return json;
  }
  // TODO handle blob, arraybuffer, other content types, etc.
  const text = await response.text();
  debug('response', response.status, response.url, response.headers, text);
  return text;
}
/**
 * A subclass of `Promise` providing additional helper methods
 * for interacting with the SDK.
 */
export class APIPromise extends Promise {
  constructor(responsePromise, parseResponse = defaultParseResponse) {
    super((resolve) => {
      // this is maybe a bit weird but this has to be a no-op to not implicitly
      // parse the response body; instead .then, .catch, .finally are overridden
      // to parse the response
      resolve(null);
    });
    this.responsePromise = responsePromise;
    this.parseResponse = parseResponse;
  }
  _thenUnwrap(transform) {
    return new APIPromise(this.responsePromise, async (props) => transform(await this.parseResponse(props)));
  }
  /**
   * Gets the raw `Response` instance instead of parsing the response
   * data.
   *
   * If you want to parse the response body but still get the `Response`
   * instance, you can use {@link withResponse()}.
   */
  asResponse() {
    return this.responsePromise.then((p) => p.response);
  }
  /**
   * Gets the parsed response data and the raw `Response` instance.
   *
   * If you just want to get the raw `Response` instance without parsing it,
   * you can use {@link asResponse()}.
   */
  async withResponse() {
    const [data, response] = await Promise.all([this.parse(), this.asResponse()]);
    return { data, response };
  }
  parse() {
    if (!this.parsedPromise) {
      this.parsedPromise = this.responsePromise.then(this.parseResponse);
    }
    return this.parsedPromise;
  }
  then(onfulfilled, onrejected) {
    return this.parse().then(onfulfilled, onrejected);
  }
  catch(onrejected) {
    return this.parse().catch(onrejected);
  }
  finally(onfinally) {
    return this.parse().finally(onfinally);
  }
}
export class APIClient {
  constructor({
    baseURL,
    maxRetries,
    timeout = 600000, // 10 minutes
    httpAgent,
    fetch: overridenFetch,
  }) {
    this.baseURL = baseURL;
    this.maxRetries = validatePositiveInteger(
      'maxRetries',
      maxRetries !== null && maxRetries !== void 0 ? maxRetries : MAX_RETRIES,
    );
    this.timeout = validatePositiveInteger('timeout', timeout);
    this.httpAgent = httpAgent;
    this.fetch = overridenFetch !== null && overridenFetch !== void 0 ? overridenFetch : fetch;
  }
  authHeaders() {
    return {};
  }
  /**
   * Override this to add your own default headers, for example:
   *
   *  {
   *    ...super.defaultHeaders(),
   *    Authorization: 'Bearer 123',
   *  }
   */
  defaultHeaders() {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': this.getUserAgent(),
      ...getPlatformHeaders(),
      ...this.authHeaders(),
    };
  }
  /**
   * Override this to add your own headers validation:
   */
  validateHeaders(headers, customHeaders) {}
  defaultIdempotencyKey() {
    return `stainless-node-retry-${uuid4()}`;
  }
  get(path, opts) {
    return this.methodRequest('get', path, opts);
  }
  post(path, opts) {
    return this.methodRequest('post', path, opts);
  }
  patch(path, opts) {
    return this.methodRequest('patch', path, opts);
  }
  put(path, opts) {
    return this.methodRequest('put', path, opts);
  }
  delete(path, opts) {
    return this.methodRequest('delete', path, opts);
  }
  methodRequest(method, path, opts) {
    return this.request(Promise.resolve(opts).then((opts) => ({ method, path, ...opts })));
  }
  getAPIList(path, Page, opts) {
    return this.requestAPIList(Page, { method: 'get', path, ...opts });
  }
  calculateContentLength(body) {
    if (typeof body === 'string') {
      if (typeof Buffer !== 'undefined') {
        return Buffer.byteLength(body, 'utf8').toString();
      }
      if (typeof TextEncoder !== 'undefined') {
        const encoder = new TextEncoder();
        const encoded = encoder.encode(body);
        return encoded.length.toString();
      }
    }
    return null;
  }
  buildRequest(options) {
    var _a, _b, _c, _d, _e, _f;
    const { method, path, query, headers: headers = {} } = options;
    const body =
      isMultipartBody(options.body) ? options.body.body
      : options.body ? JSON.stringify(options.body, null, 2)
      : null;
    const contentLength = this.calculateContentLength(body);
    const url = this.buildURL(path, query);
    if ('timeout' in options) validatePositiveInteger('timeout', options.timeout);
    const timeout = (_a = options.timeout) !== null && _a !== void 0 ? _a : this.timeout;
    const httpAgent =
      (
        (_c = (_b = options.httpAgent) !== null && _b !== void 0 ? _b : this.httpAgent) !== null &&
        _c !== void 0
      ) ?
        _c
      : getDefaultAgent(url);
    const minAgentTimeout = timeout + 1000;
    if (
      typeof ((
        (_d = httpAgent === null || httpAgent === void 0 ? void 0 : httpAgent.options) === null ||
        _d === void 0
      ) ?
        void 0
      : _d.timeout) === 'number' &&
      minAgentTimeout > ((_e = httpAgent.options.timeout) !== null && _e !== void 0 ? _e : 0)
    ) {
      // Allow any given request to bump our agent active socket timeout.
      // This may seem strange, but leaking active sockets should be rare and not particularly problematic,
      // and without mutating agent we would need to create more of them.
      // This tradeoff optimizes for performance.
      httpAgent.options.timeout = minAgentTimeout;
    }
    if (this.idempotencyHeader && method !== 'get') {
      if (!options.idempotencyKey) options.idempotencyKey = this.defaultIdempotencyKey();
      headers[this.idempotencyHeader] = options.idempotencyKey;
    }
    const reqHeaders = {
      ...(contentLength && { 'Content-Length': contentLength }),
      ...this.defaultHeaders(),
      ...headers,
    };
    // let builtin fetch set the Content-Type for multipart bodies
    if (isMultipartBody(options.body) && !fetchIsPolyfilled) {
      delete reqHeaders['Content-Type'];
    }
    // Strip any headers being explicitly omitted with null
    Object.keys(reqHeaders).forEach((key) => reqHeaders[key] === null && delete reqHeaders[key]);
    const req = {
      method,
      ...(body && { body: body }),
      headers: reqHeaders,
      ...(httpAgent && { agent: httpAgent }),
      // @ts-ignore node-fetch uses a custom AbortSignal type that is
      // not compatible with standard web types
      signal: (_f = options.signal) !== null && _f !== void 0 ? _f : null,
    };
    this.validateHeaders(reqHeaders, headers);
    return { req, url, timeout };
  }
  /**
   * Used as a callback for mutating the given `RequestInit` object.
   *
   * This is useful for cases where you want to add certain headers based off of
   * the request properties, e.g. `method` or `url`.
   */
  async prepareRequest(request, { url }) {}
  makeStatusError(status, error, message, headers) {
    return APIError.generate(status, error, message, headers);
  }
  request(options, remainingRetries = null) {
    return new APIPromise(this.makeRequest(options, remainingRetries));
  }
  async makeRequest(optionsInput, retriesRemaining) {
    var _a, _b, _c;
    const options = await optionsInput;
    if (retriesRemaining == null) {
      retriesRemaining = (_a = options.maxRetries) !== null && _a !== void 0 ? _a : this.maxRetries;
    }
    const { req, url, timeout } = this.buildRequest(options);
    await this.prepareRequest(req, { url });
    debug('request', url, options, req.headers);
    if ((_b = options.signal) === null || _b === void 0 ? void 0 : _b.aborted) {
      throw new APIUserAbortError();
    }
    const controller = new AbortController();
    const response = await this.fetchWithTimeout(url, req, timeout, controller).catch(castToError);
    if (response instanceof Error) {
      if ((_c = options.signal) === null || _c === void 0 ? void 0 : _c.aborted) {
        throw new APIUserAbortError();
      }
      if (retriesRemaining) {
        return this.retryRequest(options, retriesRemaining);
      }
      if (response.name === 'AbortError') {
        throw new APIConnectionTimeoutError();
      }
      throw new APIConnectionError({ cause: response });
    }
    const responseHeaders = createResponseHeaders(response.headers);
    if (!response.ok) {
      if (retriesRemaining && this.shouldRetry(response)) {
        return this.retryRequest(options, retriesRemaining, responseHeaders);
      }
      const errText = await response.text().catch(() => 'Unknown');
      const errJSON = safeJSON(errText);
      const errMessage = errJSON ? undefined : errText;
      debug('response', response.status, url, responseHeaders, errMessage);
      const err = this.makeStatusError(response.status, errJSON, errMessage, responseHeaders);
      throw err;
    }
    return { response, options, controller };
  }
  requestAPIList(Page, options) {
    const request = this.makeRequest(options, null);
    return new PagePromise(this, request, Page);
  }
  buildURL(path, query) {
    const url =
      isAbsoluteURL(path) ?
        new URL(path)
      : new URL(this.baseURL + (this.baseURL.endsWith('/') && path.startsWith('/') ? path.slice(1) : path));
    const defaultQuery = this.defaultQuery();
    if (!isEmptyObj(defaultQuery)) {
      query = { ...defaultQuery, ...query };
    }
    if (query) {
      url.search = this.stringifyQuery(query);
    }
    return url.toString();
  }
  stringifyQuery(query) {
    return Object.entries(query)
      .filter(([_, value]) => typeof value !== 'undefined')
      .map(([key, value]) => {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
        }
        if (value === null) {
          return `${encodeURIComponent(key)}=`;
        }
        throw new Error(
          `Cannot stringify type ${typeof value}; Expected string, number, boolean, or null. If you need to pass nested query parameters, you can manually encode them, e.g. { query: { 'foo[key1]': value1, 'foo[key2]': value2 } }, and please open a GitHub issue requesting better support for your use case.`,
        );
      })
      .join('&');
  }
  async fetchWithTimeout(url, init, ms, controller) {
    const { signal, ...options } = init || {};
    if (signal) signal.addEventListener('abort', () => controller.abort());
    const timeout = setTimeout(() => controller.abort(), ms);
    return this.getRequestClient()
      .fetch(url, { signal: controller.signal, ...options })
      .finally(() => {
        clearTimeout(timeout);
      });
  }
  getRequestClient() {
    return { fetch: this.fetch };
  }
  shouldRetry(response) {
    // Note this is not a standard header.
    const shouldRetryHeader = response.headers.get('x-should-retry');
    // If the server explicitly says whether or not to retry, obey.
    if (shouldRetryHeader === 'true') return true;
    if (shouldRetryHeader === 'false') return false;
    // Retry on lock timeouts.
    if (response.status === 409) return true;
    // Retry on rate limits.
    if (response.status === 429) return true;
    // Retry internal errors.
    if (response.status >= 500) return true;
    return false;
  }
  async retryRequest(options, retriesRemaining, responseHeaders) {
    var _a;
    retriesRemaining -= 1;
    // About the Retry-After header: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After
    //
    // TODO: we may want to handle the case where the header is using the http-date syntax: "Retry-After: <http-date>".
    // See https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After#syntax for details.
    const retryAfter = parseInt(
      (responseHeaders === null || responseHeaders === void 0 ? void 0 : responseHeaders['retry-after']) ||
        '',
    );
    const maxRetries = (_a = options.maxRetries) !== null && _a !== void 0 ? _a : this.maxRetries;
    const timeout = this.calculateRetryTimeoutSeconds(retriesRemaining, retryAfter, maxRetries) * 1000;
    await sleep(timeout);
    return this.makeRequest(options, retriesRemaining);
  }
  calculateRetryTimeoutSeconds(retriesRemaining, retryAfter, maxRetries) {
    const initialRetryDelay = 0.5;
    const maxRetryDelay = 2;
    // If the API asks us to wait a certain amount of time (and it's a reasonable amount),
    // just do what it says.
    if (Number.isInteger(retryAfter) && retryAfter <= 60) {
      return retryAfter;
    }
    const numRetries = maxRetries - retriesRemaining;
    // Apply exponential backoff, but not more than the max.
    const sleepSeconds = Math.min(initialRetryDelay * Math.pow(numRetries - 1, 2), maxRetryDelay);
    // Apply some jitter, plus-or-minus half a second.
    const jitter = Math.random() - 0.5;
    return sleepSeconds + jitter;
  }
  getUserAgent() {
    return `${this.constructor.name}/JS ${VERSION}`;
  }
}
export class APIResource {
  constructor(client) {
    this.client = client;
    this.get = client.get.bind(client);
    this.post = client.post.bind(client);
    this.patch = client.patch.bind(client);
    this.put = client.put.bind(client);
    this.delete = client.delete.bind(client);
    this.getAPIList = client.getAPIList.bind(client);
  }
}
export class AbstractPage {
  constructor(client, response, body, options) {
    _AbstractPage_client.set(this, void 0);
    __classPrivateFieldSet(this, _AbstractPage_client, client, 'f');
    this.options = options;
    this.response = response;
    this.body = body;
  }
  hasNextPage() {
    const items = this.getPaginatedItems();
    if (!items.length) return false;
    return this.nextPageInfo() != null;
  }
  async getNextPage() {
    const nextInfo = this.nextPageInfo();
    if (!nextInfo) {
      throw new Error(
        'No next page expected; please check `.hasNextPage()` before calling `.getNextPage()`.',
      );
    }
    const nextOptions = { ...this.options };
    if ('params' in nextInfo) {
      nextOptions.query = { ...nextOptions.query, ...nextInfo.params };
    } else if ('url' in nextInfo) {
      const params = [...Object.entries(nextOptions.query || {}), ...nextInfo.url.searchParams.entries()];
      for (const [key, value] of params) {
        nextInfo.url.searchParams.set(key, value);
      }
      nextOptions.query = undefined;
      nextOptions.path = nextInfo.url.toString();
    }
    return await __classPrivateFieldGet(this, _AbstractPage_client, 'f').requestAPIList(
      this.constructor,
      nextOptions,
    );
  }
  async *iterPages() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let page = this;
    yield page;
    while (page.hasNextPage()) {
      page = await page.getNextPage();
      yield page;
    }
  }
  async *[((_AbstractPage_client = new WeakMap()), Symbol.asyncIterator)]() {
    for await (const page of this.iterPages()) {
      for (const item of page.getPaginatedItems()) {
        yield item;
      }
    }
  }
}
/**
 * This subclass of Promise will resolve to an instantiated Page once the request completes.
 *
 * It also implements AsyncIterable to allow auto-paginating iteration on an unawaited list call, eg:
 *
 *    for await (const item of client.items.list()) {
 *      console.log(item)
 *    }
 */
export class PagePromise extends APIPromise {
  constructor(client, request, Page) {
    super(
      request,
      async (props) => new Page(client, props.response, await defaultParseResponse(props), props.options),
    );
  }
  /**
   * Allow auto-paginating iteration on an unawaited list call, eg:
   *
   *    for await (const item of client.items.list()) {
   *      console.log(item)
   *    }
   */
  async *[Symbol.asyncIterator]() {
    const page = await this;
    for await (const item of page) {
      yield item;
    }
  }
}
export const createResponseHeaders = (headers) => {
  return new Proxy(
    Object.fromEntries(
      // @ts-ignore
      headers.entries(),
    ),
    {
      get(target, name) {
        const key = name.toString();
        return target[key.toLowerCase()] || target[key];
      },
    },
  );
};
// This is required so that we can determine if a given object matches the RequestOptions
// type at runtime. While this requires duplication, it is enforced by the TypeScript
// compiler such that any missing / extraneous keys will cause an error.
const requestOptionsKeys = {
  method: true,
  path: true,
  query: true,
  body: true,
  headers: true,
  maxRetries: true,
  stream: true,
  timeout: true,
  httpAgent: true,
  signal: true,
  idempotencyKey: true,
};
export const isRequestOptions = (obj) => {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    !isEmptyObj(obj) &&
    Object.keys(obj).every((k) => hasOwn(requestOptionsKeys, k))
  );
};
const getPlatformProperties = () => {
  if (typeof Deno !== 'undefined' && Deno.build != null) {
    return {
      'X-Stainless-Lang': 'js',
      'X-Stainless-Package-Version': VERSION,
      'X-Stainless-OS': normalizePlatform(Deno.build.os),
      'X-Stainless-Arch': normalizeArch(Deno.build.arch),
      'X-Stainless-Runtime': 'deno',
      'X-Stainless-Runtime-Version': Deno.version,
    };
  }
  if (typeof EdgeRuntime !== 'undefined') {
    return {
      'X-Stainless-Lang': 'js',
      'X-Stainless-Package-Version': VERSION,
      'X-Stainless-OS': 'Unknown',
      'X-Stainless-Arch': `other:${EdgeRuntime}`,
      'X-Stainless-Runtime': 'edge',
      'X-Stainless-Runtime-Version': process.version,
    };
  }
  // Check if Node.js
  if (Object.prototype.toString.call(typeof process !== 'undefined' ? process : 0) === '[object process]') {
    return {
      'X-Stainless-Lang': 'js',
      'X-Stainless-Package-Version': VERSION,
      'X-Stainless-OS': normalizePlatform(process.platform),
      'X-Stainless-Arch': normalizeArch(process.arch),
      'X-Stainless-Runtime': 'node',
      'X-Stainless-Runtime-Version': process.version,
    };
  }
  const browserInfo = getBrowserInfo();
  if (browserInfo) {
    return {
      'X-Stainless-Lang': 'js',
      'X-Stainless-Package-Version': VERSION,
      'X-Stainless-OS': 'Unknown',
      'X-Stainless-Arch': 'unknown',
      'X-Stainless-Runtime': `browser:${browserInfo.browser}`,
      'X-Stainless-Runtime-Version': browserInfo.version,
    };
  }
  // TODO add support for Cloudflare workers, etc.
  return {
    'X-Stainless-Lang': 'js',
    'X-Stainless-Package-Version': VERSION,
    'X-Stainless-OS': 'Unknown',
    'X-Stainless-Arch': 'unknown',
    'X-Stainless-Runtime': 'unknown',
    'X-Stainless-Runtime-Version': 'unknown',
  };
};
// Note: modified from https://github.com/JS-DevTools/host-environment/blob/b1ab79ecde37db5d6e163c050e54fe7d287d7c92/src/isomorphic.browser.ts
function getBrowserInfo() {
  if (!navigator || typeof navigator === 'undefined') {
    return null;
  }
  // NOTE: The order matters here!
  const browserPatterns = [
    { key: 'edge', pattern: /Edge(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: 'ie', pattern: /MSIE(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: 'ie', pattern: /Trident(?:.*rv\:(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: 'chrome', pattern: /Chrome(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: 'firefox', pattern: /Firefox(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: 'safari', pattern: /(?:Version\W+(\d+)\.(\d+)(?:\.(\d+))?)?(?:\W+Mobile\S*)?\W+Safari/ },
  ];
  // Find the FIRST matching browser
  for (const { key, pattern } of browserPatterns) {
    const match = pattern.exec(navigator.userAgent);
    if (match) {
      const major = match[1] || 0;
      const minor = match[2] || 0;
      const patch = match[3] || 0;
      return { browser: key, version: `${major}.${minor}.${patch}` };
    }
  }
  return null;
}
const normalizeArch = (arch) => {
  // Node docs:
  // - https://nodejs.org/api/process.html#processarch
  // Deno docs:
  // - https://doc.deno.land/deno/stable/~/Deno.build
  if (arch === 'x32') return 'x32';
  if (arch === 'x86_64' || arch === 'x64') return 'x64';
  if (arch === 'arm') return 'arm';
  if (arch === 'aarch64' || arch === 'arm64') return 'arm64';
  if (arch) return `other:${arch}`;
  return 'unknown';
};
const normalizePlatform = (platform) => {
  // Node platforms:
  // - https://nodejs.org/api/process.html#processplatform
  // Deno platforms:
  // - https://doc.deno.land/deno/stable/~/Deno.build
  // - https://github.com/denoland/deno/issues/14799
  platform = platform.toLowerCase();
  // NOTE: this iOS check is untested and may not work
  // Node does not work natively on IOS, there is a fork at
  // https://github.com/nodejs-mobile/nodejs-mobile
  // however it is unknown at the time of writing how to detect if it is running
  if (platform.includes('ios')) return 'iOS';
  if (platform === 'android') return 'Android';
  if (platform === 'darwin') return 'MacOS';
  if (platform === 'win32') return 'Windows';
  if (platform === 'freebsd') return 'FreeBSD';
  if (platform === 'openbsd') return 'OpenBSD';
  if (platform === 'linux') return 'Linux';
  if (platform) return `Other:${platform}`;
  return 'Unknown';
};
let _platformHeaders;
const getPlatformHeaders = () => {
  return _platformHeaders !== null && _platformHeaders !== void 0 ?
      _platformHeaders
    : (_platformHeaders = getPlatformProperties());
};
export const safeJSON = (text) => {
  try {
    return JSON.parse(text);
  } catch (err) {
    return undefined;
  }
};
// https://stackoverflow.com/a/19709846
const startsWithSchemeRegexp = new RegExp('^(?:[a-z]+:)?//', 'i');
const isAbsoluteURL = (url) => {
  return startsWithSchemeRegexp.test(url);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const validatePositiveInteger = (name, n) => {
  if (typeof n !== 'number' || !Number.isInteger(n)) {
    throw new Error(`${name} must be an integer`);
  }
  if (n < 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return n;
};
export const castToError = (err) => {
  if (err instanceof Error) return err;
  return new Error(err);
};
export const ensurePresent = (value) => {
  if (value == null) throw new Error(`Expected a value to be given but received ${value} instead.`);
  return value;
};
/**
 * Read an environment variable.
 *
 * Will return undefined if the environment variable doesn't exist or cannot be accessed.
 */
export const readEnv = (env) => {
  var _a, _b, _c, _d;
  if (typeof process !== 'undefined') {
    return (_b = (_a = process.env) === null || _a === void 0 ? void 0 : _a[env]) !== null && _b !== void 0 ?
        _b
      : undefined;
  }
  if (typeof Deno !== 'undefined') {
    return (_d = (_c = Deno.env) === null || _c === void 0 ? void 0 : _c.get) === null || _d === void 0 ?
        void 0
      : _d.call(_c, env);
  }
  return undefined;
};
export const coerceInteger = (value) => {
  if (typeof value === 'number') return Math.round(value);
  if (typeof value === 'string') return parseInt(value, 10);
  throw new Error(`Could not coerce ${value} (type: ${typeof value}) into a number`);
};
export const coerceFloat = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseFloat(value);
  throw new Error(`Could not coerce ${value} (type: ${typeof value}) into a number`);
};
export const coerceBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return Boolean(value);
};
export const maybeCoerceInteger = (value) => {
  if (value === undefined) {
    return undefined;
  }
  return coerceInteger(value);
};
export const maybeCoerceFloat = (value) => {
  if (value === undefined) {
    return undefined;
  }
  return coerceFloat(value);
};
export const maybeCoerceBoolean = (value) => {
  if (value === undefined) {
    return undefined;
  }
  return coerceBoolean(value);
};
// https://stackoverflow.com/a/34491287
export function isEmptyObj(obj) {
  if (!obj) return true;
  for (const _k in obj) return false;
  return true;
}
// https://eslint.org/docs/latest/rules/no-prototype-builtins
export function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
export function debug(action, ...args) {
  if (typeof process !== 'undefined' && process.env['DEBUG'] === 'true') {
    console.log(`OpenAI:DEBUG:${action}`, ...args);
  }
}
/**
 * https://stackoverflow.com/a/2117523
 */
const uuid4 = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};
export const isRunningInBrowser = () => {
  return (
    // @ts-ignore
    typeof window !== 'undefined' &&
    // @ts-ignore
    typeof window.document !== 'undefined' &&
    // @ts-ignore
    typeof navigator !== 'undefined'
  );
};
export const isHeadersProtocol = (headers) => {
  return typeof (headers === null || headers === void 0 ? void 0 : headers.get) === 'function';
};
export const getHeader = (headers, key) => {
  const lowerKey = key.toLowerCase();
  if (isHeadersProtocol(headers)) return headers.get(key) || headers.get(lowerKey);
  const value = headers[key] || headers[lowerKey];
  if (Array.isArray(value)) {
    if (value.length <= 1) return value[0];
    console.warn(`Received ${value.length} entries for the ${key} header, using the first entry.`);
    return value[0];
  }
  return value;
};
/**
 * Encodes a string to Base64 format.
 */
export const toBase64 = (str) => {
  if (!str) return '';
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str).toString('base64');
  }
  if (typeof btoa !== 'undefined') {
    return btoa(str);
  }
  throw new Error('Cannot generate b64 string; Expected `Buffer` or `btoa` to be defined');
};
//# sourceMappingURL=core.mjs.map
