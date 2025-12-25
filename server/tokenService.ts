import { encoding_for_model, get_encoding } from "tiktoken";

export function countTokens(text: string, modelName: string = 'gpt-3.5-turbo'): number {
  if (!text) return 0;
  
  let enc;
  try {
    enc = encoding_for_model(modelName as any);
  } catch (e) {
    // Fallback to cl100k_base (used by GPT-3.5/4) if model not found
    console.warn(`Model ${modelName} not found in tiktoken, falling back to cl100k_base`);
    enc = get_encoding("cl100k_base");
  }

  try {
    const tokens = enc.encode(text);
    return tokens.length;
  } catch (e) {
    console.error("Error counting tokens", e);
    return 0;
  } finally {
    enc.free();
  }
}
