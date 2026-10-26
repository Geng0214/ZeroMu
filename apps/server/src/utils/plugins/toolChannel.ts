import { AsyncLocalStorage } from "node:async_hooks";

type ToolReference = { owner: string; id: string; kind: "function" | "object"; sync?: boolean; array?: boolean };
type ToolMessage = { type: string; id?: string; scope?: string; action?: string; target?: string; args?: any; data?: any; error?: any };
type ToolReply = { data?: any; error?: any; deferred?: string; callbacks?: ToolMessage[] };
type ToolPending = ReturnType<typeof Promise.withResolvers<any>> & { scope: string };
const blockedReferences = new Set<unknown>([
  Object, Object.prototype, Function, Function.prototype, Reflect, Proxy, eval,
  Object.getPrototypeOf(async () => {}).constructor,
  Object.getPrototypeOf(function* () {}).constructor,
  Object.getPrototypeOf(async function* () {}).constructor,
]);
for (const value of [...blockedReferences]) {
  if (typeof value === "function") blockedReferences.add(value.prototype);
  if (!value || !["object", "function"].includes(typeof value)) continue;
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    for (const member of [descriptor.value, descriptor.get, descriptor.set]) {
      if (typeof member === "function") blockedReferences.add(member);
    }
  }
}
const blockedProperties = new Set(["constructor", "prototype", "__proto__", "caller", "callee", "arguments"]);
const knownSymbols = new Map(Object.getOwnPropertyNames(Symbol)
  .map(name => [name, Object.getOwnPropertyDescriptor(Symbol, name)?.value] as const)
  .filter((entry): entry is readonly [string, symbol] => typeof entry[1] === "symbol"));

function reflectionError() {
  return Object.assign(new Error("插件不能访问宿主原型、反射方法或代码构造入口"), { code: "TOOL_HOST_REFLECTION_DENIED", status: 403 });
}

/** 只传当前端点显式导出的引用；函数、原型对象与取消信号不退化成 JSON 空对象。 */
export class ToolChannel {
  private references = new Map<string, { value: any; receiver?: any; bound?: any; scopes: Set<string> }>();
  private referenceIds = new WeakMap<object, Map<any, string>>();
  private remoteReferences = new WeakMap<object, ToolReference>();
  private remoteValues = new Map<string, any>();
  private remoteScopes = new Map<string, Set<string>>();
  private synchronousFunctions = new WeakSet<Function>();
  private opaqueValues = new WeakSet<object>();
  private mutableValues = new WeakMap<object, Set<string> | null>();
  private passiveValues = new WeakSet<object>();
  private methods = new Map<string, (...args: any[]) => any>();
  private pending = new Map<string, ToolPending>();
  private deferred = new Map<string, ToolPending>();
  private earlyDeferred = new Map<string, ToolMessage>();
  private signalControllers = new Map<string, AbortController>();
  private signalScopes = new Map<string, Set<string>>();
  private earlyAborts = new Map<string, { data: any; scopes: Set<string> }>();
  private signalListeners = new Map<AbortSignal, () => void>();
  private scope = new AsyncLocalStorage<string>();
  private liveScopes = new Set(["init"]);
  private synchronizingScopes = new Map<string, number>();
  private syncCallbacks: ToolMessage[] | undefined;
  private failure: Error | undefined;

  constructor(
    readonly owner: "host" | "worker",
    private send: (message: ToolMessage) => void,
    private synchronize?: (message: ToolMessage) => ToolReply,
    private authorize = (_scope: string, _message: ToolMessage) => {},
  ) {}

  register(name: string, operation: (...args: any[]) => any) { this.methods.set(name, operation); }
  run<T>(scope: string, operation: () => T): T { return this.scope.run(scope, operation); }
  currentScope() { return this.scope.getStore() ?? "init"; }
  openScope(scope: string) {
    if (this.failure) throw this.failure;
    if (this.owner !== "host" || this.liveScopes.has(scope)) throw new Error("插件调用范围无法重复创建");
    this.liveScopes.add(scope);
    this.transmit({ type: "scopeStart", scope });
  }
  markSynchronous(value: Function) { this.synchronousFunctions.add(value); }
  markOpaque(value: object) { this.opaqueValues.add(value); }
  markMutable(value: object, properties?: readonly string[]) {
    this.markOpaque(value);
    this.mutableValues.set(value, properties ? new Set(properties) : null);
  }
  markPassive(value: object) { this.passiveValues.add(value); }
  canUsePassive(message: ToolMessage) {
    if (message.action === "method") return false;
    const entry = this.references.get(message.target!);
    return !!entry && (this.passiveValues.has(entry.value) || (entry.receiver && this.passiveValues.has(entry.receiver))
      || (this.mutableValues.has(entry.value) && ["get", "has", "keys", "set", "delete"].includes(message.action ?? "")));
  }
  isRemote(value: object) {
    const reference = this.remoteReferences.get(value);
    return !!reference && reference.owner !== this.owner;
  }

  private reference(value: object, receiver?: any): string {
    let receivers = this.referenceIds.get(value);
    if (!receivers) this.referenceIds.set(value, receivers = new Map());
    let id = receivers.get(receiver);
    if (!id) {
      id = crypto.randomUUID();
      receivers.set(receiver, id);
      this.references.set(id, { value, receiver, scopes: new Set() });
    }
    this.references.get(id)!.scopes.add(this.currentScope());
    return id;
  }

  private getReference(id: string) {
    const entry = this.references.get(id);
    const scope = this.currentScope();
    if (!this.liveScopes.has(scope) || !entry || (!entry.scopes.has(scope) && !entry.scopes.has("init"))) {
      throw Object.assign(new Error("插件通道引用不属于当前调用范围或已释放"), { code: "TOOL_REFERENCE_DENIED", status: 403 });
    }
    return entry;
  }

  encode(value: any, forceSynchronous = false, receiver?: any): any {
    const visited = new WeakMap<object, number>();
    let nextId = 0;
    const encode = (value: any, receiver?: any, key?: PropertyKey): any => {
      if (typeof value === "symbol") {
        const name = Symbol.keyFor(value);
        if (name !== undefined) return { kind: "globalSymbol", name };
        const known = [...knownSymbols].find(([, symbol]) => symbol === value)?.[0];
        if (known) return { kind: "knownSymbol", name: known };
        throw new Error("插件消息包含不能跨进程复制的局部 Symbol");
      }
      if (value === null || !["object", "function"].includes(typeof value)) return { kind: "value", value };
      if (blockedReferences.has(value)) throw reflectionError();
      // 已登记的远端引用直接往返，不能在检查本地对象时再次进入远端。
      const remote = this.remoteReferences.get(value);
      if (remote) return { kind: "reference", owner: remote.owner, id: remote.id, referenceKind: remote.kind, sync: remote.sync, array: remote.array };
      if (typeof value === "object") {
        const constructor = Object.getOwnPropertyDescriptor(value, "constructor")?.value;
        if (typeof constructor === "function" && Object.getOwnPropertyDescriptor(constructor, "prototype")?.value === value) throw reflectionError();
      }
      if (typeof value === "function") return {
        kind: "reference", owner: this.owner, id: this.reference(value, receiver),
        referenceKind: "function", sync: forceSynchronous || this.synchronousFunctions.has(value)
          || ["prepareArguments", "renderCall", "renderResult"].includes(String(key)),
      };
      if (value instanceof AbortSignal) {
        const id = this.reference(value);
        if (!this.signalListeners.has(value)) {
          const abort = () => {
            // 关闭期间远端可能先退出；取消通知失败不能变成 EventTarget 的未捕获异常。
            for (const scope of this.references.get(id)?.scopes ?? []) {
              try { this.run(scope, () => this.transmit({ type: "abort", id, scope, data: this.encode(value.reason) })); } catch {}
            }
          };
          value.addEventListener("abort", abort, { once: true });
          this.signalListeners.set(value, () => value.removeEventListener("abort", abort));
        }
        return { kind: "signal", owner: this.owner, id, aborted: value.aborted, reason: value.aborted ? encode(value.reason) : undefined };
      }
      if (this.opaqueValues.has(value)) return { kind: "reference", owner: this.owner, id: this.reference(value), referenceKind: "object", array: Array.isArray(value) };
      if (Buffer.isBuffer(value)) return { kind: "buffer", bytes: new Uint8Array(value) };
      if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Date || value instanceof RegExp) return { kind: "clone", value };
      if ((!Array.isArray(value) && !(value instanceof Error)
        && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) {
        return { kind: "reference", owner: this.owner, id: this.reference(value), referenceKind: "object", array: Array.isArray(value) };
      }
      const previous = visited.get(value);
      if (previous !== undefined) return { kind: "previous", id: previous };
      const id = nextId++;
      visited.set(value, id);
      if (Array.isArray(value)) return { kind: "array", id, values: value.map(item => encode(item)) };
      const keys = value instanceof Error ? [...new Set([...Reflect.ownKeys(value), "name", "message"])] : Reflect.ownKeys(value);
      return {
        kind: value instanceof Error ? "error" : "record", id, nullPrototype: Object.getPrototypeOf(value) === null,
        entries: keys.map(key => [encode(key), encode(Reflect.get(value, key), value, key), Object.getOwnPropertyDescriptor(value, key)?.enumerable ?? false]),
      };
    };
    return encode(value, receiver);
  }

  decode(data: any): any {
    const visited = new Map<number, any>();
    const decode = (item: any): any => {
      if (!item || typeof item !== "object" || typeof item.kind !== "string") throw new Error("插件通道数据无效");
      if (item.kind === "value") {
        if (item.value !== null && !["undefined", "string", "number", "boolean", "bigint"].includes(typeof item.value)) throw new Error("插件通道基础值无效");
        return item.value;
      }
      if (item.kind === "clone") {
        if (!ArrayBuffer.isView(item.value) && !(item.value instanceof ArrayBuffer) && !(item.value instanceof Date) && !(item.value instanceof RegExp)) throw new Error("插件通道复制值无效");
        return item.value;
      }
      if (item.kind === "globalSymbol") {
        if (typeof item.name !== "string") throw new Error("插件通道 Symbol 无效");
        return Symbol.for(item.name);
      }
      if (item.kind === "knownSymbol") {
        if (typeof item.name !== "string" || !knownSymbols.has(item.name)) throw reflectionError();
        return knownSymbols.get(item.name);
      }
      if (item.kind === "buffer") {
        if (!(item.bytes instanceof Uint8Array)) throw new Error("插件通道缓冲区无效");
        return Buffer.from(item.bytes);
      }
      if (item.kind === "previous") {
        if (!visited.has(item.id)) throw new Error("插件通道循环引用无效");
        return visited.get(item.id);
      }
      if (item.kind === "signal") {
        if (!["host", "worker"].includes(item.owner) || typeof item.id !== "string" || typeof item.aborted !== "boolean") throw new Error("插件通道取消信号无效");
        if (item.owner === this.owner) {
          const value = this.getReference(item.id).value;
          if (!(value instanceof AbortSignal)) throw new Error("插件通道取消信号引用无效");
          return value;
        }
        let controller = this.signalControllers.get(item.id);
        if (!controller) this.signalControllers.set(item.id, controller = new AbortController());
        let scopes = this.signalScopes.get(item.id);
        if (!scopes) this.signalScopes.set(item.id, scopes = new Set());
        scopes.add(this.currentScope());
        if (item.aborted && !controller.signal.aborted) controller.abort(decode(item.reason));
        if (this.earlyAborts.has(item.id)) {
          const early = this.earlyAborts.get(item.id)!;
          for (const scope of early.scopes) scopes.add(scope);
          controller.abort(this.decode(early.data));
          this.earlyAborts.delete(item.id);
        }
        return controller.signal;
      }
      if (item.kind === "reference") {
        if (!["host", "worker"].includes(item.owner) || typeof item.id !== "string" || !["function", "object"].includes(item.referenceKind)
          || (item.sync !== undefined && typeof item.sync !== "boolean") || (item.array !== undefined && typeof item.array !== "boolean")
          || (item.array === true && item.referenceKind !== "object")) throw new Error("插件通道引用无效");
        if (item.owner === this.owner) {
          const entry = this.getReference(item.id);
          if ((typeof entry.value === "function" ? "function" : "object") !== item.referenceKind) throw new Error("插件通道引用类型无效");
          if (item.array !== undefined && item.array !== Array.isArray(entry.value)) throw new Error("插件通道数组引用无效");
          if (typeof entry.value !== "function" || entry.receiver === undefined) return entry.value;
          if (!entry.bound) {
            entry.bound = entry.value.bind(entry.receiver);
            this.remoteReferences.set(entry.bound, { owner: this.owner, id: item.id, kind: "function", sync: item.sync });
          }
          return entry.bound;
        }
        return this.remote(item);
      }
      if (!["array", "record", "error"].includes(item.kind)) throw new Error("插件通道数据类型无效");
      if (!Number.isSafeInteger(item.id) || item.id < 0 || visited.has(item.id)) throw new Error("插件通道数据编号无效");
      if (!Array.isArray(item.kind === "array" ? item.values : item.entries)) throw new Error("插件通道数据内容无效");
      const value: any = item.kind === "array" ? [] : item.kind === "error" ? new Error() : item.nullPrototype ? Object.create(null) : {};
      visited.set(item.id, value);
      if (item.kind === "array") for (const entry of item.values) value.push(decode(entry));
      else for (const entry of item.entries) {
        if (!Array.isArray(entry) || entry.length !== 3 || typeof entry[2] !== "boolean") throw new Error("插件通道属性无效");
        const key = decode(entry[0]);
        if (typeof key !== "string" && typeof key !== "symbol") throw new Error("插件通道属性名无效");
        Object.defineProperty(value, key, { value: decode(entry[1]), writable: true, enumerable: entry[2], configurable: true });
      }
      return value;
    };
    return decode(data);
  }

  private remote(item: any) {
    const key = `${item.owner}:${item.id}`;
    let scopes = this.remoteScopes.get(key);
    if (!scopes) this.remoteScopes.set(key, scopes = new Set());
    scopes.add(this.currentScope());
    const previous = this.remoteValues.get(key);
    if (previous) return previous;
    const reference: ToolReference = { owner: item.owner, id: item.id, kind: item.referenceKind ?? item.kind, sync: item.sync, array: item.array };
    const withinScope = <T>(operation: () => T): T => this.run(this.scope.getStore()
      ?? [...scopes].find(scope => scope !== "init" && this.liveScopes.has(scope)) ?? "init", operation);
    const invoke = (...args: any[]) => withinScope(() => {
      if (reference.sync) return this.requestSync("invoke", reference.id, args);
      const result = this.request("invoke", reference.id, args);
      // 事件回调可能不消费返回 Promise；等待者仍然收到原 Promise 的拒绝。
      void result.catch(() => {});
      return result;
    });
    const proxy = new Proxy(reference.kind === "function" ? invoke : reference.array ? [] : {}, {
      get: (_target, property) => {
        if (property === "then") return undefined;
        if (reference.kind === "function" && property === "toJSON") return undefined;
        if (reference.kind === "function" && ["call", "apply", "bind", "toString"].includes(String(property))) return Reflect.get(Function.prototype, property);
        // 数组迭代和回调在调用方执行，不把插件的同步回调放进宿主数组方法。
        if (reference.array && property !== "constructor" && typeof Reflect.get(Array.prototype, property) === "function") return Reflect.get(Array.prototype, property);
        return withinScope(() => this.requestSync("get", reference.id, [property]));
      },
      has: (_target, property) => withinScope(() => this.requestSync("has", reference.id, [property])),
      set: (_target, property, value) => withinScope(() => {
        if (value && typeof value === "object" && !this.remoteReferences.has(value) && !this.mutableValues.has(value)) this.markMutable(value);
        return this.requestSync("set", reference.id, [property, value]);
      }),
      deleteProperty: (_target, property) => withinScope(() => this.requestSync("delete", reference.id, [property])),
      ownKeys: target => withinScope(() => [...new Set([
        ...Reflect.ownKeys(target).filter(key => !Object.getOwnPropertyDescriptor(target, key)?.configurable),
        ...this.requestSync("keys", reference.id, []),
      ])]),
      getOwnPropertyDescriptor: (target, property) => withinScope(() => {
        const local = Object.getOwnPropertyDescriptor(target, property);
        if (local && !local.configurable) {
          if (reference.array && property === "length") Reflect.set(target, "length", this.requestSync("get", reference.id, [property]));
          return Object.getOwnPropertyDescriptor(target, property);
        }
        return this.requestSync("has", reference.id, [property]) ? { configurable: true, enumerable: true } : undefined;
      }),
    });
    this.remoteReferences.set(proxy, reference);
    this.remoteValues.set(key, proxy);
    return proxy;
  }

  private transmit(message: ToolMessage) {
    if (this.failure) throw this.failure;
    if (this.syncCallbacks && message.type === "request") this.syncCallbacks.push(message);
    else this.send(message);
  }

  request(action: string, target: string, args: any[]): Promise<any> {
    if (this.failure) return Promise.reject(this.failure);
    const scope = this.currentScope();
    if (!this.liveScopes.has(scope)) return Promise.reject(Object.assign(new Error("工具调用上下文已结束"), { code: "TOOL_CALL_CLOSED" }));
    const id = crypto.randomUUID();
    const pending = { ...Promise.withResolvers<any>(), scope };
    this.pending.set(id, pending);
    try { this.transmit({ type: "request", id, scope, action, target, args: this.encode(args) }); }
    catch (error) { this.pending.delete(id); pending.reject(error); }
    return pending.promise;
  }

  private requestSync(action: string, target: string, args: any[]) {
    if (this.failure) throw this.failure;
    const scope = this.currentScope();
    if (!this.liveScopes.has(scope)) throw Object.assign(new Error("工具调用上下文已结束"), { code: "TOOL_CALL_CLOSED" });
    if (!this.synchronize) throw Object.assign(new Error("当前插件通道尚不支持宿主同步调用子进程钩子"), { code: "TOOL_SYNC_CALLBACK_UNAVAILABLE" });
    this.synchronizingScopes.set(scope, (this.synchronizingScopes.get(scope) ?? 0) + 1);
    try {
      const reply = this.synchronize({ type: "request", scope, action, target, args: this.encode(args) });
      for (const callback of reply.callbacks ?? []) void this.receive(callback);
      if (reply.error) throw this.decode(reply.error);
      if (!reply.deferred) return this.decode(reply.data);
      const result = { ...Promise.withResolvers<any>(), scope };
      void result.promise.catch(() => {});
      this.deferred.set(reply.deferred, result);
      const early = this.earlyDeferred.get(reply.deferred);
      if (early) { this.earlyDeferred.delete(reply.deferred); this.finishDeferred(early); }
      return result.promise;
    } finally {
      const count = this.synchronizingScopes.get(scope)! - 1;
      if (count) this.synchronizingScopes.set(scope, count);
      else {
        this.synchronizingScopes.delete(scope);
        for (const [id, message] of this.earlyDeferred) if (message.scope === scope) this.earlyDeferred.delete(id);
      }
    }
  }

  private invoke(message: ToolMessage) {
    if (!message || typeof message !== "object" || message.type !== "request" || typeof message.scope !== "string"
      || typeof message.target !== "string" || !["method", "get", "has", "keys", "set", "delete", "invoke"].includes(message.action ?? "")) throw new Error("插件通道请求无效");
    if (this.failure) throw this.failure;
    if (!this.liveScopes.has(message.scope ?? "init")) throw Object.assign(new Error("工具调用上下文已结束"), { code: "TOOL_CALL_CLOSED" });
    this.authorize(message.scope ?? "init", message);
    const args = this.decode(message.args);
    if (!Array.isArray(args)) throw new Error("插件通道参数无效");
    if (message.action === "method") {
      const method = this.methods.get(message.target!);
      if (!method) throw new Error("插件通道操作不存在");
      return Reflect.apply(method, undefined, args);
    }
    const entry = this.getReference(message.target);
    if (["get", "has", "set", "delete"].includes(message.action!)) {
      const property = args[0];
      if (args.length !== (message.action === "set" ? 2 : 1) || (typeof property !== "string" && typeof property !== "symbol")) throw new Error("插件通道属性名无效");
      if (typeof property === "string" && blockedProperties.has(property)) throw reflectionError();
      if (message.action === "set" || message.action === "delete") {
        const properties = this.mutableValues.get(entry.value);
        if (properties === undefined || (properties && (typeof property !== "string" || !properties.has(property)))) throw Object.assign(new Error("插件不能修改此引用"), { code: "TOOL_REFERENCE_MUTATION_DENIED", status: 403 });
        return message.action === "set" ? Reflect.set(entry.value, property, args[1]) : Reflect.deleteProperty(entry.value, property);
      }
      // 只导出对象自身及业务原型声明的成员；基础原型的反射方法不能成为宿主能力。
      for (let owner = entry.value; owner; owner = Object.getPrototypeOf(owner)) {
        if (owner === Object.prototype || owner === Function.prototype) {
          if (Reflect.has(owner, property)) throw reflectionError();
          return message.action === "has" ? false : undefined;
        }
        if (Object.hasOwn(owner, property)) {
          if (message.action === "has") return true;
          const result = Reflect.get(entry.value, property);
          if (typeof result === "function" && this.passiveValues.has(entry.value)) this.markPassive(result);
          if (result && typeof result === "object" && owner === entry.value && this.mutableValues.get(entry.value) === null
            && (Array.isArray(result) || [Object.prototype, null].includes(Object.getPrototypeOf(result)))) this.markMutable(result);
          return result;
        }
      }
      return message.action === "has" ? false : undefined;
    }
    if (message.action === "keys") {
      if (args.length) throw new Error("插件通道参数无效");
      return Reflect.ownKeys(entry.value).filter(key => typeof key !== "string" || !blockedProperties.has(key));
    }
    if (message.action !== "invoke" || typeof entry.value !== "function") throw new Error("插件通道调用无效");
    if (blockedReferences.has(entry.value)) throw reflectionError();
    const result = Reflect.apply(entry.value, entry.receiver, args);
    if (typeof result === "function" && (this.passiveValues.has(entry.value) || (entry.receiver && this.passiveValues.has(entry.receiver)))) this.markPassive(result);
    return result;
  }

  receiveSync(message: ToolMessage): ToolReply {
    const previous = this.syncCallbacks;
    const callbacks: ToolMessage[] = [];
    this.syncCallbacks = callbacks;
    try {
      return this.run(message?.scope ?? "init", () => {
        const result = this.invoke(message);
        if (result instanceof Promise) {
          const id = crypto.randomUUID();
          const scope = message.scope ?? "init";
          const settle = (value: any, failure = false) => {
            if (!this.failure && this.liveScopes.has(scope)) this.send({ type: "deferred", id, scope, [failure ? "error" : "data"]: this.encode(value) });
          };
          void result.then(value => settle(value), error => settle(error, true)).catch(() => {});
          return { deferred: id, callbacks };
        }
        return { data: this.encode(result, message.action === "get" || typeof result === "function", message.action === "get" ? this.references.get(message.target!)?.value : undefined), callbacks };
      });
    } catch (error) { return { error: this.encode(error), callbacks }; }
    finally { this.syncCallbacks = previous; }
  }

  private finishDeferred(message: ToolMessage) {
    const pending = this.deferred.get(message.id!);
    if (!pending) {
      if (this.synchronizingScopes.has(message.scope ?? "init")) this.earlyDeferred.set(message.id!, message);
      return;
    }
    if (message.scope !== pending.scope) throw new Error("插件通道响应范围无效");
    this.deferred.delete(message.id!);
    try { this.run(pending.scope, () => message.error ? pending.reject(this.decode(message.error)) : pending.resolve(this.decode(message.data))); }
    catch (error) { pending.reject(error); }
  }

  async receive(message: ToolMessage): Promise<void> {
    if (this.failure) return;
    if (!message || typeof message !== "object" || typeof message.scope !== "string" || !message.scope
      || !["scopeStart", "scopeEnd", "abort", "deferred", "response", "request"].includes(message.type)) throw new Error("插件通道消息无效");
    if (message.type === "scopeStart" || message.type === "scopeEnd") {
      if (this.owner !== "worker" || typeof message.scope !== "string" || message.scope === "init") throw new Error("插件调用范围消息无效");
      if (message.type === "scopeStart") this.liveScopes.add(message.scope);
      else this.releaseScope(message.scope, false);
      return;
    }
    if (typeof message.id !== "string" || !message.id) throw new Error("插件通道消息编号无效");
    if (message.type === "abort") {
      const scope = message.scope ?? "init";
      if (!this.liveScopes.has(scope)) return;
      const controller = this.signalControllers.get(message.id!);
      if (controller) {
        if (!this.signalScopes.get(message.id!)?.has(scope)) throw new Error("插件通道取消信号范围无效");
        controller.abort(this.run(scope, () => this.decode(message.data)));
      } else {
        const early = this.earlyAborts.get(message.id!);
        if (early) early.scopes.add(scope);
        else this.earlyAborts.set(message.id!, { data: message.data, scopes: new Set([scope]) });
      }
      return;
    }
    if (message.type === "deferred") { this.finishDeferred(message); return; }
    if (message.type === "response") {
      const pending = this.pending.get(message.id!);
      if (!pending) return;
      if (message.scope !== pending.scope) throw new Error("插件通道响应范围无效");
      this.pending.delete(message.id!);
      try { this.run(pending.scope, () => message.error ? pending.reject(this.decode(message.error)) : pending.resolve(this.decode(message.data))); }
      catch (error) { pending.reject(error); }
      return;
    }
    if (message.type !== "request" || typeof message.id !== "string") throw new Error("插件通道消息类型无效");
    await this.run(message.scope ?? "init", async () => {
      try {
        const result = await this.invoke(message);
        if (!this.failure && this.liveScopes.has(message.scope ?? "init")) this.transmit({ type: "response", id: message.id, scope: message.scope, data: this.encode(result) });
      } catch (error) {
        if (!this.failure && this.liveScopes.has(message.scope ?? "init")) this.transmit({ type: "response", id: message.id, scope: message.scope, error: this.encode(error) });
      }
    });
  }

  abortSignals(reason: Error) {
    for (const controller of this.signalControllers.values()) controller.abort(reason);
  }

  releaseScope(scope: string, notify = true) {
    if (scope === "init") throw new Error("插件初始化引用随实例释放");
    if (!this.liveScopes.delete(scope)) return;
    const reason = Object.assign(new Error("工具调用上下文已结束"), { code: "TOOL_CALL_CLOSED" });
    // ACT: 扫描仅包含初始化及仍活跃调用的引用，不保留已结束调用的历史表。
    for (const [id, entry] of this.references) {
      entry.scopes.delete(scope);
      if (entry.scopes.size) continue;
      this.references.delete(id);
      this.referenceIds.get(entry.value)?.delete(entry.receiver);
      if (entry.bound) this.remoteReferences.delete(entry.bound);
      if (entry.value instanceof AbortSignal) {
        this.signalListeners.get(entry.value)?.();
        this.signalListeners.delete(entry.value);
      }
    }
    for (const [key, scopes] of this.remoteScopes) {
      scopes.delete(scope);
      if (!scopes.size) { this.remoteScopes.delete(key); this.remoteValues.delete(key); }
    }
    for (const [id, scopes] of this.signalScopes) {
      scopes.delete(scope);
      if (!scopes.size) {
        this.signalScopes.delete(id);
        const controller = this.signalControllers.get(id);
        this.signalControllers.delete(id);
        controller?.abort(reason);
      }
    }
    for (const values of [this.pending, this.deferred]) for (const [id, pending] of values) {
      if (pending.scope === scope) { values.delete(id); pending.reject(reason); }
    }
    for (const [id, early] of this.earlyAborts) {
      early.scopes.delete(scope);
      if (!early.scopes.size) this.earlyAborts.delete(id);
    }
    for (const [id, message] of this.earlyDeferred) if (message.scope === scope) this.earlyDeferred.delete(id);
    if (notify && !this.failure) {
      try { this.transmit({ type: "scopeEnd", scope }); } catch {}
    }
  }

  close(reason = new Error("插件通道已关闭")) {
    if (this.failure) return;
    this.failure = reason;
    this.abortSignals(reason);
    for (const remove of this.signalListeners.values()) remove();
    for (const pending of [...this.pending.values(), ...this.deferred.values()]) pending.reject(reason);
    this.pending.clear(); this.deferred.clear(); this.earlyDeferred.clear(); this.methods.clear();
    this.references.clear(); this.remoteValues.clear(); this.signalListeners.clear(); this.signalControllers.clear(); this.earlyAborts.clear();
    this.referenceIds = new WeakMap(); this.remoteReferences = new WeakMap(); this.opaqueValues = new WeakSet(); this.synchronousFunctions = new WeakSet();
    this.mutableValues = new WeakMap(); this.passiveValues = new WeakSet();
    this.remoteScopes.clear(); this.signalScopes.clear(); this.liveScopes.clear(); this.synchronizingScopes.clear();
  }
}
