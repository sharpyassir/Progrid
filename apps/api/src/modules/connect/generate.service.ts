import { Injectable } from '@nestjs/common';
import { RedisService } from '../../common/redis/redis.service';
import { ApiError } from '../../common/errors/api-error';
import type { Actor } from '../../common/auth/actor';
import { EventsService } from '../events/events.service';
import { ModelService } from './models/model.service';
import { ModelError, echoable, textOf, type ChatMessage } from './models/provider';
import { ToolRegistry } from './tools/registry.service';
import { validateBlueprint } from './blueprint';
import { BUILDER_INSTRUCTIONS, DRAFT_SCHEMA, draftFromModel, fakeDraft } from './builder';
import { PLATFORM_PREAMBLE } from './runtime/prompt';

const GENERATIONS_PER_HOUR = 30;

/**
 * Build with AI. Asks the model for a draft with structured output, validates it like any
 * blueprint (graph validator, tool configs, connection refs) and returns it. When the first
 * draft has problems the model gets one chance to fix them. Nothing is saved.
 */
@Injectable()
export class GenerateService {
  constructor(private readonly models: ModelService, private readonly tools: ToolRegistry, private readonly redis: RedisService, private readonly events: EventsService) {}

  async generate(actor: Actor, prompt: string) {
    if (!(await this.redis.allow(`connect:generate:${actor.teamId}`, GENERATIONS_PER_HOUR, 3600))) throw new ApiError(429, 'rate_limited', `Build with AI is limited to ${GENERATIONS_PER_HOUR} drafts per hour per team.`);
    const check = (raw: unknown) => validateBlueprint(raw, (kind, config) => this.tools.checkConfig(kind, config));
    const usage = { inputTokens: 0, outputTokens: 0 };

    if (this.models.isFake) {
      const { blueprint, issues } = check(fakeDraft(prompt));
      await this.events.emit('connect.draft_generated', { model: 'fake', issues: issues.length }, { actor });
      return { draft: blueprint, issues, model: 'fake', usage };
    }

    const model = this.models.defaultModel();
    const ask = async (messages: ChatMessage[]) => {
      try {
        const res = await this.models.provider.complete({
          model,
          effort: 'medium',
          system: { preamble: PLATFORM_PREAMBLE, instructions: BUILDER_INSTRUCTIONS },
          tools: [],
          messages,
          maxTokens: 16_000,
          outputSchema: DRAFT_SCHEMA,
        });
        usage.inputTokens += res.usage.inputTokens + res.usage.cacheWriteTokens;
        usage.outputTokens += res.usage.outputTokens;
        if (res.stopReason === 'refusal') throw new ApiError(422, 'model_refused', 'The model declined to build this agent. Rephrase the description.', { stopDetails: res.stopDetails ?? null });
        if (res.stopReason === 'max_tokens') throw new ApiError(422, 'draft_too_large', 'The draft did not fit; describe a smaller agent.');
        return { text: textOf(res.content), content: echoable(res.content) };
      } catch (err) {
        if (err instanceof ModelError) throw new ApiError(502, err.code, err.message);
        throw err;
      }
    };
    const request = `Build an agent for this description. Return only the draft.\n\n<description>\n${prompt}\n</description>`;
    const first = await ask([{ role: 'user', content: [{ type: 'text', text: request }] }]);
    let parsed = parseJson(first.text);
    let result = check(draftFromModel(parsed));
    if (result.issues.length) {
      const fix = await ask([
        { role: 'user', content: [{ type: 'text', text: request }] },
        // The first answer goes back exactly as returned (thinking blocks included).
        { role: 'assistant', content: first.content },
        { role: 'user', content: [{ type: 'text', text: `The draft has these problems. Return a corrected draft.\n${result.issues.map((i) => `- ${i.path}: ${i.message}`).join('\n')}` }] },
      ]);
      parsed = parseJson(fix.text);
      const second = check(draftFromModel(parsed));
      if (second.issues.length <= result.issues.length) result = second;
    }
    await this.events.emit('connect.draft_generated', { model, issues: result.issues.length, usage }, { actor });
    return { draft: result.blueprint, issues: result.issues, model, usage };
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(502, 'invalid_draft', 'The model returned a draft that is not valid JSON. Try again.');
  }
}
