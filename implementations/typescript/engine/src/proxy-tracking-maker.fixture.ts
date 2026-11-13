// Test fixture (S1 proxy tracking): a module that creates proxies at module
// evaluation, like type-foundation's `Str`.
export const madeAtLoad = new Proxy({ a: 1 }, {});
export const revocableAtLoad = Proxy.revocable({ b: 2 }, {}).proxy;
