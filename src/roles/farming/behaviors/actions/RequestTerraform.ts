import type { Bot } from 'mineflayer';
import { type FarmingBlackboard, requestTerraformIfNeeded } from '../../Blackboard';
import type { BehaviorNode, BehaviorStatus } from '../types';

/**
 * RequestTerraform - Request landscaper to terraform rough terrain
 *
 * This action checks if the farm center area needs terraforming
 * and sends a request via village chat if so.
 */
export class RequestTerraform implements BehaviorNode {
    name = 'RequestTerraform';

    async tick(bot: Bot, bb: FarmingBlackboard): Promise<BehaviorStatus> {
        // No farm center yet
        if (!bb.farmCenter) return 'failure';

        // No village chat for communication
        if (!bb.villageChat) return 'failure';

        // Already waiting for terraform
        if (bb.waitingForTerraform) {
            bb.lastAction = 'wait_terraform';
            // Check if done
            if (bb.terraformRequestedAt && bb.villageChat.isTerraformDoneAt(bb.terraformRequestedAt)) {
                console.log(`[Farmer] Terraform complete, can start farming!`);
                bb.waitingForTerraform = false;
                bb.terraformRequestedAt = null;
                return 'success';
            }
            return 'running'; // Still waiting
        }

        // Try to request terraform if needed
        bb.lastAction = 'check_terraform';
        const requested = requestTerraformIfNeeded(bot, bb);

        if (requested) {
            return 'running'; // Now waiting for terraform
        }

        // Terrain is fine, no terraform needed
        return 'failure';
    }
}
