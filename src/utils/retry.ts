/**
 * Helper to retry an operation with exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelay?: number;
    retryCondition?: (error: any) => boolean;
    onRetry?: (error: any, retryCount: number, delay: number) => void;
  } = {}
): Promise<T> {
  const {
    maxRetries = 2,
    baseDelay = 1000,
    retryCondition = (error) => {
      const status = error?.status || error?.response?.status;
      return status === 429 || (status >= 500 && status < 600) || error.message?.includes('timeout') || error.code === 'ETIMEDOUT';
    },
    onRetry,
  } = options;

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries && retryCondition(error)) {
        const delay = baseDelay * Math.pow(2, attempt);
        if (onRetry) {
          onRetry(error, attempt + 1, delay);
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}
