import { object, choice } from './command-schema.js';
import { callsIdSchema, callsSchemaValid, callsCapabilities, commitCallsCandidate, startLocalCall, callById } from './calls-state.js';
import { recipientIdentity } from './messages-recipients.js';

const recipientSchema = object({
  contactId: callsIdSchema,
  name: { type: 'string', minLength: 1, maxLength: 512 },
  address: { type: 'string', minLength: 1, maxLength: 320 }
}, ['name', 'address']);
export const callsGroupSchema = object({
  kind: choice('audio', 'video'),
  recipients: { type: 'array', items: recipientSchema, minItems: 2, maxItems: 31 }
});
const reject = (code, message) => ({ status: 'rejected', error: { code, message }, code, message });

// One outer preflight and commit owns the complete group, never a visible first-call scaffold.
export function startLocalGroupCall(state, spec, time, canCommit, guard = () => true) {
  if (!callsSchemaValid(spec, callsGroupSchema)) return reject('invalid_arguments', 'Supply a closed audio/video group specification with two or more resolved recipients.');
  return commitCallsCandidate(state, candidate => {
    const capabilities = callsCapabilities(candidate.profileId);
    if (!capabilities.groupSupported) return reject('unavailable', capabilities.groupUnavailableReason);
    if (spec.recipients.length > capabilities.maxRemoteParticipants) return reject('limit_exceeded', `This profile supports at most ${capabilities.maxRemoteParticipants} remote participants (${capabilities.maxRemoteParticipants + 1} including you).`);
    const addresses = new Set(), contacts = new Set();
    for (const recipient of spec.recipients) {
      const address = recipientIdentity(recipient.address);
      if (!address || !recipient.name.trim() || addresses.has(address) || (recipient.contactId && contacts.has(recipient.contactId))) return reject('invalid_arguments', 'Group recipients require distinct nonblank addresses and canonical contact identities.');
      addresses.add(address);
      if (recipient.contactId) contacts.add(recipient.contactId);
    }
    const started = startLocalCall(candidate, { ...spec.recipients[0], kind: spec.kind }, time, () => true);
    if (started.status !== 'applied') return started;
    const call = callById(candidate, started.callId);
    const firstId = call.participants[0].id;
    call.participants = spec.recipients.map((recipient, index) => ({
      id: index === 0 ? firstId : `${call.id}-remote-${index + 1}`,
      contactId: recipient.contactId ?? null,
      name: recipient.name.trim(), address: recipient.address.trim(), role: 'remote', media: 'studio'
    }));
    return { callId: call.id, participantIds: call.participants.map(row => row.id) };
  }, canCommit, guard);
}
