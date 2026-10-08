import { pawnMotion } from '../render/motion/motion-names.js';
import { pawnAnimationFor } from '../render/motion/pawn-animation.js';
import { targetReach, skillVfxPlace } from './skill-place.js';

const PLACEMENT_NOTE = '実ゲームとエフェクト表示位置等に差異あり。復元不能。';

export const chainLinksOf = (entry) => (Array.isArray(entry.chain) && entry.chain.length > 1 ? entry.chain : [{ effect: entry.effect, slot: entry.slot, vfxRel: entry.vfxRel, seRels: entry.seRels }]);

const isEffectSlot = (link) => ((link && link.slot) | 0) >= 2;

export const skillMotion = (entry) => pawnMotion(pawnAnimationFor(entry && entry.skillId, entry && entry.effect));

export function skillPlaybackPlan(entry, available) {
  const chainLinks = chainLinksOf(entry);
  const seen = new Set();
  const links = [];
  chainLinks.forEach((link, i) => {
    if (!available[i]) return;
    const effect = isEffectSlot(link);
    if (effect) {
      const k = String(link.effect).toLowerCase();
      // NOTE: ビューワの選択 … 実機は効果1件×対象ユニットごとに1本出すが、対象が1体なので同じ演出は1本にまとめる（vfx-design 15.26）。
      if (seen.has(k)) return;
      seen.add(k);
    }
    links.push({ index: i, link, role: effect ? 'effect' : null });
  });
  const reach = targetReach(entry.skillMeta && entry.skillMeta.targetCells);
  return {
    chainLinks,
    links,
    reach,
    motion: skillMotion(entry),
    placeOf: (planLink, placement) => skillVfxPlace(planLink.link && planLink.link.slot, placement, reach),
    hasEffectLinks: links.some((x) => x.role === 'effect'),
  };
}

export const placementNote = (plan, placedCount) => (placedCount || plan.hasEffectLinks ? PLACEMENT_NOTE : '');
