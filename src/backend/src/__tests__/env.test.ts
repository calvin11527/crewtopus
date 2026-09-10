import { envFlag, envNumber, envString, envWorkDir } from '../utils/env';

describe('env aliases', () => {
  const keys = [
    'CREWTOPUS_WORK_DIR',
    'AGENTHUB_WORK_DIR',
    'CREWTOPUS_JOB_CONCURRENCY',
    'AGENTHUB_JOB_CONCURRENCY',
  ];
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) {
      prev[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  });

  it('prefers CREWTOPUS_* over AGENTHUB_*', () => {
    process.env.AGENTHUB_WORK_DIR = '/legacy';
    process.env.CREWTOPUS_WORK_DIR = '/canonical';
    expect(envWorkDir()).toBe('/canonical');
    expect(envString('CREWTOPUS_WORK_DIR', 'AGENTHUB_WORK_DIR')).toBe('/canonical');
  });

  it('falls back to AGENTHUB_* when Crewtopus is unset', () => {
    process.env.AGENTHUB_WORK_DIR = '/legacy';
    expect(envWorkDir()).toBe('/legacy');
  });

  it('parses numbers and flags', () => {
    process.env.CREWTOPUS_JOB_CONCURRENCY = '4';
    expect(envNumber(3, 'CREWTOPUS_JOB_CONCURRENCY', 'AGENTHUB_JOB_CONCURRENCY')).toBe(4);
    process.env.CREWTOPUS_JOB_CONCURRENCY = 'true';
    expect(envFlag('true', 'CREWTOPUS_JOB_CONCURRENCY')).toBe(true);
  });
});
