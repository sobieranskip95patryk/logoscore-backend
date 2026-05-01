import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../../shared/middleware/auth.middleware';
import { gdprService } from '../application/gdpr.service';
import { securityAuditRepository } from '../infrastructure/security-audit.repository';
import { eventBus } from '../../../core/events/event-bus';

export class SecurityController {
  /**
   * GET /api/me/export — pełny eksport danych użytkownika (RODO art. 20).
   * Wymaga zweryfikowanego konta (nie anonim).
   */
  static async exportMe(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const uid = req.user!.uid;
      const data = await gdprService.exportUser(uid);
      await securityAuditRepository.record({
        uid,
        action: 'user.exported',
        ip: req.ip,
        path: req.path,
        method: req.method
      });
      eventBus.publish('security.user.exported', { uid, ts: data.exportedAt });
      res.setHeader('Content-Disposition', `attachment; filename="logoscore-export-${uid}.json"`);
      res.json(data);
    } catch (e) { next(e); }
  }

  /**
   * DELETE /api/me — kaskadowe usunięcie wszystkich danych użytkownika (RODO art. 17).
   * Operacja nieodwracalna; wymaga zweryfikowanego konta.
   */
  static async deleteMe(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const uid = req.user!.uid;
      const report = await gdprService.purgeUser(uid);
      await securityAuditRepository.record({
        uid,
        action: 'user.deleted',
        ip: req.ip,
        path: req.path,
        method: req.method,
        payload: report.counts as unknown as Record<string, unknown>
      });
      eventBus.publish('security.user.deleted', report);
      res.json(report);
    } catch (e) { next(e); }
  }

  /**
   * GET /api/admin/security/audit — odczyt audytu bezpieczeństwa.
   * Tylko rola 'admin' (egzekwowane przez requireRole na route'ie).
   */
  static async listAudit(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const items = await securityAuditRepository.list({
        uid: req.query.uid ? String(req.query.uid) : undefined,
        action: req.query.action as any,
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined
      });
      res.json({ count: items.length, items });
    } catch (e) { next(e); }
  }
}
