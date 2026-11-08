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

/** The text of one job, from its key to the next job at the same depth. */
function job(text: string, name: string): string {
  const start = text.indexOf(`\n  ${name}:`);
  const rest = text.slice(start + 1);
  const end = rest.slice(1).search(/\n {2}\S/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

describe('workflows', () => {
  it('never deploys the live app on a push to a branch', () => {
    // The v1 workflow redeployed Pages and republished releases on every push to main (K13).
    expect(existsSync(`${DIR}/android-apk.yml`)).toBe(false);
    for (const { name, text } of workflows()) {
      if (!text.includes('actions/deploy-pages')) {
        continue;
      }
      expect(triggers(text), name).not.toMatch(/branches/);
    }
    const release = readFileSync(`${DIR}/v2-release.yml`, 'utf8');
    expect(triggers(release)).toContain('workflow_dispatch');
    expect(triggers(release)).toContain("tags: ['v2.*']");
    expect(triggers(release)).not.toMatch(/branches/);
    expect(release).toContain('draft: true');
    expect(release).toContain('Kurmadan önce yedek alın');
  });

  it('publishes the web app from a v2 tag or a run started by hand', () => {
    const deploy = job(readFileSync(`${DIR}/v2-release.yml`, 'utf8'), 'deploy-pages');
    expect(deploy).toMatch(/if: .*inputs\.deploy_pages/);
    expect(deploy).toMatch(/if: .*startsWith\(github\.ref, 'refs\/tags\/v2\.'\)/);
  });

  it('builds every package against the server', () => {
    const release = readFileSync(`${DIR}/v2-release.yml`, 'utf8');
    for (const name of ['build-web', 'build-android', 'build-windows']) {
      const text = job(release, name);
      expect(text, name).toContain('VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL }}');
      expect(text, name).toContain(
        'VITE_SUPABASE_PUBLISHABLE_KEY: ${{ vars.VITE_SUPABASE_PUBLISHABLE_KEY }}',
      );
    }
    // The publishable key is a repository variable, never a secret baked into the app by mistake.
    expect(release).not.toMatch(/secrets\.VITE_/);
  });

  it('signs the Android release with the same key every time', () => {
    const android = job(readFileSync(`${DIR}/v2-release.yml`, 'utf8'), 'build-android');
    expect(android).toContain('secrets.ANDROID_KEYSTORE_BASE64');
    expect(android).toContain('assembleRelease');
    // A tag never ships a debug-signed APK, which could not update the one before it.
    expect(android).toMatch(/refs\/tags\/[\s\S]*exit 1/);
    const gradle = readFileSync('android/app/build.gradle', 'utf8');
    expect(gradle).toContain("System.getenv('MK_KEYSTORE_PATH')");
    expect(gradle).toContain('versionCode appVersionCode');
  });

  it('publishes the desktop update feed under fixed download names', () => {
    const release = readFileSync(`${DIR}/v2-release.yml`, 'utf8');
    expect(release).toContain('release-files/latest.yml');
    expect(release).toContain('release-files/*.exe.blockmap');
    expect(release).toContain('out/Market-Kasa.apk');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      build: { publish: { provider: string }[]; nsis: { artifactName: string } };
    };
    expect(pkg.build.publish[0]?.provider).toBe('github');
    // The site's download button points at releases/latest/download/<name>: the name never changes.
    expect(pkg.build.nsis.artifactName).toBe('Market-Kasa-Setup.${ext}');
  });

  it('refuses to release a build without the server address', () => {
    const web = job(readFileSync(`${DIR}/v2-release.yml`, 'utf8'), 'build-web');
    expect(web).toMatch(/refs\/tags\/[\s\S]*VITE_SUPABASE_URL[\s\S]*exit 1/);
  });
});
