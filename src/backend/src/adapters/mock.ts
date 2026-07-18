import fs from 'fs';
import path from 'path';
import type { AgentAdapter, AdapterInput, AdapterOutput } from './base';
import { buildFullPrompt, estimateTokens } from './base';
import { createCliStreamHandlers, endCliStream, type CliStreamContext } from '../modules/cli-stream';

const MOCK_RESPONSES: Record<string, string> = {
  planning: '## Plan\n1. Analyze requirements\n2. Design architecture\n3. Define implementation steps\n4. Set acceptance criteria',
  implementation: '## Implementation\n```typescript\nexport function feature() {\n  return "implemented";\n}\n```',
  review: 'APPROVED\n## Review\n- Code quality: Good\n- Test coverage: Adequate\n- Acceptance criteria met',
  testing: 'PASS\n## Tests\n```typescript\ndescribe("feature", () => {\n  it("should work", () => expect(true).toBe(true));\n});\n```',
  research: '## Research\nKey findings documented with references and recommendations.',
  analysis: '## Analysis\nData patterns identified. Risk areas flagged. Recommendations provided.',
  architecture: '## Architecture\nComponent diagram defined. Interfaces specified. Data flow documented.',
  default: '## Mock Response\nTask processed successfully by mock agent.',
};

/** Deterministic mock adapter for CI and testing. */
export class MockAdapter implements AgentAdapter {
  readonly type = 'mock' as const;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async execute(input: AdapterInput): Promise<AdapterOutput> {
    const fullPrompt = buildFullPrompt(input);
    const capability = (input.config?.capability as string) || '';
    const cwd = input.config?.cwd as string | undefined;
    let content =
      MOCK_RESPONSES[capability] ||
      MOCK_RESPONSES[Object.keys(MOCK_RESPONSES).find((k) => fullPrompt.toLowerCase().includes(k)) || ''] ||
      MOCK_RESPONSES.default;

    if (fullPrompt.includes('AGENTHUB_BA_PHASE') && cwd) {
      fs.mkdirSync(cwd, { recursive: true });
      const requirements =
        '# Requirements\n\n## Scope\nImplement the requested story with clear acceptance criteria.\n';
      const plan = '# Implementation plan\n\n1. Analyze codebase\n2. Implement feature\n3. Add tests\n';
      fs.writeFileSync(path.join(cwd, 'requirements.md'), requirements);
      fs.writeFileSync(path.join(cwd, 'plan.md'), plan);
      content =
        '## Business analysis\nRequirements and plan written.\n\n## Acceptance criteria\n- Feature meets story description\n- Tests pass\n- Review approved\n';
    } else if (fullPrompt.includes('AGENTHUB_PM_PHASE')) {
      content =
        '## Task decomposition\nSplitting into implementation tasks.\n\n```json\n' +
        '{\n' +
        '  "atomic": false,\n' +
        '  "tasks": [\n' +
        '    {\n' +
        '      "title": "Implement core feature",\n' +
        '      "description": "Build the main story functionality",\n' +
        '      "acceptanceCriteria": ["Core flow works end-to-end"],\n' +
        '      "storyPoints": 3\n' +
        '    },\n' +
        '    {\n' +
        '      "title": "Add tests and polish",\n' +
        '      "description": "Cover the feature with tests and edge cases",\n' +
        '      "acceptanceCriteria": ["Unit tests pass"],\n' +
        '      "storyPoints": 2\n' +
        '    }\n' +
        '  ]\n' +
        '}\n' +
        '```';
    } else if (capability === 'implementation' && cwd) {
      fs.mkdirSync(cwd, { recursive: true });
      const boundary = '---AGENTHUB_TASK_BOUNDARY---';
      const taskSection = fullPrompt.includes(boundary)
        ? fullPrompt.split(boundary).pop() || fullPrompt
        : fullPrompt.includes('## Task')
          ? fullPrompt.split('## Task').pop() || fullPrompt
          : fullPrompt;
      const prompt = taskSection.toLowerCase();
      if (prompt.includes('automation-checklist') || prompt.includes('readiness checklist')) {
        fs.writeFileSync(
          path.join(cwd, 'automation-checklist.md'),
          '# Automation readiness\n- [x] Epic and child stories created\n- [x] Grok→Copilot pipeline configured\n- [x] Activity and loop history recorded\n'
        );
        content = '## Implementation\nCreated automation-checklist.md.';
      } else if (prompt.includes('pipeline-verification') || prompt.includes('pipeline activity')) {
        fs.writeFileSync(
          path.join(cwd, 'pipeline-verification.md'),
          '# Pipeline verification\nImplement and review steps completed; activity feed updated.\n'
        );
        content = '## Implementation\nCreated pipeline-verification.md.';
      } else if (prompt.includes('improvements.md') || prompt.includes('prioritized improvements')) {
        fs.writeFileSync(
          path.join(cwd, 'improvements.md'),
          '# Improvements\n- Improve board epic hierarchy UI\n- Add async pipeline polling on the board\n- Harden privacy guard and context scope\n'
        );
        content = '## Implementation\nCreated improvements.md with 3 prioritized recommendations.';
      }
    }

    const streamCtx = input.config?.cliStream as CliStreamContext | undefined;
    if (streamCtx?.workItemId) {
      const handlers = createCliStreamHandlers({ ...streamCtx, agentType: 'mock' });
      handlers.onStdout?.(`$ mock-agent --capability ${capability || 'default'}\r\n`);
      for (const line of content.split('\n')) {
        handlers.onStdout?.(`${line}\r\n`);
      }
      handlers.onStdout?.(`\r\n[mock] completed (${estimateTokens(content)} tokens est.)\r\n`);
      endCliStream(streamCtx.workItemId, {
        agentType: 'mock',
        phase: streamCtx.phase,
        loopIteration: streamCtx.loopIteration,
      });
    }

    return {
      content,
      tokenCount: estimateTokens(fullPrompt) + estimateTokens(content),
      metadata: { adapter: 'mock', deterministic: true, capability },
    };
  }

  shutdown(): void {
    /* no-op */
  }
}