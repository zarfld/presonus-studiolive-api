import { withLiveClient } from './helpers/liveUtil';

// Read-only file list tests against a real mixer (non-destructive).

describe('Live Mixer Files (Read-Only)', () => {
  jest.setTimeout(90000);

  test('lists projects and optionally scenes without mutation', async () => {
    const session = await withLiveClient(6000);
    if (!session) {
      console.warn('No mixers discovered; skipping file list test (no-op)');
      return;
    }

    const { client, cleanup } = session;

    // Projects list
    const projects = await (client as any).getProjects(false);
    expect(Array.isArray(projects)).toBe(true);

    // If there are projects, try fetching scenes of the first project (read-only)
    if (projects.length > 0) {
      const first = projects[0];
      const scenes = await (client as any).getScenesOfProject(first.name);
      expect(Array.isArray(scenes)).toBe(true);
    }

    // Channel presets list
    const presets = await (client as any).getChannelPresets();
    expect(Array.isArray(presets)).toBe(true);

    await cleanup();
  });
});
