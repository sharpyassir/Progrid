import { Injectable, Logger } from '@nestjs/common';
import { loadConfig } from '../../../config/config';
import { AnthropicProvider } from './anthropic.provider';
import { FakeProvider } from './fake.provider';
import { MODELS, findModel } from './catalog';
import type { ModelProvider } from './provider';

/**
 * Chooses the model provider from config: CONNECT_MODEL_PROVIDER, else anthropic when
 * ANTHROPIC_API_KEY is set, else the deterministic fake. A new provider is one class
 * implementing ModelProvider plus its models in the catalog.
 */
@Injectable()
export class ModelService {
  private readonly log = new Logger(ModelService.name);
  readonly provider: ModelProvider;

  constructor() {
    const cfg = loadConfig();
    const kind = cfg.CONNECT_MODEL_PROVIDER ?? (cfg.ANTHROPIC_API_KEY ? 'anthropic' : 'fake');
    if (kind === 'anthropic' && !cfg.ANTHROPIC_API_KEY) {
      this.log.warn('CONNECT_MODEL_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty; Connect uses the fake model');
      this.provider = new FakeProvider();
    } else {
      this.provider = kind === 'anthropic' ? new AnthropicProvider(cfg.ANTHROPIC_API_KEY!, { fallbacks: cfg.CONNECT_MODEL_FALLBACKS }) : new FakeProvider();
    }
    if (!findModel(cfg.CONNECT_DEFAULT_MODEL)) this.log.warn(`CONNECT_DEFAULT_MODEL ${cfg.CONNECT_DEFAULT_MODEL} is not in the catalog; using claude-opus-5-5`);
  }

  get isFake() {
    return this.provider.name === 'fake';
  }

  defaultModel() {
    const id = loadConfig().CONNECT_DEFAULT_MODEL;
    return findModel(id) ? id : 'claude-opus-5-5';
  }

  list() {
    const def = this.defaultModel();
    return {
      provider: this.provider.name,
      data: MODELS.map((m) => ({
        id: m.id,
        label: m.label,
        description: m.description,
        default: m.id === def,
        provider: m.provider,
        efforts: m.supportsEffort ? ['low', 'medium', 'high'] : [],
        contextWindow: m.contextWindow,
        available: true,
      })),
    };
  }
}
