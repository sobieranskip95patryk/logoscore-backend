import { Router } from 'express';
import { firebaseAuthMiddleware, AuthenticatedRequest } from '../../../shared/middleware/auth.middleware';
import { inventoryRepository } from '../infrastructure/inventory.repository';
import { inventoryRules } from '../domain/inventory.entity';
import { eventBus } from '../../../core/events/event-bus';

export const inventoryRouter = Router();

inventoryRouter.get('/', firebaseAuthMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const items = await inventoryRepository.listByUser(req.user!.uid);
    res.json({ items });
  } catch (e) { next(e); }
});

inventoryRouter.post('/add', firebaseAuthMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { itemKey, quantity, metadata, rarity, soulbound } = req.body || {};
    if (!itemKey) { res.status(400).json({ error: 'itemKey_required' }); return; }
    const item = await inventoryRepository.add(req.user!.uid, itemKey, quantity ?? 1, {
      metadata, rarity, soulbound: !!soulbound
    });
    eventBus.publish('inventory.item.added', {
      itemId: item.id, itemKey, quantity: item.quantity, rarity: item.rarity, soulbound: item.soulbound
    }, req.user!.uid);
    res.status(201).json(item);
  } catch (e) { next(e); }
});

inventoryRouter.delete('/:id', firebaseAuthMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const existing = await inventoryRepository.findById(req.params.id);
    if (!existing) { res.status(404).json({ error: 'not_found' }); return; }
    if (existing.userId !== req.user!.uid) { res.status(403).json({ error: 'forbidden' }); return; }
    try {
      inventoryRules.ensureRemovable(existing);
    } catch (err) {
      res.status(409).json({ error: 'soulbound', message: (err as Error).message });
      return;
    }
    const ok = await inventoryRepository.remove(req.params.id);
    if (!ok) { res.status(404).json({ error: 'not_found' }); return; }
    eventBus.publish('inventory.item.removed', { itemId: req.params.id }, req.user!.uid);
    res.status(204).send();
  } catch (e) { next(e); }
});
