/// <reference types="@cloudflare/workers-types" />

interface Env {
  KV: KVNamespace;
  DB: D1Database;
  JWT_PUB_KEY: string;
  NODE_SERVICE_URL: string;
  INTERNAL_SERVICE_API_KEY: string;
  CF_ACCOUNT_ID: string;
  CF_KV_NAMESPACE_ID: string;
  CF_API_TOKEN: string;
}
