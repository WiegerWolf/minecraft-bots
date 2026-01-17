import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

export type POICategory = 'crafting_table' | 'chest' | 'farm_center' | 'farm_chest';

export interface POI {
    position: Vec3;
    category: POICategory;
    timestamp: number;
    metadata?: any;
}

export type Constructor<T = {}> = new (...args: any[]) => T;

/**
 * Mixin that adds memory of points of interest to a Role.
 */
export function KnowledgeMixin<TBase extends Constructor>(Base: TBase) {
    return class extends Base {
        private pois: POI[] = [];

        // Changed to public so Tasks can call it
        public rememberPOI(category: POICategory, position: Vec3, metadata?: any) {
            // Check if already exists nearby
            const existing = this.pois.find(p => p.category === category && p.position.distanceTo(position) < 1);
            if (existing) {
                existing.timestamp = Date.now();
                existing.metadata = metadata;
                return;
            }

            this.pois.push({
                category,
                position,
                timestamp: Date.now(),
                metadata
            });
        }

        // Changed to public so Tasks can call it
        public getPOIs(category: POICategory): POI[] {
            return this.pois.filter(p => p.category === category);
        }

        // Changed to public so Tasks can call it
        public getNearestPOI(bot: Bot, category: POICategory): POI | null {
            const botPos = bot.entity?.position;
            if (!botPos) return null;

            const matches = this.getPOIs(category);
            if (matches.length === 0) return null;

            return matches.sort((a, b) => a.position.distanceTo(botPos) - b.position.distanceTo(botPos))[0] || null;
        }

        // Changed to public so Tasks can call it
        public forgetPOI(category: POICategory, position: Vec3) {
            this.pois = this.pois.filter(p => !(p.category === category && p.position.distanceTo(position) < 1));
        }
    };
}