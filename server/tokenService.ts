import { encoding_for_model, get_encoding, Tiktoken } from "tiktoken";

export function countTokens(text: string, modelName: string = 'gpt-3.5-turbo'): number {
  if (!text) return 0;
  
  let enc: Tiktoken;
  try {
    // Standardize model name for tiktoken
    let model = modelName.toLowerCase();
    if (model.includes('gpt-4o')) model = 'gpt-4o';
    else if (model.includes('gpt-4')) model = 'gpt-4';
    else if (model.includes('gpt-3.5')) model = 'gpt-3.5-turbo';
    else if (model.includes('claude-3')) model = 'gpt-4'; // Close enough approximation
    
    enc = encoding_for_model(model as any);
  } catch (e) {
    // Fallback to cl100k_base (used by GPT-3.5/4) if model not found
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

/**
 * Accurately count tokens for a list of messages, accounting for chat format overhead.
 * Heuristic based on OpenAI's chat format (3-4 tokens per message).
 */
export function countMessagesTokens(messages: any[], modelName: string = 'gpt-3.5-turbo'): number {
    let tokensPerMessage = 3;
    let tokensPerName = 1;
    
    // Newer models have different overhead
    if (modelName.includes('gpt-3.5-turbo-0301')) {
        tokensPerMessage = 4;
        tokensPerName = -1;
    } else if (modelName.includes('gpt-4')) {
        tokensPerMessage = 3;
        tokensPerName = 1;
    }

    let numTokens = 0;
    for (const message of messages) {
        numTokens += tokensPerMessage;
        for (const [key, value] of Object.entries(message)) {
            if (typeof value === 'string') {
                numTokens += countTokens(value, modelName);
                if (key === "name") {
                    numTokens += tokensPerName;
                }
            }
        }
    }
    numTokens += 3; // every reply is primed with <|start|>assistant<|message|>
    return numTokens;
}
