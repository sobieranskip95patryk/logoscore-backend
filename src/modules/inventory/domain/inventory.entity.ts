export type ItemRarity = 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'MYTHIC';

export const ITEM_RARITIES: ItemRarity[] = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'];

export interface InventoryItemEntity {
  id: string;
  userId: string;
  itemKey: string;
  quantity: number;
  rarity: ItemRarity;
  soulbound: boolean;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export const inventoryRules = {
  ensureRarity(value: unknown): ItemRarity {
    if (typeof value !== 'string' || !ITEM_RARITIES.includes(value as ItemRarity)) {
      return 'COMMON';
    }
    return value as ItemRarity;
  },
  /**
   * Soulbound items są niezbywalne — nie można ich usunąć ani transferować.
   */
  ensureRemovable(item: InventoryItemEntity): void {
    if (item.soulbound) {
      throw new Error(`item ${item.id} is soulbound and cannot be removed`);
    }
  }
};
