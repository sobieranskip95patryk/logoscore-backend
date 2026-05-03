# 04. Session Diffs (Unified Patch)

Poniżej pełne diffy zmian wykonanych w tej sesji (oraz bezpośrednio powiązanych poprawek).

```diff
diff --git a/src/core/config/app.config.ts b/src/core/config/app.config.ts
index a750711..c6c9976 100644
--- a/src/core/config/app.config.ts
+++ b/src/core/config/app.config.ts
@@ -41,7 +41,7 @@ export const appConfig = {
 
   ai: {
     provider: (process.env.AI_PROVIDER || 'gemini').toLowerCase(),
-    apiKey: process.env.AI_API_KEY || '',
+    apiKey: process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '',
     modelAnalyze: process.env.AI_MODEL_ANALYZE || 'gemini-1.5-flash',
     modelTts: process.env.AI_MODEL_TTS || 'gemini-2.5-flash-preview-tts',
     modelEmbed: process.env.AI_MODEL_EMBED || 'text-embedding-004',
@@ -89,6 +89,14 @@ export const appConfig = {
     serviceName: process.env.OTEL_SERVICE_NAME || 'mtaquestwebsidex-backend',
     sampleRate: Number(process.env.OTEL_SAMPLE_RATE || 1.0),
     prometheusEnabled: (process.env.PROMETHEUS_ENABLED || 'false').toLowerCase() === 'true'
+  },
+
+  migi: {
+    enabled: (process.env.MIGI_ENABLED || 'false').toLowerCase() === 'true',
+    repoDir: process.env.MIGI_REPO_DIR || 'external/MIGI_7G-Dashboard-Kalibracyjny-EQ-Bench-3-Integration',
+    pythonCmd: process.env.MIGI_PYTHON_CMD || 'python',
+    healthPort: Number(process.env.MIGI_HEALTH_PORT || 18080),
+    telemetryPort: Number(process.env.MIGI_TELEMETRY_PORT || 8765)
   }
 } as const;
 
diff --git a/src/modules/logos/interfaces/logos.controller.ts b/src/modules/logos/interfaces/logos.controller.ts
index ac5c271..7e27163 100644
--- a/src/modules/logos/interfaces/logos.controller.ts
+++ b/src/modules/logos/interfaces/logos.controller.ts
@@ -1,4 +1,4 @@
-import { Request, Response, NextFunction } from 'express';
+import { Response, NextFunction } from 'express';
 import { analyzeQueryUseCase } from '../application/analyze-query.usecase';
 import { synthesizeSpeechUseCase } from '../application/synthesize-speech.usecase';
 import { AuthenticatedRequest } from '../../../shared/middleware/auth.middleware';
diff --git a/src/modules/memory/interfaces/memory.controller.ts b/src/modules/memory/interfaces/memory.controller.ts
index 1bbe91c..f95f251 100644
--- a/src/modules/memory/interfaces/memory.controller.ts
+++ b/src/modules/memory/interfaces/memory.controller.ts
@@ -1,4 +1,4 @@
-import { Request, Response, NextFunction } from 'express';
+import { Response, NextFunction } from 'express';
 import { intentMapRepository } from '../infrastructure/intent-map.repository';
 import { embeddingRepository } from '../infrastructure/embedding.repository';
 import { eventBus } from '../../../core/events/event-bus';
diff --git a/src/modules/quest/domain/quest.rules.ts b/src/modules/quest/domain/quest.rules.ts
index a39a369..f86d959 100644
--- a/src/modules/quest/domain/quest.rules.ts
+++ b/src/modules/quest/domain/quest.rules.ts
@@ -35,7 +35,7 @@ export const questRules = {
     if (parent.state === 'REWARDED' || parent.state === 'FAILED') {
       throw new Error(`quest ${parent.id} is sealed (${parent.state}), cannot branch`);
     }
-    if (branchKey && !/^[A-Za-z0-9_\-]{1,64}$/.test(branchKey)) {
+    if (branchKey && !/^[A-Za-z0-9_-]{1,64}$/.test(branchKey)) {
       throw new Error(`invalid branchKey: ${branchKey}`);
     }
   },
diff --git a/src/modules/quest/interfaces/quest.controller.ts b/src/modules/quest/interfaces/quest.controller.ts
index 41891c6..2dca73f 100644
--- a/src/modules/quest/interfaces/quest.controller.ts
+++ b/src/modules/quest/interfaces/quest.controller.ts
@@ -1,4 +1,4 @@
-import { Request, Response, NextFunction } from 'express';
+import { Response, NextFunction } from 'express';
 import { startQuestUseCase } from '../application/start-quest.usecase';
 import { rewardQuestUseCase } from '../application/reward-quest.usecase';
 import { completeQuestUseCase } from '../application/complete-quest.usecase';
diff --git a/src/modules/resolver/interfaces/resolver.controller.ts b/src/modules/resolver/interfaces/resolver.controller.ts
index d73a9de..36e2f95 100644
--- a/src/modules/resolver/interfaces/resolver.controller.ts
+++ b/src/modules/resolver/interfaces/resolver.controller.ts
@@ -8,6 +8,14 @@ import {
 } from '../application/correlate-action.usecase';
 import { GoalStatus } from '../domain/project-goal.entity';
 
+async function canAccessGoal(req: AuthenticatedRequest, goalId: string): Promise<boolean> {
+  if (!req.user) return false;
+  const goal = await goalsRepository.get(goalId);
+  if (!goal) return false;
+  if (req.user.role === 'admin' || req.user.role === 'system') return true;
+  return goal.uid === req.user.uid;
+}
+
 export class ResolverController {
   static async listGoals(req: AuthenticatedRequest, res: Response, next: NextFunction) {
     try {
@@ -32,6 +40,11 @@ export class ResolverController {
 
   static async reembedGoal(req: AuthenticatedRequest, res: Response, next: NextFunction) {
     try {
+      const canAccess = await canAccessGoal(req, req.params.goalId);
+      if (!canAccess) {
+        res.status(404).json({ error: 'goal_not_found' });
+        return;
+      }
       const goal = await reembedGoalUseCase(req.params.goalId);
       if (!goal) {
         res.status(404).json({ error: 'goal_not_found' });
@@ -48,6 +61,11 @@ export class ResolverController {
 
   static async deleteGoal(req: AuthenticatedRequest, res: Response, next: NextFunction) {
     try {
+      const canAccess = await canAccessGoal(req, req.params.goalId);
+      if (!canAccess) {
+        res.status(404).json({ error: 'goal_not_found' });
+        return;
+      }
       const ok = await goalsRepository.delete(req.params.goalId);
       if (!ok) {
         res.status(404).json({ error: 'goal_not_found' });
diff --git a/src/routes/index.ts b/src/routes/index.ts
index 9a7dc05..725e138 100644
--- a/src/routes/index.ts
+++ b/src/routes/index.ts
@@ -6,6 +6,7 @@ import { userRouter }      from '../modules/user/interfaces/user.routes';
 import { inventoryRouter } from '../modules/inventory/interfaces/inventory.routes';
 import { resolverRouter }  from '../modules/resolver/interfaces/resolver.routes';
 import { meRouter, adminRouter } from '../modules/security/interfaces/security.routes';
+import { migiRouter } from '../modules/migi/interfaces/migi.routes';
 import { economizerRouter } from '../infrastructure/ai/economizer/economizer.routes';
 import { pingPostgres, isPgvectorReady } from '../infrastructure/database/postgres';
 import { pingMongo, isMongoReady } from '../infrastructure/database/mongo';
@@ -76,6 +77,7 @@ export function registerRoutes(app: Express): void {
   api.use('/me',        meRouter);
   api.use('/admin',     adminRouter);
   api.use('/admin/economizer', economizerRouter);
+  api.use('/admin/migi', migiRouter);
 
   app.use('/api', api);
 
diff --git a/src/shared/middleware/request-id.middleware.ts b/src/shared/middleware/request-id.middleware.ts
index 5b1209e..1ab9496 100644
--- a/src/shared/middleware/request-id.middleware.ts
+++ b/src/shared/middleware/request-id.middleware.ts
@@ -1,11 +1,9 @@
 import { Request, Response, NextFunction } from 'express';
 import { randomUUID } from 'crypto';
 
-declare global {
-  namespace Express {
-    interface Request {
-      requestId?: string;
-    }
+declare module 'express-serve-static-core' {
+  interface Request {
+    requestId?: string;
   }
 }
 
diff --git a/src/shared/validators/schemas.ts b/src/shared/validators/schemas.ts
index 61c8d3e..6bf86fa 100644
--- a/src/shared/validators/schemas.ts
+++ b/src/shared/validators/schemas.ts
@@ -31,7 +31,7 @@ export const branchQuestSchema = z.object({
   userId: z.string().min(1).optional(),
   parentId: z.string().min(1),
   title: z.string().min(1).max(256),
-  branchKey: z.string().regex(/^[A-Za-z0-9_\-]{1,64}$/).optional().nullable(),
+  branchKey: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional().nullable(),
   description: z.string().max(8_000).optional(),
   acceptanceCriteria: z.string().max(8_000).optional()
 });
diff --git a/tests/integration/security-hardening.test.ts b/tests/integration/security-hardening.test.ts
index c4755f8..b598910 100644
--- a/tests/integration/security-hardening.test.ts
+++ b/tests/integration/security-hardening.test.ts
@@ -47,6 +47,12 @@ describe('integration: Sprint VIII security hardening', () => {
       expect(res.status).toBe(403);
       expect(res.body.error).toBe('forbidden');
     });
+
+    it('blokuje GET /api/admin/migi/status dla anonima (403)', async () => {
+      const res = await request(app).get('/api/admin/migi/status');
+      expect(res.status).toBe(403);
+      expect(res.body.error).toBe('forbidden');
+    });
   });
 
   describe('RODO endpoints wymagają konta', () => {
@@ -71,4 +77,44 @@ describe('integration: Sprint VIII security hardening', () => {
       expect(res.body.error).toBe('forbidden_ownership');
     });
   });
+
+  describe('Resolver goal ownership guard', () => {
+    it('blokuje reembed cudzego celu (404 goal_not_found)', async () => {
+      const createRes = await request(app)
+        .post('/api/resolver/goals')
+        .set('Authorization', 'Bearer user-owner')
+        .send({ title: 'owner goal' });
+      expect(createRes.status).toBe(201);
+      const goalId = createRes.body.goalId;
+
+      const reembedAsOther = await request(app)
+        .post(`/api/resolver/goals/${goalId}/reembed`)
+        .set('Authorization', 'Bearer user-other')
+        .send();
+
+      expect(reembedAsOther.status).toBe(404);
+      expect(reembedAsOther.body.error).toBe('goal_not_found');
+    });
+
+    it('blokuje delete cudzego celu i pozwala właścicielowi usunąć (404 -> 200)', async () => {
+      const createRes = await request(app)
+        .post('/api/resolver/goals')
+        .set('Authorization', 'Bearer user-owner-2')
+        .send({ title: 'owner goal 2' });
+      expect(createRes.status).toBe(201);
+      const goalId = createRes.body.goalId;
+
+      const deleteAsOther = await request(app)
+        .delete(`/api/resolver/goals/${goalId}`)
+        .set('Authorization', 'Bearer user-other-2');
+      expect(deleteAsOther.status).toBe(404);
+      expect(deleteAsOther.body.error).toBe('goal_not_found');
+
+      const deleteAsOwner = await request(app)
+        .delete(`/api/resolver/goals/${goalId}`)
+        .set('Authorization', 'Bearer user-owner-2');
+      expect(deleteAsOwner.status).toBe(200);
+      expect(deleteAsOwner.body.ok).toBe(true);
+    });
+  });
 });
```
