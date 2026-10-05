export function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function rejected(code, message) {
  return { status: 'rejected', error: { code, message } };
}

export function createFeatureCommands(handlers, readState, afterApply, catalog, readTargets, readProfile, knownCatalog) {
  const commandNames = Object.keys(handlers);
  if (!isRecord(catalog) || !isRecord(knownCatalog)
    || commandNames.some((name) => !Object.hasOwn(catalog, name) || !Object.hasOwn(knownCatalog, name))
    || Object.keys(catalog).some((name) => !Object.hasOwn(handlers, name))) {
    throw new Error('Every feature handler needs exactly one command catalog descriptor.');
  }
  function supported(name, profile) {
    return Object.hasOwn(handlers, name) && profile !== null && profile !== undefined
      && catalog[name].profiles.includes(profile.id)
      && profile.capabilities.includes(catalog[name].capability);
  }

  function unsupportedProfile(name) {
    return rejected('unsupported_profile', `The active OS profile does not support command: ${name}`);
  }
  // Composite handlers also use this registry: guard them before any mutation,
  // without repeating the outer request's DOM-settlement step.
  for (const name of commandNames) {
    const handler = handlers[name];
    handlers[name] = (target, payload) => supported(name, readProfile())
      ? handler(target, payload)
      : unsupportedProfile(name);
  }
  Object.freeze(handlers);
  function finish(request, result) {
    return typeof request?.requestId === 'string'
      ? { ...result, requestId: request.requestId }
      : result;
  }

  return Object.freeze({
    async execute(request) {
      if (!isRecord(request)
        || Object.keys(request).some((key) => !['requestId', 'command', 'target', 'payload'].includes(key))
        || typeof request.command !== 'string'
        || (request.requestId !== undefined && (typeof request.requestId !== 'string' || !request.requestId))) {
        return finish(request, rejected('invalid_request', 'Expected a command request with an optional nonempty requestId.'));
      }
      if (!Object.hasOwn(handlers, request.command)) {
        return finish(request, Object.hasOwn(knownCatalog, request.command)
          ? unsupportedProfile(request.command)
          : rejected('unsupported_command', `Unsupported command: ${request.command}`));
      }
      const target = request.target === undefined ? {} : request.target;
      const payload = request.payload === undefined ? {} : request.payload;
      if (!isRecord(target) || !isRecord(payload)) {
        return finish(request, rejected('invalid_arguments', 'Target and payload must be plain objects.'));
      }
      const result = await handlers[request.command](target, payload);
      if (result.status === 'applied') await afterApply();
      return finish(request, result);
    },
    inspect() {
      const profile = readProfile();
      // The renderer supplies a detached, proxy-free snapshot; do not copy it twice.
      return {
        commands: commandNames.filter((name) => supported(name, profile)),
        state: readState(),
      };
    },
    describe(command) {
      if (command !== undefined && typeof command !== 'string') {
        return rejected('invalid_arguments', 'Expected an optional command name.');
      }
      if (command !== undefined && !Object.hasOwn(knownCatalog, command)) {
        return rejected('unsupported_command', `Unsupported command: ${command}`);
      }
      const profile = readProfile();
      if (command !== undefined && !supported(command, profile)) {
        return unsupportedProfile(command);
      }
      const supportedNames = commandNames.filter((name) => supported(name, profile));
      const commands = command === undefined
        ? Object.fromEntries(supportedNames.map((name) => [name, catalog[name]]))
        : { [command]: catalog[command] };
      return structuredClone({
        version: 1,
        profile,
        profiles: [...new Set(supportedNames.flatMap((name) => catalog[name].profiles))],
        commands,
        targets: readTargets(),
      });
    },
  });
}
