import { EventEmitter } from 'events';
import { Request, Response } from 'express';
import { ChangeSummary, ContextFactory } from '.';

export default function sse<Context>(
  emitter: EventEmitter,
  getContext: ContextFactory<Context>,
  shouldEventBeSent: (
    event: ChangeSummary,
    context: Context
  ) => Promise<boolean>
) {
  const sseHandlers = new Set<(changeSummary: ChangeSummary) => void>();

  emitter.on('change', (changeSummary: ChangeSummary) => {
    sseHandlers.forEach(handler => handler(changeSummary));
  });

  return async (req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('\n');

    const context = getContext(req, res);

    const handler = async (changeSummary: ChangeSummary) => {
      if (!(await shouldEventBeSent(changeSummary, context))) {
        return;
      }

      const batch =
        [
          `id: ${Date.now()}`,
          'event: update',
          `data: ${JSON.stringify(changeSummary)}`,
        ].join('\n') + '\n\n';

      res.write(batch);
    };

    const interval = setInterval(() => {
      res.write(':\n\n');
    }, 10000);

    const onEnd = () => {
      sseHandlers.delete(handler);
      clearInterval(interval);
    };

    sseHandlers.add(handler);
    req.on('end', onEnd);
    req.on('close', onEnd);
  };
}
