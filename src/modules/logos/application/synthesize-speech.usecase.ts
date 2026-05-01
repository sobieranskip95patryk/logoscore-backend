import { executeService, SynthesizeInput, SynthesizeOutput } from '../../../infrastructure/ai/execute.service';
import { eventBus } from '../../../core/events/event-bus';

export class SynthesizeSpeechUseCase {
  async run(sessionId: string, input: SynthesizeInput): Promise<SynthesizeOutput> {
    const out = await executeService.synthesize(input);
    eventBus.publish('logos.synthesize.completed', {
      provider: out.provider,
      bytes: Math.floor(out.audioBase64.length * 0.75)
    }, sessionId);
    return out;
  }
}

export const synthesizeSpeechUseCase = new SynthesizeSpeechUseCase();
