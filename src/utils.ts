import { InferenceContext, PoolConfig } from "./types";

export async function estimateCost(poolConfig: PoolConfig, ctx: InferenceContext): Promise<number> {
  const content = ctx.messages.map((m) => m.content).join("\n");

  // Estimate tokens as (unicode characters * 1.2) to account for multi-byte characters
  // and add 20% buffer to ensure overestimation. Array.from() gives proper Unicode length.
  const charCount = Array.from(content).length;
  const tokenEstimate = Math.ceil(charCount * 1.2);
  const inputCost = poolConfig.prices.input * tokenEstimate;
  const outputCost = poolConfig.prices.output * ctx.maxTokens;
  return inputCost + outputCost;
}
