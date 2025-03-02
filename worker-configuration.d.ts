/// <reference types="@cloudflare/workers-types" />

interface Env {
  KV: KVNamespace;
  DB: D1Database;
  JWT_PUB_KEY: string;
  INTERNAL_SERVICE_API_KEY: string;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  QSTASH_TOKEN: string;
  QSTASH_URL: string;
  QSTASH_CURRENT_SIGNING_KEY: string;
  QSTASH_NEXT_SIGNING_KEY: string;
  CF_ACCOUNT_ID: string;
  CF_KV_NAMESPACE_ID: string;
  CF_API_TOKEN: string;
  TOKEN_ADDRESS: string;
}
