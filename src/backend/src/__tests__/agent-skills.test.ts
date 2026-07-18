import { defaultSkillsForRole, listSkillCatalog, validateSkillIds } from '../modules/agent-skills';

describe('agent-skills', () => {
  it('lists elite skills with domains', () => {
    const catalog = listSkillCatalog();
    expect(catalog.length).toBeGreaterThan(20);
    expect(catalog.some((s) => s.domain === 'Business analysis')).toBe(true);
  });

  it('suggests skills for project manager', () => {
    const skills = defaultSkillsForRole('project_manager');
    expect(skills).toContain('scope-management');
    expect(skills).toContain('milestone-planning');
  });

  it('rejects unknown skill ids', () => {
    expect(() => validateSkillIds(['not-a-real-skill'])).toThrow(/Unknown skills/);
  });
});