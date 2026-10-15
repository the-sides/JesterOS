import { canonicalStringUnits } from './canonical-data.js';

// Transient scene observations, not host telemetry or persisted event copies.
export function createSceneRuntimeInventory(ctx) {
  const makeRecord = ctx.makeRecord ?? (value => value);
  const processes = makeRecord([]), applications = makeRecord([]), commands = makeRecord([]), localUsers = makeRecord([]), networkEndpoints = makeRecord([]);
  const feed = makeRecord({ entries: [], revision: 0 });
  let nextProcess = 1, nextEvent = 1;
  let applicationSources = [];
  const inventory = {
    profile: ctx.profile, hardware: ctx.hardware, processes, applications, commands, localUsers, networkEndpoints,
    get system() { return ctx.getShared('system'); },
    get runApps() { return ctx.getRunningAppIds(); },
    get windows() { return ctx.getWindows(); },
    get files() { return ctx.getFiles(); },
    get preferences() { return ctx.getShared('preferences'); },
    get fonts() { return ctx.getShared('fonts'); },
    get fontbook() { return ctx.getShared('fontbook'); },
    get audiomidi() { return ctx.getShared('audiomidi'); },
  };
  function synchronize() {
    const running = ctx.getRunningAppIds();
    for (let index = processes.length - 1; index >= 0; index--)
      if (!running.includes(processes[index].appId)) processes.splice(index, 1);
    for (const appId of running) {
      let process = processes.find(row => row.appId === appId);
      if (!process) {
        const ordinal = nextProcess++;
        process = makeRecord({ id: `process-${ordinal}`, appId, pid: 1000 + ordinal, startedAt: ctx.getSceneTime(),
          counters: { cpuTimeMs: 0, memoryBytes: 0, energyImpact: 0, bytesRead: 0, bytesWritten: 0,
            bytesReceived: 0, bytesSent: 0, wakeups: 0, threads: 1 } });
        processes.push(process);
      }
      process.counters.memoryBytes = canonicalStringUnits(ctx.getApplicationGraph(appId)) * 2;
    }
    const registered = Object.values(ctx.getApplications());
    if (registered.length !== applicationSources.length || registered.some((row, index) => row !== applicationSources[index])) {
      applicationSources = registered;
      applications.splice(0, applications.length, ...registered);
    }
    if (commands.length === 0) commands.push(...Object.entries(ctx.getCatalog()).map(([name, descriptor]) => ({
      name, targetSchema: descriptor.requestSchema.properties.target, payloadSchema: descriptor.requestSchema.properties.payload, profiles: descriptor.profiles,
    })));
    const users = ctx.getShared('session')?.users ?? [];
    for (let index = localUsers.length - 1; index >= 0; index--)
      if (!users.some(user => user.id === localUsers[index].id)) localUsers.splice(index, 1);
    for (const user of users) {
      let row = localUsers.find(row => row.id === user.id);
      if (!row) { row = { id: user.id, name: user.name, login: user.id, home: '/', plan: 'Fictional scene account; no remote host.' }; localUsers.push(row); }
      row.name = user.name;
    }
    return inventory;
  }
  function record(command, result, { appId, windowId = null, durationMs = 0 } = {}) {
    synchronize();
    if (nextEvent >= Number.MAX_SAFE_INTEGER) throw new Error('The scene operation identity capacity is exhausted.');
    const sequence = nextEvent++;
    feed.entries.push({ id: `event-${sequence}`, sequence, time: ctx.getSceneTime(), sourceAppId: appId ?? ctx.profile.defaults.desktopAppId,
      sourceWindowId: windowId, command, status: result.status, severity: result.status === 'rejected' ? 'warning' : 'info' });
    while (feed.entries.length > 2048 || canonicalStringUnits(feed) > 1024 * 1024
      || typeof ctx.canCommit === 'function' && ctx.canCommit(0) !== true) {
      if (!feed.entries.length) break;
      feed.entries.shift();
    }
    feed.revision++;
    const process = processes.find(row => row.appId === appId);
    if (process) {
      // Elapsed real local handler execution; not measured host CPU utilization.
      process.counters.cpuTimeMs += Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
      process.counters.wakeups++;
    }
  }
  return { getInventory: () => inventory, getSceneEvents: () => feed, record, synchronize };
}
