import Knex from 'knex';
import { EventEmitter } from 'events';
import { Request, Response } from 'express';
import { ChangeSummary, ContextFactory, Table, ShouldEventBeSent } from '.';

export default function sse<Context>(
  knex: Knex,
  emitter: EventEmitter,
  getContext: ContextFactory<Context>,
  tables: Table<Context>[],
  shouldEventBeSent?: ShouldEventBeSent<Context>
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
      const isVisible = async () => {
        const table = tables.find(
          t =>
            t.tableName === changeSummary.tableName &&
            t.schemaName === changeSummary.schemaName
        );
        if (!table) return false;

        const stmt = knex(`${table.schemaName}.${table.tableName}`)
          .where(`${table.tableName}.id`, changeSummary.row.id)
          .first();

        if (table.tenantIdColumnName) {
          stmt.where(
            `${table.tableName}.${table.tenantIdColumnName}`,
            changeSummary.row[table.tenantIdColumnName]
          );
        }

        await table.policy(stmt, context, 'read');

        return Boolean(await stmt);
      };

      const shouldSend = shouldEventBeSent
        ? await shouldEventBeSent(isVisible, changeSummary, context)
        : await isVisible();

      if (!shouldSend) return;

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
