import core, { Authorizer } from './Core';
import { NotFoundError } from './Errors';
import Table, { TableConfig } from './Table';
import knexHelpers from './knexHelpers';

import withTimestamps from './plugins/withTimestamps';

export default core;

export {
  core,
  Authorizer,
  NotFoundError,
  Table,
  TableConfig,
  knexHelpers,
  withTimestamps,
};
