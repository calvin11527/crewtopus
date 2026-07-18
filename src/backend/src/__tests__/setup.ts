import { closeDatabase, initDatabase } from '../database';
import { seedDefaultAgents } from '../modules/agent-registry';
import { seedDefaultCapabilities } from '../modules/capability-registry';
import { seedDefaultPolicies } from '../modules/seed-policies';

beforeEach(() => {
  closeDatabase();
  process.env.AGENTHUB_DB_PATH = ':memory:';
  initDatabase();
  seedDefaultAgents();
  seedDefaultCapabilities();
  seedDefaultPolicies();
});

afterAll(() => {
  closeDatabase();
  delete process.env.AGENTHUB_DB_PATH;
});