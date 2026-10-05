export function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function rejected(code, message) {
  return { status: 'rejected', error: { code, message } };
}

export function createFeatureCommands(handlers, readState, afterApply) {
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
        return finish(request, rejected('unsupported_command', `Unsupported command: ${request.command}`));
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
      return { commands: Object.keys(handlers), state: readState() };
    },
  });
}
