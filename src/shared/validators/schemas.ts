import { z } from 'zod';

export const analyzeSchema = z.object({
  query: z.string().min(1).max(20_000),
  sessionId: z.string().min(1).max(256),
  imageData: z.string().optional(),
  imageMimeType: z.string().optional()
});

export const synthesizeSchema = z.object({
  text: z.string().min(1).max(20_000),
  sessionId: z.string().min(1).max(256),
  voiceName: z.string().optional()
});

export const intentMapUpdateSchema = z.object({
  newIntent: z.string().min(1).max(2_000),
  sessionId: z.string().min(1).max(256)
});

export const startQuestSchema = z.object({
  // userId: ignorowane przez kontroler (zawsze nadpisywane req.user.uid).
  // Akceptujemy w schemacie dla kompatybilności wstecz starych klientów.
  userId: z.string().min(1).optional(),
  title: z.string().min(1).max(256),
  description: z.string().max(8_000).optional(),
  acceptanceCriteria: z.string().max(8_000).optional()
});

export const branchQuestSchema = z.object({
  userId: z.string().min(1).optional(),
  parentId: z.string().min(1),
  title: z.string().min(1).max(256),
  branchKey: z.string().regex(/^[A-Za-z0-9_\-]{1,64}$/).optional().nullable(),
  description: z.string().max(8_000).optional(),
  acceptanceCriteria: z.string().max(8_000).optional()
});

export const completeQuestSchema = z.object({
  questId: z.string().min(1)
});

export const failQuestSchema = z.object({
  questId: z.string().min(1),
  reason: z.string().max(2_000).optional()
});

export const rewardQuestSchema = z.object({
  questId: z.string().min(1),
  reward: z.record(z.any()).optional()
});

export const goalCreateSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(8_000).optional(),
  weight: z.number().min(0).max(1).optional(),
  tags: z.array(z.string().min(1).max(64)).max(32).optional(),
  parentId: z.string().min(1).max(256).nullable().optional(),
  sessionId: z.string().min(1).max(256).optional()
});

export const correlateActionSchema = z.object({
  actionRef: z.string().min(1).max(256),
  actionText: z.string().min(1).max(20_000),
  sessionId: z.string().min(1).max(256).optional(),
  topK: z.number().int().min(1).max(50).optional(),
  minScore: z.number().min(0).max(1).optional()
});
