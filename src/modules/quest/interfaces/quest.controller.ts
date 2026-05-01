import { Request, Response, NextFunction } from 'express';
import { startQuestUseCase } from '../application/start-quest.usecase';
import { rewardQuestUseCase } from '../application/reward-quest.usecase';
import { completeQuestUseCase } from '../application/complete-quest.usecase';
import { failQuestUseCase } from '../application/fail-quest.usecase';
import { questRepository } from '../infrastructure/quest.repository';
import { AuthenticatedRequest } from '../../../shared/middleware/auth.middleware';

/**
 * Sprint VIII fortyfikacja: każda mutacja questa weryfikuje ownership po stronie
 * kontrolera (uid z tokenu vs quest.userId). Admin/system bypass.
 */
async function assertQuestOwnership(req: AuthenticatedRequest, questId: string) {
  const quest = await questRepository.findById(questId);
  if (!quest) { return { error: 'not_found', status: 404, quest: null as null }; }
  const role = req.user?.role;
  if (role !== 'admin' && role !== 'system' && quest.userId !== req.user?.uid) {
    return { error: 'forbidden_quest_ownership', status: 403, quest: null };
  }
  return { error: null, status: 200, quest };
}

export class QuestController {
  static async start(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      // userId zawsze z tokenu — body.userId jest ignorowany.
      const quest = await startQuestUseCase.run({
        ...req.body,
        userId: req.user!.uid
      });
      res.status(201).json(quest);
    } catch (e) { next(e); }
  }

  static async branch(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const quest = await startQuestUseCase.branch({
        ...req.body,
        userId: req.user!.uid
      });
      res.status(201).json(quest);
    } catch (e) { next(e); }
  }

  static async complete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { questId } = req.body;
      const check = await assertQuestOwnership(req, questId);
      if (check.error) { res.status(check.status).json({ error: check.error }); return; }
      const quest = await completeQuestUseCase.run(questId);
      res.json(quest);
    } catch (e) { next(e); }
  }

  static async fail(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { questId, reason } = req.body;
      const check = await assertQuestOwnership(req, questId);
      if (check.error) { res.status(check.status).json({ error: check.error }); return; }
      const quest = await failQuestUseCase.run(questId, reason);
      res.json(quest);
    } catch (e) { next(e); }
  }

  static async reward(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { questId, reward } = req.body;
      const check = await assertQuestOwnership(req, questId);
      if (check.error) { res.status(check.status).json({ error: check.error }); return; }
      const quest = await rewardQuestUseCase.run(questId, reward);
      res.json(quest);
    } catch (e) { next(e); }
  }

  static async findById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const check = await assertQuestOwnership(req, req.params.id);
      if (check.error) { res.status(check.status).json({ error: check.error }); return; }
      res.json(check.quest);
    } catch (e) { next(e); }
  }

  static async tree(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const check = await assertQuestOwnership(req, req.params.id);
      if (check.error) { res.status(check.status).json({ error: check.error }); return; }
      const tree = await questRepository.findTree(req.params.id);
      res.json(tree);
    } catch (e) { next(e); }
  }
}
