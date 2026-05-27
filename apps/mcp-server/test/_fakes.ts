/**
 * Fakes mínimos dos bindings Cloudflare usados pelo Worker em ambiente
 * de teste (vitest rodando em Node puro).
 *
 * Cobre apenas a superfície usada pelo handler atual:
 *   - `CACHE` (KVNamespace): `get`, `put`, `delete`.
 *
 * Demais bindings (AI, VECTORIZE, R2, D1) recebem stubs que arremessam
 * caso usados — preservando "fail-fast" se algum handler vazar
 * dependência indevida nos testes.
 */

import type { Env } from "../src/env.js";

/**
 * Fake do KV em memória — suficiente para testar rate-limit + cache wrapper.
 *
 * Implementa as duas formas de `get` usadas pelo código: string padrão
 * (no rate-limit) e `"json"` (no cache wrapper). Demais sobrecargas
 * (`"arrayBuffer"`, `"stream"`) caem no `default` que arremessa.
 */
export function createFakeKv(): KVNamespace {
  const store = new Map<string, string>();

  // Função `get` polimórfica — cobre as sobrecargas string e "json".
  async function get(
    key: string,
    typeOrOptions?: unknown,
  ): Promise<string | null | unknown> {
    const raw = store.get(key) ?? null;
    if (raw === null) return null;
    const type =
      typeof typeOrOptions === "string"
        ? typeOrOptions
        : (typeOrOptions as { type?: string } | undefined)?.type;
    if (type === "json") {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    }
    if (type === undefined || type === "text") {
      return raw;
    }
    throw new Error(`createFakeKv.get: tipo '${type}' não suportado em testes`);
  }

  const kv: Partial<KVNamespace> = {
    get: get as unknown as KVNamespace["get"],
    async put(
      key: string,
      value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
      _opts?: KVNamespacePutOptions,
    ): Promise<void> {
      if (typeof value === "string") {
        store.set(key, value);
        return;
      }
      throw new Error("createFakeKv: apenas string values são suportadas");
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
  };
  return kv as KVNamespace;
}

/**
 * Builder genérico para um binding "explosivo" — qualquer acesso lança.
 * Útil quando o handler em teste não deveria tocar aquele binding.
 */
function unusedBinding<T>(name: string): T {
  return new Proxy(
    {},
    {
      get(): never {
        throw new Error(`Binding '${name}' acessado em teste sem fake configurado`);
      },
    },
  ) as T;
}

/**
 * Fake mínimo de bucket R2 — armazena `string` na memória.
 *
 * Suporta apenas a superfície usada pelo subsistema de skills:
 *   - `put(key, value, opts?)` — value pode ser string ou ReadableStream.
 *   - `get(key)` — devolve objeto com `text()`, `json()`, ou `null`.
 *   - `head(key)` — devolve metadados (ou `null`).
 *   - `list({ prefix, cursor, limit })` — listagem paginada simples.
 *   - `delete(key | string[])` — remove um ou vários objetos.
 *
 * Demais sobrecargas (`arrayBuffer`, `blob`, etc.) caem em `throw` para
 * fail-fast detectar uso não previsto.
 */
export interface FakeR2 extends R2Bucket {
  /** Snapshot do que foi gravado — útil para asserts diretos. */
  __snapshot(): Record<string, string>;
  /** Pre-popula o bucket sem chamar `put` (atalho para fixtures). */
  __seed(entries: Record<string, string>): void;
}

export function createFakeR2(): FakeR2 {
  const store = new Map<
    string,
    { body: string; metadata: Record<string, string> }
  >();

  function makeObject(key: string, raw: string): R2ObjectBody {
    return {
      key,
      version: "v1",
      size: raw.length,
      etag: `etag-${key}`,
      httpEtag: `"etag-${key}"`,
      checksums: {
        toJSON: () => ({}),
      } as R2Checksums,
      uploaded: new Date(),
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
      customMetadata: store.get(key)?.metadata ?? {},
      range: undefined,
      storageClass: "Standard",
      ssecKeyMd5: undefined,
      writeHttpMetadata(_h: Headers): void {
        /* no-op */
      },
      async text(): Promise<string> {
        return raw;
      },
      async json<T>(): Promise<T> {
        return JSON.parse(raw) as T;
      },
      async arrayBuffer(): Promise<ArrayBuffer> {
        return new TextEncoder().encode(raw).buffer as ArrayBuffer;
      },
      async blob(): Promise<Blob> {
        return new Blob([raw]);
      },
      async bytes(): Promise<Uint8Array> {
        return new TextEncoder().encode(raw);
      },
      body: new ReadableStream<Uint8Array>({
        start(controller): void {
          controller.enqueue(new TextEncoder().encode(raw));
          controller.close();
        },
      }),
      bodyUsed: false,
    } as unknown as R2ObjectBody;
  }

  const bucket: Partial<FakeR2> = {
    async head(key: string): Promise<R2Object | null> {
      const entry = store.get(key);
      if (!entry) return null;
      return makeObject(key, entry.body) as unknown as R2Object;
    },
    async get(key: string): Promise<R2ObjectBody | null> {
      const entry = store.get(key);
      if (!entry) return null;
      return makeObject(key, entry.body);
    },
    async put(
      key: string,
      value: string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob | null,
      opts?: R2PutOptions,
    ): Promise<R2Object> {
      if (typeof value !== "string") {
        throw new Error("FakeR2.put: apenas string suportada em testes");
      }
      const metadata =
        (opts as { customMetadata?: Record<string, string> } | undefined)
          ?.customMetadata ?? {};
      store.set(key, { body: value, metadata });
      return makeObject(key, value) as unknown as R2Object;
    },
    async list(
      opts?: R2ListOptions,
    ): Promise<R2Objects> {
      const prefix = opts?.prefix ?? "";
      const limit = opts?.limit ?? 1000;
      const all = Array.from(store.keys())
        .filter((k) => k.startsWith(prefix))
        .sort();
      const cursor = opts?.cursor ? Number.parseInt(opts.cursor, 10) : 0;
      const slice = all.slice(cursor, cursor + limit);
      const objects = slice.map(
        (k) => makeObject(k, store.get(k)!.body) as unknown as R2Object,
      );
      const truncated = cursor + slice.length < all.length;
      return {
        objects,
        truncated,
        cursor: truncated ? String(cursor + slice.length) : undefined,
        delimitedPrefixes: [],
      } as unknown as R2Objects;
    },
    async delete(keys: string | string[]): Promise<void> {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) store.delete(k);
    },
    __snapshot(): Record<string, string> {
      const out: Record<string, string> = {};
      for (const [k, v] of store) out[k] = v.body;
      return out;
    },
    __seed(entries: Record<string, string>): void {
      for (const [k, v] of Object.entries(entries)) {
        store.set(k, { body: v, metadata: {} });
      }
    },
  };
  return bucket as FakeR2;
}

/**
 * Monta um `Env` de teste com KV + R2_SKILLS reais (in-memory) e demais
 * bindings inertes.
 */
export function createTestEnv(overrides: Partial<Env> = {}): Env {
  return {
    AI: unusedBinding<Ai>("AI"),
    VECTORIZE: unusedBinding<VectorizeIndex>("VECTORIZE"),
    R2_LEIS: unusedBinding<R2Bucket>("R2_LEIS"),
    R2_SKILLS: createFakeR2(),
    DB: unusedBinding<D1Database>("DB"),
    CACHE: createFakeKv(),
    ...overrides,
  };
}

/**
 * `ExecutionContext` simulado — `waitUntil` / `passThroughOnException` são
 * no-ops nos testes (não precisamos esperar tarefas em background).
 */
export function createExecutionContext(): ExecutionContext {
  return {
    waitUntil(_promise: Promise<unknown>): void {
      /* no-op */
    },
    passThroughOnException(): void {
      /* no-op */
    },
    props: {},
  } satisfies ExecutionContext;
}
