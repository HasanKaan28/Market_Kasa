import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = '.github/workflows';
const workflows = () =>
  readdirSync(DIR)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => ({ name, text: readFileSync(`${DIR}/${name}`, 'utf8') }));

/** The lines of the `on:` block, up to the next top-level key. */
function triggers(text: string): string {
  const start = text.indexOf('\non:');
  const rest = text.slice(start + 1);
  const end = rest.slice(1).search(/\n\S/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

describe('workflows', () => {
  it('never deploys the live app on a push', () => {
    // The v1 workflow redeployed Pages and republished releases on every push to main (K13).
    expect(existsSync(`${DIR}/android-apk.yml`)).toBe(false);
    for (const { name, text } of workflows()) {
      if (!text.includes('actions/deploy-pages')) {
        continue;
      }
      // Only a run started by hand, with the box ticked, may reach the live app.
      expect(triggers(text), name).not.toMatch(/branches/);
      expect(text, name).toMatch(/if: .*inputs\.deploy_pages/);
    }
    const release = readFileSync(`${DIR}/v2-release.yml`, 'utf8');
    expect(triggers(release)).toContain('workflow_dispatch');
    expect(triggers(release)).toContain("tags: ['v2.*']");
    expect(triggers(release)).not.toMatch(/branches/);
    expect(release).toContain('draft: true');
  });
});
