import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../../shared/middleware/auth.middleware';
import { goalsRepository } from '../infrastructure/goals.repository';
import {
  createGoalUseCase,
  reembedGoalUseCase,
  correlateActionUseCase
} from '../application/correlate-action.usecase';
import { GoalStatus } from '../domain/project-goal.entity';

export class ResolverController {
  static async listGoals(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const uid = req.user?.uid || 'anonymous';
      const status = (req.query.status as GoalStatus | undefined) || undefined;
      const goals = await goalsRepository.list(uid, status);
      res.json({
        backend: goalsRepository.backend,
        count: goals.length,
        goals: goals.map(g => ({ ...g, embedding: undefined }))  // nie wypluwamy wektora
      });
    } catch (e) { next(e); }
  }

  static async createGoal(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const uid = req.user?.uid || 'anonymous';
      const goal = await createGoalUseCase({ ...req.body, uid });
      res.status(201).json({ ...goal, embedding: undefined });
    } catch (e) { next(e); }
  }

  static async reembedGoal(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const goal = await reembedGoalUseCase(req.params.goalId);
      if (!goal) {
        res.status(404).json({ error: 'goal_not_found' });
        return;
      }
      res.json({
        goalId: goal.goalId,
        embeddingModel: goal.embeddingModel,
        embeddingDim: goal.embeddingDim,
        hasEmbedding: !!goal.embedding && goal.embedding.length > 0
      });
    } catch (e) { next(e); }
  }

  static async deleteGoal(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const ok = await goalsRepository.delete(req.params.goalId);
      if (!ok) {
        res.status(404).json({ error: 'goal_not_found' });
        return;
      }
      res.json({ ok: true });
    } catch (e) { next(e); }
  }

  static async correlate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const uid = req.user?.uid || 'anonymous';
      const out = await correlateActionUseCase({
        uid,
        actionRef:  req.body.actionRef,
        actionText: req.body.actionText,
        sessionId:  req.body.sessionId,
        topK:       req.body.topK,
        minScore:   req.body.minScore
      });
      res.json(out);
    } catch (e) { next(e); }
  }
}
