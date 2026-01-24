import type { ProviderType } from '../types/index.js';
import type { IProvider } from './types.js';

/**
 * Registry for managing provider instances
 */
export class ProviderRegistry {
  private providers: Map<ProviderType, IProvider> = new Map();

  /**
   * Register a provider
   */
  register(provider: IProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Get a provider by name
   */
  getProvider(name: ProviderType): IProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Provider not found: ${name}`);
    }
    return provider;
  }

  /**
   * Check if a provider exists
   */
  hasProvider(name: ProviderType): boolean {
    return this.providers.has(name);
  }

  /**
   * Get all registered providers
   */
  getAllProviders(): IProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get all configured providers
   */
  getConfiguredProviders(): IProvider[] {
    return this.getAllProviders().filter((p) => p.isConfigured());
  }
}

// Singleton instance
let registryInstance: ProviderRegistry | null = null;

/**
 * Get the provider registry instance
 */
export function getProviderRegistry(): ProviderRegistry {
  if (!registryInstance) {
    registryInstance = new ProviderRegistry();
  }
  return registryInstance;
}

/**
 * Initialize the registry with all providers
 * Called during server startup
 */
export async function initializeProviders(): Promise<void> {
  const registry = getProviderRegistry();

  // Import providers dynamically to avoid circular dependencies
  const { DeepSeekProvider } = await import('./deepseek.js');
  const { OpenAIProvider } = await import('./openai.js');

  // Register providers
  registry.register(new DeepSeekProvider());
  registry.register(new OpenAIProvider());
}
