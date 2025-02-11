import { InferenceContext, PoolConfig } from './types';

export function estimateCost(poolConfig: PoolConfig, ctx: InferenceContext): number {
  const content = ctx.messages.map(m => m.content).join('\n');
  const maxToken = ctx.maxTokens || poolConfig.maxOutput;

  // Estimate tokens as (unicode characters * 1.2) to account for multi-byte characters
  // and add 20% buffer to ensure overestimation. Array.from() gives proper Unicode length.
  const charCount = Array.from(content).length;
  const tokenEstimate = charCount * 1.2;
  const inputCost = poolConfig.prices.input * tokenEstimate;
  const outputCost = poolConfig.prices.output * maxToken;
  return Math.ceil((inputCost + outputCost) / 1000000);
}
