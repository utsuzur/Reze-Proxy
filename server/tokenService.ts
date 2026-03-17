import { encoding_for_model, get_encoding, Tiktoken } from "tiktoken";

/**
 * Automatically detects the best tokenizer for a given model and provider.
 */
function getTokenizer(modelName: string, providerType?: string): Tiktoken {
    const model = modelName.toLowerCase();
    
    try {
        // 1. Explicitly detect Claude 4 and 3.5 (uses a tokenizer very similar to GPT-4o's o200k_base)
        if (model.includes('claude-4') || model.includes('claude-3-5') || model.includes('gpt-4o')) {
            return encoding_for_model('gpt-4o');
        }
        
        // 2. Detect Claude 3 / 3.7 / GPT-4 / GPT-3.5 (use cl100k_base)
        if (model.includes('claude-3') || model.includes('gpt-4') || model.includes('gpt-3.5')) {
            return encoding_for_model('gpt-4' as any);
        }

        // 3. Provider-based fallback
        if (providerType === 'anthropic') {
            return get_encoding("cl100k_base");
        }

        // 4. Default to cl100k_base for most modern models
        return get_encoding("cl100k_base");
    } catch (e) {
        return get_encoding("cl100k_base");
    }
}

export function countTokens(text: string, modelName: string = 'gpt-3.5-turbo', providerType?: string): number {
  if (!text) return 0;
  
  const enc = getTokenizer(modelName, providerType);

  try {
    const tokens = enc.encode(text);
    return tokens.length;
  } catch (e) {
    console.error("Error counting tokens", e);
    return 0;
  } finally {
    // enc.free() is only needed if we create a NEW encoding every time.
    // get_encoding and encoding_for_model in tiktoken-js might return shared instances 
    // or need manual freeing depending on the version. 
    // In this WASM version, it's safer to free if we don't cache.
    enc.free();
  }
}

/**
 * Accurately count tokens for a list of messages, accounting for chat format overhead.
 * Heuristic based on OpenAI's chat format.
 */
export function countMessagesTokens(messages: any[], modelName: string = 'gpt-3.5-turbo', providerType?: string): number {
    let tokensPerMessage = 3;
    let tokensPerName = 1;
    
    if (modelName.includes('gpt-3.5-turbo-0301')) {
        tokensPerMessage = 4;
        tokensPerName = -1;
    } else {
        // Modern models (GPT-4, GPT-4o, Claude 3+) typically use 3 tokens per message
        tokensPerMessage = 3;
        tokensPerName = 1;
    }

    let numTokens = 0;
    for (const message of messages) {
        numTokens += tokensPerMessage;
        
        // Count role
        numTokens += countTokens(message.role || '', modelName, providerType);
        
        // Count content (handle both string and multimodal array formats)
        const content = message.content;
        if (typeof content === 'string') {
            numTokens += countTokens(content, modelName, providerType);
        } else if (Array.isArray(content)) {
            for (const part of content) {
                if (part.type === 'text' && typeof part.text === 'string') {
                    numTokens += countTokens(part.text, modelName, providerType);
                }
            }
        }
        
        // Count name if present
        if (message.name) {
            numTokens += countTokens(message.name, modelName, providerType);
            numTokens += tokensPerName;
        }
    }
    
    numTokens += 3; // every reply is primed with <|start|>assistant<|message|>
    return numTokens;
}
