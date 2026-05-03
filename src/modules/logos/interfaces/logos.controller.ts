import { Response, NextFunction } from 'express';
import { analyzeQueryUseCase } from '../application/analyze-query.usecase';
import { synthesizeSpeechUseCase } from '../application/synthesize-speech.usecase';
import { AuthenticatedRequest } from '../../../shared/middleware/auth.middleware';

export class LogosController {
  static async analyze(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { query, sessionId, imageData, imageMimeType } = req.body;
      const uid = req.user?.uid;
      const out = await analyzeQueryUseCase.run(sessionId, { query, imageData, imageMimeType, uid });
      res.json(out);
    } catch (e) { next(e); }
  }

  static async synthesize(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { text, sessionId, voiceName } = req.body;
      const out = await synthesizeSpeechUseCase.run(sessionId, { text, voiceName });
      res.json(out);
    } catch (e) { next(e); }
  }
}
