# Runbook

## Setup

```bash
pnpm install
```

Install ollama locally(https://ollama.com/) and run with:

```bash
ollama run llama3.2:3B
```

## Run locally

```bash
wrangler dev --config wrangler.local.toml --local --persist-to .wrangler/kv-data
```

## Run in production

```bash
wrangler dev --config wrangler.toml
```

## Test CF Worker

First you have to cd the project root and run the dummy node server.

```bash
poetry run python -m scripts.dummy_node_server
```

Then you can run the CF worker locally.

```bash
wrangler dev --config wrangler.local.toml --local --persist-to .wrangler/kv-data
```

Then you can test the workflow by publish some jobs with the node_client:

```bash
poetry run python -m scripts.node_client --publisher --nowait
poetry run python -m scripts.node_client --worker --nowait
```

To keep it running and wait for the job results, run them without the nowait flag.

## Run migrations

```bash
# Update cloudflare d1 database table
npx wrangler d1 execute mizu-token-usage --file=./migrations/0000_create_pools.sql -c wrangler.staging.toml --remote
```
