import type { EventBridgeEvent } from 'aws-lambda';

export async function handler(_event: EventBridgeEvent<'Scheduled Event', unknown>): Promise<void> {
  console.log(
    JSON.stringify({ level: 'info', msg: 'orchestrator stub: due-feed fan-out lands in Phase 3' }),
  );
}
